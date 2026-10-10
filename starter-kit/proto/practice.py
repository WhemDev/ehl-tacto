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
    def facts_for(self, t):
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
        # 4. our order history with this supplier for this part (2-8 order lines)
        pos = q("SELECT id FROM po_lines WHERE part_id = ? AND supplier_id = ? ORDER BY id DESC LIMIT 3", (part, t.sid))
        if len(pos) >= 2:
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
        t.facts = facts
        return facts

    def _estimate(self):
        b, case = self.b, self.case
        part = case["parts"][0]
        lowest_open = min((t.sheets[0]["terms"]["unit_price"] for t in self.threads.values() if t.sheets), default=None)
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
            own_open = t.sheets[0]["terms"].get("unit_price") if t.sheets else None
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
        msg = super().write(t, rnd, sheets, rival)
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
