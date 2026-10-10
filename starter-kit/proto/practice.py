"""The engine on hosted practice (and final) cases: facts and floors from the data package.

    PYTHONPATH=. uv run python proto/practice.py --dry case:P01 case:P05     # no session, no quota
    ENGINE_CFG='{...}' PYTHONPATH=. uv run python proto/practice.py case:P01  # plays: costs 1 practice session

Facts are built only from facts.json / the SQL tables, with the exact figure the arena checks,
and only when they help us (e.g. never a fallback quote dearer than the supplier's ask).
"""

import json
import re
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from arena_kit import ArenaClient
from arena_kit.cli import load_env
from arena_kit.data import DataPackage

from proto.engine import Config, Negotiator, play
from proto.target import target

_PKG, _LOCK = None, threading.RLock()
SHOULD_COST_MARKUP = 1.02  # the package's should-cost over the arena's full cost (P01 1.0200, P02 1.0199, P03 1.0199)


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


def citable(ref):
    """An ID the arena can check: in facts.json or the Sunday release. `lookup` also finds table-only rows (225
    forecast snapshots, goods receipts, invoices); the arena answers those "doesn't exist ... that costs trust"."""
    with _LOCK:
        return ref in pkg().facts


# Fact planner: the share of verified claims a supplier answered "it holds and we took it into account" (or "we did
# not know that") in 1,061 practice replies, by the arena's claim type. Our own order prices: 0 of 198.
PRIOR = {"notice_period": 0.95, "quality_record": 0.9, "index_change": 0.8, "should_cost": 0.75, "volume_change": 0.6,
         "rival_quote": 0.5, "delivery_record": 0.3}
TYPE_WORDS = {"delivery record": "delivery_record", "scorecard": "delivery_record", "on-time": "delivery_record",
              "index change": "index_change", "index": "index_change", "not our reality": "index_change",
              "price history": "price_history", "rival quote": "rival_quote", "competing": "rival_quote",
              "should cost": "should_cost", "should-cost": "should_cost", "volume change": "volume_change",
              "forecast": "volume_change", "quality record": "quality_record", "quality": "quality_record",
              "notice period": "notice_period", "notice": "notice_period"}
LANDED = ("took it into account", "took them into account", "did not know", "fair point", "pass this saving",
          "adjusted our calculation", "factored in", "reduce our price")
REJECTED = ("does not change our", "already taken", "already factored", "already been factored", "does not concern",
            "not our reality", "cannot give up margin", "does not alter", "do not alter", "not relevant", "not impact",
            "no impact", "does not affect", "do not affect", "into our previous")  # rejected is checked first


CITE_RE = re.compile(r"\b(?:idx|quote|offer|sc|qn|po|cost|fc|news|doc|ctr|gr|inv|rfq):[\w.:@#/-]*\w")


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


def cash_rate(sid, good_credit=None):
    """What money now is worth to a supplier: weaker credit (higher index) = dearer cash. `good_credit` replaces the
    rate for a credit index below 200 (Config.cash_rate_rel, supplier-health cases only)."""
    r = q("SELECT credit_index, equity_ratio_pct FROM supplier_intel WHERE supplier_id = ?", (sid,))
    if not r or r[0]["credit_index"] is None:
        return 0.10
    ci = r[0]["credit_index"]
    if good_credit is not None and ci < 200:
        return good_credit
    # good credit -> cash is cheap for it (below our 8 %), so long payment terms cost it little (P08/P18: 90 days)
    return 0.05 if ci < 200 else 0.10 if ci < 250 else 0.14 if ci < 300 else 0.20


class PracticeNegotiator(Negotiator):
    def facts_for(self, t):
        if self.cfg.plan_facts:
            return [(f["ids"] if len(f["ids"]) > 1 else f["ids"][0], f["text"]) for f in self.fact_queue(t)]
        if hasattr(t, "facts"):
            return t.facts
        case, b = self.case, self.b
        part = case["parts"][0]
        asked = t.sheets[0]["terms"].get("unit_price") if t.sheets else None
        refs = case.get("refs", [])
        facts = []
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
                if len(other) == 2 and all(o["price_unit"] == unit for o in other) and other[0]["price"] < asked \
                        and not self.cfg.landing_only:
                    # a plain statement without IDs: the arena only checks a supplier's own orders, so the IDs came
                    # back "irrelevant" and cost a claim slot (practice A9: P04, P08, P18)
                    facts.insert(0, ([], f"We currently buy the same part from another supplier at EUR "
                                         f"{other[0]['price']:.2f} per unit"))
        # 4. our order history with this supplier for this part (2-8 order lines)
        pos = q("SELECT id FROM po_lines WHERE part_id = ? AND supplier_id = ? ORDER BY id DESC LIMIT 3", (part, t.sid))
        if len(pos) >= 2 and not self.cfg.landing_only:  # our own order prices landed 0 of 198 times
            ids = [p["id"] for p in pos]
            facts.append((ids, f"Our recent orders {', '.join(ids)} show the price level we have been paying"))
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
                facts.append((r, f"Our forecast {r} shows demand {f['change_pct']:+.1f}%"))
        # 6b. news about this supplier (checked: that it is about this supplier) - optional
        if self.cfg.news:
            for nrow in q("SELECT id, headline FROM news WHERE supplier_id = ? ORDER BY date DESC LIMIT 1", (t.sid,)):
                facts.append((nrow["id"], f"We have read the recent news about your company ({nrow['id']})"))
        if getattr(self.cfg, "evidence_plus", False):
            # 6c. its own history on this part: it settled below its ask before (not a data ID: plain statement)
            h = q("SELECT asked_pct, settled_pct FROM negotiation_history WHERE supplier_id = ? AND part_id = ? "
                  "ORDER BY date DESC LIMIT 3", (t.sid, part))
            gaps = [x["asked_pct"] - x["settled_pct"] for x in h if x["asked_pct"] is not None and x["settled_pct"] is not None]
            if len(gaps) >= 2 and all(g > 0 for g in gaps) and not self.cfg.landing_only:
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
        if self.cfg.first_indices:
            from proto.candidate_levers import first_indices
            facts = first_indices(facts)
        t.facts = facts
        return facts

    # ---------- fact planner ----------
    def inventory(self, t):
        """Every checkable, favourable fact for this supplier (facts.json + the Sunday release), typed as the arena
        types claims: never our own order prices, never a plain statement without an ID ("send us the data")."""
        if hasattr(t, "inventory"):
            return t.inventory
        case, b = self.case, self.b
        part, own = case["parts"][0], set(case.get("refs") or [])
        asked = t.sheets[0]["terms"].get("unit_price") if t.sheets else None
        facts = pkg().facts
        inv = []

        def add(ids, text, ctype, weight=1.0):
            ids = list(ids) if isinstance(ids, (list, tuple)) else [ids]
            taken = {i for f in inv for i in f["ids"]}
            if ids and all(citable(i) or i in own for i in ids) and not taken & set(ids):
                inv.append({"ids": ids, "text": text, "type": ctype, "prior": PRIOR[ctype], "weight": weight})

        # notice: the letter gives less notice than the contract requires
        for d in (r for r in own if r.startswith("doc:")):
            df = lookup(d) or {}
            for c in (r for r in own if r.startswith("ctr:")):
                cf = lookup(c) or {}
                if df.get("days") and cf.get("days") and df["days"] < cf["days"] and cf.get("supplier") in (None, t.sid):
                    add([d, c], f"Your letter {d} gives {df['days']} days' notice, while our contract {c} requires "
                                f"{cf['days']} days, so a new price cannot start before then", "notice_period")
        # should-cost of this part below its price
        for r in q("SELECT id, unit_cost FROM should_cost WHERE part_id = ? ORDER BY supplier_id = ? DESC", (part, t.sid))[:1]:
            if asked is None or r["unit_cost"] < asked:
                add(r["id"], f"Our bottom-up should-cost estimate for this part is €{r['unit_cost']:.2f} ({r['id']})",
                    "should_cost")
        # each cost driver that fell, once: its steepest fall over 3, 6 or 12 months to the latest month
        for d in q("SELECT series_id, weight FROM cost_drivers WHERE part_id = ? ORDER BY weight DESC", (part,)):
            best = None
            for mths in (3, 6, 12):
                ch = index_change(d["series_id"], mths)
                if ch and ch[0] < -0.5 and (best is None or ch[0] < best[0]):
                    best = ch
            if best:
                chg, a, z, ma, mz = best
                add([a, z], f"{series_name(d['series_id'])} fell {chg:.1f}% from {ma} to {mz} ({a}, {z})", "index_change",
                    1.0 if (d["weight"] or 0) >= 0.1 else 0.5)
        # quality: this supplier's complaints on this part in the last 18 months, newest first, three per claim
        qn = sorted(((k, v) for k, v in facts.items() if k.startswith("qn:") and v.get("supplier") == t.sid
                     and v.get("part") == part and v.get("ppm") is not None), key=lambda kv: kv[1].get("date") or "", reverse=True)
        if qn:
            latest = qn[0][1].get("date") or ""
            cut = f"{int(latest[:4]) - 1}{latest[4:]}" if latest[:4].isdigit() else ""
            recent = [kv for kv in qn if (kv[1].get("date") or "") >= cut[:7]][:9]
            for i in range(0, len(recent), 3):
                chunk = recent[i:i + 3]
                ppm = sum(v["ppm"] for _, v in chunk) / len(chunk)
                ids = [k for k, _ in chunk]
                add(ids, f"Our quality notifications {', '.join(ids)} on this part record an average of {ppm:.1f} ppm",
                    "quality_record", (1.0 if b.get("category_goal") == "quality_first" else 0.45) * 0.85 ** (i // 3))
        # forecasts of this part that grew, the newest citable snapshots of the last 12 months first
        fcs = sorted(((k, v) for k, v in facts.items() if k.startswith("fc:") and v.get("part") == part),
                     key=lambda kv: kv[0].split("@")[-1], reverse=True)
        if fcs:
            top = fcs[0][0].split("@")[-1]
            cut = f"{int(top[:4]) - 1}{top[4:]}" if top[:4].isdigit() else ""
            # one snapshot: later ones are versions of the same forecast ("already taken that volume change data")
            for k, v in [kv for kv in fcs if kv[0].split("@")[-1] >= cut and (kv[1].get("change_pct") or 0) > 0][:1]:
                add(k, f"Our demand forecast {k} shows {v['change_pct']:+.1f}% for this part", "volume_change")
        # weak delivery quarters of this supplier (on-time below 92 %) in the last 12 months, newest first
        scs = sorted(((k, v) for k, v in facts.items() if k.startswith("sc:") and v.get("supplier") == t.sid),
                     key=lambda kv: kv[1].get("quarter") or "", reverse=True)[:4]
        for j, (k, v) in enumerate(kv for kv in scs if (kv[1].get("otd_pct") or 100) < 92):
            add(k, f"Your scorecard {k} shows {v['otd_pct']}% on-time delivery", "delivery_record", 0.8 ** j)
        # our alternative quote, if it is cheaper than its opening
        alt = b.get("alternative") or {}
        if (alt.get("ref") or "").startswith("quote:"):
            af = lookup(alt["ref"]) or {}
            if af.get("unit_price") and asked and af["unit_price"] < asked:
                add(alt["ref"], f"We hold another quote at €{af['unit_price']:.2f} ({alt['ref']})", "rival_quote")
        t.inventory = inv
        self.note("inventory", supplier=t.sid, facts=[(f["type"], f["ids"], round(f["prior"] * f["weight"], 2)) for f in inv])
        return inv

    def posterior(self, t):
        """Land chance per claim type for this supplier, from its own replies: a type it took into account rises to
        0.9; a type it waved off ("does not change our calculation", "already taken") drops to 0.05."""
        post = {}
        for m in t.events:  # the latest reply's verdict on a type wins (P08: a forecast taken into account in round 1,
            if m.get("from") == "buyer":  # its next snapshot "already taken" in round 2)
                continue
            now = {}
            for sent in re.split(r"(?<=[.!?])\s+", (m.get("body") or "").lower()):
                types = {v for k, v in TYPE_WORDS.items() if k in sent}
                if any(w in sent for w in REJECTED):  # one driver waved off says nothing about the next (P08: AS-14404
                    now.update({x: max(now.get(x, 0.0), 0.05) for x in types if x != "index_change"})  # hedged, PPI landed)
                elif any(w in sent for w in LANDED):
                    now.update({x: 0.9 for x in types})  # within one reply, a landed claim of a type beats a waved one
            post.update(now)
        return post

    def fact_queue(self, t):
        """The best unsent fact of each type (a shared one not yet sent to anyone), most likely to land first: one
        claim per type in a mail, the next of its type in the next mail."""
        post = self.posterior(t)
        sent = t.__dict__.setdefault("sent_ids", set()) | self.__dict__.setdefault("spent", set())
        queue = sorted((dict(f, p=post.get(f["type"], f["prior"]) * f["weight"]) for f in self.inventory(t)
                        if not set(f["ids"]) & sent), key=lambda f: -f["p"])
        # one claim per type in a mail (a second forecast snapshot draws "already taken"); index series count apart
        kind = lambda f: f["ids"][0].split("@")[0] if f["type"] == "index_change" else f["type"]  # noqa: E731
        firsts, seen = [], set()
        for f in queue:
            if kind(f) not in seen:
                seen.add(kind(f))
                firsts.append(f)
        # never a scorecard and quality notifications in one mail: speaking of quality, the arena checks the mean ppm
        # over every sc and qn row cited, so our qn-only mean came back "contradicted ... costs trust" (P07, P04)
        quality = [f for f in firsts if f["type"] in ("quality_record", "delivery_record")]
        if len(quality) == 2:
            firsts.remove(min(quality, key=lambda f: f["p"]))
        if any(f["p"] >= 0.1 for f in firsts):  # a type it waved off only when nothing likelier is left
            firsts = [f for f in firsts if f["p"] >= 0.1]
        return firsts

    def facts_left(self, t):
        return max((f["p"] for f in self.fact_queue(t)), default=0.0) if self.cfg.plan_facts else 0.0

    def fact_count(self, t, most):
        """Just enough facts that at least one lands with `plan_sure` (a strong one alone; two weak ones), at most
        `most`: the rest buy later rounds."""
        n, miss = 0, 1.0
        for f in self.fact_queue(t)[:most]:
            n, miss = n + 1, miss * (1 - f["p"])
            if 1 - miss >= self.cfg.plan_sure:
                break
        return max(n, 1)

    def _estimate(self):
        b, case = self.b, self.case
        part = case["parts"][0]
        lowest_open = min((t.sheets[0]["terms"]["unit_price"] for t in self.threads.values() if t.sheets), default=None)
        for s, t in self.threads.items():
            std = {**t.std, **case.get("fixed_terms", {})}
            std.setdefault("payment_days", b["reference_payment_days"])
            std.setdefault("incoterm", max(b["freight_eur_per_unit"], key=b["freight_eur_per_unit"].get))
            est = {"standard": std, "interest_rate": cash_rate(s, self.cfg.cash_rate_rel if self.relationship else None)}
            from proto.engine import BREAKDOWN
            txt = " ".join((m.get("body") or "") + " " + " ".join(a.get("text") or "" for a in m.get("attachments") or [])
                           for m in t.events if m.get("from") != "buyer")
            mats = [float(m.group(1)) for x in self.threads.values() for m in [BREAKDOWN.search(" ".join(
                a.get("text") or "" for e in x.events for a in e.get("attachments") or []))] if m]
            sc = q("SELECT unit_cost, supplier_id FROM should_cost WHERE part_id = ? ORDER BY supplier_id = ? DESC", (part, s))
            if bd := BREAKDOWN.search(txt):  # its own cost breakdown: material + labour + conversion
                direct = round(sum(float(x) for x in bd.groups()), 2)
                est.update(floor=direct, full_cost=direct, basis="own cost breakdown: material + labour + conversion")
            elif mats and (share := re.search(r"Material accounts for about (\d+) %", txt)):
                f = round(mats[0] / (int(share.group(1)) / 100), 2)  # a rival's material cost / its material share
                est.update(floor=f, full_cost=f, basis=f"material {mats[0]} / {share.group(1)} % share")
            elif sc:
                own_plant = sc[0]["supplier_id"] == s
                # calibration (2026-10-10, P01/P02/P03): the arena's own full cost, backed out of its supplier-health
                # charges on 24 deals, is the package's should-cost / 1.0200 for every supplier with its own row
                f = round(sc[0]["unit_cost"] / SHOULD_COST_MARKUP, 2) if own_plant else sc[0]["unit_cost"]
                est.update(floor=f, full_cost=f,
                           basis=f"should-cost {sc[0]['unit_cost']} ({'this supplier, / 1.02' if own_plant else 'other supplier'})")
            elif b.get("current_unit_price"):
                m = (b.get("sustainable_margin_pct") or 5) / 100
                full = b["current_unit_price"] / (1 + m) * (1 + drift(part))
                est.update(floor=round(full, 2), full_cost=round(full, 2), basis=f"current / (1+{m}) x (1+drift {drift(part):+.4f})")
            elif lowest_open:
                est.update(floor=round(0.85 * lowest_open, 2), full_cost=round(0.85 * lowest_open, 2), basis="85 % of lowest opening")
            # teammates' P02/P05 zeros: should-cost can sit ABOVE the quotes. It is a weak prior: cap it so
            # the supplier's own opening still earns a sustainable margin (else the opening looks like a squeeze)
            # the lowest price it has offered so far (any of its sheets): it proves it lives at that price with its
            # margin, so its floor is at most that / (1 + margin). Not only the latest offer (P18 countered higher once)
            # and not only the opening (P02's counter sat above its opening): the minimum
            offered = [s["terms"].get("unit_price") for m in t.events if m.get("from") not in ("buyer", "arena")
                       for s in m.get("term_sheets") or [] if s.get("terms", {}).get("unit_price")]
            own_open = min(offered) if offered else None
            if est.get("floor") and own_open:
                cap = round(own_open / (1 + (b.get("sustainable_margin_pct") or 5) / 100), 2)
                if est["floor"] > cap:
                    est.update(floor=cap, full_cost=cap, basis=est["basis"] + f" -> capped at opening/(1+margin) = {cap}")
            t.est = est
        rows = target(case, {s: t.est for s, t in self.threads.items() if t.est.get("floor")})
        self.target_c, self.target_sup, self.target_terms = rows[0] if rows else (float("inf"), None, None)
        self.note("target", c_target=self.target_c, supplier=self.target_sup, terms=self.target_terms,
                  floors={s: (t.est.get("floor"), t.est.get("basis"), t.est.get("interest_rate")) for s, t in self.threads.items()})

    def write(self, t, rnd, sheets, rival=None):
        if self.cfg.plan_facts:
            t.facts_used = 0  # the planner's queue holds only unsent facts
        msg = super().write(t, rnd, sheets, rival)
        if self.cfg.plan_facts:
            t.__dict__.setdefault("sent_ids", set()).update(msg.get("refs") or [])
            t.fc_cited = True  # forecasts come from the planner's queue
        own = set(self.case.get("refs") or [])
        ok = lambda r: r.startswith("offer:") or citable(r) or r in own  # noqa: E731
        msg["refs"] = [r for r in msg.get("refs") or [] if ok(r)]  # never an ID the arena cannot check
        if self.cfg.answer_plus:
            extra = []
            asked = (t.last.get("body") or "") if rnd else ""
            part = self.case["parts"][0]
            if re.search(r"volume", asked, re.I) and not getattr(t, "fc_cited", False):
                # only an ID the arena can check (facts.json): P05's latest forecast row is not in it, and citing it
                # came back "doesn't exist ... that costs trust" in every run - the supplier went final a round early
                fc = [r for r in q("SELECT id FROM forecasts WHERE part_id = ? ORDER BY snapshot_month DESC", (part,))
                      if citable(r["id"])][:1]
                if fc:  # cited without a figure: the arena takes the data's own value
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
                rows.append(f"| {ref} | {vals or 'see the shared data'} |")
            need = f"{self.b['need_per_year']:,} pieces per year"
            if rows:
                import base64
                doc = ("# Data behind our figures\n\n| ID | Values |\n|---|---|\n" + "\n".join(rows)
                       + f"\n\nOur requirement: {need}, the full need for this part.\n")
                msg.setdefault("attachments", []).append(
                    {"name": "our-data.md", "type": "md", "content_b64": base64.b64encode(doc.encode()).decode()})
                msg["body"] = msg["body"].replace("\nBest regards", "\nYou asked for the data behind our figures: it is attached.\n\nBest regards", 1)
                t.proof_sent = True
        lines = msg["body"].split("\n")
        kept = [x for x in lines if all(ok(i) for i in CITE_RE.findall(x))]
        if len(kept) != len(lines):
            self.note("dropped_ids", supplier=t.sid, ids=sorted({i for x in lines for i in CITE_RE.findall(x) if not ok(i)}))
            msg["body"] = "\n".join(kept)
        msg["refs"] = [r for r in msg["refs"] if ok(r)]
        return msg
        msg["body"] = msg["body"].replace(
            "Energy and wage costs have clearly been a strain for a foundry this year",
            "Cost pressure has clearly been real for you this year")
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
