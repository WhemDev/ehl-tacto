from copy import deepcopy
from dataclasses import asdict

import pytest

from arena_kit.cost import total_cost
from proto.hybrid import revealed_schedule
from proto.variants import VARIANTS


@pytest.fixture
def example():
    case = {
        "case_id": "case:UNSEEN", "type": "rfq",
        "negotiable": ["unit_price", "payment_days", "lead_time_days", "incoterm"],
        "fixed_terms": {"contract_months": 12, "volume_per_year": 1000},
        "term_options": {"lead_time_days": [7, 21, 42]},
        "buyer": {"need_per_year": 1000, "horizon_years": 1, "fallback_unit_price": 60,
                  "interest_rate": 0.08, "reference_payment_days": 30, "need_lead_time_days": 30,
                  "late_cost_per_day": 400, "freight_eur_per_unit": {"EXW": 2, "DAP": 0},
                  "must_haves": []},
    }
    proposal = {"unit_price": 40, "payment_days": 30, "lead_time_days": 7, "incoterm": "DAP"}
    quote = {"term_sheet_id": "offer:UNSEEN-2", "terms": {**proposal, "unit_price": 43, "lead_time_days": 21}}
    return case, proposal, quote


def test_trade_preserves_price_cost_other_terms_and_inputs(example):
    case, proposal, quote = example
    original = deepcopy(example)
    picks, changes = revealed_schedule(case, [proposal], [quote])
    assert picks == [{**proposal, "lead_time_days": 21}]
    assert total_cost(case, picks[0]) == total_cost(case, proposal)
    assert changes[0]["cost_after"] == changes[0]["cost_before"]
    assert changes[0]["quote_id"] == "offer:UNSEEN-2"
    assert example == original


@pytest.mark.parametrize("reason", ["no_quote", "no_explicit_lead", "late", "not_allowed", "must_have",
                                    "fixed", "not_negotiable", "single_case", "payment", "freight", "duplicate"])
def test_does_not_invent_or_weaken_a_package(example, reason):
    case, proposal, quote = example
    quotes, proposals = [quote], [proposal]
    if reason == "no_quote":
        quotes = []
    elif reason == "no_explicit_lead":
        del quote["terms"]["lead_time_days"]
    elif reason == "late":
        quote["terms"]["lead_time_days"] = 42
    elif reason == "not_allowed":
        quote["terms"]["lead_time_days"] = 20
    elif reason == "must_have":
        case["buyer"]["must_haves"] = [{"field": "lead_time_days", "op": "<=", "value": 10}]
    elif reason == "fixed":
        case["fixed_terms"]["lead_time_days"] = 7
    elif reason == "not_negotiable":
        case["negotiable"].remove("lead_time_days")
    elif reason == "single_case":
        case["type"] = "price_increase"
    elif reason == "payment":
        quote["terms"]["payment_days"] = 14
    elif reason == "freight":
        quote["terms"]["incoterm"] = "EXW"
    elif reason == "duplicate":
        proposals.append({**proposal, "lead_time_days": 21})
    assert revealed_schedule(case, proposals, quotes) == (proposals, [])


def test_hybrid_has_only_one_policy_change():
    baseline = asdict(VARIANTS["A6"][1])
    hybrid = asdict(VARIANTS["A_hybrid"][1])
    assert {key for key in baseline if baseline[key] != hybrid[key]} == {"revealed_schedule"}
