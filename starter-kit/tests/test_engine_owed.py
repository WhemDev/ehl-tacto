"""Collect an announced step (variant A9h-owed): a reply that says "Any further step needs approval from our
management" or "we need to clarify this internally" promises a further step on the supplier's NEXT reply. The engine
never accepts on such a reply: it asks once more just below the offer, and in an RFQ it never closes while a bidder
still owes that step."""

import json
import threading
from dataclasses import replace
from pathlib import Path

import pytest
from test_engine_clock import C1, J1
from test_engine_clock import quote as rfq_quote

import proto.engine as eng
from proto.variants import VARIANTS

CASE = json.loads((Path(__file__).resolve().parents[1] / "cases" / "D01.json").read_text(encoding="utf-8"))
RFQ_CASE = json.loads((Path(__file__).resolve().parents[1] / "cases" / "D02.json").read_text(encoding="utf-8"))
F1 = "sup:DEMO-F1"
ASK_BOSS = "We have reviewed your offer. Any further step needs approval from our management."
APPROVED = "Our management has approved a further step."


def quote(price, n=0, status="open", body="Our offer."):
    terms = {
        "unit_price": price,
        "payment_days": 30,
        "lead_time_days": 35,
        "incoterm": "FCA",
        "contract_months": 24,
        "effective_date": "2026-11-01",
    }
    return {
        "from": f"sales@{F1}",
        "status": status,
        "body": body,
        "attachments": [],
        "term_sheets": [{"term_sheet_id": f"offer:{F1}-{n}", "terms": terms}],
    }


class Escalating:
    """Its first reply asks its management for a further step (status `first`); the next reply brings the approved
    step at 51.30."""

    def __init__(self, first="open"):
        self.first, self.sent, self.asks, self.accepted = first, 0, [], None
        self.lock = threading.Lock()

    def _ctx(self):
        pass

    def open_session(self, case_id):
        return {"session_id": "s1", "case": CASE, "threads": {F1: [quote(52.90)]}}

    def attachment(self, session_id, attachment_id):
        return b""

    def session(self, session_id):
        return {"status": "open"}

    def thread(self, session_id, supplier_id):
        raise AssertionError("no resync expected")

    def send_message(self, session_id, sup, msg):
        if msg.get("action"):
            self.accepted = (self.sent, msg["action"].get("term_sheet_id"))
            return {"result": {"deal": True, "supplier_id": sup, "score": 0.5, "terms": {}}}
        self.sent += 1
        self.asks.append([s["terms"]["unit_price"] for s in msg.get("term_sheets") or []])
        if self.sent == 1:
            return quote(52.00, n=1, status=self.first, body=ASK_BOSS)
        return quote(51.30, n=self.sent, status="final_offer", body=APPROVED)


def generous(monkeypatch, later=0.99):
    # round 0 asks well below the opening; from round 1 on our goal accepts any reply at most 1 % above it
    monkeypatch.setattr(eng.Negotiator, "goal", lambda self, rnd: self.c_open * (0.95 if rnd <= 0 else later))


def run(cfg, first="open"):
    arena = Escalating(first)
    res = eng.Negotiator(arena, "case:D01", cfg, quiet=True).run()
    return arena, res


def cfg(name, **kw):
    return replace(VARIANTS[name][1], holds=0, pushes=0, rfq_pushes=0, **kw)


def test_the_plain_build_accepts_on_the_escalation_reply(monkeypatch):
    generous(monkeypatch)
    arena, res = run(cfg("A9h-gap"))
    assert res["deal"] and arena.accepted == (1, f"offer:{F1}-1")  # took 52.00 and never saw the approval


def test_an_open_escalation_reply_is_answered_once_below_its_offer_then_the_approved_step_is_taken(monkeypatch):
    generous(monkeypatch)
    arena, res = run(cfg("A9h-owed"))
    assert res["deal"] and arena.accepted == (2, f"offer:{F1}-2")  # one more mail, then the approved 51.30
    assert len(arena.asks) == 2 and min(arena.asks[1]) < 52.00  # the collecting ask sits below its offer


def test_a_final_offer_with_the_cue_is_still_taken_unless_owed_final(monkeypatch):
    generous(monkeypatch)
    arena, _ = run(cfg("A9h-owed"), first="final_offer")
    assert arena.accepted == (1, f"offer:{F1}-1")  # untested on real suppliers: off by default
    arena, _ = run(cfg("A9h-owed", owed_final=True), first="final_offer")
    assert arena.accepted == (2, f"offer:{F1}-2") and min(arena.asks[1]) < 52.00


def test_only_announced_steps_count():
    n = eng.Negotiator.__new__(eng.Negotiator)
    n.cfg = VARIANTS["A9h-owed"][1]
    for body, owed in (
        (ASK_BOSS, True),
        ("We need to clarify this internally - we will come back to you on price.", True),
        ("Our management has frozen all price reductions until December 2027.", False),
        ("Thank you for your e-mail, which we have reviewed internally.", False),
        ("Each needs your engineering approval and a new drawing revision.", False),
    ):
        t = eng.Thread(F1, [quote(52.0, body=body)])
        assert n.owes_step(t) is owed, body
        t.collected = 1
        assert n.owes_step(t) is False  # once per thread
    n.cfg = VARIANTS["A9h-gap"][1]
    assert n.owes_step(eng.Thread(F1, [quote(52.0, body=ASK_BOSS)])) is False  # off without collect_owed


class Rest:
    """J1 leads the stagger and promises a follow-up before C1 agrees at 15.00.

    J1 first asks to clarify internally, then offers 13.60 on its next reply.
    """

    def __init__(self):
        self.sent, self.log, self.lock = {J1: 0, C1: 0}, [], threading.Lock()

    def _ctx(self):
        pass

    def open_session(self, case_id):
        return {
            "session_id": "s1",
            "case": RFQ_CASE,
            "threads": {J1: [rfq_quote(J1, 15.9)], C1: [rfq_quote(C1, 16.0, pay=45, inco="EXW")]},
        }

    def attachment(self, session_id, attachment_id):
        return b""

    def session(self, session_id):
        return {"status": "open"}

    def thread(self, session_id, supplier_id):
        raise AssertionError("no resync expected")

    def send_message(self, session_id, sup, msg):
        if msg.get("action"):
            with self.lock:
                self.log.append(("accept", sup, msg["action"].get("term_sheet_id")))
            return {"result": {"deal": True, "supplier_id": sup, "score": 0.7, "terms": {}}}
        with self.lock:
            self.sent[sup] += 1
            k = self.sent[sup]
            self.log.append(("msg", sup, k))
        if sup == J1:
            r = rfq_quote(J1, 15.8, n=1) if k == 1 else rfq_quote(J1, 13.6, n=k, status="final_offer")
            r["body"] = (
                "We need to clarify this internally - we will come back to you on price."
                if k == 1
                else "We have clarified this internally and can move further on the price."
            )
            return r
        return rfq_quote(C1, 15.0, n=k, status="agreed", pay=14)


def play_rest(monkeypatch, name):
    monkeypatch.setattr(eng.Negotiator, "goal", lambda self, rnd: self.c_open * 0.5)  # only agreed / final offers close
    arena = Rest()
    res = eng.Negotiator(arena, "case:D02", cfg(name), quiet=True).run()
    return arena, res, next(e for e in arena.log if e[0] == "accept")


def test_the_plain_build_closes_the_rfq_on_an_agreement_while_a_bidder_owes_its_rest(monkeypatch):
    arena, res, accept = play_rest(monkeypatch, "A9h-gap")
    assert res["deal"] and accept[1] == C1 and arena.sent[J1] == 1


def test_an_rfq_is_never_closed_while_a_bidder_owes_its_rest(monkeypatch):
    arena, res, accept = play_rest(monkeypatch, "A9h-owed")
    assert res["deal"] and arena.sent[J1] == 2  # the rest was collected before closing
    assert accept[1] == J1 and accept[2] == f"offer:{J1}-2"  # and it won: 13.60 beats C1's agreed 15.00


@pytest.mark.parametrize("variant", ["A9h", "A9h-rival"])
def test_the_rival_trigger_cites_the_cheapest_price_well_below_its_own_and_never_a_dearer_one(variant):
    from test_engine_clock import Arena

    n = eng.Negotiator(Arena(), "case:D02", replace(VARIANTS[variant][1], pushes=0, rfq_pushes=0), quiet=True)
    j1, c1 = n.threads[J1], n.threads[C1]  # J1 opens at 17.10 FCA; C1 at 16.00 EXW with a 45-day lead (not compliant)
    pick = n.rival_cheaper(j1)
    assert pick and pick[0] == f"offer:{C1}-0"  # 6.4 % below: cited although its package misses our must-haves
    assert n.rival_cheaper(c1) is None  # J1's 17.10 is dearer than C1's own price: telling C1 so helps nobody
    j1.events.append({"from": "buyer", "refs": [f"offer:{C1}-0"], "term_sheets": []})
    assert n.rival_cheaper(j1) is None  # never the same offer twice (a duplicate)
    n.cfg = replace(n.cfg, rival_gap=0.10)
    j1.events.pop()
    assert n.rival_cheaper(j1) is None  # 6.4 % is below a 10 % bar
