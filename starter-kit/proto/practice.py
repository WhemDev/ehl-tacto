"""The engine on hosted practice (and final) cases: facts and floors from the data package.

    PYTHONPATH=. uv run python proto/practice.py --dry case:P01 case:P05     # no session, no quota
    ENGINE_CFG='{...}' PYTHONPATH=. uv run python proto/practice.py case:P01  # plays: costs 1 practice session

Facts are built only from facts.json / the SQL tables, with the exact figure the arena checks,
and only when they help us (e.g. never a fallback quote dearer than the supplier's ask).
"""

import base64
import json
import math
import re
from collections.abc import Mapping
from copy import copy
from dataclasses import replace
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from arena_kit import ArenaClient
from arena_kit.cost import closing_terms
from arena_kit.cli import load_env
from arena_kit.data import DataPackage

from proto.engine import Config, Negotiator, fmt, play
from proto.target import target

_PKG, _LOCK = None, threading.RLock()
_FACT_IDS = None


def pkg():
    global _PKG
    with _LOCK:
        if _PKG is None:
            _PKG = DataPackage(os.environ.get("ARENA_DATA", "data/package"))
        return _PKG


def q(sql, params=()):
    with _LOCK:  # one sqlite connection shared by all threads
        return pkg().query(sql, params)


def lookup(ref):
    with _LOCK:
        return pkg().lookup(ref)


def canonical_fact(ref):
    """Whitelist the facts file before using the package's lookup interface."""
    global _FACT_IDS
    with _LOCK:
        if _FACT_IDS is None:
            try:
                raw = json.loads((Path(os.environ.get("ARENA_DATA", "data/package")) / "facts.json").read_text())
            except (OSError, ValueError):
                raw = {}
            records = raw.get("facts", raw) if isinstance(raw, dict) else raw
            if isinstance(records, dict):
                _FACT_IDS = {r for r in records if isinstance(r, str) and ":" in r}
            elif isinstance(records, list):
                _FACT_IDS = {r.get("id", r.get("ref")) for r in records if isinstance(r, dict)
                             and isinstance(r.get("id", r.get("ref")), str)}
            else:
                _FACT_IDS = set()  # Unknown formats must fail closed, never fall back to SQL existence.
        if ref not in _FACT_IDS:
            return None
        fact = lookup(ref)
        return dict(fact) if isinstance(fact, dict) else None


_RECORDS_V2 = {}  # Package paths, not SQL connections, identify canonical evidence.


def canonical_record_v2(ref, package_path=None):
    """Read the actual facts records; lookup may substitute conflicting SQL values."""
    if not isinstance(ref, str) or not ref or ":" not in ref:
        return None
    path = Path(package_path or os.environ.get("ARENA_DATA", "data/package")).resolve()
    key = str(path)
    with _LOCK:
        if key not in _RECORDS_V2:
            try:
                raw = json.loads((path / "facts.json").read_text())
            except (OSError, ValueError):
                raw = None
            if isinstance(raw, dict):
                for wrapper in ("facts", "records"):
                    if wrapper in raw:
                        raw = raw[wrapper]
                        break
            records, invalid = {}, set()
            if isinstance(raw, dict) and all(isinstance(k, str) and ":" in k for k in raw):
                entries = list(raw.items())
            elif isinstance(raw, list):
                entries = [(r.get("id") or r.get("ref") or r.get("fact_id"), r)
                           for r in raw if isinstance(r, dict)]
            else:
                entries = []  # Unknown containers cannot authorize evidence.
            for rid, record in entries:
                if not isinstance(rid, str) or ":" not in rid or not isinstance(record, dict):
                    continue
                record = dict(record)
                identity = [record[k] for k in ("id", "ref", "fact_id") if record.get(k) is not None]
                if any(value != rid for value in identity):
                    invalid.add(rid)
                    continue
                # Packages expose flat records and records with a named field payload.
                payloads = [k for k in ("data", "fields", "attributes", "record", "values", "fact", "value")
                            if isinstance(record.get(k), dict)]
                if len(payloads) > 1:
                    invalid.add(rid)
                    continue
                if payloads:
                    payload = record.pop(payloads[0])
                    if any(k in record and record[k] is not None and record[k] != value
                           for k, value in payload.items()):
                        invalid.add(rid)
                        continue
                    record.update(payload)
                if rid in records and records[rid] != record:
                    invalid.add(rid)
                else:
                    records[rid] = record
            _RECORDS_V2[key] = {rid: record for rid, record in records.items() if rid not in invalid}
        record = _RECORDS_V2[key].get(ref)
        return dict(record) if record is not None else None


def _v2_number(value):
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _v2_field(record, *keys):
    return next((record[k] for k in keys if record.get(k) is not None), None)


def order_unit_price(row):
    """Normalize only explicit piece-based price units; kg and lot prices are not comparable."""
    unit = str(row.get("price_unit") or "").upper().replace(" ", "")
    match = re.fullmatch(r"(?:EUR/)?(?:(\d+(?:\.\d+)?))?(?:PC|PCS|EA|PIECE|PIECES|UNIT|UNITS)", unit)
    if not match or not isinstance(row.get("price"), int | float):
        return None
    divisor = float(match.group(1) or 1)
    return row["price"] / divisor if divisor > 0 else None


def index_change(series, months=12):
    """(change %, earlier id, later id) over the latest `months` of a series."""
    rows = q("SELECT id, month, value FROM index_values WHERE series_id = ? ORDER BY month DESC LIMIT ?", (series, months + 1))
    if len(rows) < months + 1:
        return None
    b, a = rows[0], rows[-1]
    return (b["value"] / a["value"] - 1) * 100, a["id"], b["id"], a["month"], b["month"]


def series_name(series):
    r = q("SELECT name FROM index_series WHERE id = ?", (series,))
    return r[0]["name"] if r else series


def drift(part):
    """The cost change the category team's drivers justify: sum(weight x 12-month index change)."""
    total = 0.0
    for d in q("SELECT series_id, weight FROM cost_drivers WHERE part_id = ?", (part,)):
        if ch := index_change(d["series_id"]):
            total += d["weight"] * ch[0] / 100
    return total


def cash_rate(sid):
    """What money now is worth to a supplier: weaker credit (higher index) = dearer cash."""
    r = q("SELECT credit_index, equity_ratio_pct FROM supplier_intel WHERE supplier_id = ?", (sid,))
    if not r or r[0]["credit_index"] is None:
        return 0.10
    ci = r[0]["credit_index"]
    # good credit -> cash is cheap for it (below our 8 %), so long payment terms cost it little (P08/P18: 90 days)
    return 0.05 if ci < 200 else 0.10 if ci < 250 else 0.14 if ci < 300 else 0.20


class PracticeNegotiator(Negotiator):
    def claim_source(self, ref):
        return canonical_fact(ref)

    def _supplier_intel(self, sid):
        """persona_writer: owner type / group parent / staff from the data package (None for unknown suppliers)."""
        try:
            rows = q("SELECT owner_type, group_parent, staff FROM supplier_intel WHERE supplier_id = ?", (sid,))
        except Exception:
            return None
        return dict(rows[0]) if rows else None

    def _safe_facts_for(self, t):
        case, b = self.case, self.b
        part, refs = case["parts"][0], case.get("refs", [])
        asked = t.sheets[0]["terms"].get("unit_price") if t.sheets else None
        facts = []

        def source(ref, row=None):
            fact = self.claim_source(ref)
            if fact is None:
                return None
            if row is not None:
                keys = ("unit_cost", "unit_price", "change_pct", "otd_pct", "ppm", "value", "month", "days",
                        "price_unit", "currency", "part_id", "supplier_id", "headline")
                if any(k in fact and k in row and fact[k] != row[k] for k in keys):
                    return None
            if fact.get("part", fact.get("part_id", part)) != part:
                return None
            return fact

        for d in (r for r in refs if r.startswith("doc:")):
            df = source(d) or {}
            for c in (r for r in refs if r.startswith("ctr:")):
                cf = source(c) or {}
                if df.get("days") and cf.get("days") and df["days"] < cf["days"] and cf.get("supplier", cf.get("supplier_id")) in (None, t.sid):
                    facts.append(([d, c], f"Your letter {d} provides {df['days']} days' notice; the recorded contract {c} requires {cf['days']} days"))
        sc = q("SELECT id, unit_cost, supplier_id FROM should_cost WHERE part_id = ? ORDER BY supplier_id = ? DESC", (part, t.sid))
        if sc:
            row, cf = sc[0], source(sc[0]["id"], sc[0])
            if cf and cf.get("unit_cost") is not None and cf.get("currency", "EUR") == "EUR" and (asked is None or cf["unit_cost"] < asked):
                unit = cf.get("price_unit", cf.get("unit"))
                if unit is None or order_unit_price({"price": cf["unit_cost"], "price_unit": unit}) == cf["unit_cost"]:
                    facts.append((row["id"], f"Our recorded bottom-up should-cost estimate is EUR {cf['unit_cost']:.2f} per unit ({row['id']})"))
        ask_pct = ((asked / b["current_unit_price"] - 1) * 100) if asked and b.get("current_unit_price") else 0.0

        def index_fact(series, months):
            ch = index_change(series, months)
            if not ch:
                return None
            _, a, z, ma, mz = ch
            rows = q("SELECT * FROM index_values WHERE id IN (?, ?)", (a, z))
            sql = {row["id"]: row for row in rows}
            af, zf = source(a, sql.get(a)), source(z, sql.get(z))
            if a not in sql or z not in sql or not af or not zf or af.get("month") != ma or zf.get("month") != mz:
                return None
            if af.get("value") != sql[a].get("value") or zf.get("value") != sql[z].get("value") or not af.get("value"):
                return None
            for fact in (af, zf):
                if fact.get("series", fact.get("series_id", series)) != series:
                    return None
            au, zu = af.get("unit", series), zf.get("unit", series)
            if au != zu or any(sql[r].get("series_id", series) != series for r in (a, z)):
                return None
            if any(sql[r].get("unit", u) != u for r, u in ((a, au), (z, zu))):
                return None
            try:
                ay, am = map(int, ma.split("-"))
                zy, zm = map(int, mz.split("-"))
            except (ValueError, AttributeError):
                return None
            if not 1 <= am <= 12 or not 1 <= zm <= 12 or (zy - ay) * 12 + zm - am != months:
                return None
            change = (zf["value"] / af["value"] - 1) * 100
            return change, a, z, ma, mz

        drivers = q("SELECT series_id, weight FROM cost_drivers WHERE part_id = ?", (part,))
        if not self._index_rejected(t):
            moves = []
            for d in drivers:
                ch = index_fact(d["series_id"], 12)
                if ch and ch[0] < 0:
                    moves.append((d["weight"] * (ch[0] - ask_pct), d["series_id"], ch))
            for _, _, (change, a, z, ma, mz) in sorted(moves)[:2]:
                facts.append(([a, z], f"The recorded cost-driver index changed {change:+.1f}% from {ma} to {mz} ({a}, {z})"))
            if self.cfg.evidence_plus:
                for d in sorted(drivers, key=lambda row: -row["weight"]):
                    windows = [ch for months in (3, 6, 12) if (ch := index_fact(d["series_id"], months)) and ch[0] < 0]
                    best = min(windows, key=lambda ch: ch[0]) if windows else None
                    if best and not any(best[1] in (f[0] if isinstance(f[0], list) else [f[0]]) for f in facts):
                        change, a, z, ma, mz = best
                        facts.append(([a, z], f"The recorded cost-driver index changed {change:+.1f}% from {ma} to {mz} ({a}, {z})"))
        if self.cfg.evidence_plus and asked:
            other = q("SELECT id, price, price_unit FROM po_lines WHERE part_id = ? AND supplier_id != ? ORDER BY order_date DESC LIMIT 2", (part, t.sid))
            if len(other) == 2 and (price := order_unit_price(other[0])) is not None and order_unit_price(other[1]) is not None and price < asked:
                facts.insert(0, ([], f"Our latest recorded order of the same part from another supplier is EUR {price:.2f} per unit"))
        pos = q("SELECT * FROM po_lines WHERE part_id = ? AND supplier_id = ? ORDER BY id DESC LIMIT 3", (part, t.sid))
        ids = []
        for row in pos:
            cf = source(row["id"], row)
            if cf is None:
                continue
            if "unit_price" in cf and "price" in row and order_unit_price(row) != cf["unit_price"]:
                continue
            ids.append(row["id"])
        if len(ids) >= 2:
            facts.append((ids, f"Our recorded order history includes {', '.join(ids)}"))
        for r in refs:
            if r.startswith("sc:") and r.split("@")[0] == "sc:" + t.sid.split(":")[1]:
                cf = source(r) or {}
                if b.get("category_goal") == "quality_first" and cf.get("ppm") is not None:
                    facts.append((r, f"Your recorded scorecard {r} shows {cf['ppm']} ppm"))
                elif cf.get("otd_pct") is not None and cf["otd_pct"] < 92:
                    facts.append((r, f"Your recorded scorecard {r} shows {cf['otd_pct']}% on-time delivery"))
            if r.startswith("fc:"):
                rows = q("SELECT * FROM forecasts WHERE id = ?", (r,))
                cf = source(r, rows[0] if rows else None) or {}
                if cf.get("change_pct", 0) > 0:
                    facts.append((r, f"Our recorded forecast {r} shows demand changing {cf['change_pct']:+.1f}%"))
        if self.cfg.news:
            for row in q("SELECT id, headline FROM news WHERE supplier_id = ? ORDER BY date DESC LIMIT 1", (t.sid,)):
                if source(row["id"], row) is not None:
                    facts.append((row["id"], f"The recorded news about your company ({row['id']}) is part of our review"))
        if self.cfg.evidence_plus:
            history = q("SELECT asked_pct, settled_pct FROM negotiation_history WHERE supplier_id = ? AND part_id = ? ORDER BY date DESC LIMIT 3", (t.sid, part))
            gaps = [row["asked_pct"] - row["settled_pct"] for row in history if row["asked_pct"] is not None and row["settled_pct"] is not None]
            if len(gaps) >= 2 and all(gap > 0 for gap in gaps):
                facts.append(([], f"In your recorded historical renewals of this part, {len(gaps)} settlements averaged {sum(gaps) / len(gaps):.1f} percentage points below the initial ask"))
        alt = b.get("alternative") or {}
        ref = alt.get("ref") or ""  # the key can be present with None
        cf = source(ref) if ref.startswith("quote:") else None
        if cf and cf.get("unit_price") and asked and cf["unit_price"] < asked:
            terms_price = alt.get("terms", {}).get("unit_price")
            unit = cf.get("price_unit", cf.get("unit"))
            if (terms_price is None or terms_price == cf["unit_price"]) and cf.get("currency", "EUR") == "EUR" and (unit is None or order_unit_price({"price": cf["unit_price"], "price_unit": unit}) == cf["unit_price"]):
                facts.append((ref, f"Our recorded reference quote is EUR {cf['unit_price']:.2f} per unit ({ref}); this is reference evidence, not a current-session standing offer"))
        known = {r for f in facts for r in (f[0] if isinstance(f[0], list) else [f[0]])}
        for ref in refs:
            if ref not in known and self.claim_source(ref) is None:
                facts.append((ref, f"The enquiry explicitly lists {ref} as a reference for our review"))
        return facts

    def _provenance_v2_source(self, ref, part=None, supplier=None, row=None):
        fact = canonical_record_v2(ref)
        if fact is None:
            return None

        def normalized(value, prefix):
            return str(value).removeprefix(prefix + ":")

        for aliases, expected, prefix in ((("part", "part_id"), part, "part"),
                                          (("supplier", "supplier_id"), supplier, "sup")):
            values = [fact[k] for k in aliases if fact.get(k) is not None]
            if values and any(normalized(value, prefix) != normalized(values[0], prefix) for value in values):
                return None
            value = values[0] if values else None
            if expected is not None:
                if value is not None and normalized(value, prefix) != normalized(expected, prefix):
                    return None
                if value is None:
                    short = normalized(expected, prefix)
                    encoded = (prefix == "part" and ref.split(":", 1)[0] in ("cost", "fc")
                               and re.search(r"(?:^|[:@/])" + re.escape(short) + r"(?:$|[:@/])", ref))
                    encoded = encoded or (prefix == "sup" and ref.startswith("sc:" + short + "@"))
                    scope = self.case.get("parts", []) if prefix == "part" else self.case.get("suppliers", [])
                    if not scope and prefix == "sup":
                        scope = list(getattr(self, "threads", {}))
                    case_scoped = (ref in (self.case.get("refs") or []) and len(scope) == 1
                                   and normalized(scope[0], prefix) == short)
                    if not encoded and not case_scoped:
                        return None
            if row is not None:
                sql_value = _v2_field(row, *aliases)
                if value is not None and sql_value is not None and normalized(value, prefix) != normalized(sql_value, prefix):
                    return None
        recorded_part = _v2_field(fact, "part", "part_id")
        if recorded_part is not None and not any(
                normalized(recorded_part, "part") == normalized(p, "part") for p in self.case.get("parts", [])):
            return None
        if row is not None:
            for key in ("unit_cost", "unit_price", "price", "change_pct", "otd_pct", "ppm", "value", "month",
                        "days", "price_unit", "currency", "series_id", "headline", "qty", "snapshot_month"):
                if fact.get(key) is not None and row.get(key) is not None and fact[key] != row[key]:
                    return None
            series, sql_series = _v2_field(fact, "series", "series_id"), _v2_field(row, "series", "series_id")
            if series is not None and sql_series is not None and series != sql_series:
                return None
            if fact.get("unit_price") is not None and row.get("price") is not None:
                price = order_unit_price(row)
                canonical_price = self._provenance_v2_price(fact, "unit_price")
                if price is None or canonical_price is None or not math.isclose(price, canonical_price, rel_tol=1e-9, abs_tol=1e-9):
                    return None
        return fact

    def _provenance_v2_price(self, record, field):
        value = record.get(field)
        if not _v2_number(value) or value <= 0:
            return None
        currency = _v2_field(record, "currency", "currency_code")
        if currency is not None and str(currency).upper() not in ("EUR", "€"):
            return None
        unit = _v2_field(record, "price_unit", "unit", "uom")
        if unit is None:
            # These canonical fields are per-piece EUR; raw purchase prices need an explicit divisor.
            return value if field in ("unit_cost", "unit_price") else None
        price = order_unit_price({"price": value, "price_unit": unit})
        return price if price is not None and _v2_number(price) else None

    def _provenance_v2_facts(self, t):
        if hasattr(t, "_provenance_v2_facts_cache"):
            return list(t._provenance_v2_facts_cache)
        case, b = self.case, self.b
        part = case["parts"][0]
        refs = [r for r in case.get("refs") or [] if isinstance(r, str) and r]
        asked = t.sheets[0]["terms"].get("unit_price") if t.sheets else None
        facts = []
        # Keep A10's order: provenance is not an objection-based evidence policy.
        for d in (r for r in refs if r.startswith("doc:")):
            df = self._provenance_v2_source(d, supplier=t.sid)
            for c in (r for r in refs if r.startswith("ctr:")):
                cf = self._provenance_v2_source(c, supplier=t.sid)
                if (df and cf and _v2_number(df.get("days")) and _v2_number(cf.get("days"))
                        and 0 < df["days"] < cf["days"]):
                    facts.append(([d, c], f"Your letter {d} gives {df['days']} days' notice, while our contract {c} "
                                          f"requires {cf['days']} days, so a new price cannot start before then"))
        sc = q("SELECT * FROM should_cost WHERE part_id = ? ORDER BY supplier_id = ? DESC", (part, t.sid))
        if sc:
            row = sc[0]
            cf = self._provenance_v2_source(row["id"], part=part, row=row)
            price = self._provenance_v2_price(cf, "unit_cost") if cf else None
            if price is not None and (asked is None or price < asked):
                facts.append((row["id"], f"Our bottom-up should-cost estimate for this part is €{price:.2f} ({row['id']})"))
        ask_pct = ((asked / b["current_unit_price"] - 1) * 100) if asked and b.get("current_unit_price") else 0.0

        def index_fact(series, months):
            ch = index_change(series, months)
            if not ch:
                return None
            _, a, z, ma, mz = ch
            rows = q("SELECT * FROM index_values WHERE id IN (?, ?)", (a, z))
            sql = {row["id"]: row for row in rows}
            if a not in sql or z not in sql:
                return None
            af = self._provenance_v2_source(a, row=sql[a])
            zf = self._provenance_v2_source(z, row=sql[z])
            if not af or not zf:
                return None
            for rid, fact, month in ((a, af, ma), (z, zf, mz)):
                recorded_month = fact.get("month")
                if recorded_month is None and rid == f"idx:{series}@{month}":
                    recorded_month = month
                recorded_series = _v2_field(fact, "series", "series_id")
                if recorded_series is None and rid == f"idx:{series}@{month}":
                    recorded_series = series
                if (recorded_month != month or recorded_series != series or sql[rid].get("series_id") != series
                        or not isinstance(month, str) or not re.fullmatch(r"\d{4}-\d{2}", month)
                        or not _v2_number(fact.get("value")) or fact["value"] <= 0
                        or fact["value"] != sql[rid].get("value")):
                    return None
            if _v2_field(af, "unit", "currency") != _v2_field(zf, "unit", "currency"):
                return None
            ay, am = map(int, ma.split("-"))
            zy, zm = map(int, mz.split("-"))
            if not 1 <= am <= 12 or not 1 <= zm <= 12 or (zy - ay) * 12 + zm - am != months:
                return None
            change = (zf["value"] / af["value"] - 1) * 100
            return (change, a, z, ma, mz) if _v2_number(change) else None

        drivers = q("SELECT series_id, weight FROM cost_drivers WHERE part_id = ?", (part,))
        moves = []
        for d in drivers:
            ch = index_fact(d["series_id"], 12)
            if ch and ch[0] < 0 and _v2_number(d.get("weight")):
                moves.append((d["weight"] * (ch[0] - ask_pct), d["series_id"], ch))
        for _, series, (change, a, z, ma, mz) in sorted(moves)[:2]:
            facts.append(([a, z], f"{series_name(series)} changed {change:+.1f}% from {ma} to {mz} ({a}, {z})"))
        if self.cfg.evidence_plus:
            for d in sorted(drivers, key=lambda row: -(row.get("weight") or 0)):
                windows = [ch for months in (3, 6, 12) if (ch := index_fact(d["series_id"], months)) and ch[0] < 0]
                best = min(windows, key=lambda ch: ch[0]) if windows else None
                if best and not any(best[1] in (f[0] if isinstance(f[0], list) else [f[0]]) for f in facts):
                    change, a, z, ma, mz = best
                    facts.append(([a, z], f"{series_name(d['series_id'])} fell {change:.1f}% from {ma} to {mz} ({a}, {z})"))
            if asked:
                other = q("SELECT * FROM po_lines WHERE part_id = ? AND supplier_id != ? ORDER BY order_date DESC LIMIT 2", (part, t.sid))
                prices = [order_unit_price(row) for row in other]
                if (len(other) == 2 and all(price is not None and _v2_number(price) for price in prices)
                        and all(row.get("currency") in (None, "EUR") for row in other) and prices[0] < asked):
                    # Useful SQL context stays uncited; it is not promoted to checked evidence.
                    facts.insert(0, ([], f"Our latest recorded order of the same part from another supplier is EUR {prices[0]:.2f} per unit"))
        pos = q("SELECT * FROM po_lines WHERE part_id = ? AND supplier_id = ? ORDER BY id DESC LIMIT 3", (part, t.sid))
        ids, prices_supported = [], True
        for row in pos:
            cf = self._provenance_v2_source(row["id"], part=part, supplier=t.sid, row=row)
            if cf is None:
                continue
            ids.append(row["id"])
            field = "unit_price" if cf.get("unit_price") is not None else "price"
            prices_supported = prices_supported and self._provenance_v2_price(cf, field) is not None
        if len(ids) >= 2:
            sentence = (f"Our recent orders {', '.join(ids)} show the price level we have been paying" if prices_supported
                        else f"Our recorded order history includes {', '.join(ids)}")
            facts.append((ids, sentence))
        for r in refs:
            if r.startswith("sc:") and r.split("@")[0] == "sc:" + t.sid.split(":", 1)[-1]:
                cf = self._provenance_v2_source(r, supplier=t.sid)
                if cf and b.get("category_goal") == "quality_first" and _v2_number(cf.get("ppm")) and cf["ppm"] >= 0:
                    facts.append((r, f"Your scorecard {r} shows {cf['ppm']} ppm"))
                elif cf and _v2_number(cf.get("otd_pct")) and 0 <= cf["otd_pct"] < 92:
                    facts.append((r, f"Your scorecard {r} shows {cf['otd_pct']}% on-time delivery"))
            if r.startswith("fc:"):
                rows = q("SELECT * FROM forecasts WHERE id = ?", (r,))
                cf = self._provenance_v2_source(r, part=part, row=rows[0] if rows else None)
                if cf and _v2_number(cf.get("change_pct")) and cf["change_pct"] > 0:
                    facts.append((r, f"Our forecast {r} shows demand {cf['change_pct']:+.1f}%"))
        if self.cfg.news:
            for row in q("SELECT * FROM news WHERE supplier_id = ? ORDER BY date DESC LIMIT 1", (t.sid,)):
                if self._provenance_v2_source(row["id"], supplier=t.sid, row=row) is not None:
                    facts.append((row["id"], f"We have read the recent news about your company ({row['id']})"))
        if self.cfg.evidence_plus:
            history = q("SELECT asked_pct, settled_pct FROM negotiation_history WHERE supplier_id = ? AND part_id = ? ORDER BY date DESC LIMIT 3", (t.sid, part))
            gaps = [row["asked_pct"] - row["settled_pct"] for row in history
                    if _v2_number(row.get("asked_pct")) and _v2_number(row.get("settled_pct"))]
            if len(gaps) >= 2 and all(gap > 0 for gap in gaps):
                facts.append(([], f"In the recorded historical renewals of this part, {len(gaps)} settlements averaged "
                                  f"{sum(gaps) / len(gaps):.1f} percentage points below your initial ask"))
        alt = b.get("alternative") or {}
        ref = alt.get("ref") or ""
        if isinstance(ref, str) and ref.startswith("quote:"):
            cf = self._provenance_v2_source(ref, part=part)
            price = self._provenance_v2_price(cf, "unit_price") if cf else None
            terms_price = (alt.get("terms") or {}).get("unit_price")
            if price is not None and asked and price < asked and terms_price == price:
                facts.append((ref, f"We hold another quote at €{price:.2f} ({ref}); this is a reference quote, "
                                   "not a current-session standing primary"))
        known = {r for f in facts for r in (f[0] if isinstance(f[0], list) else [f[0]])}
        for ref in refs:
            if ref not in known and canonical_record_v2(ref) is None:
                # A listed case reference proves its inclusion, not an absent cost or forecast figure.
                facts.append((ref, f"The enquiry explicitly lists {ref} as a reference for our review"))
        t._provenance_v2_facts_cache = tuple(facts)
        return list(facts)

    def _provenance_v2_forecast(self, t, sheets, msg, slots):
        if slots <= 0 or not sheets or getattr(t, "fc_cited", False):
            return None
        part = self.case["parts"][0]
        rows = q("SELECT * FROM forecasts WHERE part_id = ? ORDER BY snapshot_month DESC LIMIT 1", (part,))
        if not rows:
            return None
        row, ref = rows[0], rows[0].get("id")
        if not isinstance(ref, str) or ref in self._message_ids(msg):
            return None
        used = getattr(t, "_provenance_v2_forecast_ids", ())
        if ref in used or any(m.get("from") == "buyer" and ref in (m.get("refs") or [])
                             and "backs this binding volume" in (m.get("body") or "") for m in t.events):
            return None
        cf = self._provenance_v2_source(ref, part=part, row=row)
        if cf is None:
            return None
        volume = _v2_field(cf, "volume_per_year", "need_per_year", "qty_per_year", "annual_qty", "annual_volume")
        months = _v2_field(cf, "contract_months", "horizon_months", "months")
        if months is None:
            years = _v2_field(cf, "horizon_years", "years")
            months = 12 * years if _v2_number(years) else None
        if not _v2_number(volume) or not _v2_number(months) or volume <= 0 or months <= 0:
            return None
        packages = [closing_terms(self.case, sheet, t.std) for sheet in sheets]
        stated_months = ((self.case.get("fixed_terms") or {}).get("contract_months")
                         or (12 * self.b["horizon_years"] if self.cfg.volume_framing else 24))
        if (volume < self.b["need_per_year"] or months < stated_months
                or any(package["volume_per_year"] != self.b["need_per_year"]
                       or package["contract_months"] != stated_months for package in packages)):
            return None
        return ref, f"Our current forecast ({ref}) backs this binding volume."

    def _provenance_v2_rival(self, t, rival):
        if not rival or len(rival) != 2:
            return None, None
        ref, terms = rival
        if not isinstance(ref, str) or not ref or not isinstance(terms, Mapping):
            return None, None
        for other in self.threads.values():
            if other.sid == t.sid:
                continue
            current = next((i for i, sheet in enumerate(other.sheets)
                            if sheet.get("term_sheet_id") == ref and sheet.get("terms") == terms), None)
            if current is not None:
                primary_id = other.sheets[0].get("term_sheet_id")
                authoritative = getattr(other, "_close_offer_id", getattr(other, "offer_id", primary_id))
                if self.cfg.arena_clock_guard:
                    authoritative = getattr(other, "standing_offer_id", authoritative)
                live = (other.status not in ("walked_away", "no_bid") and not getattr(other, "closed", False)
                        and not other.in_flight and not getattr(other, "state_uncertain", False))
                if current == 0 and live and authoritative == ref:
                    return (ref, terms), "standing"
                label = "quoted alternative" if current else "quoted primary requiring refreshed confirmation"
                return (ref, terms), label
            for event in other.events:
                if event.get("from") == "buyer":
                    continue
                if any(sheet.get("term_sheet_id") == ref and sheet.get("terms") == terms
                       for sheet in event.get("term_sheets") or []):
                    return (ref, terms), "earlier quote"
        return None, None

    def _provenance_v2_proof(self, t, msg, groups, slots):
        if getattr(t, "proof_sent", False):
            return
        current = list(dict.fromkeys(tuple(group) for group in groups if group))
        previous = getattr(t, "_provenance_v2_history", ())
        candidates = [(group, False) for group in current]
        candidates += [(group, True) for group in previous if group not in current]
        rows, seen = [], set()
        labels = {"po": "Our order", "cost": "Should-cost estimate", "fc": "Our forecast", "sc": "Your scorecard",
                  "idx": "Index value", "doc": "Your letter", "ctr": "Our contract", "quote": "Reference quote"}
        for group, additional in candidates:
            if additional and slots <= 0 or seen.intersection(group):
                continue
            records = [(ref, self._provenance_v2_source(ref)) for ref in group]
            if any(record is None for _, record in records):
                continue  # Never split an index, notice or history assertion.
            group_rows = []
            for ref, record in records:
                kind, values = ref.split(":", 1)[0], []
                if kind in ("po", "cost", "quote"):
                    field = "unit_cost" if kind == "cost" else "unit_price" if record.get("unit_price") is not None else "price"
                    price = self._provenance_v2_price(record, field)
                    if price is not None:
                        values.append(f"EUR per piece: {price:.2f}")
                keys = {"fc": ("change_pct", "volume_per_year", "need_per_year", "qty_per_year", "annual_qty",
                               "annual_volume", "contract_months", "horizon_months", "horizon_years", "months", "years"),
                        "sc": ("otd_pct", "ppm"), "idx": ("value",), "doc": ("days",), "ctr": ("days",)}.get(kind, ())
                values += [f"{key}: {record[key]}" for key in keys if _v2_number(record.get(key))]
                month = record.get("month")
                if kind == "idx" and isinstance(month, str) and re.fullmatch(r"\d{4}-\d{2}", month):
                    values.append(f"month: {month}")
                if values:
                    group_rows.append(f"| {labels.get(kind, 'Recorded data')} | {'; '.join(values)} |")
            if not group_rows:
                continue
            rows.extend(group_rows)
            seen.update(group)
            if additional:
                slots -= 1
        if rows:
            # Plain labels avoid reintroducing old IDs; additional groups still consume a slot.
            text = "# Data behind our figures\n\n| Source | Values |\n|---|---|\n" + "\n".join(rows) + "\n"
            msg.setdefault("attachments", []).append({"name": "our-data.md", "type": "md",
                                                       "content_b64": base64.b64encode(text.encode()).decode()})
            msg["body"] = msg["body"].replace("\nBest regards", "\nYou asked for the data behind our figures: it is attached.\n\nBest regards", 1)
            t.proof_sent = True

    def _lead_cost_first(self, t, facts, should_cost):
        """Promote existing cost evidence only for the actual stagger opening leader."""
        cfg = getattr(self, "cfg", None)
        if (not getattr(cfg, "leader_cost_first", False) or not cfg.rfq_stagger
                or len(getattr(self, "threads", {})) < 2
                or getattr(t, "staggered", None) is not False):
            return facts
        try:
            if t.sent():
                return facts
            for other in self.threads.values():
                if other.sid == t.sid:
                    continue
                buyer_seen = False
                for event in tuple(other.events):
                    if event.get("from") == "buyer":
                        buyer_seen = True
                    elif (buyer_seen and event.get("from") not in (None, "arena")
                          and event.get("term_sheets")):
                        return facts  # A negotiated rival quote removes the leader's evidence gap.
            parts = self.case.get("parts") or []
            part = str(parts[0]).removeprefix("part:") if parts else ""
            candidates = []
            for i, (ref, sentence) in enumerate(facts):
                if not isinstance(ref, str):
                    continue
                # These rows were already queried for this builder's part; no extra I/O is needed.
                for row in should_cost:
                    value = row.get("unit_cost")
                    if row.get("id") != ref or not _v2_number(value) or value <= 0:
                        continue
                    expected = (f"Our bottom-up should-cost estimate for this part is €{value:.2f} "
                                f"({ref})")
                    if sentence == expected:
                        own = row.get("supplier_id") == t.sid
                        candidates.append((0 if own else 1, i))
                same_part = bool(part and re.search(
                    r"(?:^|[:@/])" + re.escape(part) + r"(?:$|[:@/])", ref))
                case_scoped = len(parts) == 1 and not ref.startswith("cost:part:")
                if (ref.startswith("cost:") and ref in (self.case.get("refs") or [])
                        and (same_part or case_scoped)
                        and sentence == f"Our should-cost estimate ({ref}) is below the current offer"):
                    candidates.append((2, i))
            if not candidates:
                return facts
            rank, index = min(candidates)
            if index == 0:
                return facts
            self.note("leader_cost_first", supplier=t.sid, ref=facts[index][0],
                      support=("supplier_numeric", "part_numeric", "case_reference")[rank])
            # Allocate a new list; preserve every remaining fact and its relative order.
            return [facts[index], *facts[:index], *facts[index + 1:]]
        except Exception as e:
            self.note("leader_cost_first_failed", supplier=t.sid,
                      error=f"{type(e).__name__}: {str(e)[:200]}")
            return facts

    def facts_for(self, t):
        if getattr(getattr(self, "cfg", None), "claim_provenance_only", False):
            return self._provenance_v2_facts(t)
        if getattr(self, "cfg", Config()).safe_claims:
            return self._safe_facts_for(t)
        if hasattr(t, "facts"):
            return t.facts
        case, b = self.case, self.b
        part = case["parts"][0]
        asked = t.sheets[0]["terms"].get("unit_price") if t.sheets else None
        refs = case.get("refs", [])
        facts = []
        # E72 anchor_guard: never cite a price above our target price - the supplier settles just under the highest price
        # we disclose (P18: "another supplier at EUR 5.45" -> deal 5.40; our orders at 5.84 -> "well above your requests")
        guard = getattr(self.cfg, "anchor_guard", False)
        t.fact_prices = {}  # sentence -> (per-piece price, "own" | "other"); engine.write checks them when citing

        def per_piece(row):
            return row["price"] / (row.get("price_unit") or 1)
        # 1. notice: the letter gives less notice than the contract requires
        docs = [r for r in refs if r.startswith("doc:")]
        ctrs = [r for r in refs if r.startswith("ctr:")]
        for d in docs:
            df = lookup(d) or {}
            for c in ctrs:
                cf = lookup(c) or {}
                if df.get("days") and cf.get("days") and df["days"] < cf["days"] and cf.get("supplier") in (None, t.sid):
                    facts.append(([d, c], f"Your letter {d} gives {df['days']} days' notice, while our contract {c} "
                                          f"requires {cf['days']} days, so a new price cannot start before then"))
        # 2. should-cost of this part (at this supplier if there is one)
        sc = q("SELECT id, unit_cost, supplier_id FROM should_cost WHERE part_id = ? ORDER BY supplier_id = ? DESC", (part, t.sid))
        if sc and (asked is None or sc[0]["unit_cost"] < asked):
            facts.append((sc[0]["id"], f"Our bottom-up should-cost estimate for this part is €{sc[0]['unit_cost']:.2f} "
                                         f"({sc[0]['id']})"))
        # 3. cost drivers whose index moved less than the price (or fell): the strongest first
        ask_pct = ((asked / b["current_unit_price"] - 1) * 100) if asked and b.get("current_unit_price") else 0.0
        moves = []
        for d in q("SELECT series_id, weight FROM cost_drivers WHERE part_id = ?", (part,)):
            ch = index_change(d["series_id"])
            if ch and ch[0] < 0:  # practice run A: a driver that rose (even less than the ask) "confirms our case"
                moves.append((d["weight"] * (ch[0] - ask_pct), d["series_id"], ch))
        for _, series, (chg, a, z, ma, mz) in sorted(moves)[:2]:
            facts.append(([a, z], f"{series_name(series)} changed {chg:+.1f}% from {ma} to {mz} ({a}, {z})"))
        if self.cfg.evidence_plus:
            # 3b. a cost driver that FELL over a recent window although it may have risen over 12 months (P18: AS-14404
            #     -5.5 % since June) - the most negative of the 3/6/12-month windows ending at the latest month
            for d in q("SELECT series_id, weight FROM cost_drivers WHERE part_id = ? ORDER BY weight DESC", (part,)):
                best = None
                for mths in (3, 6, 12):
                    ch = index_change(d["series_id"], mths)
                    if ch and ch[0] < 0 and (best is None or ch[0] < best[0]):
                        best = ch
                if best and not any(best[1] in (f[0] if isinstance(f[0], list) else [f[0]]) for f in facts):
                    chg, a, z, ma, mz = best
                    facts.append(([a, z], f"{series_name(d['series_id'])} fell {chg:.1f}% from {ma} to {mz} ({a}, {z})"))
            # 4b. we buy the same part cheaper from another supplier (P18: po:4500014455-10 at EUR 5.45 vs its 5.84)
            if asked:
                other = q("SELECT id, price, price_unit FROM po_lines WHERE part_id = ? AND supplier_id != ? "
                          "ORDER BY order_date DESC LIMIT 2", (part, t.sid))
                unit = (q("SELECT price_unit FROM po_lines WHERE part_id = ? AND supplier_id = ? LIMIT 1", (part, t.sid))
                        or [{"price_unit": None}])[0]["price_unit"]
                if len(other) == 2 and all(o["price_unit"] == unit for o in other) and other[0]["price"] < asked:
                    # a plain statement without IDs: the arena only checks a supplier's own orders, so the IDs came
                    # back "irrelevant" and cost a claim slot (practice A9: P04, P08, P18)
                    facts.insert(0, ([], f"We currently buy the same part from another supplier at EUR "
                                         f"{other[0]['price']:.2f} per unit"))
                    if guard:
                        t.fact_prices[facts[0][1]] = (per_piece(other[0]), "other")
        # 4. our order history with this supplier for this part (2-8 order lines)
        pos = q("SELECT id FROM po_lines WHERE part_id = ? AND supplier_id = ? ORDER BY id DESC LIMIT 3", (part, t.sid))
        if len(pos) >= 2:
            ids = [p["id"] for p in pos]
            sentence = f"Our recent orders {', '.join(ids)} show the price level we have been paying"
            if self.cfg.bind_evidence and ("volume_per_year" in (case.get("negotiable") or [])
                                           or (case.get("fixed_terms") or {}).get("volume_per_year") is not None):
                # I1: state the quantity these orders document, next to the volume our package commits
                # (only when the case lets or makes the package carry the volume, as for the forecast sentence)
                try:
                    rows = q(f"SELECT id, qty, order_date FROM po_lines WHERE id IN ({','.join('?' * len(ids))})", tuple(ids))
                    by_id = {r["id"]: r for r in rows}
                    qtys = [by_id[i]["qty"] for i in ids]
                    months = [str(by_id[i]["order_date"])[:7] for i in ids]
                    if (all(isinstance(x, int | float) and not isinstance(x, bool) and math.isfinite(x) for x in qtys)
                            and all(re.fullmatch(r"\d{4}-\d{2}", m) for m in months)):
                        sentence = (f"Our orders {', '.join(ids)} total {sum(qtys):,.0f} pieces between {min(months)} and "
                                    f"{max(months)}: steady demand that our package now turns into a binding volume, "
                                    "which lowers your risk and your cost per piece")
                except Exception:
                    pass  # missing data: keep the original sentence
            facts.append((ids, sentence))
            if guard:
                order_rows = q(f"SELECT price, price_unit FROM po_lines WHERE id IN ({','.join('?' * len(ids))})", tuple(ids))
                if order_rows:
                    t.fact_prices[sentence] = (max(per_piece(r) for r in order_rows), "own")
        # 5. its scorecard, if it is weak
        for r in refs:
            if r.startswith("sc:") and r.split("@")[0] == "sc:" + t.sid.split(":")[1]:
                f = lookup(r) or {}
                if b.get("category_goal") == "quality_first" and f.get("ppm") is not None:
                    facts.append((r, f"Your scorecard {r} shows {f['ppm']} ppm"))
                elif f.get("otd_pct") is not None and f["otd_pct"] < 92:
                    facts.append((r, f"Your scorecard {r} shows {f['otd_pct']}% on-time delivery"))
        # 6. a forecast that grows
        for r in refs:
            if r.startswith("fc:") and (f := lookup(r) or {}).get("change_pct", 0) > 0:
                sentence = f"Our forecast {r} shows demand {f['change_pct']:+.1f}%"
                if self.cfg.bind_evidence and ("volume_per_year" in (case.get("negotiable") or [])
                                               or (case.get("fixed_terms") or {}).get("volume_per_year") is not None) \
                        and isinstance(b.get("need_per_year"), int | float):
                    # I1: only state the commitment when the case lets/makes the package carry the volume
                    sentence += (f"; our package commits the full requirement of {b['need_per_year']:,} pieces per year, "
                                 "so that growth is secured volume for you")
                facts.append((r, sentence))
        # 6b. news about this supplier (checked: that it is about this supplier) - optional
        if self.cfg.news:
            for nrow in q("SELECT id, headline FROM news WHERE supplier_id = ? ORDER BY date DESC LIMIT 1", (t.sid,)):
                facts.append((nrow["id"], f"We have read the recent news about your company ({nrow['id']})"))
        if getattr(self.cfg, "evidence_plus", False):
            # 6c. its own history on this part: it settled below its ask before (not a data ID: plain statement)
            h = q("SELECT asked_pct, settled_pct FROM negotiation_history WHERE supplier_id = ? AND part_id = ? "
                  "ORDER BY date DESC LIMIT 3", (t.sid, part))
            gaps = [x["asked_pct"] - x["settled_pct"] for x in h if x["asked_pct"] is not None and x["settled_pct"] is not None]
            if len(gaps) >= 2 and all(g > 0 for g in gaps):
                facts.append(([], f"In your last {len(gaps)} renewals of this part we settled on average "
                                  f"{sum(gaps) / len(gaps):.1f} points below your initial ask"))
        # 7. our alternative, only if it is cheaper than what the supplier asks
        alt = b.get("alternative") or {}
        if alt.get("ref", "") and alt.get("ref", "").startswith("quote:"):
            af = lookup(alt["ref"]) or {}
            if af.get("unit_price") and asked and af["unit_price"] < asked:
                facts.append((alt["ref"], f"We hold another quote at €{af['unit_price']:.2f} ({alt['ref']})"))
        # 8. the case's own reference IDs that the data package does not know (case-only facts, e.g. sandbox or a
        #    new release): cite them by type without inventing a figure - the arena then checks the data's own value
        known = {r for f in facts for r in (f[0] if isinstance(f[0], list) else [f[0]])}
        sup_short = t.sid.split(":")[1]
        for r in refs:
            if r in known or lookup(r):
                continue
            kind = r.split(":")[0]
            if kind == "po":
                facts.append((r, f"Our recent orders ({r}) show the price level we have been paying"))
            elif kind == "cost":
                facts.append((r, f"Our should-cost estimate ({r}) is below the current offer"))
            elif kind == "fc":
                facts.append((r, f"Our forecast ({r}) backs the full volume over the contract term"))
            elif kind == "sc" and sup_short in r:
                facts.append((r, f"Your delivery and quality scorecard ({r}) is part of our review"))
        if getattr(getattr(self, "cfg", None), "leader_cost_first", False):
            facts = self._lead_cost_first(t, facts, sc)
        t.facts = facts
        return facts

    def _estimate(self):
        b, case = self.b, self.case
        if self.cfg.calibrated_anchor or self.cfg.anchor_probe:
            for t in self.threads.values():
                self._resolve_calibration(t)
        part = case["parts"][0]
        prices = [self._opening_terms(t).get("unit_price") if self.cfg.calibrated_anchor else
                  t.sheets[0]["terms"].get("unit_price") if t.sheets else None for t in self.threads.values()]
        lowest_open = min((p for p in prices if p is not None), default=None)
        for s, t in self.threads.items():
            std = {**t.std, **case.get("fixed_terms", {})}
            std.setdefault("payment_days", b["reference_payment_days"])
            std.setdefault("incoterm", max(b["freight_eur_per_unit"], key=b["freight_eur_per_unit"].get))
            est = {"standard": std, "interest_rate": cash_rate(s)}
            from proto.engine import BREAKDOWN
            txt = " ".join((m.get("body") or "") + " " + " ".join(a.get("text") or "" for a in m.get("attachments") or [])
                           for m in t.events if m.get("from") != "buyer")
            mats = [float(m.group(1)) for x in self.threads.values() for m in [BREAKDOWN.search(" ".join(
                a.get("text") or "" for e in x.events for a in e.get("attachments") or []))] if m]
            sc = q("SELECT unit_cost, supplier_id FROM should_cost WHERE part_id = ? ORDER BY supplier_id = ? DESC", (part, s))
            if bd := BREAKDOWN.search(txt):  # its own cost breakdown: material + labour + conversion
                direct = round(sum(float(x) for x in bd.groups()), 2)
                est.update(floor=direct, full_cost=direct, basis="own cost breakdown: material + labour + conversion")
            elif self.cfg.calibrated_anchor and sc and sc[0]["supplier_id"] == s:
                est.update(floor=sc[0]["unit_cost"], full_cost=sc[0]["unit_cost"],
                           basis=f"should-cost {sc[0]['unit_cost']} (this supplier)")
            elif mats and (share := re.search(r"Material accounts for about (\d+) %", txt)):
                f = round(mats[0] / (int(share.group(1)) / 100), 2)  # a rival's material cost / its material share
                est.update(floor=f, full_cost=f, basis=f"material {mats[0]} / {share.group(1)} % share")
            elif sc:
                est.update(floor=sc[0]["unit_cost"], full_cost=sc[0]["unit_cost"],
                           basis=f"should-cost {sc[0]['unit_cost']} ({'this supplier' if sc[0]['supplier_id'] == s else 'other supplier'})")
            elif b.get("current_unit_price"):
                m = (b.get("sustainable_margin_pct") or 5) / 100
                full = b["current_unit_price"] / (1 + m) * (1 + drift(part))
                est.update(floor=round(full, 2), full_cost=round(full, 2), basis=f"current / (1+{m}) x (1+drift {drift(part):+.4f})")
            elif lowest_open:
                est.update(floor=round(0.85 * lowest_open, 2), full_cost=round(0.85 * lowest_open, 2), basis="85 % of lowest opening")
            # teammates' P02/P05 zeros: should-cost can sit ABOVE the quotes. It is a weak prior: cap it so
            # the supplier's own opening still earns a sustainable margin (else the opening looks like a squeeze)
            raw_floor = est.get("floor")
            own_open = (self._opening_terms(t).get("unit_price") if self.cfg.calibrated_anchor else
                        t.sheets[0]["terms"].get("unit_price") if t.sheets else None)
            if est.get("floor") and own_open:
                cap = round(own_open / (1 + (b.get("sustainable_margin_pct") or 5) / 100), 2)
                if est["floor"] > cap:
                    self._anchor_clamp(t, est["floor"], cap, "floor_capped_at_immutable_opening_margin")
                    est.update(floor=cap, full_cost=cap, basis=est["basis"] + f" -> capped at opening/(1+margin) = {cap}")
            if self.cfg.calibrated_anchor:
                self._calibrate_estimate(t, est, raw_floor)
            prior = self.cfg.floor_prior_rfq if len(self.threads) > 1 else self.cfg.floor_prior
            basis = str(est.get("basis", ""))
            if prior and est.get("floor") is not None and "own cost breakdown" not in basis and "material" not in basis:
                # review E56: without the supplier's own cost evidence, opening quotes embed 25-45 % margin; an 85 %-of-
                # opening or price-minus-margin floor hands the anchor to the supplier. Cap at prior x opening (RFQ:
                # x the lowest opening). Overwritten as soon as a breakdown / material share arrives (re-estimate).
                opens = [x.opening_terms.get("unit_price") for x in self.threads.values() if x.opening_terms.get("unit_price")]
                ref = (min(opens) if len(self.threads) > 1 else t.opening_terms.get("unit_price")) if opens else None
                if ref and est["floor"] > prior * ref:
                    cap = round(prior * ref, 2)
                    est.update(floor=cap, full_cost=min(est.get("full_cost") or cap, cap),
                               basis=basis + f" -> prior cap {prior:.2f} x opening = {cap}")
            if getattr(self.cfg, "strategy", "") and est.get("floor") is not None:
                est.setdefault("full_cost", est["floor"])  # alt negotiators (proto/alt) read full_cost; A10 unchanged
            t.est = est
        rows = target(case, {s: t.est for s, t in self.threads.items() if t.est.get("floor")})
        self.target_c, self.target_sup, self.target_terms = rows[0] if rows else (float("inf"), None, None)
        if self.cfg.calibrated_anchor:
            self._calibration_targets(rows)
        self.note("target", c_target=self.target_c, supplier=self.target_sup, terms=self.target_terms,
                  floors={s: (t.est.get("floor"), t.est.get("basis"), t.est.get("interest_rate")) for s, t in self.threads.items()})

    def _material_share_bridge(self, t, msg):
        """A conditional arithmetic question, never a verified cost or profit claim."""
        if (not self.cfg.material_share_bridge or self.cfg.safe_claims
                or self.cfg.claim_provenance_only or len(self.threads) < 2
                or self.relationship or t.status != "open" or "action" in msg
                or getattr(t, "closed", False) or getattr(t, "state_uncertain", False)
                or getattr(t, "pending_request", None) or not msg.get("term_sheets")):
            return msg
        lock = getattr(t, "io_lock", None)
        if lock is not None and not lock.acquire(blocking=False):
            return msg  # Evidence work must not wait behind supplier I/O.
        try:
            name = "material-share-bridge.md"
            if getattr(t, "_material_share_bridge_used", False) or any(
                    event.get("from") == "buyer" and any(a.get("name") == name
                        for a in event.get("attachments") or []) for event in t.events):
                return msg
            parts = self.case.get("parts") or []
            if len(parts) != 1 or not isinstance(parts[0], str) or self.turn_remaining(t, refresh=False) <= 15:
                return msg  # A bundled price cannot be assigned to one material input.
            part = parts[0].removeprefix("part:")
            part_pattern = re.compile(r"(?<![\w-])" + re.escape(part) + r"(?![\w-])", re.I)
            packages = [closing_terms(self.case, s.get("terms") or {}, t.std)
                        for s in msg["term_sheets"]]
            for layer in (self.case, self.b, self.case.get("fixed_terms") or {}, t.std, *packages):
                currency = layer.get("currency") or layer.get("currency_code")
                unit = layer.get("price_unit")
                if currency is not None and str(currency).upper() not in ("EUR", "€"):
                    return msg
                if unit is not None and order_unit_price({"price": 1, "price_unit": unit}) != 1:
                    return msg
            if any(not _v2_number(p.get("unit_price")) or p["unit_price"] <= 0 for p in packages):
                return msg

            def scope(text, metadata, body=False):
                specified = [str(metadata[k]).strip().removeprefix("part:")
                             for k in ("part", "part_id") if metadata.get(k) is not None]
                specified += [m.group(1).removeprefix("part:") for m in re.finditer(
                    r"(?im)^\s*[#*` ]*part(?:[_ ]id| number)?\s*[:=]\s*([\w:/.-]+)", text)]
                if specified:
                    return f"explicit part {part}" if all(v == part for v in specified) else None
                first = next((line.strip().strip("#*` ") for line in text.splitlines() if line.strip()), "")
                if (part_pattern.search(first)
                        and re.search(r"cost|breakdown|material|quote|quotation", first, re.I)):
                    return first
                return f"single-part RFQ for {part}" if body else None

            def origin(event, attachment=None):
                if attachment is None:
                    label = "supplier-authored message"
                    identifier = event.get("message_id")
                else:
                    label = "supplier-authored attachment " + str(attachment.get("name") or "(unnamed)")
                    identifier = attachment.get("attachment_id")
                return label + (f" ({identifier})" if identifier else "")

            share_pattern = re.compile(
                r"\bmaterial\s+(?:accounts?\s+for|represents?|makes?\s+up|is)\s*"
                r"(?:(?:about|approximately|roughly|around)\s+|~\s*)?"
                r"([+-]?\d+(?:[.,]\d+)?)\s*%\s+of\s+"
                r"(?:(?:our|the|total|direct|production|unit)\s+)*costs?\b", re.I)
            shares = []
            for event in tuple(t.events):
                if event.get("from") not in (t.sid, "supplier"):
                    continue
                sources = [(event.get("body") or "", event, True, origin(event))]
                sources += [(a.get("text") or "", a, False, origin(event, a))
                            for a in event.get("attachments") or []]
                for text, metadata, body, source in sources:
                    if not isinstance(text, str) or not (source_scope := scope(text, metadata, body)):
                        continue
                    for sentence in re.split(r"(?<=[.!?])\s+|\n", text):
                        matches = list(share_pattern.finditer(sentence))
                        if not matches:
                            continue
                        if (len(matches) != 1 or len(re.findall(r"\d\s*%", sentence)) != 1
                                or re.search(r"\b(?:their|another supplier|rival|hypothetical|if|assum\w*)\b",
                                             sentence, re.I)):
                            return msg
                        match = matches[0]
                        if re.search(r"\b(?:not|never|no longer|cannot|can't)\b",
                                     sentence[:match.start()] + match.group(0), re.I):
                            return msg
                        share = float(match.group(1).replace(",", "."))
                        if not math.isfinite(share) or not 0 < share <= 100:
                            return msg
                        shares.append((share, match.group(0), source, source_scope))
            if not shares or len({row[0] for row in shares}) != 1:
                return msg

            basis_pattern = re.compile(
                r"(?:EUR|€)\s*(?:/|per)\s*(?:units?|pieces?|pcs?|ea)\b|"
                r"(?:units?|pieces?|pcs?|ea)\s*(?:\(|\[)?\s*(?:EUR|€)", re.I)
            amount_pattern = re.compile(r"(?:EUR\s*|€\s*)?([+-]?\d+(?:[.,]\d+)?)\s*(?:EUR|€)?", re.I)

            def material_input(text):
                preamble = text.split("|", 1)[0]
                global_basis = basis_pattern.search(preamble) is not None
                columns, values = [], []
                for line in text.splitlines():
                    if "|" not in line:
                        continue
                    cells = [cell.strip().strip("*` ") for cell in line.strip().strip("|").split("|")]
                    basis_columns = [i for i, cell in enumerate(cells) if basis_pattern.search(cell)]
                    if basis_columns:
                        columns = basis_columns
                    if not cells or not re.search(r"\bmaterial\b", cells[0], re.I):
                        continue
                    amounts = [(i, match) for i, cell in enumerate(cells[1:], 1)
                               if (match := amount_pattern.fullmatch(cell))]
                    if not amounts:
                        continue
                    if len(amounts) != 1:
                        return None
                    column, match = amounts[0]
                    if (columns and (len(columns) != 1 or column != columns[0])) or (not columns and not global_basis):
                        return None
                    value = float(match.group(1).replace(",", "."))
                    if not math.isfinite(value) or value <= 0:
                        return None
                    values.append(value)
                # Also accept an explicitly unit-labelled prose input, not a raw bar/kg price.
                if not values:
                    for line in text.splitlines():
                        if not re.search(r"\bmaterial\b", line, re.I) or "%" in line:
                            continue
                        match = re.search(
                            r"\bmaterial(?: cost)?\s*(?::|=|is)\s*(?:EUR|€)\s*"
                            r"([+-]?\d+(?:[.,]\d+)?)\s*(?:/|per)\s*(?:units?|pieces?|pcs?|ea)\b", line, re.I)
                        if match:
                            values.append(float(match.group(1).replace(",", ".")))
                return values[0] if len(values) == 1 and math.isfinite(values[0]) and values[0] > 0 else None

            own, references = [], []
            for other in self.threads.values():
                for event in tuple(other.events):
                    if event.get("from") not in (other.sid, "supplier"):
                        continue
                    for attachment in event.get("attachments") or []:
                        text = attachment.get("text") or ""
                        if not isinstance(text, str) or not (source_scope := scope(text, attachment)):
                            continue
                        if other.sid != t.sid:
                            secrecy = " ".join(str(value or "") for value in (
                                text, attachment.get("name"), event.get("body"), attachment.get("classification"),
                                attachment.get("visibility"), event.get("classification")))
                            if (attachment.get("confidential") or event.get("confidential")
                                    or attachment.get("private") or re.search(
                                        r"confidential|proprietary|restricted|\bNDA\b|internal (?:use|only)|"
                                        r"do not (?:share|disclose)|not (?:for sharing|to be shared)|non[- ]disclosure",
                                        secrecy, re.I)):
                                continue  # Possession is not permission to disclose confidential rival costs.
                        value = material_input(text)
                        if value is None:
                            if other.sid == t.sid and re.search(r"\|[^\n|]*\bmaterial\b[^\n]*\d", text, re.I):
                                return msg  # Do not replace an ambiguous own input with a rival assumption.
                            continue
                        row = (value, origin(event, attachment), source_scope, other.sid)
                        (own if other.sid == t.sid else references).append(row)
            inputs = own or references
            if not inputs or len({row[0] for row in inputs}) != 1:
                return msg
            material, source, source_scope, source_supplier = inputs[0]
            share, quote, share_source, share_scope = shares[0]
            implied = material / (share / 100)
            if not math.isfinite(implied):
                return msg
            source_label = (f"Your documented material input: {source}; scope: {source_scope}." if own else
                            f"Same-part reference assumption from another supplier's document: {source}; "
                            f"source supplier: {source_supplier}; scope: {source_scope}. "
                            "This is not your verified cost or evidence that your material basis is identical.")
            rows, terms = [], []
            for i, package in enumerate(packages, 1):
                price = package["unit_price"]
                rows.append(f"| Package {i} | {price:.2f} | {price - implied:.4f} |")
                terms.append(f"Package {i} proposed terms: " + "; ".join(
                    f"{key}={value}" for key, value in package.items()) + ".")
            question = ("Which material basis or omitted cost explains the difference? "
                        "Please identify and quantify it on the proposed terms.")
            document = (f"# Conditional material-share bridge for {part}\n\n{source_label}\n\n"
                        f"Your quoted share: \"{quote}\". Source: {share_source}; scope: {share_scope}.\n\n"
                        f"Documented material input: {material:g} EUR per unit.\n"
                        f"If that material basis applies to your quoted cost share, "
                        f"F = {material:g} / ({share:g}/100) = {implied:.4f} EUR per unit (rounded).\n\n"
                        "| Attached proposal | Unit price (EUR/unit) | Price minus F (EUR/unit, rounded) |\n"
                        "|---|---:|---:|\n" + "\n".join(rows) + "\n\n" + "\n".join(terms) + "\n\n"
                        "Price minus F is an indicative remainder before any costs omitted from the quoted "
                        "cost basis, not profit. Material basis, cost definition and term-related costs may "
                        "differ; this calculation does not establish feasibility.\n\n" + question + "\n")
            summary = (f"A conditional material-share calculation is attached. Using "
                       f"{'your documented material input' if own else 'a same-part reference assumption from another supplier, not your verified cost'}, "
                       f"{material:g} EUR/unit / ({share:g}/100) gives F approximately {implied:.4f} EUR/unit. "
                       + " ".join(f"Package {i}: proposed price {p['unit_price']:.2f}, price minus F "
                                   f"{p['unit_price'] - implied:.4f} EUR/unit."
                                   for i, p in enumerate(packages, 1))
                       + " These are indicative remainders before omitted costs, not profit. " + question)
            head, separator, tail = (msg.get("body") or "").partition("\nBest regards")
            attachments = list(msg.get("attachments") or [])
            attachments.append({"name": name, "type": "md",
                                "content_b64": base64.b64encode(document.encode()).decode()})
            result = {**msg, "body": head + "\n" + summary + separator + tail, "attachments": attachments}
            self.note("material_share_bridge", supplier=t.sid, source_supplier=source_supplier,
                      source=source, scope=source_scope, share=share, material=material,
                      implied_cost=implied, reference_assumption=not bool(own))
            # Reserve the draft conservatively; an uncertain dispatch must never repeat this bridge.
            t._material_share_bridge_used = True
            return result
        except Exception as e:
            self.note("material_share_bridge_failed", supplier=t.sid,
                      error=f"{type(e).__name__}: {str(e)[:200]}")
            return msg
        finally:
            if lock is not None:
                lock.release()

    _VERIFY_LINE = ("Please verify these inputs first, then assess the attached package; if you counter, "
                    "please reflect any applicable adjustment in your primary term sheet.")

    def _verify_settle(self, t, rnd, msg):
        """I3: evidence-first layout and/or a verify-then-assess request; same lines, refs and sheets (no new facts)."""
        cfg = self.cfg
        if not (cfg.verify_layout or cfg.verify_request) or rnd < 1 or not isinstance(msg, dict):
            return msg
        refs = [r for r in (msg.get("refs") or []) if isinstance(r, str) and r]
        if not msg.get("term_sheets") or not refs or not isinstance(msg.get("body"), str) or not msg["body"]:
            return msg
        try:
            original = msg["body"]
            lines = original.split("\n")
            layout_done = request_done = False

            def signoff_index(ls):
                idx = [i for i, ln in enumerate(ls) if ln.strip() == "Best regards"]
                return idx[-1] if idx else None

            if cfg.verify_layout:
                g = next((i for i, ln in enumerate(lines) if ln.strip()), None)
                so = signoff_index(lines)
                end = so if so is not None else len(lines)
                if g is not None and g < end:
                    body_idx = range(g + 1, end)
                    ev = [i for i in body_idx if lines[i].strip() and any(r in lines[i] for r in refs)]
                    if ev:
                        evset = set(ev)
                        evidence = [lines[i] for i in ev]
                        rest = [lines[i] for i in range(g + 1, len(lines)) if i not in evset]
                        while rest and not rest[0].strip():
                            rest.pop(0)
                        new_lines = lines[:g + 1] + [""] + evidence + [""] + rest
                        key = lambda ls: sorted(x.strip() for x in ls if x.strip())
                        if key(new_lines) == key(lines):
                            if new_lines != lines:
                                lines, layout_done = new_lines, True
                        else:
                            self.note("verify_settle_failed", supplier=t.sid, reason="sentence_multiset_changed")
            if cfg.verify_request and self._VERIFY_LINE not in lines:
                so = signoff_index(lines)
                if so is not None:
                    lines = lines[:so] + [self._VERIFY_LINE, ""] + lines[so:]
                else:
                    lines = lines + ["", self._VERIFY_LINE]
                request_done = True
            if not (layout_done or request_done):
                return msg
            self.note("verify_settle", supplier=t.sid, layout=layout_done, request=request_done)
            return {**msg, "body": "\n".join(lines)}
        except Exception as e:
            self.note("verify_settle_failed", supplier=getattr(t, "sid", None), error=f"{type(e).__name__}: {str(e)[:200]}")
            return msg

    def write(self, t, rnd, sheets, rival=None):
        if self.cfg.safe_claims:
            return super().write(t, rnd, sheets, rival)
        if getattr(self.cfg, "claim_provenance_only", False):
            valid_rival, rival_label = self._provenance_v2_rival(t, rival)
            writer = copy(self)  # Share clients and locks; only the immutable per-message config differs.
            writer.cfg = replace(self.cfg, facts=min(max(0, self.cfg.facts), 3 - int(valid_rival is not None)),
                                 objection_map=False)
            facts = writer.facts_for(t)
            start = t.facts_used
            # The parent owns the package explanation, including U1's price/term trade-offs.
            msg = super(PracticeNegotiator, writer).write(t, rnd, sheets, valid_rival)
            selected = facts[start:t.facts_used]
            groups = [tuple(f[0] if isinstance(f[0], list) else [f[0]]) for f in selected if f[0]]
            count = len(groups) + int(valid_rival is not None)
            if valid_rival and rival_label != "standing":
                rid, terms = valid_rival
                old_sentence = f"For transparency: another supplier's standing offer ({rid}) is {fmt(terms)}; I attach it."
                new_sentence = (f"For transparency: another supplier's {rival_label} ({rid}) is {fmt(terms)}; "
                                "it needs confirmation before acceptance and is not an executable standing primary.")
                msg["body"] = msg["body"].replace(old_sentence, new_sentence, 1)
                for attachment in msg.get("attachments") or []:
                    if attachment.get("name") == "competing-offer.md":
                        text = f"# Competing {rival_label} {rid}\n\n{fmt(terms)}\n\nConfirmation is required before acceptance.\n"
                        attachment["content_b64"] = base64.b64encode(text.encode()).decode()
            asked = (t.last.get("body") or "") if rnd else ""
            extra = []
            if self.cfg.answer_plus:
                if re.search(r"volume", asked, re.I):
                    proof = self._provenance_v2_forecast(t, sheets, msg, 3 - count)
                    if proof:
                        ref, sentence = proof
                        extra.append(sentence)
                        msg.setdefault("refs", []).append(ref)
                        groups.append((ref,))
                        count += 1
                        t.fc_cited = True
                        t._provenance_v2_forecast_ids = tuple(dict.fromkeys(
                            (*getattr(t, "_provenance_v2_forecast_ids", ()), ref)))
                if re.search(r"pay(ing)? (your |our |the )?invoices on time|late payments?|pay on time|paid late|payment discipline", asked, re.I):
                    extra.append("We will pay every invoice on time within the agreed payment term.")
                if self.case.get("type") == "bundling" and rnd == 0:
                    extra.append("Our proposal covers the parts listed in this bundled enquiry; the proposed commitments are in the term sheets.")
            if extra:
                msg["body"] = msg["body"].replace("\nBest regards", "\n" + "\n".join(extra) + "\n\nBest regards", 1)
            msg["refs"] = list(dict.fromkeys(r for r in msg.get("refs") or [] if isinstance(r, str) and r))
            if self.cfg.proof and re.search(r"send us the data|which figures|proof|verify|documentation", asked, re.I):
                self._provenance_v2_proof(t, msg, groups, 3 - count)
            # Only this thread's validated assertions are remembered; no case-wide used-ID ledger.
            canonical_groups = [group for group in groups if all(canonical_record_v2(ref) is not None for ref in group)]
            t._provenance_v2_history = tuple(dict.fromkeys(
                (*getattr(t, "_provenance_v2_history", ()), *canonical_groups)))
            return msg
        msg = super().write(t, rnd, sheets, rival)
        if self.cfg.answer_plus:
            extra = []
            asked = (t.last.get("body") or "") if rnd else ""
            part = self.case["parts"][0]
            if re.search(r"volume", asked, re.I) and not getattr(t, "fc_cited", False):
                fc = q("SELECT id FROM forecasts WHERE part_id = ? ORDER BY snapshot_month DESC LIMIT 1", (part,))
                if fc and getattr(self.cfg, "text_fixes2", False) and fc[0]["id"] in (msg.get("body") or ""):
                    fc = []  # E72: the forecast fact already cites this ID in the body (P03: the same ID twice)
                    t.fc_cited = True
                if fc and self.cfg.fc_provenance and canonical_fact(fc[0]["id"]) is None:
                    # SQL-only id: the arena would answer "that forecast ID doesn't exist" -> state it without the id
                    extra.append("Our current forecast backs this binding volume.")
                    self.note("fc_provenance", supplier=t.sid, ref=fc[0]["id"], cited=False)
                    t.fc_cited = True
                elif fc:  # cited without a figure: the arena takes the data's own value
                    extra.append(f"Our current forecast ({fc[0]['id']}) backs this binding volume.")
                    msg.setdefault("refs", []).append(fc[0]["id"])
                    t.fc_cited = True
            if re.search(r"pay(ing)? (your |our |the )?invoices on time|late payments?|pay on time|paid late|payment discipline",
                         asked, re.I):
                extra.append("We will pay every invoice on time within the agreed payment term.")
            if self.case.get("type") == "bundling" and rnd == 0:
                # the bundle moves volume we buy from other suppliers today (from our order lines)
                parts = self.case.get("parts", [])
                rows = q(f"SELECT SUM(qty) AS n FROM po_lines WHERE part_id IN ({','.join('?' * len(parts))}) "
                         "AND supplier_id != ? AND order_date >= date('2025-10-01')", (*parts, t.sid)) if parts else []
                n = (rows[0]["n"] if rows else 0) or 0
                if n > 0:
                    extra.append(f"The bundle moves about {n:,.0f} pieces a year that we buy from other suppliers today to you.")
            if extra:
                msg["body"] = msg["body"].replace("\nBest regards", "\n" + "\n".join(extra) + "\n\nBest regards", 1)
        asked = (t.last.get("body") or "") if rnd else ""
        if self.cfg.proof and re.search(r"send us the data|which figures|proof|verify|documentation", asked, re.I) \
                and not getattr(t, "proof_sent", False):
            # P03/P04/P05/P08/P11: "Which figures is that based on? Please send us the data." -> attach them
            cited = [r for m in t.events if m.get("from") == "buyer" for r in m.get("refs") or []]
            rows = []
            for ref in dict.fromkeys(cited):
                f = lookup(ref) or {}
                vals = ", ".join(f"{k} {v}" for k, v in f.items() if k in ("unit_price", "unit_cost", "change_pct", "otd_pct",
                                                                              "ppm", "value", "month", "days", "part"))
                label = {"po": "Our order", "cost": "Should-cost estimate", "fc": "Our forecast", "sc": "Your scorecard",
                         "idx": "Index value", "doc": "Your letter", "ctr": "Our contract", "quote": "Quote"}.get(ref.split(":")[0], "Data")
                # no raw IDs in the attachment: re-cited IDs counted as duplicate claims (P07, GPT-6.1-sol #9)
                rows.append(f"| {label} | {vals or 'see the shared data'} |") if (self.cfg.objection_map or self.cfg.proof_plain) else \
                    rows.append(f"| {ref} | {vals or 'see the shared data'} |")
            need = f"{self.b['need_per_year']:,} pieces per year"
            if rows:
                doc = ("# Data behind our figures\n\n| ID | Values |\n|---|---|\n" + "\n".join(rows)
                       + f"\n\nOur requirement: {need}, the full need for this part.\n")
                msg.setdefault("attachments", []).append(
                    {"name": "our-data.md", "type": "md", "content_b64": base64.b64encode(doc.encode()).decode()})
                msg["body"] = msg["body"].replace("\nBest regards", "\nYou asked for the data behind our figures: it is attached.\n\nBest regards", 1)
                t.proof_sent = True
        if self.cfg.material_share_bridge:
            msg = self._material_share_bridge(t, msg)
        msg = self._no_dup_claims(t, msg)
        if self.cfg.text_fixes and msg.get("refs"):
            msg["refs"] = list(dict.fromkeys(msg["refs"]))  # audit: P03 cited the same forecast ID twice in one message
        msg = self._verify_settle(t, rnd, msg)  # I3 (flags verify_layout / verify_request; no-op when off)
        return msg


def dry(case_id):
    """Facts and floors for a practice case from the data alone: no session, no quota."""
    cases = {c["case_id"]: c for c in ArenaClient().cases("practice")}
    case = cases[case_id]

    class T:  # a thread without a session: no opening quote yet
        def __init__(self, sid):
            self.sid, self.sheets = sid, []

    n = PracticeNegotiator.__new__(PracticeNegotiator)
    n.case, n.b = case, case["buyer"]
    print(f"\n== {case_id} {case['title']} ({case['buyer']['category_goal']})")
    for sid in case["suppliers"]:
        t = T(sid)
        for refs, text in n.facts_for(t):
            print(f"   {sid} fact: {text}.  refs={refs}")
        sc = q("SELECT unit_cost, supplier_id FROM should_cost WHERE part_id = ? ORDER BY supplier_id = ? DESC", (case["parts"][0], sid))
        print(f"   {sid} floor: should-cost {sc[0]['unit_cost'] if sc else None}, drift {drift(case['parts'][0]):+.4f}, cash rate {cash_rate(sid)}")


if __name__ == "__main__":
    load_env()
    args = sys.argv[1:]
    if args and args[0] == "--dry":
        for c in args[1:]:
            dry(c)
        sys.exit()
    cfg = Config(**json.loads(os.environ.get("ENGINE_CFG", "{}")))
    import proto.engine as eng

    eng.Negotiator = PracticeNegotiator  # play() builds this class
    with ThreadPoolExecutor(len(args)) as ex:
        for case_id, (sid, res) in zip(args, ex.map(lambda c: play(c, cfg, log_dir=Path("proto/runs/practice")), args)):
            print(f"\n=== {case_id} session {sid}: score {res.get('score')} c_deal {res.get('c_deal')} c_best {res.get('c_best')}")
            print(f"replay: https://arena.tacto.ai/replay/{sid}")
