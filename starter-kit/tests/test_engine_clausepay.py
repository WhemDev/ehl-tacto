"""A clause package in a supplier-health case goes out at the payment term and price cheapest for us (variant
A9h-clausepay). P02: Nordmark agreed at once to every clause package we sent, all at 60 days at the round's goal."""

import json
from pathlib import Path

from arena_kit import complete_offer, total_cost
from proto.engine import Thread
from proto.practice import PracticeNegotiator
from proto.variants import VARIANTS

CASE = json.loads((Path(__file__).resolve().parents[1] / "cases" / "P02.json").read_text(encoding="utf-8"))
SUP = CASE["suppliers"][0]
OPEN = {"unit_price": 370.96, "payment_days": 30, "index_clause": None}


def packages(variant, goal):
    n = PracticeNegotiator.__new__(PracticeNegotiator)
    n.c, n.case_id, n.cfg, n.quiet, n.log = None, "case:P02", VARIANTS[variant][1], True, []
    n.sid, n.case, n.b, n.deadline, n.slowest = "t", CASE, CASE["buyer"], None, 0
    t = Thread(SUP, [{"from": f"sales@{SUP}", "status": "open", "body": "Our offer.", "attachments": [],
                      "term_sheets": [{"term_sheet_id": "offer:x-0", "terms": dict(OPEN)}]}])
    t.std = {k: v for k, v in complete_offer(CASE, OPEN).items() if k != "unit_price"}
    n.threads, n.alt, n.c_alt, n.relationship = {SUP: t}, {}, float("inf"), True
    n.c_open = total_cost(CASE, complete_offer(CASE, OPEN), t.std, None)
    n._estimate()
    return n, t, n.meso(t, goal)


def test_the_clause_package_moves_to_its_cheapest_payment_term_and_price():
    goal = 2_246_000
    _, _, frozen = packages("A9h-frozen", goal)
    n, t, plan = packages("A9h-clausepay", goal)
    old = [p for p in frozen if p.get("index_clause")]
    new = [p for p in plan if p.get("index_clause")]
    assert old and new
    assert new[0]["payment_days"] == 90 and old[0]["payment_days"] == 60
    assert n.C(t, complete_offer(CASE, new[0])) < n.C(t, complete_offer(CASE, old[0]))
    assert [p for p in plan if not p.get("index_clause")] == [p for p in frozen if not p.get("index_clause")]


def test_no_change_outside_supplier_health_cases():
    cfg = VARIANTS["A9h-clausepay"][1]
    assert cfg.clause_pay_best and not VARIANTS["A9h-frozen"][1].clause_pay_best
    assert VARIANTS["A9h"][1].clause_pay_best and VARIANTS["A9h"][1].clause_pay_rate == 0.064  # the final build
