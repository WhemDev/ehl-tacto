"""The first ask never opens more than ask_cap below the lowest opening price, whatever the floor estimate says."""

from dataclasses import replace

from test_engine_clock import C1, Arena

import proto.engine as eng
from proto.variants import VARIANTS


def first_asks(cap):
    n = eng.Negotiator(Arena(), "case:D02", replace(VARIANTS["A9h"][1], ask_cap=cap), quiet=True)
    t = n.threads[C1]
    sheets = n.meso(t, n.goal(0))
    return n, [s["unit_price"] for s in sheets], [n.C(t, s) for s in sheets]


def test_the_first_ask_is_capped_below_the_lowest_opening():
    _, free, _ = first_asks(0.0)  # the floor estimate alone: well under the openings (EUR 16.00 and 17.10)
    assert free and min(free) < 16.0 * 0.85
    n, capped, cs = first_asks(0.10)
    floor = n.price_floor_c(0.10)  # the cap is a cost: the cheapest package at 10 % below EUR 16.00
    assert capped and all(c >= floor * 0.999 for c in cs)
    assert min(capped) > min(free)
