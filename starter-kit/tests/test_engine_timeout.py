"""A late move counts as a timeout: the arena repeats our last offer and the supplier's answer - with a NEW standing
sheet - sits in the thread's `timeouts`, not in `messages` (practice P05 523a5c20: four accepts of the stale sheet
failed). After a failed accept the engine reads the standing sheet and accepts that. And with Config.collect_owed an
agreed best is held only while an owing bidder's ask still beats it."""

import json
from dataclasses import replace
from pathlib import Path

from test_engine_clock import C1, J1, quote
from test_engine_clock import Arena as RfqArena

import proto.engine as eng
from arena_kit import ArenaError
from proto.variants import VARIANTS

CASE = json.loads((Path(__file__).resolve().parents[1] / "cases" / "D01.json").read_text(encoding="utf-8"))
F1 = "sup:DEMO-F1"
TERMS = {"unit_price": 50.0, "payment_days": 30, "lead_time_days": 35, "incoterm": "FCA", "contract_months": 24,
         "effective_date": "2026-11-01"}


def offer(n, status, price):
    return {"from": f"sales@{F1}", "status": status, "body": "Our offer.", "attachments": [],
            "term_sheets": [{"term_sheet_id": f"offer:{F1}-{n}", "terms": {**TERMS, "unit_price": price}}]}


class LateAccept:
    """F1 agrees to our first ask. Our accept of that sheet comes back stale (it timed out, re-agreed as -2)."""

    def __init__(self):
        self.accepts, self.events = [], [offer(0, "open", 56.0)]

    def _ctx(self):
        pass

    def open_session(self, case_id):
        return {"session_id": "s1", "case": CASE, "threads": {F1: list(self.events)}}

    def attachment(self, session_id, attachment_id):
        return b""

    def session(self, session_id):
        return {"status": "open"}

    def thread(self, session_id, supplier_id):
        ask = next(m for m in reversed(self.events) if m.get("from") == "buyer")
        price = ask["term_sheets"][0]["terms"]["unit_price"]
        return {"supplier_id": F1, "offer_id": f"offer:{F1}-2", "status": "agreed", "closed": None,
                "messages": list(self.events),
                "timeouts": [{"offer_id": f"offer:{F1}-2", "round": 2, "status": "agreed",
                              "terms": {**TERMS, "unit_price": price}, "text": "We can accept your terms."}]}

    def send_message(self, session_id, sup, msg):
        if msg.get("action"):
            self.accepts.append(msg["action"]["term_sheet_id"])
            if msg["action"]["term_sheet_id"] != f"offer:{F1}-2":
                raise ArenaError(422, "not a standing offer in this session")
            return {"result": {"deal": True, "supplier_id": sup, "score": 0.7, "terms": {}}}
        self.events.append({**msg, "from": "buyer"})
        price = msg["term_sheets"][0]["terms"]["unit_price"]
        r = offer(1, "agreed", price)
        self.events.append(r)
        return r


def test_a_failed_accept_takes_the_standing_sheet_the_timeout_left():
    arena = LateAccept()
    res = eng.Negotiator(arena, "case:D01", replace(VARIANTS["A9h"][1]), quiet=True).run()
    assert res["deal"]
    assert arena.accepts == [f"offer:{F1}-1", f"offer:{F1}-2"]  # the stale sheet once, then the standing one


def test_an_agreed_best_is_held_only_while_an_owing_bidders_ask_still_beats_it():
    n = eng.Negotiator(RfqArena(), "case:D02", replace(VARIANTS["A9h-rival"][1], pushes=0, rfq_pushes=0), quiet=True)
    j1, c1 = n.threads[J1], n.threads[C1]
    ours = {"unit_price": 15.0, "payment_days": 30, "lead_time_days": 35, "incoterm": "FCA"}
    j1.events += [{"from": "buyer", "term_sheets": [{"terms": ours}]}, quote(J1, 15.0, n=1, status="agreed")]
    best = (n.C(j1, j1.sheets[0]["terms"]), j1, j1.sheets[0])
    c1.events.append({"from": "buyer", "term_sheets": [{"terms": {**ours, "unit_price": 14.99}}]})
    c1.collected, c1.in_flight = 1, True  # its rest is on the way, asked at (about) the same cost as J1's agreement
    assert not n.owed_hold(best, [j1, c1], [])  # it cannot win: accept J1 now, before its 60 s run out
    c1.events.append({"from": "buyer", "term_sheets": [{"terms": {**ours, "unit_price": 14.2}}]})
    assert n.owed_hold(best, [j1, c1], [])  # asked 5 % below the agreement: worth collecting
    j1.events[-1] = quote(J1, 15.0, n=1, status="open")
    assert n.owed_hold(best, [j1, c1], [])  # an open best keeps negotiating anyway
