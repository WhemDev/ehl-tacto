"""The hybrid: Tugra's engine (proto/, algorithm A9h) plays every case; the orchestra is the fallback.

A9 won or tied every case type on the hosted practice cases (2026-10-10 18:15, mean 0.688: P08 0.586 and P18 0.485
against the orchestra's 0.52 and 0.39; P10 and P11 equal). A9h is A9 with A6's RFQ play: A9's RFQ-only settings
lose 0.13 on sandbox D02 once replies are fresh. ENGINE_VARIANT picks the algorithm (proto/variants.py), ENGINE_CFG
(JSON) overrides single settings, HYBRID_ENGINE_TYPES limits the engine to a comma list of case types ("all" is the
default, "none" gives every case to the orchestra).

The case is opened once, here, through our table - so both agents share the event log (dashboard, run notes), the
final's resume after a restart, and the wave's cap. The engine talks to an ArenaClient; it gets a small client that
sends through that table.

The 60-second clock runs from the supplier's reply. Two things on this path used to eat it (sandbox D02
095febf129ec15fd: a €13.90 final offer lost, bug #9): a reply's attachments were downloaded and parsed before the
reply was seen (17-21 s per quote PDF on the hosted arena under load), and a final offer rested while a rival still
negotiated. Here replies' attachments load in the background (the opening quotes stay eager: standard terms, floors)
and the engine re-estimates its target when a cost breakdown arrives; the engine itself now accepts a best final
offer after at most FINAL_GRACE_S.
"""

import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path

from .. import events as event_log
from ..play import CLOSE_BEFORE_CAP_S, ROUND_MARGIN_S
from . import engine_writer

log = logging.getLogger("arena")
SAFETY_CAP_S = 8 * 60  # the final's wave cap
LOG_DIR = Path(__file__).resolve().parents[2] / "proto" / "runs" / "hybrid"
# the engine's notes that are decisions: shown on the dashboard as planned moves
PLAN_NOTES = {"accept", "hold", "push", "mirror_alternative", "cap_close", "bar", "stagger", "meet_field",
              "accept_retry", "theirs_sheet", "required_term", "recalled", "fallback_counter"}
STEP_NOTES = ("target", "crash", "error", "close_failed", "close_failed_2", "resync", "attachment_missing")
BREAKDOWN_HINT = re.compile(r"conversion|Material accounts for about", re.I)
DOCS = ThreadPoolExecutor(max_workers=4, thread_name_prefix="docs")


def engine_types():
    forced = os.environ.get("HYBRID_ENGINE_TYPES", "").strip().lower()
    if forced in ("", "all"):
        return None  # every type
    if forced == "none":
        return set()
    return {t.strip() for t in forced.split(",") if t.strip()}


def plays_engine(case):
    types = engine_types()
    return types is None or case.get("type") in types


def variant():
    return os.environ.get("ENGINE_VARIANT", "A9h")  # A9's rules with A6's RFQ play: see proto/variants.py


class _Opened:
    """The table, with the case already opened: `open` hands back that opening (no second session)."""

    def __init__(self, table, case, threads):
        self._t, self._opening = table, (case, threads)

    def __getattr__(self, name):
        return getattr(self._t, name)

    def open(self, case_id):
        return self._opening


class _TableClient:
    """What the engine calls on an ArenaClient, sent through our table (event log, resume, results)."""

    def __init__(self, table, case_id, case, threads):
        self.t, self.case_id = table, case_id
        self.opening = {"session_id": table.session_id, "case": case, "threads": threads}

    def _ctx(self):  # the engine's worker threads: their events belong to this case
        event_log.ctx.case, event_log.ctx.session = self.case_id, self.t.session_id

    def open_session(self, case_id):
        return self.opening

    def send_message(self, session_id, supplier_id, message):
        self._ctx()
        if message.get("action"):
            return self.t.close(supplier_id, message)
        return self.t.send(supplier_id, message)

    def attachment(self, session_id, attachment_id):
        return self.t.attachment(attachment_id)

    def thread(self, session_id, supplier_id):
        return self.t.client.thread(session_id, supplier_id)

    def session(self, session_id):
        return self.t.client.session(session_id)


def engine_config():
    from proto.variants import VARIANTS

    return replace(VARIANTS[variant()][1], **json.loads(os.environ.get("ENGINE_CFG") or "{}"))


def _negotiator(case_id):
    """The engine's class for this case: the sandbox's demo facts, else facts and floors from the data."""
    import proto.engine as eng
    from proto.practice import PracticeNegotiator

    base = eng.Negotiator if case_id in eng.FACTS else PracticeNegotiator

    class Negotiator(base):
        writer = None  # the LLM `complete` for ENGINE_WRITER=llm

        def __init__(self, *args, **kwargs):
            self._opened, self._pending = False, set()
            super().__init__(*args, **kwargs)  # the opening quotes load eagerly: standard terms, floors
            self._opened = True

        def _docs(self, events):
            """Replies: their attachments load in the background; the reply is acted on at once."""
            if not self._opened:
                return super()._docs(events)
            for m in events:
                atts = [
                    a
                    for a in m.get("attachments") or []
                    if a.get("attachment_id") and "text" not in a and a["attachment_id"] not in self._pending
                ]
                if atts:
                    self._pending.update(a["attachment_id"] for a in atts)
                    DOCS.submit(self._fetch, m, atts)

        def _fetch(self, m, atts):
            self.c._ctx()
            try:
                super()._docs([m])
            except Exception:  # a missing document is not a reason to stop negotiating
                log.exception("attachments of a reply")
            finally:
                self._pending.difference_update(a["attachment_id"] for a in atts)
            if BREAKDOWN_HINT.search(" ".join(a.get("text") or "" for a in atts)):
                try:
                    self._estimate()  # a cost breakdown sharpens the target (the engine looked once, after round 1)
                except Exception:
                    log.exception("re-estimate after a document")

        def write(self, t, rnd, sheets, rival=None):
            msg = super().write(t, rnd, sheets, rival)
            if engine_writer.mode():
                msg["_draft"] = True  # rewritten in send(), outside the RFQ loop's lock
            return msg

        def send(self, t, msg):
            if msg.pop("_draft", False):
                self.c._ctx()  # a pool thread in the single-supplier loop: log the model's call with this case
                msg = engine_writer.prepare(self.writer, msg, self.case, t.last.get("body"))
            return super().send(t, msg)

        def near_cap(self):  # the wave's cap may move (the host can extend a wave): ask each time
            cap = self.deadline() if callable(self.deadline) else self.deadline
            return cap is not None and time.time() > cap - max(CLOSE_BEFORE_CAP_S, self.slowest + ROUND_MARGIN_S)

        def note(self, kind, **kw):
            super().note(kind, **kw)
            self.c._ctx()
            if kind == "round":  # the single-supplier loop names its round and goal before it sends
                self.at = (kw.get("rnd"), kw.get("goal"))
            if kind in PLAN_NOTES:
                c = kw.get("c", kw.get("best"))
                why = kw.get("why") or ", ".join(f"{k} {v}" for k, v in kw.items() if k not in ("c", "supplier"))
                event_log.emit("plan", move=kind.replace("_", " "), supplier=kw.get("supplier"), c=c, why=why[:300])
            elif kind == "send":
                rnd, goal = getattr(self, "at", (None, None))
                event_log.emit("plan", move="send", phase="engine", supplier=kw.get("supplier"),
                               round=kw.get("rnd", rnd or 0), target=kw.get("goal", goal),
                               sheets=kw.get("sheets"), arguments=kw.get("refs") or [], took=0)
            elif kind in STEP_NOTES:
                event_log.emit("engine", step=kind, **{k: v for k, v in kw.items() if k != "body"})

    return Negotiator


class Hybrid:
    def __init__(self, new_orchestra, complete=None):
        self.new_orchestra, self.complete = new_orchestra, complete  # complete: the engine's writer (ENGINE_WRITER)

    def play_case(self, table, case_id, deadline=None):
        case, threads = table.open(case_id)
        if getattr(table, "done", None):  # resumed a case that had already ended
            return table.done
        if not plays_engine(case):
            event_log.emit("engine", step="route", agent="orchestra", type=case.get("type"))
            return self.new_orchestra().play_case(_Opened(table, case, threads), case_id, deadline)
        writes = engine_writer.mode() or "template"
        event_log.emit("engine", step="route", agent=f"engine {variant()} ({writes})", type=case.get("type"))
        return self._engine(table, case_id, case, threads, deadline)

    def _engine(self, table, case_id, case, threads, deadline):
        client = _TableClient(table, case_id, case, threads)
        # outside the final, a wave's cap all the same: the engine's RFQ loop waits for ever when every supplier
        # has made a final offer and each is dearer than our alternative (arena-sim D02); the cap closes it
        deadline = deadline or time.time() + SAFETY_CAP_S
        table.eager_documents = False  # replies come straight to the engine; it loads their attachments itself
        try:  # setting up only reads (documents, data, the target): if it breaks, the orchestra plays the case
            n = _negotiator(case_id)(client, case_id, engine_config(), quiet=True, deadline=deadline)
            n.writer = self.complete
        except Exception as e:
            log.exception("engine could not start on %s", case_id)
            event_log.emit("warning", message=f"engine could not start ({type(e).__name__}: {e}) - orchestra plays")
            table.eager_documents = True
            return self.new_orchestra().play_case(_Opened(table, case, threads), case_id, deadline)
        try:
            return n.run()
        except Exception as e:  # never leave a session open: take the best standing offer (or walk)
            log.exception("engine failed on %s", case_id)
            event_log.emit("warning", message=f"engine failed ({type(e).__name__}: {e}) - closing")
            try:
                return n.closing_move()
            except Exception:
                log.exception("closing failed")
                return n.walk()
        finally:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            path = LOG_DIR / f"{case_id.replace(':', '_')}-{n.sid}.json"
            path.write_text(json.dumps(n.log, indent=1, default=str), encoding="utf-8")
