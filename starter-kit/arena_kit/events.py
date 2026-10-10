"""A local event log of everything the agent does, for the live dashboard (`arena dashboard`).

`play()` wraps its table and agent in recorders that append one JSON line per step to
`logs/events.jsonl` (or ARENA_EVENTS; ARENA_EVENTS=off switches it off): the case opening, every
supplier e-mail with the cost C of its standing offer, the agent thinking and what the model
proposed, every buyer e-mail with C of each term sheet, timeouts, warnings and the result.
Only our own data: nothing here reads the arena's live feed.
"""

import json
import logging
import os
import threading
import time
import uuid
from pathlib import Path

from .cost import cost_breakdown, total_cost
from .docs import standard_terms

PATH = os.environ.get("ARENA_EVENTS") or str(Path(__file__).resolve().parents[2] / "logs" / "events.jsonl")
ENABLED = PATH.lower() not in ("off", "0", "")
RUN = uuid.uuid4().hex[:8]  # one id per process: the dashboard groups by it
_lock = threading.Lock()
ctx = threading.local()  # case_id and session_id of the case this thread plays


def emit(kind, **data):
    if not ENABLED or "PYTEST_CURRENT_TEST" in os.environ:  # tests exercise the recorder, not the log
        return
    event = {
        "ts": round(time.time(), 3),
        "run": RUN,
        "kind": kind,
        "case": getattr(ctx, "case", None),
        "session": getattr(ctx, "session", None),
        "trial": getattr(ctx, "trial", None),
        "strategy": getattr(ctx, "strategy", None),
        "repeat": getattr(ctx, "repeat", None),
        "target": getattr(ctx, "target", None),
        **data,
    }
    line = json.dumps(event, ensure_ascii=False, default=str)
    with _lock:
        Path(PATH).parent.mkdir(parents=True, exist_ok=True)
        with open(PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")


def _cost(case, terms, std):
    try:
        return round(total_cost(case, terms, std), 2) if terms and terms.get("unit_price") else None
    except Exception:  # a half-filled term sheet must not break the run
        return None


def _att(m):
    return [{"name": a.get("name"), "type": a.get("type")} for a in m.get("attachments") or []]


class RecordingTable:
    """Wraps a table (RemoteTable): records what goes over the wire, and prices every offer."""

    def __init__(self, table):
        self._t, self.case, self.history = table, None, {}

    def __getattr__(self, name):  # session_id, done, attachment, ... come from the real table
        return getattr(self._t, name)

    def _std(self, sid):
        return standard_terms(self.history.get(sid, []))

    def _supplier(self, sid, m, took=None):
        from .play import fetch_documents  # play imports this module

        fetch_documents(self._t, m)  # the quote PDF gives the standard terms; play() reuses the text
        self.history.setdefault(sid, []).append(m)
        sheets = m.get("term_sheets") or []
        terms = sheets[0]["terms"] if sheets else {}
        emit(
            "supplier",
            supplier=sid,
            sender=m.get("from"),
            subject=m.get("subject"),
            body=m.get("body"),
            status=m.get("status"),
            offer_id=sheets[0].get("term_sheet_id") if sheets else None,
            terms=terms,
            c=_cost(self.case, terms, self._std(sid)),
            standard=self._std(sid),
            missing=m.get("missing_fields"),
            claims=m.get("claim_results"),
            signals=m.get("signals"),
            attachments=_att(m),
            took=took,
        )

    def open(self, case_id):
        ctx.case, ctx.session = case_id, None
        emit("opening")
        case, threads = self._t.open(case_id)
        self.case, ctx.session = case, self._t.session_id
        b = case["buyer"]
        alt = b.get("alternative") or {}
        emit(
            "case",
            title=case.get("title"),
            type=case.get("type"),
            goal=b.get("category_goal"),
            suppliers=case.get("suppliers"),
            negotiable=case.get("negotiable"),
            must_haves=b.get("must_haves"),
            need=b.get("need_per_year"),
            horizon=b.get("horizon_years"),
            current_price=b.get("current_unit_price"),
            fallback_price=b.get("fallback_unit_price"),
            alternative=alt,
            c_alt=_cost(case, alt.get("terms"), None),
            round_limit=case.get("round_limit", 10),
            briefing=case.get("briefing"),
        )
        if not getattr(self._t, "done", None):
            for sid, events in threads.items():
                for m in events:
                    if m.get("from") != "buyer":
                        self._supplier(sid, m)
        return case, threads

    def send(self, sid, msg):
        std = self._std(sid)
        sheets = [ts.get("terms", ts) for ts in msg.get("term_sheets") or []]
        emit(
            "buyer",
            supplier=sid,
            subject=msg.get("subject"),
            body=msg.get("body"),
            sheets=[{"terms": t, "c": _cost(self.case, t, std)} for t in sheets],
            refs=msg.get("refs"),
        )
        t0 = time.monotonic()
        reply = self._t.send(sid, msg)
        if "result" in reply:
            self._result(reply["result"])
        else:
            self._supplier(sid, reply, round(time.monotonic() - t0, 1))
        return reply

    def close(self, sid, msg):
        emit("action", supplier=sid, action=msg.get("action"))
        result = self._t.close(sid, msg)
        self._result(result)
        return result

    def missed(self, sid, error):
        emit("missed", supplier=sid, detail=str(getattr(error, "detail", error)))
        reply = self._t.missed(sid, error)
        if "result" in reply:
            self._result(reply["result"])
        return reply

    def result(self):
        result = self._t.result()
        self._result(result)
        return result

    def _result(self, r):
        replay = None
        try:
            replay = self._t.client.session(self._t.session_id).get("replay_url")
        except Exception:
            pass
        breakdown = r.get("cost_breakdown")
        if not breakdown and r.get("terms") and self.case:
            try:
                breakdown = cost_breakdown(self.case, r["terms"])
            except Exception:
                breakdown = None
        emit(
            "result",
            deal=r.get("deal"),
            supplier=r.get("supplier_id"),
            terms=r.get("terms"),
            score=r.get("score"),
            c_open=r.get("c_open"),
            c_deal=r.get("c_deal"),
            c_alt=r.get("c_alt"),
            c_best=r.get("c_best"),
            end_reason=r.get("end_reason"),
            breakdown=breakdown,
            replay=(os.environ.get("ARENA_URL", "").rstrip("/") + replay) if replay else None,
        )


class RecordingAgent:
    """Wraps an agent: when it starts and stops thinking, and what it decided."""

    def __init__(self, agent):
        self._a = agent

    def __getattr__(self, name):
        return getattr(self._a, name)

    def decide(self, case, threads):
        emit("thinking")
        t0 = time.monotonic()
        decision = self._a.decide(case, threads)
        msg = decision.get("message", {})
        kind = msg["action"]["type"] if msg.get("action") else "send"
        emit("decided", supplier=decision.get("supplier_id"), decision=kind, took=round(time.monotonic() - t0, 1))
        return decision


def recording_complete(complete):
    """Wraps an LLM `complete(system, user)`: latency, prompt size and the raw answer."""

    def wrapped(system, user):
        t0 = time.monotonic()
        try:
            out = complete(system, user)
        except Exception as e:
            emit("llm", ok=False, error=str(e)[:300], took=round(time.monotonic() - t0, 1), prompt_chars=len(user))
            raise
        emit("llm", ok=True, took=round(time.monotonic() - t0, 1), prompt_chars=len(user), output=out[:6000])
        return out

    return wrapped


class LogHandler(logging.Handler):
    """Warnings from the agent (dropped data IDs, LLM fallbacks, slow decisions) as events."""

    def emit(self, record):  # noqa: D102 - logging.Handler API
        if record.levelno >= logging.WARNING:
            emit("warning", message=record.getMessage()[:500])


def install():
    """Record warnings of the `arena` logger once per process."""
    log = logging.getLogger("arena")
    if ENABLED and not any(isinstance(h, LogHandler) for h in log.handlers):
        log.addHandler(LogHandler())
        emit("run", pid=os.getpid())


def wrap(table, agent):
    if not ENABLED or isinstance(table, RecordingTable):
        return table, agent
    return RecordingTable(table), RecordingAgent(agent)
