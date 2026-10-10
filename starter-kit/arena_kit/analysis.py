"""Deterministic price analysis: what the data and the cost function say about a case, in numbers.

No language model here. Given a case, the suppliers' opening offers (with the standard terms from
their quote PDFs) and the data package, it works out:
  - C of every opening offer, of the alternative, and the reserve (never accept a worse deal);
  - what each lever is worth to us in € and in € per unit (the price equivalent);
  - our ideal non-price terms, by brute force over the case's term options;
  - the supplier's likely floor from the should-cost estimate;
  - for price increases, the increase the cost drivers justify (index moves × cost shares);
  - citable claims: one sentence each, the figure next to its IDs, ranked by strength;
  - the anchor (our opening aspiration) and a Boulware concession curve towards the reserve;
  - MESO term sheets: up to three packages of equal C for us that differ in the levers.
"""

import itertools
import math

from .cost import RELATIONSHIP_GOALS, complete_offer, must_haves_ok, snap, total_cost

# Per category goal: how far below the best opening price we anchor, how stubbornly we concede
# (Boulware exponent: small = hold firm until late), and the minimum margin we leave the supplier
# over its should-cost (None: the case's sustainable margin, for strategic and bottleneck goals).
GOALS = {
    "leverage": {"anchor": 0.12, "e": 0.25, "min_margin": 0.02},
    "routine": {"anchor": 0.07, "e": 0.6, "min_margin": 0.03},
    "stabilise": {"anchor": 0.06, "e": 0.4, "min_margin": None},
    "secure_supply": {"anchor": 0.05, "e": 0.5, "min_margin": None},
    "quality_first": {"anchor": 0.06, "e": 0.4, "min_margin": 0.03},
}
TARGET_OTD = 95.0  # the quality agreement's on-time delivery target (company.md)


def fact(case, package, ref):
    """A citable fact: the case's own facts first (hidden cases), then the data package."""
    found = (case.get("facts") or {}).get(ref)
    if found is None and package is not None:
        found = package.lookup(ref)
    return found


def cost(case, terms, std=None, supplier=None):
    try:
        return total_cost(case, terms, std, supplier)
    except (KeyError, TypeError, ValueError):
        return math.inf


def price_for(case, levers, std, target_c):
    """The unit price at which these levers cost exactly `target_c` (C is linear in the price)."""
    lo, hi = cost(case, {**levers, "unit_price": 10.0}, std), cost(case, {**levers, "unit_price": 20.0}, std)
    slope = (hi - lo) / 10.0
    if not math.isfinite(slope) or slope <= 0:
        return None
    return round(10.0 + (target_c - lo) / slope, 2)


def lever_fields(case):
    return [f for f in case["negotiable"] if f != "unit_price"]


def options(case, field, *also):
    found = list(case.get("term_options", {}).get(field) or [])
    for v in also:
        if v not in found and v is not None:
            found.append(v)
    return found or [None]


def ideal_levers(case, std, price):
    """Our cheapest combination of the non-price levers at a given price (must-haves kept)."""
    fields = lever_fields(case)
    best, best_c = {}, math.inf
    for combo in itertools.product(*(options(case, f) for f in fields)):
        levers = dict(zip(fields, combo, strict=True))
        terms = complete_offer(case, {**levers, "unit_price": price})
        if not must_haves_ok(case, terms, std):
            continue
        c = cost(case, terms, std)
        if c < best_c:
            best, best_c = {f: terms[f] for f in fields}, c
    return best


def lever_table(case, base, std):
    """Per lever and option: ΔC against `base` (a complete term sheet) and its price equivalent."""
    c0 = cost(case, base, std)
    per_unit = cost(case, {**base, "unit_price": base["unit_price"] + 1}, std) - c0  # € of C per €1 of price
    out = {}
    for f in lever_fields(case):
        rows = []
        for v in options(case, f, base.get(f)):
            t = {**base, f: v}
            dc = cost(case, t, std) - c0
            rows.append(
                {
                    "value": v,
                    "dc": round(dc, 2),
                    "price_eq": round(dc / per_unit, 2) if per_unit else None,
                    "ok": must_haves_ok(case, t, std),
                }
            )
        out[f] = rows
    return out


def boulware(r, rounds, aspiration, reserve, e):
    """Our target C at our r-th exploit move of `rounds`: close to the aspiration for long, then
    faster towards the reserve - concessions that shrink are the signal we want to send early."""
    if rounds <= 0:
        return reserve
    t = min(max(r / rounds, 0.0), 1.0)
    return aspiration + (reserve - aspiration) * t ** (1 / e)


# --- the data ---------------------------------------------------------------------------------


def _q(package, sql, params=()):
    try:
        return package.query(sql, params) if package is not None and package.db is not None else []
    except Exception:
        return []


def index_moves(case, package):
    """Cost drivers of the case's parts: weight, 12-month change of each series, citable IDs."""
    out = []
    for part in case.get("parts", []):
        for d in _q(package, "SELECT series_id, weight FROM cost_drivers WHERE part_id = ?", (part,)):
            months = _q(
                package,
                "SELECT id, month, value FROM index_values WHERE series_id = ? ORDER BY month DESC LIMIT 13",
                (d["series_id"],),
            )
            if len(months) < 13:
                continue
            last, first = months[0], months[12]
            name = (_q(package, "SELECT name FROM index_series WHERE id = ?", (d["series_id"],)) or [{}])[0].get("name")
            change = (last["value"] / first["value"] - 1) * 100
            out.append(
                {
                    "part": part,
                    "series": d["series_id"],
                    "name": name or d["series_id"],
                    "weight": d["weight"],
                    "change_pct": round(change, 1),
                    "from": first["id"],
                    "to": last["id"],
                    "from_month": first["month"],
                    "to_month": last["month"],
                }
            )
    return out


def should_cost(case, package, supplier):
    """The should-cost estimate per part: the row modelled for this supplier's plant if any."""
    out = {}
    for part in case.get("parts", []):
        rows = _q(
            package,
            "SELECT id, unit_cost, supplier_id, cost_base, price_unit FROM should_cost WHERE part_id = ?",
            (part,),
        )
        own = [r for r in rows if r.get("supplier_id") == supplier]
        if rows:
            out[part] = (own or rows)[0] | {"own_plant": bool(own)}
    return out


def history(package, supplier, parts):
    """Past price events with this supplier: how much of its asks it got."""
    rows = []
    for part in parts:
        rows += _q(
            package,
            "SELECT date, type, asked_pct, settled_pct, note FROM negotiation_history "
            "WHERE supplier_id = ? AND part_id = ? ORDER BY date",
            (supplier, part),
        )
    gaps = [
        r["settled_pct"] - r["asked_pct"]
        for r in rows
        if r.get("asked_pct") is not None and r.get("settled_pct") is not None
    ]
    return {"events": rows, "settled_minus_asked_pp": round(sum(gaps) / len(gaps), 1) if gaps else None}


def claims(case, package, supplier, opening_price):
    """Citable arguments for this supplier, one sentence each with the figure next to its IDs,
    strongest first. Each is checked by the arena; only true figures from the data go in."""
    out, b = [], case["buyer"]
    letter = fact(case, package, case.get("trigger_doc")) if case.get("trigger_doc") else None
    # 1. the cost drivers: index moves that undercut the claimed increase
    asked = (letter or {}).get("asked_pct")
    for m in index_moves(case, package):
        weak = asked is None or m["change_pct"] < asked
        out.append(
            {
                "kind": "index",
                "ids": [m["from"], m["to"]],
                "strength": (2 if m["change_pct"] <= 0 else 1) if weak else 0,
                "sentence": f"{m['name']} changed {m['change_pct']:+.1f}% from {m['from_month']} to {m['to_month']} "
                f"({m['from']}, {m['to']}).",
            }
        )
    # 2. a shorter notice than the contract requires
    ctr_id = next((r for r in case.get("refs", []) if r.startswith("ctr:")), None)
    ctr = fact(case, package, ctr_id) if ctr_id else None
    if letter and ctr and letter.get("days") is not None and ctr.get("days") and letter["days"] < ctr["days"]:
        out.append(
            {
                "kind": "notice",
                "ids": [case["trigger_doc"], ctr_id],
                "strength": 3,
                "sentence": f"Your letter gives {letter['days']} days' notice ({case['trigger_doc']}), while our "
                f"contract requires {ctr['days']} days ({ctr_id}).",
            }
        )
    # 3. rival quotes of this case that beat the supplier's opening price
    for ref in [*case.get("refs", []), (b.get("alternative") or {}).get("ref")]:
        q = fact(case, package, ref) if ref and ref.startswith("quote:") else None
        if (
            q
            and q.get("supplier") != supplier
            and q.get("unit_price")
            and opening_price
            and q["unit_price"] < opening_price
        ):
            out.append(
                {
                    "kind": "quote",
                    "ids": [ref],
                    "strength": 3,
                    "sentence": f"We hold a competing quote at EUR {q['unit_price']:.2f} per unit ({ref}).",
                }
            )
    # 4. scorecards below target: on-time delivery or quality
    for ref in case.get("refs", []):
        sc = fact(case, package, ref) if ref.startswith("sc:") else None
        if sc and sc.get("supplier") == supplier:
            if sc.get("otd_pct") is not None and sc["otd_pct"] < TARGET_OTD - 3:
                out.append(
                    {
                        "kind": "otd",
                        "ids": [ref],
                        "strength": 2,
                        "sentence": f"Your on-time delivery over the last 12 months was {sc['otd_pct']:.1f}% ({ref}), "
                        f"below our {TARGET_OTD:.0f}% target.",
                    }
                )
            if sc.get("ppm") and sc["ppm"] > 500 and b.get("category_goal") == "quality_first":
                out.append(
                    {
                        "kind": "ppm",
                        "ids": [ref],
                        "strength": 2,
                        "sentence": f"Your defect rate over the last 12 months was {sc['ppm']} ppm ({ref}).",
                    }
                )
    # 5. growing demand: a carrot, not a stick
    for ref in case.get("refs", []):
        fc = fact(case, package, ref) if ref.startswith("fc:") else None
        if fc and fc.get("change_pct") and fc["change_pct"] > 0:
            out.append(
                {
                    "kind": "forecast",
                    "ids": [ref],
                    "strength": 1,
                    "sentence": f"Our demand forecast for this part rose {fc['change_pct']:.1f}% ({ref}).",
                }
            )
    return sorted(out, key=lambda c: -c["strength"])


# --- the analysis ---------------------------------------------------------------------------


def analyse(case, opening, package=None, tactics=None):
    """`opening`: {supplier_id: {"terms": its opening offer, "standard": its standard terms}}.
    `tactics`: {supplier_id: strategy.tactics(...)} - per-supplier anchor, Boulware e, the value of
    money to it; without, the category goal's defaults."""
    b = case["buyer"]
    goal = GOALS.get(b.get("category_goal"), GOALS["leverage"])
    alt = b.get("alternative") or {}
    c_alt = cost(case, alt["terms"]) if alt.get("terms", {}).get("unit_price") else None
    letter = fact(case, package, case.get("trigger_doc")) if case.get("trigger_doc") else None
    moves = index_moves(case, package)
    justified = round(sum(m["weight"] * m["change_pct"] for m in moves), 2) if moves else None
    sups = {}
    for sid, o in opening.items():
        std, terms = o.get("standard") or {}, o.get("terms") or {}
        tac = (tactics or {}).get(sid) or {}
        c_open = cost(case, terms, std)
        ok = bool(terms.get("unit_price")) and must_haves_ok(case, terms, std)
        price = terms.get("unit_price")
        sc = should_cost(case, package, sid)
        unit_cost = next(iter(sc.values()))["unit_cost"] if sc else None
        margin = goal["min_margin"]
        if margin is None:
            margin = (b.get("sustainable_margin_pct") or 3) / 100
        floor = round(unit_cost * (1 + margin), 2) if unit_cost else None
        # strategic and bottleneck goals charge for squeezing the supplier: with a should-cost we can
        # price that, and the best package for us is where the charge outweighs any further saving
        est = (
            {"full_cost": unit_cost, "interest_rate": tac.get("interest_rate") or b["interest_rate"], "standard": std}
            if unit_cost and b.get("category_goal") in RELATIONSHIP_GOALS
            else None
        )
        p_opt, ideal = None, ideal_levers(case, std, price) if price else {}
        if est and price:
            ideal, p_opt, _ = best_fit(case, std, est, unit_cost * 0.85, max(price, unit_cost * 1.2))
        # the anchor price: below the opening, at most the justified increase, never below the floor
        anchor = price * (1 - tac.get("anchor", goal["anchor"])) if price else None
        if anchor and case.get("type") == "price_increase" and b.get("current_unit_price"):
            anchor = min(anchor, b["current_unit_price"] * (1 + max(justified or 0.0, 0.0) / 100))
        if anchor and p_opt:  # never below the relationship optimum (it would cost us more), and not
            # further than twice the supplier type's discount (a bottleneck that barely moves)
            anchor = max(p_opt, min(anchor, price * (1 - 2 * tac.get("anchor", goal["anchor"]))))
        elif anchor and floor:
            anchor = max(anchor, floor * (0.97 if b.get("category_goal") == "leverage" else 1.0))
        min_price = None if est else (round(floor * 0.97, 2) if floor else None)
        if anchor and not est:
            ideal = ideal_levers(case, std, anchor)
        aspiration = (
            cost(case, complete_offer(case, {**ideal, "unit_price": round(anchor, 2)}), std, est) if anchor else None
        )
        base = complete_offer(case, {**terms, "unit_price": price}) if price else None
        sups[sid] = {
            "c_open": c_open if math.isfinite(c_open) else None,
            "must_haves_ok": ok,
            "price": price,
            "terms": terms,
            "standard": std,
            "should_cost": sc,
            "floor_price": floor,
            "anchor_price": round(anchor, 2) if anchor else None,
            "relationship_optimum": p_opt,
            "min_price": min_price,
            "estimate": est,
            "ideal_levers": ideal,
            "aspiration_c": aspiration,
            "levers": lever_table(case, base, std) if base else {},
            "history": history(package, sid, case.get("parts", [])),
            "claims": claims(case, package, sid, price),
            "e": tac.get("e", goal["e"]),
            "tactics": tac,
        }
    opens = [s["c_open"] for s in sups.values() if s["must_haves_ok"] and s["c_open"] is not None]
    best_open = min(opens) if opens else None
    reserve = min(x for x in (c_alt, best_open) if x is not None) if (c_alt or best_open) else None
    return {
        "goal": b.get("category_goal"),
        "e": goal["e"],
        "c_alt": c_alt,
        "best_open": best_open,
        "reserve": reserve,
        "letter": {k: letter.get(k) for k in ("asked_pct", "asked_price", "effective_date", "days")}
        if letter
        else None,
        "index_moves": moves,
        "justified_pct": justified,
        "suppliers": sups,
    }


def solve_price(case, levers, std, target_c, est=None, lo=None, hi=None):
    """The unit price at which `levers` cost us `target_c`. Without a relationship charge C is
    linear in the price; with one it falls and then rises, so we search the rising side."""
    if est is None:
        return price_for(case, complete_offer(case, {**levers, "unit_price": 1.0}), std, target_c)
    f = lambda p: cost(case, complete_offer(case, {**levers, "unit_price": round(p, 2)}), std, est)  # noqa: E731
    grid = [lo + (hi - lo) * i / 120 for i in range(121)]
    vals = [(p, f(p)) for p in grid]
    p_min, c_min = min(vals, key=lambda v: v[1])
    if target_c <= c_min:
        return round(p_min, 2)
    return round(next((p for p, c in vals if p >= p_min and c >= target_c), hi), 2)


def best_fit(case, std, est, lo, hi):
    """The package that costs us least, relationship charge included: (levers, price, C)."""
    fields, best = lever_fields(case), (None, None, math.inf)
    for combo in itertools.product(*(options(case, f) for f in fields)):
        levers = dict(zip(fields, combo, strict=True))
        if not must_haves_ok(case, complete_offer(case, {**levers, "unit_price": lo}), std):
            continue
        p = solve_price(case, levers, std, -math.inf, est, lo, hi)  # the cheapest price for these levers
        c = cost(case, complete_offer(case, {**levers, "unit_price": p}), std, est)
        if c < best[2]:
            best = ({f: complete_offer(case, {**levers, "unit_price": p})[f] for f in fields}, p, c)
    return best


def meso(case, sup, target_c, theirs, protect=(), probe=0, gives=None):
    """Up to three term sheets that each cost us `target_c` and differ in the levers: our ideal
    levers, ours except the fields the supplier protects, and the supplier's own levers.
    `sup` is the supplier's entry of `analyse()`; `theirs` its standing terms. `gives` {field: value}:
    trades its profile says it values; then the 2nd sheet offers the first, the 3rd all of them."""
    fields, std, est = lever_fields(case), sup["standard"], sup.get("estimate")
    ours = sup["ideal_levers"]
    theirs = {**std, **(theirs or {})}
    lo = (est or {}).get("full_cost", 0) * 0.85
    hi = max(sup.get("price") or 0, lo * 1.5)
    # only small trades vary: a lever whose move to the supplier's value is worth at most 4 % of the
    # price (payment days, a date, lead time) - not coverage (contract months, volume), which would
    # need an absurd price to stay equal in C
    ref = complete_offer(case, {**ours, "unit_price": sup.get("anchor_price") or sup.get("price") or 1.0})
    per_unit = cost(case, {**ref, "unit_price": ref["unit_price"] + 1}, std) - cost(case, ref, std)

    def small(f, v):
        t = {**ref, f: snap(case, f, v)}
        return (
            v is not None
            and v != ours.get(f)
            and per_unit > 0
            and must_haves_ok(case, t, std)
            and abs(cost(case, t, std) - cost(case, ref, std)) / per_unit <= 0.04 * ref["unit_price"]
        )

    tradeable = [f for f in fields if small(f, theirs.get(f))]
    held = {f: theirs[f] for f in protect if f in tradeable}
    offered = {f: v for f, v in (gives or {}).items() if f in fields and small(f, v)}
    if offered:  # the profile says what it values: our ideal, then its first trade, then all of them
        first = dict([next(iter(offered.items()))])
        mixes = [ours, {**ours, **held, **first}, {**ours, **held, **offered}]
    else:  # without known trades, each round probes a different lever (round r gives field r)
        keep = list(held) or (tradeable[probe % len(tradeable) :][:1] if tradeable else [])
        mixes = [ours, {**ours, **{f: theirs[f] for f in keep}}, {**ours, **{f: theirs[f] for f in tradeable}}]
    sheets = []
    for levers in mixes:
        levers = {f: snap(case, f, v) for f, v in levers.items() if f in fields}
        price = solve_price(case, levers, std, target_c, est, lo, hi)
        if not price or price <= 0:
            continue
        if sup.get("min_price") and price < sup["min_price"]:  # below the supplier's floor
            price = sup["min_price"]
        t = complete_offer(case, {**levers, "unit_price": price})
        if must_haves_ok(case, t, std) and t not in sheets:
            sheets.append(t)
    return sheets[:3]
