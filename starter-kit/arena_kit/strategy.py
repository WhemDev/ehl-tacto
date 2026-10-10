"""Supplier type → negotiation tactics: the hook between the supplier profiles and the orchestra.

The profiles (`profiles.py`, built offline) say who a supplier is: its archetype, its situation (cash
pressure, capacity, how much it needs us and we need it), what it wants and what it protects. This
module turns that into numbers the orchestra uses, so the agent learns *type → strategy*, which carries
over to suppliers practice never showed:
  anchor     how far below its opening price we open (the goal's default × the type's factor)
  e          the Boulware exponent: small holds firm until late, large concedes sooner
  gives      trades this type values, offered in the second and third MESO term sheet at equal C for us
             (e.g. faster payment for a cash-short shop, a longer contract for a firm hungry for work)
  protect    fields it will hardly move: we give it its own value there and push elsewhere
  interest   what money is worth to it (cash-short: more), for the relationship charge of strategic goals
  voice      tone, wants, things to avoid and talking points for the e-mail writer
No profile (the sandbox's demo suppliers, a stranger): the goal's defaults, unchanged.

Tuning: ARENA_STRATEGY='{"cash_short": {"anchor": 1.2}}' (JSON, or a path to a JSON file) patches the
archetype table; ARENA_PROFILES=off switches the hook off (A/B tests).
"""

import json
import os
import re
from pathlib import Path

from .analysis import GOALS

# Per archetype: factors on the goal's anchor and Boulware exponent, and the trades it values as
# (field, mode): "low" / "high" = that end of the case's options, "theirs" = the supplier's own value.
ARCHETYPES = {
    "family_relationship": {
        "anchor": 0.7,
        "e": 1.3,
        "gives": [("contract_months", "high"), ("effective_date", "theirs")],
    },
    "group_approval_ladder": {"anchor": 0.75, "e": 1.0, "gives": [("effective_date", "theirs")]},
    "cash_short": {"anchor": 1.0, "e": 1.0, "gives": [("payment_days", "low")]},
    "hungry_for_work": {"anchor": 1.3, "e": 0.8, "gives": [("contract_months", "high"), ("volume_per_year", "high")]},
    "capacity_constrained": {
        "anchor": 0.6,
        "e": 1.4,
        "gives": [("lead_time_days", "high"), ("contract_months", "high")],
    },
    "near_monopolist": {"anchor": 0.5, "e": 1.6, "gives": [("index_clause", "theirs"), ("effective_date", "theirs")]},
    "quality_problem": {"anchor": 1.1, "e": 0.9, "gives": []},
}
SECONDARY_WEIGHT = 0.3
WORDS = {  # how the profiles name the fields in prose
    "unit_price": ("unit_price", "price", "list price"),
    "payment_days": ("payment_days", "payment", "skonto", "cash discount"),
    "effective_date": ("effective_date", "effective date", "start date", "timing of the increase"),
    "contract_months": ("contract_months", "contract length", "contract term", "duration"),
    "volume_per_year": ("volume_per_year", "volume", "allocation", "quota"),
    "lead_time_days": ("lead_time_days", "lead time", "delivery time"),
    "index_clause": ("index_clause", "index clause", "index"),
    "tooling_eur": ("tooling_eur", "tooling"),
    "ppm_commitment": ("ppm_commitment", "ppm", "defect rate"),
    "chargeback_eur_per_complaint": ("chargeback_eur_per_complaint", "chargeback"),
}
PROFILES = Path(__file__).resolve().parents[1] / "profiles"
ID_RE = re.compile(r"\b(?:sup|part|po|gr|inv|qn|ctr|quote|rfq|fc|idx|sc|cost|news|doc|ev):[\w.:@#/-]*\w")


def _table():
    """The archetype table, patched by ARENA_STRATEGY if set."""
    table = {k: dict(v) for k, v in ARCHETYPES.items()}
    raw = os.environ.get("ARENA_STRATEGY")
    if raw:
        patch = json.loads(Path(raw).read_text(encoding="utf-8") if Path(raw).is_file() else raw)
        for arch, values in patch.items():
            table.setdefault(arch, {}).update(values)
    return table


def load(sid):
    """A supplier's cached profile, or None (no profile, or the hook switched off)."""
    if os.environ.get("ARENA_PROFILES", "on").lower() in ("off", "0", "false"):
        return None
    path = PROFILES / f"{sid.replace(':', '_')}.json"
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None
    except (OSError, ValueError):
        return None


def fields_in(texts):
    """The negotiable fields a list of profile sentences talks about."""
    found = []
    for text in texts or []:
        low = str(text).lower()
        for field, words in WORDS.items():
            if field not in found and any(w in low for w in words):
                found.append(field)
    return found


def _mix(primary, secondary, key, conf):
    p = primary.get(key, 1.0)
    if secondary:
        p = (1 - SECONDARY_WEIGHT) * p + SECONDARY_WEIGHT * secondary.get(key, 1.0)
    return 1 + (p - 1) * conf  # an unsure profile moves the defaults less


def tactics(case, profile):
    """The orchestra's parameters for one supplier of a case, from its profile (None: defaults)."""
    b = case["buyer"]
    goal = GOALS.get(b.get("category_goal"), GOALS["leverage"])
    out = {
        "anchor": goal["anchor"],
        "e": goal["e"],
        "gives": [],
        "protect": [],
        "interest_rate": None,
        "archetype": None,
        "voice": None,
    }
    if not profile:
        return out
    table = _table()
    arch, sec = profile.get("archetype"), profile.get("secondary_archetype")
    primary, secondary = table.get(arch, {}), table.get(sec) if sec else None
    conf = min(max(float(profile.get("confidence") or 0.5), 0.0), 1.0)
    s = profile.get("situation") or {}
    anchor = goal["anchor"] * _mix(primary, secondary, "anchor", conf)
    e = goal["e"] * _mix(primary, secondary, "e", conf)
    # the situation: a supplier that needs us can be pushed harder, one we need cannot
    needs_us, we_need = float(s.get("dependency_on_us") or 0.3), float(s.get("our_dependency") or 0.5)
    anchor *= (0.85 + 0.5 * needs_us) * (1.15 - 0.4 * we_need)
    if s.get("capacity") == "under_used":
        anchor *= 1.1
    elif s.get("capacity") == "full":
        e *= 1.2
    if s.get("relationship") == "strained":
        anchor *= 0.9
    protect = [f for f in fields_in(profile.get("protects")) if f in case["negotiable"]]
    if "unit_price" in protect:  # its price is policy or already tight: push on terms instead
        anchor *= 0.75
    gives = [g for g in primary.get("gives", []) + (secondary or {}).get("gives", [])]
    cash = float(s.get("cash_pressure") or 0.0)
    if cash >= 0.5 and ("payment_days", "low") not in gives:
        gives.insert(0, ("payment_days", "low"))
    seen, ordered = set(), []
    for field, mode in gives:
        if field in case["negotiable"] and field not in seen and field != "unit_price":
            seen.add(field)
            ordered.append((field, mode))
    points = [ID_RE.sub("", a.get("point", "")).replace("()", "").strip() for a in profile.get("arguments") or []]
    out.update(
        anchor=round(min(max(anchor, 0.02), 0.25), 4),
        e=round(min(max(e, 0.15), 1.5), 3),
        gives=ordered,
        protect=[f for f in protect if f != "unit_price"],
        interest_rate=round(b["interest_rate"] + 0.3 * cash, 3),
        archetype=arch + (f" / {sec}" if sec else ""),
        voice={
            "summary": ID_RE.sub("", profile.get("summary", ""))[:500],
            "tone": profile.get("tone"),
            "decision_maker": s.get("decision_maker"),
            "wants": [ID_RE.sub("", w) for w in (profile.get("wants") or [])[:3]],
            "avoid": [ID_RE.sub("", a) for a in (profile.get("avoid") or [])[:3]],
            "points": [p for p in points if p][:3],
        },
    )
    return out


def give_values(case, gives, theirs):
    """Concrete values for `gives` [(field, mode)] in this case: an end of the options or its own."""
    out = {}
    for field, mode in gives:
        opts = [o for o in case.get("term_options", {}).get(field) or [] if o is not None]
        if mode == "theirs":
            if theirs.get(field) is not None:
                out[field] = theirs[field]
        elif opts and all(isinstance(o, int | float | str) for o in opts):
            try:
                out[field] = min(opts) if mode == "low" else max(opts)
            except TypeError:
                continue
    return out
