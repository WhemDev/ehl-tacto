"""Supplier profiles: who each supplier is and what will move it, built offline before the final.

    uv run python -m arena_kit.profiles                      # every detailed supplier (46), cached
    uv run python -m arena_kit.profiles sup:70110 --force    # one supplier, rebuilt
    uv run python -m arena_kit.profiles --dossier sup:70110  # print the facts the model sees, no LLM

Two steps per supplier:
  dossier - code collects everything the data says about it (master data, intel, contract, price and
            negotiation history, scorecards, complaints, our payments, spend, quotes, news, letters,
            notes, the Sunday release) and computes indicators: our share of its turnover, its credit
            trend, how much of its asks it got, its margin over should-cost.
  profile - a strong model reads the dossier and returns JSON: archetype, situation, what it wants,
            what it protects, the trades to offer, how to talk to it, with the IDs behind each claim.
            Code drops every ID the data does not have.
Profiles are cached in `profiles/` by a hash of the dossier and the prompt, so a rerun after the
Sunday release only rebuilds the suppliers whose data changed. The agent reads them with `load()`.
"""

import argparse
import hashlib
import json
import logging
import os
import re
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

from .data import DataPackage

log = logging.getLogger("arena")
OUT = Path(__file__).resolve().parents[1] / "profiles"
CASES = Path(__file__).resolve().parents[1] / "cases"
PROMPT_VERSION = "1"
ID_RE = re.compile(r"\b(?:sup|part|po|gr|inv|qn|ctr|quote|rfq|fc|idx|sc|cost|news|doc|ev):[\w.:@#/-]*\w")
ARCHETYPES = {
    "family_relationship": "owner-led family firm; remembers how it was treated, values loyalty, fairness and steady "
    "volume; moves for respect and long-term commitment, digs in against pressure",
    "group_approval_ladder": "part of a group or a larger corporate; the contact must get approval for bigger moves, "
    "list prices are policy; moves on terms (payment, dates, volume) more easily than on list price",
    "cash_short": "tight liquidity (weak or worsening credit index, low equity, asks for faster payment or "
    "prepayment); values fast payment or skonto far above our interest rate",
    "hungry_for_work": "under-used capacity, lost customers or volume; values volume, contract length and forecast "
    "security, gives price for them",
    "capacity_constrained": "full order books, long or rising lead times, allocations; values commitment and "
    "forecasts, charges for urgency, price moves little",
    "near_monopolist": "few or no alternatives for us (single source, own tooling, special technology); barely moves, "
    "secure supply and terms instead of fighting on price",
    "quality_problem": "poor scorecard or open complaints; under pressure to fix quality, can be moved with "
    "ppm/chargeback commitments and the threat to its share",
}
FIELDS = (
    "unit_price payment_days effective_date contract_months volume_per_year lead_time_days incoterm index_clause "
    "tooling_eur ppm_commitment chargeback_eur_per_complaint"
).split()

SYSTEM = f"""You are a senior procurement analyst at Hollerau Pumpenwerke GmbH, a German pump maker.
Today is 2026-09-30. You profile ONE supplier from the dossier below, to prepare a buyer agent that will
negotiate with it by e-mail. Read it as a person reads a counterpart: what is this company dealing with right
now, what does it need, what will it never give, what trade would it welcome?

Archetypes (pick the best primary one, optionally a secondary one):
{chr(10).join(f"- {k}: {v}" for k, v in ARCHETYPES.items())}

Rules:
- Ground every statement in the dossier. Cite the IDs behind it (doc:, news:, sc:, ctr:, cost:, quote:, ev:, ...)
  exactly as written in the dossier. Never invent an ID or a figure.
- Some notes are noise (certificates, holiday shutdowns, new contacts); ignore them unless they matter.
- The indicators are computed by code and are correct; use them.
- Be specific and short. The buyer agent reads this under time pressure.
- Negotiable fields: {", ".join(FIELDS)}.

Reply with ONE JSON object and nothing else:
{{
  "archetype": "<one of {", ".join(ARCHETYPES)}>",
  "secondary_archetype": "<one of the archetypes or null>",
  "confidence": <0-1, how clearly the data supports the archetype>,
  "summary": "<2-3 sentences: who it is and what it is dealing with right now>",
  "situation": {{
    "cash_pressure": <0-1>,
    "capacity": "<under_used | normal | full | unknown>",
    "dependency_on_us": <0-1, how much it needs our business>,
    "our_dependency": <0-1, how hard it would be for us to replace it>,
    "relationship": "<good | neutral | strained | unknown>",
    "decision_maker": "<who decides price moves, e.g. 'owner', 'sales rep up to x %, then managing director'>"
  }},
  "negotiation_pattern": "<how it negotiated in the past: what it asked, what it settled for, how it reacts to pressure>",
  "wants": ["<ranked: what it values most, e.g. 'faster payment', 'volume security'>"],
  "protects": ["<fields or things it will hardly move, e.g. 'unit_price (list price policy)'>"],
  "trades": [{{"give": "<what we offer, a field and direction>", "get": "<what we ask for>", "why": "<one line>", "ids": ["..."]}}],
  "arguments": [{{"point": "<an argument likely to land with this supplier>", "ids": ["..."]}}],
  "avoid": ["<what will backfire with this supplier>"],
  "tone": "<one line: how to write to it>",
  "red_flags": ["<risks: supply, quality, insolvency, walk-away>"],
  "evidence": [{{"claim": "<a key fact>", "ids": ["..."]}}]
}}"""


# --- dossier: the facts, collected by code --------------------------------------------------


def suppliers(pkg):
    return [r["id"] for r in pkg.query("SELECT id FROM suppliers WHERE detail = 'full' ORDER BY id")]


def _rows(pkg, sql, sid, limit=200):
    return pkg.query(sql, (sid,), limit)


def _release_rows(pkg, table, sid):
    """Rows of the Sunday release (news, letters) about this supplier: they are not in the SQLite."""
    if not pkg.release:
        return []
    return [
        {k: v for k, v in r.items() if k not in ("table", "root")}
        for r in pkg._ids.values()
        if r.get("table") == table and r.get("root") and r.get("supplier_id") == sid
    ]


def _days(a, b):
    try:
        return (date.fromisoformat(b[:10]) - date.fromisoformat(a[:10])).days
    except (TypeError, ValueError):
        return None


def indicators(pkg, sid, intel, hist, spend, cards, inv, prices, should):
    out = {}
    turnover = intel.get("turnover_eur")
    if turnover and spend:
        last = max(spend, key=lambda r: r["fiscal_year"])
        out["our_share_of_its_turnover_pct"] = round(100 * last["spend_eur"] / turnover, 1)
        out["our_spend_eur"] = {r["fiscal_year"]: round(r["spend_eur"]) for r in spend}
    if intel.get("credit_index") is not None:
        ci, ago = intel["credit_index"], intel.get("credit_index_12m_ago")
        out["credit_index"] = f"{ci} (12 months ago {ago}; higher is worse, >300 weak)"
    asked = [h for h in hist if h.get("asked_pct") is not None and h.get("settled_pct") is not None]
    if asked:
        out["history_mean_asked_pct"] = round(statistics.mean(h["asked_pct"] for h in asked), 2)
        out["history_mean_settled_pct"] = round(statistics.mean(h["settled_pct"] for h in asked), 2)
        out["history_settled_minus_asked_pct"] = round(
            out["history_mean_settled_pct"] - out["history_mean_asked_pct"], 2
        )
    late = [d for r in inv if (d := _days(r["due_date"], r["paid_date"])) is not None]
    if late:
        out["we_pay_days_after_due_mean"] = round(statistics.mean(late), 1)
        out["we_pay_late_share_pct"] = round(100 * sum(d > 0 for d in late) / len(late))
    if inv:
        out["skonto_taken_share_pct"] = round(100 * sum(bool(r.get("discount_taken")) for r in inv) / len(inv))
    margins = []
    for s in should:
        p = next((x for x in prices if x["part_id"] == s["part_id"]), None)
        if p and s.get("unit_cost") and p.get("price") and s.get("price_unit") == p.get("price_unit"):
            plant = (
                "its own plant"
                if s.get("supplier_id") == sid
                else f"plant of {s.get('supplier_id') or s.get('cost_base')}"
            )
            pct = round(100 * (p["price"] / s["unit_cost"] - 1), 1)
            margins.append(f"{s['part_id']}: price {p['price']} vs {s['id']} {s['unit_cost']} ({plant}): {pct:+} %")
    if margins:
        out["price_vs_should_cost_no_margin"] = margins
    if cards:
        out["scorecard_trend"] = " → ".join(
            f"{c['quarter']} {c['colour']} (otd {c['otd_pct']}, ppm {c['ppm']})" for c in reversed(cards)
        )
    return out


def dossier(pkg, sid):
    """Everything the data says about one supplier, as a dict (stable order, so it hashes stably)."""
    s = _rows(pkg, "SELECT * FROM suppliers WHERE id = ?", sid)[0]
    intel = (_rows(pkg, "SELECT * FROM supplier_intel WHERE supplier_id = ?", sid) or [{}])[0]
    sourcing = _rows(
        pkg,
        """SELECT so.part_id, p.description, p.category, so.status, so.quota_pct, so.tooling_owner,
                  (SELECT count(*) FROM sourcing o WHERE o.part_id = so.part_id AND o.supplier_id != so.supplier_id) AS other_sources
           FROM sourcing so JOIN parts p ON p.id = so.part_id WHERE so.supplier_id = ? ORDER BY so.part_id""",
        sid,
    )
    prices = _rows(
        pkg,
        """SELECT part_id, price, price_unit, valid_from, basis, event_id FROM price_conditions pc
           WHERE supplier_id = ? AND valid_from = (SELECT max(valid_from) FROM price_conditions
                 WHERE part_id = pc.part_id AND supplier_id = pc.supplier_id) ORDER BY part_id""",
        sid,
    )
    hist = _rows(pkg, "SELECT * FROM negotiation_history WHERE supplier_id = ? ORDER BY date DESC", sid, 20)
    contracts = _rows(pkg, "SELECT * FROM contracts WHERE supplier_id = ?", sid)
    clauses = _rows(
        pkg,
        """SELECT id, type, text, series, material_share, deadband_pct, days FROM contract_clauses
           WHERE contract_id IN (SELECT id FROM contracts WHERE supplier_id = ?) AND type != 'scope' ORDER BY id""",
        sid,
    )
    cards = _rows(pkg, "SELECT * FROM scorecards WHERE supplier_id = ? ORDER BY quarter DESC", sid, 4)
    qns = _rows(
        pkg,
        """SELECT count(*) AS n, sum(complaint_qty) AS qty, sum(cost_recharged_eur) AS recharged,
                  sum(d8_date IS NULL) AS open_8d, max(qn_date) AS last FROM quality_notifications
           WHERE supplier_id = ? AND qn_date >= '2025-10-01'""",
        sid,
    )
    inv = _rows(pkg, "SELECT due_date, paid_date, discount_taken FROM invoices WHERE supplier_id = ?", sid, 100000)
    spend = _rows(pkg, "SELECT fiscal_year, spend_eur FROM spend_cube WHERE supplier_id = ? ORDER BY fiscal_year", sid)
    should = _rows(
        pkg,
        "SELECT * FROM should_cost WHERE supplier_id = ?1 OR part_id IN (SELECT part_id FROM sourcing WHERE supplier_id = ?1)",
        sid,
    )
    quotes = _rows(
        pkg,
        "SELECT id, rfq_id, part_id, quote_date, unit_price, price_unit, lead_time_days, payment_days, tooling_eur, awarded, missing_fields, remarks FROM quotes WHERE supplier_id = ? ORDER BY quote_date DESC",
        sid,
        12,
    )
    news = _rows(pkg, "SELECT id, date, topic, headline, body FROM news WHERE supplier_id = ? ORDER BY date", sid)
    news += _release_rows(pkg, "news", sid)
    docs = _rows(pkg, "SELECT * FROM documents WHERE supplier_id = ? ORDER BY date", sid)
    docs += _release_rows(pkg, "documents", sid)
    letters = []
    for d in docs:
        try:
            text = pkg.document(d["id"])
        except (FileNotFoundError, KeyError):
            text = ""
        meta = {
            k: d.get(k)
            for k in ("id", "date", "kind", "author", "asked_pct", "asked_price", "effective_date")
            if d.get(k)
        }
        letters.append({**meta, "text": text.strip()})
    seen = sorted(
        p.stem
        for p in CASES.glob("*.json")
        if sid in json.dumps(json.loads(p.read_text(encoding="utf-8")).get("suppliers", ""))
    )
    return {
        "supplier": {
            k: s.get(k)
            for k in (
                "id",
                "name",
                "country",
                "category",
                "abc_class",
                "payment_days",
                "skonto_days",
                "skonto_pct",
                "incoterm",
                "standard_lead_time_days",
                "blocked",
            )
        },
        "intel": {k: v for k, v in intel.items() if k != "supplier_id"},
        "indicators": indicators(pkg, sid, intel, hist, spend, cards, inv, prices, should),
        "parts": sourcing,
        "current_prices": prices,
        "should_cost": should,
        "negotiation_history": hist,
        "contracts": contracts,
        "contract_clauses": clauses,
        "scorecards": cards,
        "complaints_last_12m": qns[0] if qns else {},
        "quotes": quotes,
        "news": news,
        "correspondence": letters,
        "practice_cases": seen,
    }


# --- profile: the model reads the dossier -------------------------------------------------


def _key(d, model):
    blob = json.dumps(d, sort_keys=True, default=str) + SYSTEM + PROMPT_VERSION + (model or "")
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _path(sid):
    return OUT / f"{sid.replace(':', '_')}.json"


def _clean_ids(obj, pkg, dropped):
    """Keep only IDs the data package knows: an invented ID would read as a lie if the agent cites it."""
    if isinstance(obj, dict):
        return {k: (_ids_ok(v, pkg, dropped) if k == "ids" else _clean_ids(v, pkg, dropped)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean_ids(v, pkg, dropped) for v in obj]
    return obj


def _ids_ok(ids, pkg, dropped):
    keep = []
    for i in ids if isinstance(ids, list) else [ids]:
        i = str(i).strip()
        if pkg.lookup(i) is not None or pkg.lookup(i.split("#")[0]) is not None:
            keep.append(i)
        else:
            dropped.append(i)
    return keep


def build(pkg, sid, complete, model=None, force=False, d=None):
    """The supplier's profile, from the cache if its dossier and the prompt did not change. Pass `d` (the
    dossier) when calling from threads: the package's SQLite connection must not be shared across them."""
    d = d or dossier(pkg, sid)
    key, path = _key(d, model), _path(sid)
    if not force and path.is_file():
        old = json.loads(path.read_text(encoding="utf-8"))
        if old.get("meta", {}).get("key") == key:
            return old, False
    from .agents.llm import parse

    t0 = time.monotonic()
    user = "DOSSIER\n" + json.dumps(d, ensure_ascii=False, indent=1, default=str)
    reply = complete(SYSTEM, user)
    profile = parse(reply)
    dropped = []
    profile = _clean_ids(profile, pkg, dropped)
    if profile.get("archetype") not in ARCHETYPES:
        profile["archetype"] = None
    profile = {
        "supplier_id": sid,
        "name": d["supplier"]["name"],
        **profile,
        "indicators": d["indicators"],
        "practice_cases": d["practice_cases"],
        "meta": {
            "key": key,
            "model": model,
            "prompt_version": PROMPT_VERSION,
            "built": time.strftime("%F %T"),
            "seconds": round(time.monotonic() - t0, 1),
            "release": bool(pkg.release),
            "dropped_ids": dropped,
        },
    }
    OUT.mkdir(exist_ok=True)
    path.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return profile, True


def load(sid):
    """The cached profile of a supplier, or None (e.g. a supplier the data does not know)."""
    path = _path(sid)
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def write_index(profiles):
    """profiles/INDEX.md: one line per supplier, for people."""
    rows = [
        "| Supplier | Name | Archetype | Conf. | Cash | Needs us | We need it | Wants | Practice |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for p in sorted(profiles, key=lambda p: p["supplier_id"]):
        s = p.get("situation", {})
        arch = p.get("archetype") or "?"
        if p.get("secondary_archetype"):
            arch += f" / {p['secondary_archetype']}"
        wants = "; ".join((p.get("wants") or [])[:2]).replace("|", "/")
        rows.append(
            f"| `{p['supplier_id']}` | {p['name']} | {arch} | {p.get('confidence')} | {s.get('cash_pressure')} | "
            f"{s.get('dependency_on_us')} | {s.get('our_dependency')} | {wants} | {', '.join(p.get('practice_cases') or []) or '-'} |"
        )
    OUT.mkdir(exist_ok=True)
    (OUT / "INDEX.md").write_text(
        "# Supplier profiles\n\nGenerated by `python -m arena_kit.profiles`: do not edit, rebuild.\n\n"
        + "\n".join(rows)
        + "\n",
        encoding="utf-8",
    )


def offline_llm():
    """Like `llm_from_env()`, but with the time an offline job may take (the live agent has 45 s), and a
    server-side fallback: a request a safety classifier declines is re-run on Anthropic's recommended model."""
    import anthropic

    client = anthropic.Anthropic(timeout=300.0, max_retries=2)  # a stalled request is retried, not waited out
    model, effort = os.environ["LLM_MODEL"], os.environ.get("LLM_EFFORT")

    def complete(system, user):
        extra = {"output_config": {"effort": effort}} if effort else {}
        with client.beta.messages.stream(
            model=model,
            max_tokens=32000,
            system=system,
            messages=[{"role": "user", "content": user}],
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            **extra,
        ) as stream:
            r = stream.get_final_message()
        if r.stop_reason == "refusal":  # the whole fallback chain declined
            raise RuntimeError(f"refused ({getattr(r.stop_details, 'category', None)})")
        return "".join(b.text for b in r.content if b.type == "text")

    return complete


def main(argv=None):
    from .agents.llm import llm_from_env
    from .cli import load_env

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("suppliers", nargs="*", help="supplier IDs (default: every detailed supplier)")
    ap.add_argument("--data", default=None, help="the data package (default ARENA_DATA or ../data)")
    ap.add_argument(
        "--model", default=None, help="LLM_MODEL for the profiles (default: the strongest, claude-opus-5-5)"
    )
    ap.add_argument(
        "--effort", default="high", help="LLM_EFFORT for Anthropic models (default high: this runs offline)"
    )
    ap.add_argument("--parallel", type=int, default=6)
    ap.add_argument("--force", action="store_true", help="rebuild even if the dossier did not change")
    ap.add_argument("--dossier", metavar="SUPPLIER", help="print one supplier's dossier and exit (no LLM)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")

    load_env()
    load_env(Path(__file__).resolve().parents[2] / ".env")
    if os.environ.get("CLAUDE_API_KEY"):
        os.environ.setdefault("ANTHROPIC_API_KEY", os.environ["CLAUDE_API_KEY"])
    pkg = DataPackage(args.data or os.environ.get("ARENA_DATA") or "../data")
    if args.dossier:
        return print(json.dumps(dossier(pkg, args.dossier), ensure_ascii=False, indent=1, default=str))

    os.environ["LLM_MODEL"] = args.model or os.environ.get("PROFILE_MODEL") or "claude-opus-5-5"
    if args.effort:
        os.environ["LLM_EFFORT"] = args.effort
    complete = offline_llm() if os.environ.get("LLM_PROVIDER", "anthropic") == "anthropic" else llm_from_env()
    ids = args.suppliers or suppliers(pkg)
    print(f"{len(ids)} suppliers, model {os.environ['LLM_MODEL']}, release {'yes' if pkg.release else 'no'}")

    pkg.lookup("")  # build the ID index once, before threads read it
    dossiers = {sid: dossier(pkg, sid) for sid in ids}  # SQLite here, in one thread; only the LLM runs in parallel

    def one(sid):
        try:
            p, built = build(pkg, sid, complete, os.environ["LLM_MODEL"], args.force, dossiers[sid])
            print(
                f"  {sid:<12} {'built ' if built else 'cached'} {p.get('archetype')}  dropped {len(p['meta']['dropped_ids'])} IDs"
            )
            return p
        except Exception as e:  # one supplier must not stop the others
            log.exception("%s failed", sid)
            print(f"  {sid:<12} FAILED {type(e).__name__}: {e}")
            return None

    with ThreadPoolExecutor(max_workers=args.parallel) as pool:
        list(pool.map(one, ids))
    profiles = [p for sid in suppliers(pkg) if (p := load(sid))]
    write_index(profiles)
    print(f"{len(profiles)} profiles in {OUT}, index: {OUT / 'INDEX.md'}")


if __name__ == "__main__":
    main()
