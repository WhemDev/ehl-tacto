"""Unseen cases (audit 2026-10-11): parts dearer than EUR 1,000 (world.sqlite has one at EUR 1,608.32) are priced
correctly, and a one-supplier case never takes a deal that costs more than our alternative."""

import copy
import json
from pathlib import Path

from arena_kit import complete_offer, total_cost
from proto.target import lever_grid, price_for_c

CASES = Path(__file__).resolve().parents[1] / "cases"


def test_a_part_dearer_than_the_first_bound_is_priced_at_its_cost_target():
    case = json.loads((CASES / "P05.json").read_text(encoding="utf-8"))  # reference prices ~EUR 37: first bound 1,000
    g = {k: v for k, v in next(iter(lever_grid(case, {}))).items() if k != "unit_price"}
    for price in (1608.32, 4999.0):
        c = total_cost(case, complete_offer(case, {**g, "unit_price": price}), {})
        assert abs(price_for_c(case, g, {}, c) - price) <= 0.01


def test_a_cheap_part_is_priced_too():
    case = copy.deepcopy(json.loads((CASES / "P19.json").read_text(encoding="utf-8")))
    g = {k: v for k, v in next(iter(lever_grid(case, {}))).items() if k != "unit_price"}
    c = total_cost(case, complete_offer(case, {**g, "unit_price": 2.15}), {})
    assert abs(price_for_c(case, g, {}, c) - 2.15) <= 0.01


class Stubborn:
    """P07's supplier opens at EUR 7.50 - dearer than our current contract at EUR 6.29 - and never moves."""

    def __init__(self):
        self.case = json.loads((CASES / "P07.json").read_text(encoding="utf-8"))
        self.sup, self.actions, self.n = self.case["suppliers"][0], [], 0

    def quote(self, status):
        terms = {"unit_price": 7.5, "payment_days": 30, "contract_months": 24}
        return {"from": f"sales@{self.sup}", "status": status, "body": "Our price stands.", "attachments": [],
                "term_sheets": [{"term_sheet_id": f"offer:{self.sup[4:]}-{self.n}", "terms": terms}]}

    def open_session(self, case_id):
        return {"session_id": "s1", "case": self.case, "threads": {self.sup: [self.quote("open")]}}

    def attachment(self, session_id, attachment_id):
        return b""

    def session(self, session_id):
        return {"status": "open"}

    def thread(self, session_id, supplier_id):
        raise AssertionError("no resync expected")

    def send_message(self, session_id, sup, msg):
        if msg.get("action"):
            self.actions.append(msg["action"]["type"])
            return {"result": {"deal": msg["action"]["type"] == "accept", "score": 0.0}}
        self.n += 1
        return self.quote("final_offer")


def test_a_final_offer_dearer_than_our_alternative_is_never_taken():
    import proto.engine as eng
    from proto.variants import VARIANTS

    arena = Stubborn()
    eng.Negotiator(arena, "case:P07", VARIANTS["A9h"][1], quiet=True).run()
    assert arena.actions == ["walk_away"]
