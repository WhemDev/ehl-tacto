"""Patience with movement: an open supplier that still concedes is asked again, a little below its offer; the first
stalled reply is taken; the frozen build (3 holds) gives up earlier on a slowly moving supplier."""

import json
import threading
from dataclasses import replace
from pathlib import Path

import proto.engine as eng
from proto.variants import VARIANTS

CASE = json.loads((Path(__file__).resolve().parents[1] / "cases" / "D01.json").read_text(encoding="utf-8"))
F1 = "sup:DEMO-F1"


def quote(price, n=0, status="open"):
    terms = {"unit_price": price, "payment_days": 30, "lead_time_days": 35, "incoterm": "FCA", "contract_months": 24,
             "effective_date": "2026-11-01"}
    return {"from": f"sales@{F1}", "status": status, "body": "Our offer.", "attachments": [],
            "term_sheets": [{"term_sheet_id": f"offer:{F1}-{n}", "terms": terms}]}


class Foundry:
    """One supplier: concedes `step` of its price a round for `moves` rounds, then repeats its price (a stall)."""

    def __init__(self, moves=5, step=0.01):
        self.moves, self.step, self.sent, self.lock = moves, step, 0, threading.Lock()
        self.asks, self.offers, self.accepted_after = [], [52.90], None

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
            self.accepted_after = self.sent
            return {"result": {"deal": True, "supplier_id": sup, "score": 0.5, "terms": {}}}
        self.sent += 1
        self.asks.append([s["terms"]["unit_price"] for s in msg.get("term_sheets") or []])
        price = round(52.90 * (1 - self.step * min(self.sent, self.moves)), 2)
        self.offers.append(price)
        return quote(price, n=self.sent)


def run(cfg, **kw):
    foundry = Foundry(**kw)
    res = eng.Negotiator(foundry, "case:D01", cfg, quiet=True).run()
    return foundry, res


def test_patient_keeps_asking_while_it_moves_and_takes_the_first_stall():
    foundry, res = run(replace(VARIANTS["A10"][1], rfq_pushes=0), moves=5, step=0.01)
    assert res["deal"] and foundry.accepted_after == 6  # five concessions answered, the first repeated price taken
    for i in range(1, len(foundry.asks)):
        assert min(foundry.asks[i]) != min(foundry.asks[i - 1])  # never the same ask twice
    for ask, offer in zip(foundry.asks[3:], foundry.offers[3:6], strict=True):  # late asks sit below its price
        assert min(ask) <= offer * 0.995


def test_the_frozen_build_gives_up_earlier_on_a_slowly_moving_supplier():
    slow = {"moves": 8, "step": 0.002}  # 0.2 % a round: below the holds' 0.3 % bar, above the stall bar
    frozen, _ = run(replace(VARIANTS["A9h"][1], rfq_pushes=0), **slow)
    patient, _ = run(replace(VARIANTS["A10"][1], rfq_pushes=0), **slow)
    assert frozen.accepted_after < patient.accepted_after
    assert patient.offers[patient.accepted_after - 1] < frozen.offers[frozen.accepted_after - 1]  # a better price
