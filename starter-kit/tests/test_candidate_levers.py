from dataclasses import replace
from types import SimpleNamespace

from test_engine_refs import negotiator

from proto.candidate_levers import extreme_payments, first_indices, worthwhile_leads
from proto.variants import VARIANTS


def test_payment_endpoints_and_fixed_term():
    grid = [{"payment_days": d} for d in (14, 30, 60, 90)]
    assert extreme_payments({"negotiable": ["payment_days"]}, grid) == [grid[0], grid[-1]]
    assert extreme_payments({"negotiable": []}, grid) == grid
    assert extreme_payments({"negotiable": ["payment_days"]}, [grid[1]]) == [grid[1]]


def test_p08_ppi_is_in_first_email_with_valid_ids():
    n = negotiator("P08")
    n.cfg = replace(n.cfg, first_indices=True)
    t = next(iter(n.threads.values()))
    if hasattr(t, "facts"):
        del t.facts
    msg = n.write(t, 0, n.meso(t, n.goal(0)), None)
    assert any(ref.startswith("idx:PPI-") for ref in msg["refs"])
    assert all(not ref.startswith("po:") for ref in msg["refs"])


def test_index_priority_does_not_discard_later_evidence():
    facts = [("cost:X", "cost"), (["idx:AS-X@a", "idx:AS-X@b"], "fall"), (["idx:PPI-X@a", "idx:PPI-X@b"], "fall")]
    assert first_indices(facts) == [facts[2], facts[1], facts[0]]


def test_lead_requires_isolated_quote_saving_above_late_cost():
    neg = SimpleNamespace(C=lambda t, x: x["unit_price"] * 100 + max(0, x["lead_time_days"] - 35) * 10)
    fast = {"unit_price": 10, "lead_time_days": 35, "payment_days": 30}

    def thread(slow):
        return SimpleNamespace(events=[{"from": "supplier", "term_sheets": [{"terms": fast}, {"terms": slow}]}])

    assert worthwhile_leads(neg, thread({**fast, "unit_price": 9, "lead_time_days": 42})) == {42: 1}
    assert not worthwhile_leads(neg, thread({**fast, "unit_price": 9.5, "lead_time_days": 42}))
    assert not worthwhile_leads(neg, thread({**fast, "unit_price": 9, "lead_time_days": 42, "payment_days": 14}))


def test_baseline_is_unchanged_and_switches_independent():
    base = VARIANTS["A9h"][1]
    assert base.collect_owed  # joined the final build 2026-10-11 03:45 (P05 0.846 vs 0.74)
    assert not any((base.first_indices, base.economic_lead, base.extreme_payment))
    assert VARIANTS["A9h-candidate"][1] == replace(base, first_indices=True, economic_lead=True, extreme_payment=True)


def test_candidate_packages_keep_must_haves_and_endpoint_payments():
    from test_engine_refs import ALL

    from arena_kit import must_haves_ok

    for cid in ALL:
        n = negotiator(cid)
        n.cfg = VARIANTS["A9h-candidate"][1]
        for t in n.threads.values():
            sheets = n.meso(t, n.goal(0))
            assert sheets, cid
            for sheet in sheets:
                assert must_haves_ok(n.case, sheet, t.std), cid
                opts = n.case.get("term_options", {}).get("payment_days", [])
                if opts and "payment_days" in n.case["negotiable"]:
                    assert sheet["payment_days"] in (min(opts), max(opts)), (cid, sheet)
