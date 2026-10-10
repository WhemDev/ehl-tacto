"""A supplier's priced payment alternatives reveal its cash rate (variant A9h-payrate): used only to rank our
equal-cost packages by their value to it, never in our own cost."""

from dataclasses import replace

import proto.engine as eng
from proto.variants import VARIANTS


class T:
    def __init__(self, sheets):
        self.sid, self.est = "sup:X", {"standard": {"payment_days": 60}, "interest_rate": 0.05}
        self.events = [{"from": "sales@x", "term_sheets": sheets}]

    @property
    def sheets(self):
        return self.events[-1]["term_sheets"]


def neg(variant="A9h-payrate"):
    n = eng.Negotiator.__new__(eng.Negotiator)
    n.cfg, n.log, n.quiet, n.case_id = VARIANTS[variant][1], [], True, "case:X"
    return n


def test_a_payment_only_alternative_reveals_the_rate():
    t = T([{"terms": {"unit_price": 5.60, "payment_days": 90, "contract_months": 24}},
           {"terms": {"unit_price": 5.50, "payment_days": 30, "contract_months": 24}}])
    n = neg()
    n.learn_rate(t)
    assert abs(t.learned_rate - 0.108) < 0.002  # Werdenfels: EUR 0.10 for 60 days on ~5.55
    est = n.rank_est(t)
    assert est["interest_rate"] == t.learned_rate and est["standard"]["payment_days"] == 90  # its opening term
    assert t.est["interest_rate"] == 0.05  # our own cost model keeps its estimate


def test_alternatives_that_move_more_than_payment_teach_nothing():
    t = T([{"terms": {"unit_price": 5.60, "payment_days": 90, "contract_months": 24}},
           {"terms": {"unit_price": 5.50, "payment_days": 30, "contract_months": 36}}])
    n = neg()
    n.learn_rate(t)
    assert not hasattr(t, "learned_rate")


def test_off_in_the_final_build():
    assert not VARIANTS["A9h"][1].pay_rate_learn
    n = neg("A9h")
    t = T([{"terms": {"unit_price": 5.60, "payment_days": 90}}, {"terms": {"unit_price": 5.50, "payment_days": 30}}])
    n.learn_rate(t)
    assert n.rank_est(t) is t.est and not hasattr(t, "learned_rate")


def test_replace_keeps_the_flag():
    assert replace(VARIANTS["A9h-payrate"][1]).pay_rate_learn
