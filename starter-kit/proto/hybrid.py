"""Evidence-led package trades, independent of demo IDs and supplier personas."""

import math

from arena_kit.cost import closing_terms, must_haves_ok, total_cost


def revealed_schedule(case, proposals, quoted_sheets, standard=None, supplier=None):
    """Relax at most one proposal to a matching, supplier-quoted delivery schedule.

    Quotes are evidence for a new counteroffer, never an executable old offer. Keep
    price and every other term unchanged, and verify buyer indifference in euros.
    The caller supplies only the current supplier's latest open reply sheets.
    """
    picks = [dict(p) for p in proposals]
    if case.get("type") != "rfq" or "lead_time_days" not in case.get("negotiable", []):
        return picks, []
    if "lead_time_days" in case.get("fixed_terms", {}):
        return picks, []
    options = case.get("term_options", {}).get("lead_time_days")
    deadline = case["buyer"]["need_lead_time_days"]
    for i, proposal in enumerate(picks):
        base = closing_terms(case, proposal, standard)
        for quote in quoted_sheets:
            terms = quote.get("terms", {})
            lead = terms.get("lead_time_days")  # must be explicit supplier evidence
            if not isinstance(lead, (int, float)) or not base["lead_time_days"] < lead <= deadline:
                continue
            if options and lead not in options:
                continue
            observed = closing_terms(case, terms, standard)
            fields = (base.keys() | observed.keys()) - {"unit_price", "lead_time_days"}
            if any(base.get(f) != observed.get(f) for f in fields):
                continue
            candidate = {**proposal, "lead_time_days": lead}
            if candidate in picks or not must_haves_ok(case, candidate, standard):
                continue
            before = total_cost(case, proposal, standard, supplier)
            after = total_cost(case, candidate, standard, supplier)
            if not math.isfinite(before) or not math.isfinite(after) or abs(after - before) > 0.01:
                continue
            picks[i] = candidate
            return picks, [{"package": i + 1, "from_days": base["lead_time_days"],
                            "to_days": lead, "quote_id": quote.get("term_sheet_id"),
                            "terms": candidate, "cost_before": before, "cost_after": after}]
    return picks, []
