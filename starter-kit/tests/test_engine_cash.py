"""The cost of money of a good-credit supplier (credit index < 200) is recalibrated only in cases with a supplier-health
charge (stabilise, secure_supply): the arena's charges imply 6.6 % (P02) and 6.1 % (P03) where we assumed 5 %."""

import json
from pathlib import Path

from arena_kit import complete_offer
from proto.engine import Thread
from proto.practice import PracticeNegotiator, cash_rate
from proto.variants import VARIANTS

CASES = Path(__file__).resolve().parents[1] / "cases"


def est_rate(cid, variant):
    case = json.loads((CASES / f"{cid}.json").read_text(encoding="utf-8"))
    n = PracticeNegotiator.__new__(PracticeNegotiator)
    n.c, n.case_id, n.cfg, n.quiet, n.log = None, f"case:{cid}", VARIANTS[variant][1], True, []
    n.sid, n.case, n.b, n.deadline, n.slowest = "t", case, case["buyer"], None, 0
    s = case["suppliers"][0]
    terms = complete_offer(case, {"unit_price": (case["buyer"].get("current_unit_price") or 10) * 1.06})
    n.threads = {s: Thread(s, [{"from": f"sales@{s}", "status": "open", "body": "Our offer.", "attachments": [],
                                "term_sheets": [{"term_sheet_id": f"offer:{s}-0", "terms": terms}]}])}
    n.alt, n.c_alt = case["buyer"].get("alternative") or {}, float("inf")
    n.relationship = case["buyer"].get("category_goal") in ("stabilise", "secure_supply")
    n.c_open = min(n.C(t, t.sheets[0]["terms"]) for t in n.threads.values())
    n._estimate()
    return n.threads[s].est["interest_rate"]


def test_only_good_credit_suppliers_are_recalibrated():
    assert cash_rate("sup:70510") == 0.05  # Nordmark, credit index 147: the old default
    assert cash_rate("sup:70510", 0.064) == 0.064
    assert cash_rate("sup:70110", 0.064) == 0.10  # credit index 222: unchanged


def test_only_cases_with_a_supplier_health_charge():
    assert est_rate("P02", "A9h-cash") == 0.064  # stabilise, good credit
    assert est_rate("P02", "A9h") == 0.05
    assert est_rate("P08", "A9h-cash") == 0.05  # leverage: no supplier-health charge, the old rate stays
    assert est_rate("P01", "A9h-cash") == 0.10  # stabilise, but credit index 222
