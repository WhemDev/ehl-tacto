"""The hybrid: each case goes to the agent that won its case type on the hosted practice cases.

    Tugra's engine (proto/, algorithm A3)  price increases, renewals, RFQs, bundles  (P01-P05, P07)
    the orchestra (agents/orchestra.py)    raw material, capacity, quality           (P08, P10, P11, P18)

The case is opened once, here, through our table - so both agents share the event log (dashboard, run
notes), the final's resume after a restart, and the wave's cap. The engine talks to an ArenaClient; it gets
a small client that sends through that table. HYBRID_ENGINE_TYPES overrides the split ("all", "none", or
a comma list of case types); ENGINE_CFG (JSON) overrides single settings of the engine's Config.
"""

import json
import logging
import os
import time
from dataclasses import replace
from pathlib import Path

from .. import events as event_log
from ..play import CLOSE_BEFORE_CAP_S, ROUND_MARGIN_S

log = logging.getLogger("arena")
ENGINE_TYPES = {"price_increase", "renewal", "rfq", "bundling"}
SAFETY_CAP_S = 8 * 60  # the final's wave cap
LOG_DIR = Path(__file__).resolve().parents[2] / "proto" / "runs" / "hybrid"
# the engine's notes that are decisions: shown on the dashboard as planned moves
PLAN_NOTES = {"accept", "hold", "push", "mirror_alternative", "cap_close", "bar", "stagger", "meet_field"}


def engine_types():
    forced = os.environ.get("HYBRID_ENGINE_TYPES", "").strip().lower()
    if forced == "all":
        return None  # every type
    if forced == "none":
        return set()
    return {t.strip() for t in forced.split(",") if t.strip()} if forced else ENGINE_TYPES


def plays_engine(case):
    types = engine_types()
    return types is None or case.get("type") in types


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

    return replace(VARIANTS["A3"][1], **json.loads(os.environ.get("ENGINE_CFG") or "{}"))


def _negotiator(case_id):
    """The engine's class for this case: the sandbox's demo facts, else facts and floors from the data."""
    import proto.engine as eng
    from proto.practice import PracticeNegotiator

    base = eng.Negotiator if case_id in eng.FACTS else PracticeNegotiator

    class Negotiator(base):
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
            elif kind in ("target", "crash", "error", "close_failed", "resync"):
                event_log.emit("engine", step=kind, **{k: v for k, v in kw.items() if k != "body"})

    return Negotiator


class Hybrid:
    def __init__(self, new_orchestra):
        self.new_orchestra = new_orchestra

    def play_case(self, table, case_id, deadline=None):
        case, threads = table.open(case_id)
        if getattr(table, "done", None):  # resumed a case that had already ended
            return table.done
        if not plays_engine(case):
            event_log.emit("engine", step="route", agent="orchestra", type=case.get("type"))
            return self.new_orchestra().play_case(_Opened(table, case, threads), case_id, deadline)
        event_log.emit("engine", step="route", agent="engine A3", type=case.get("type"))
        return self._engine(table, case_id, case, threads, deadline)

    def _engine(self, table, case_id, case, threads, deadline):
        client = _TableClient(table, case_id, case, threads)
        # outside the final, a wave's cap all the same: the engine's RFQ loop waits for ever when every supplier
        # has made a final offer and each is dearer than our alternative (arena-sim D02); the cap closes it
        deadline = deadline or time.time() + SAFETY_CAP_S
        try:  # setting up only reads (documents, data, the target): if it breaks, the orchestra plays the case
            n = _negotiator(case_id)(client, case_id, engine_config(), quiet=True, deadline=deadline)
        except Exception as e:
            log.exception("engine could not start on %s", case_id)
            event_log.emit("warning", message=f"engine could not start ({type(e).__name__}: {e}) - orchestra plays")
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
