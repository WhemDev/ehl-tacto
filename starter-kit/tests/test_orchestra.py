"""The orchestra's price analysis and the profile hook, on real case files and real arena openings."""

import json
from pathlib import Path

import pytest

from arena_kit import strategy
from arena_kit.analysis import analyse, meso
from arena_kit.cost import must_haves_ok

CASES = Path(__file__).resolve().parents[1] / "cases"
DATA = Path(__file__).resolve().parents[2] / "data"


@pytest.fixture(scope="module")
def pkg():
    from arena_kit.data import DataPackage

    return DataPackage(DATA)


def case(cid):
    return json.loads((CASES / f"{cid}.json").read_text(encoding="utf-8"))


def test_quote_with_partial_standard_terms(pkg):
    # practice P02 on the arena: the quote PDF's standard terms list only ppm and chargeback
    c = case("P02")
    opening = {
        "sup:70510": {
            "terms": {"unit_price": 370.96, "payment_days": 30, "index_clause": None},
            "standard": {"ppm_commitment": 250, "chargeback_eur_per_complaint": 0.0},
        }
    }
    s = analyse(c, opening, pkg)["suppliers"]["sup:70510"]
    assert s["aspiration_c"] is not None and s["ideal_levers"]
    assert s["anchor_price"] < 370.96


def test_anchor_stays_below_an_offer_under_our_floor(pkg):
    # practice P05 on the arena: 70210 opened at 36.00, below the German should-cost floor
    c = case("P05")
    opening = {
        "sup:70210": {"terms": {"unit_price": 36.0, "payment_days": 30, "lead_time_days": 35}, "standard": {}},
        "sup:70240": {"terms": {"unit_price": 31.5, "payment_days": 30, "lead_time_days": 56}, "standard": {}},
    }
    a = analyse(c, opening, pkg)
    for sid, o in opening.items():
        s = a["suppliers"][sid]
        assert s["anchor_price"] < o["terms"]["unit_price"]
        for sheet in meso(c, s, s["aspiration_c"], o["terms"]):
            assert must_haves_ok(c, sheet, s["standard"])
    assert a["suppliers"]["sup:70240"]["should_cost"]["part:320070"]["country_factor"] < 1  # a Czech plant


def test_tactics_from_a_profile():
    c = case("P05")
    p = {
        "archetype": "cash_short",
        "confidence": 1.0,
        "situation": {"cash_pressure": 0.8, "dependency_on_us": 0.5, "our_dependency": 0.5},
    }
    t = strategy.tactics(c, p)
    assert ("payment_days", "low") in t["gives"]
    assert t["interest_rate"] > c["buyer"]["interest_rate"]
    assert strategy.give_values(c, t["gives"], {})["payment_days"] == min(c["term_options"]["payment_days"])
    assert strategy.tactics(c, None)["anchor"] > 0  # no profile: the goal's defaults
