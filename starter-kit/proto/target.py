"""Deterministic target C: the best package a supplier with an estimated cost floor would accept.

For every combination of the negotiable levers (term_options), solve the unit price at which the
supplier's cash value (arena_kit.cost.supplier_value) equals its floor, cost that package with the
published C, drop must-have violations, and take the minimum. Also: the price that gives a
package a chosen C (for equal-C MESO term sheets).
"""

import itertools
import math

from arena_kit.cost import complete_offer, must_haves_ok, supplier_value, total_cost


def lever_grid(case, std=None):
    """Every complete term sheet (without price) the case allows. Lead times faster than both the
    supplier's standard and our need are left out: they cost it overtime and gain us nothing."""
    opts = dict(case.get("term_options", {}))
    need = case["buyer"].get("need_lead_time_days")
    if opts.get("lead_time_days") and need:
        fastest = min((std or {}).get("lead_time_days") or need, need)
        opts["lead_time_days"] = [d for d in opts["lead_time_days"] if d >= fastest] or opts["lead_time_days"]
    fields = [f for f in case["negotiable"] if f != "unit_price"]
    choices = [opts.get(f) or [None] for f in fields]
    for combo in itertools.product(*choices):
        terms = {f: v for f, v in zip(fields, combo) if v is not None}
        yield complete_offer(case, {**terms, "unit_price": 1.0})


def _solve(fn, target, lo=0.01, hi=1000.0, increasing=True):
    """Bisection for fn(p) = target on a monotone fn."""
    for _ in range(80):
        mid = (lo + hi) / 2
        v = fn(mid)
        if (v < target) == increasing:
            lo = mid
        else:
            hi = mid
    return round((lo + hi) / 2, 2)


def floor_price(case, terms, supplier):
    """Lowest unit price on these terms whose cash value to the supplier still reaches its floor."""
    return _solve(lambda p: supplier_value(case, {**terms, "unit_price": p}, supplier), supplier["floor"])


def price_for_c(case, terms, std, c_target, supplier=None):
    """Unit price that makes this package cost us exactly c_target. With a relationship term C
    first falls (a squeezed supplier costs us) and then rises with price: solve on the rising side."""
    f = lambda p: total_cost(case, {**terms, "unit_price": p}, std, supplier)
    lo, hi = 0.01, 1000.0
    for _ in range(100):  # ternary search for the cheapest price (C is convex in p)
        m1, m2 = lo + (hi - lo) / 3, hi - (hi - lo) / 3
        if f(m1) <= f(m2):
            hi = m2
        else:
            lo = m1
    p_min = (lo + hi) / 2
    if f(p_min) >= c_target:
        return round(p_min, 2)  # the goal is below anything this package can reach
    return _solve(f, c_target, lo=p_min)


def target(case, suppliers):
    """suppliers: {sup_id: {"standard":…, "floor":…, "interest_rate":…, "full_cost":…}}.
    Returns sorted [(C, sup_id, terms)] for every allowed package priced at its floor."""
    rows = []
    for sid, sup in suppliers.items():
        std = sup["standard"]
        for terms in lever_grid(case, {**std, **sup.get("offered", {})}):
            p0 = floor_price(case, terms, sup)
            if not must_haves_ok(case, {**terms, "unit_price": p0}, std):
                continue
            # strategic goals charge for squeezing the supplier: the cheapest price may sit above its floor
            prices = [round(p0 + 0.05 * i, 2) for i in range(0, 121)] if sup.get("full_cost") else [p0]
            c, p = min((total_cost(case, {**terms, "unit_price": q}, std, sup), q) for q in prices)
            rows.append((c, sid, {**terms, "unit_price": p}))
    alt = case["buyer"].get("alternative") or {}
    if alt.get("terms", {}).get("unit_price"):
        rows.append((total_cost(case, alt["terms"]), "alternative", alt["terms"]))
    # ties (e.g. any lead time within our need costs us the same): prefer what is easiest for the
    # supplier, i.e. the longest lead time, so the floor estimate is not undercut by overtime
    return sorted(rows, key=lambda r: (round(r[0]), -(r[2].get("lead_time_days") or 0)))
