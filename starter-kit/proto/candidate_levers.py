"""Opt-in candidate levers; baseline A9h is unchanged."""


def extreme_payments(case, grid):
    """Keep the shortest/longest feasible payment term (fixed/required terms stay binding)."""
    if "payment_days" not in case["negotiable"]:
        return grid
    days = {g.get("payment_days") for g in grid} - {None}
    if not days:
        return grid
    ends = {min(days), max(days)}
    return [g for g in grid if g.get("payment_days") in ends]


def worthwhile_leads(neg, thread):
    """Only learn from same-message quotes differing solely in price and lead time.

    Compare the complete buyer cost, including late days. Do not infer a speed premium
    from prose or from quotes that also change payment/volume/quality.
    """
    allowed = {}
    for event in thread.events:
        if event.get("from") in ("buyer", "arena"):
            continue
        sheets = [s.get("terms", {}) for s in event.get("term_sheets", [])]
        for fast in sheets:
            for slow in sheets:
                if not all(
                    x.get("unit_price") is not None and x.get("lead_time_days") is not None for x in (fast, slow)
                ):
                    continue
                if slow["lead_time_days"] <= fast["lead_time_days"]:
                    continue
                keys = (fast.keys() | slow.keys()) - {"unit_price", "lead_time_days"}
                if any(fast.get(k) != slow.get(k) for k in keys):
                    continue
                if slow["unit_price"] < fast["unit_price"] and neg.C(thread, slow) < neg.C(thread, fast):
                    days = slow["lead_time_days"]
                    allowed[days] = max(allowed.get(days, 0), fast["unit_price"] - slow["unit_price"])
    return allowed


def first_indices(facts):
    """Promote favourable driver indices; PPI evidence precedes hedge-sensitive inputs.

    facts_for constructs only negative index changes. Stable sorting retains all other
    evidence and later-round pacing. No new claims or figures are invented here.
    """

    def rank(fact):
        ids = fact[0] if isinstance(fact[0], list) else [fact[0]]
        if ids and all(isinstance(i, str) and i.startswith("idx:") for i in ids):
            return 0 if any(i.startswith("idx:PPI-") for i in ids) else 1
        return 2

    return sorted(facts, key=rank)
