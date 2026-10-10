"""Research-driven buyer prototype: code picks every number, templates write the e-mail.

    PYTHONPATH=. uv run python proto/engine.py case:D01 case:D02            # default Config
    ENGINE_CFG='{"e": 2, "T": 4}' PYTHONPATH=. uv run python proto/engine.py case:D02

Per round: target C (proto.target) -> concession curve on C -> equal-C term sheets (MESO) ->
templated e-mail (facts, answers, rival offer, question) -> replies -> acceptance rule.
Every tactic is a field of Config, so proto/search.py can try many variants in parallel.
"""

import base64
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, replace
from pathlib import Path

from arena_kit import ArenaClient, ArenaError, complete_offer, must_haves_ok, total_cost
from arena_kit.cli import load_env
from arena_kit.cost import supplier_value
from arena_kit.docs import read_document, standard_terms
from arena_kit.play import ENDED

from proto.target import lever_grid, price_for_c, target

LOG_DIR = Path("proto/runs")
FINAL_GRACE_S = 15  # how long a best final offer may wait for a rival's reply that is already in flight


@dataclass(frozen=True)
class Config:
    e: float = 1.0  # concession curve exponent: <1 firm until late, 1 linear, >1 concede early
    T: int = 4  # rounds over which our goal travels from the target to the reference offer
    toward: str = "standing"  # curve end: "standing" (best standing offer) or "open" (best opening quote)
    anchor: float = 0.0  # first goal = target x (1 + anchor); negative = more aggressive
    holds: int = 1  # extra rounds at an unchanged goal while the supplier still gives > hold_gave
    hold_gave: float = 0.01  # share of C the supplier must have given last round to earn a hold
    push: str = "all"  # after a final offer: "all", "rfq" (only with a fallback offer) or "off"
    pushes: int = 1  # how many small asks after a final offer
    push_pct: float = 0.015  # size of each ask below its standing price
    meso_n: int = 3  # term sheets per message (1-3)
    pick: str = "diverse"  # which packages: "diverse" or "near" (closest to the supplier's own levers)
    facts: int = 1  # new citable facts per message
    rival: bool = True  # RFQ: tell each supplier the rival's standing offer (ID + attachment)
    calc: bool = True  # attach our calculation from the supplier's own breakdown when asked
    volume: bool = True  # answer "which volume can you commit to?"
    tone: str = "warm"  # "warm" or "brief"
    max_rounds: int = 8
    # ideas from the teammates' practice runs (Team-Knowledge, 2026-10-10)
    anchor_mode: str = "target"  # "target": open at our C_target; "opening": per-goal % below the opening quote
    long_contract: bool = False  # longest contract_months >= horizon in every sheet (free for us, valued by suppliers)
    say_fixed: bool = False  # when a supplier asks for a fixed term, say it is fixed in this enquiry
    rfq_bar: bool = False  # RFQ: an early "agreed" is the bar for one more rival round, not the deal
    rfq_hold: bool = False  # RFQ: a short no-sheet e-mail keeps a final-offer supplier's clock alive
    news: bool = False  # cite news rows about the supplier (practice/final data only)
    # fixes from practice run A (Progress/Practice-Run-A-Findings)
    bottleneck_anchor: float = 0.0  # secure_supply: first ask at least opening x (1 - this); 0 = off
    meet_fields: bool = False  # one package takes the supplier's value for a term it set (e.g. its index clause)
    # from the friend's D02 replay e843da929222686e (0.661)
    rfq_stagger: bool = False  # RFQ: open with the cheapest quote first, then the others citing its fresh reply
    breakdown_arg: bool = False  # quote the supplier's own cost breakdown back (material + labour + conversion)
    volume_framing: bool = False  # monthly baseline, "quote the trade-off for a larger lot", no-overtime lead time
    # fixes from A3 on practice (E21)
    meet_insist: bool = False  # meet a term at its FIRST explicit insistence ("mandatory", "essential", ...)
    penalty_aversion: float = 0.0  # extra weight on chargebacks when ranking packages for the supplier (P11)
    never_walk: bool = False  # no alternative: counter at its price with the must-haves restored instead of walking
    meet_band: float = 0.0  # a met (insisted) term is priced at most this far below the supplier's price; 0 = off
    # fixes from A5 on practice (Progress/Practice-Run-A5-Findings)
    recall_best: bool = False  # if its offers got worse after our move, propose its best earlier package back
    proof: bool = False  # when asked for data/proof, attach a data sheet with the facts we cited
    target_prior: bool = False  # leverage/routine/quality: first ask at least a typical room below the opening (P07)
    price_freeze: bool = False  # "prices are frozen, talk about terms": keep its price, trade terms only (P03)
    # RFQ-only overrides (None = same as above): tune multi-supplier play without touching single-supplier cases
    rfq_e: float | None = None
    rfq_T: int | None = None
    rfq_anchor: float | None = None
    rfq_holds: int | None = None
    rfq_pushes: int | None = None
    rfq_push_pct: float | None = None
    rfq_meso_n: int | None = None
    rfq_facts: int | None = None
    # upgrades from the team's weak-case review (2026-10-10 17:40)
    meet_cheapest: bool = False  # an insisted term goes into EVERY package, in the variant cheapest for us
    lead_cap: bool = False  # never offer a lead time beyond our need (within it: the supplier's standard)
    evidence_plus: bool = False  # cheaper orders of the same part elsewhere, recently falling drivers, its own history
    answer_plus: bool = False  # forecast ID with volume answers, on-time payment promise, bundle volume framing

    # from the R4 fork (another session, 2026-10-10 evening; sandbox D02 +0.05 each on fresh replies)
    allocate_facts: bool = False  # RFQ: a case fact counts once per case - a shared one goes to the best supplier now, never twice
    theirs_sheet: bool = False  # one package on the supplier's own levers (its standing + standard terms, within our must-haves)
    theirs_rfq_only: bool = False  # ... only with rivals: alone, a supplier agrees to it at our goal instead of conceding (P01)
    ask_cap: float = 0.0  # every goal: the first ask at least the lowest opening price x (1 - this); 0 = off
    # 2026-10-10 20:30, from 70 practice replays: suppliers go final right after a message with no new fact, and
    # after a hold that repeats the same ask ("you didn't move")
    facts_later: int = 0  # facts per message after the first (0 = `facts`): spread them, one new fact every round
    hold_back: float = 1.0  # a hold rewinds the curve by this many rounds: 1 = the same ask again, 0.75 = a quarter step
    # patience with movement (21:30, 90 practice replays): after any open reply a supplier conceded again ~1 % of C
    # about half the time, going final costs nothing (we take the final), and no supplier ever walked without a
    # push. So: never accept an OPEN offer while rounds remain unless it stalled; keep our ask patient_gap below its
    # standing offer (suppliers agreed to asks 0.8-2 % below their last offer), never the same ask twice
    patient: bool = False
    patient_gap: float = 0.015  # our late ask sits this share of C below the supplier's standing offer
    stall_gave: float = 0.001  # a reply that moved less than this share of C is a stall: take the offer
    # Fact planner (2026-10-10 22:45, 1,061 practice replies): a new fact that lands is what moves a supplier
    # (moved + landed: 82 % conceded, 1.8 % mean, 8 % final; moved, nothing landed: 54 %, 0.9 %, 27 % final), and
    # suppliers go final when we run out of new facts, not rounds. Our own order prices landed 0 of 198 times.
    plan_facts: bool = False  # every checkable, favourable fact for the supplier, ranked by land rate (practice adapter)
    plan_first: int = 3  # most claims in the first mail (the arena checks at most 3 per message)
    plan_later: int = 2  # most new claims per later mail (a rival's offer is one more)
    # A round concedes about the same with 1, 2 or 3 new facts landing (rounds >= 2: 1.05 / 0.55 / 1.67 % median), so
    # a mail carries just enough facts that one likely lands, and the rest buy later rounds (probe 22:30: P18 with
    # both falling indices in the first mail 0.401 vs 0.532 when the second index came a round later)
    plan_sure: float = 0.8
    plan_hold: float = 0.5  # keep holding past `holds` while a fact at least this likely to land is left
    # RFQ rival loop (Options note O3): an open best offer at our goal is not taken while a rival is still bidding down,
    # and every bidder is shown the best rival offer it has not seen yet, only if it beats its own (practice RFQs:
    # 2.1 % mean concession with a rival's offer cited vs 0.3 % without; final 25 % vs 62 %)
    auction_rfq: bool = False
    # What money is worth to a good-credit supplier (credit index < 200) in cases with a supplier-health charge
    # (stabilise, secure_supply). The arena's own charges imply 6.6 % (P02, Nordmark, 24 deals) and 6.1 % (P03,
    # Selvbrunn, 23 deals) with residuals near EUR 0; we assumed 5 %, so our "equal-cost" packages were not equal and the
    # supplier took the one worst for us (P02: about EUR 7k of a EUR 47k range). None = the old 5 %.
    cash_rate_rel: float | None = None
    # In a supplier-health case a clause package goes out at the payment term where it is cheapest for us. Nordmark
    # (P02) agreed at once to all 12 clause packages we sent, every one at 60 days; on the arena's bill the 90-day
    # clause package is about EUR 2.5k cheaper (formula: 0.76 vs 0.71 at each one's best price).
    clause_pay_best: bool = False
    # ... priced with this cost of money for a good-credit supplier (the arena-implied 6.1-6.6 %, not our 5 %): at 5 %
    # the cheapest price for us came out at EUR 358.92 and the supplier-health charge jumped to EUR 52.5k (0.701)
    clause_pay_rate: float | None = None

    def key(self):
        return json.dumps(asdict(self), sort_keys=True)


# SANDBOX-ONLY (hand-written for the 3 demo suppliers; the final uses proto/practice.py, which builds facts,
# floors and cash rates from data). Kept only to reproduce the early sandbox experiments (variants.py --handfacts).
# Per-supplier priors: how much money now is worth to it (persona-based guesses).
CASH_RATE = {"sup:DEMO-F1": 0.10, "sup:DEMO-J1": 0.20, "sup:DEMO-C1": 0.12}

# Citable facts from the case refs, dripped out (each verified fact moves a price once).
FACTS = {
    "case:D01": {
        "sup:DEMO-F1": [
            ("po:4500001201", "our recent orders (po:4500001201) show we have bought PH-100 steadily at the current price"),
            ("cost:part:PH-100", "our should-cost estimate for PH-100 (cost:part:PH-100) sits well below the new price"),
            ("sc:DEMO-F1@2026Q3", "your latest scorecard (sc:DEMO-F1@2026Q3) is part of how we review the partnership"),
            ("po:4500001342", "our latest order (po:4500001342) confirms the steady volume"),
        ],
    },
    "case:D02": {
        "sup:DEMO-J1": [
            ("fc:SH-220@2026-09", "our forecast fc:SH-220@2026-09 confirms 6,000 pieces a year for 24 months"),
            ("cost:part:SH-220", "our should-cost estimate (cost:part:SH-220) is below the current offers"),
            ("news:N-0412", "the market news (news:N-0412) points to easing stainless bar costs"),
            ("sc:DEMO-J1@2026Q3", "your scorecard (sc:DEMO-J1@2026Q3) is part of our award decision"),
        ],
        "sup:DEMO-C1": [
            ("fc:SH-220@2026-09", "our forecast fc:SH-220@2026-09 confirms 6,000 pieces a year for 24 months"),
            ("cost:part:SH-220", "our should-cost estimate (cost:part:SH-220) is below the current offers"),
            ("sc:DEMO-C1@2026Q3", "your scorecard (sc:DEMO-C1@2026Q3) shows room to improve on delivery and quality"),
        ],
    },
}
# teammates' goal anchors: how far below the opening quote our first ask goes (C basis)
GOAL_ANCHOR = {"routine": 0.12, "leverage": 0.16, "quality_first": 0.10, "stabilise": 0.06, "secure_supply": 0.06}
# typical room open -> best per goal on the hosted practice cases (P04/P07 routine 1-24 %, P05/P08/P18 leverage
# 15-27 %, P11 quality 12 %); only used to make a too-timid first ask bolder, never softer
ROOM_PRIOR = {"leverage": 0.15, "routine": 0.08, "quality_first": 0.08}
FREEZE = re.compile(r"frozen|freeze|no (further )?price reduction|cannot (reduce|lower|move on) (the |our )?price|"
                    r"talk about the terms|price (is|remains|stays) (fixed|firm)", re.I)
INSIST = (r"\bmandatory\b|\bessential\b|\brequires?\b|\brequired\b|\bwe (must|need to|have to) (include|have|add|keep|insist)"
          r"|\bnot possible without\b|\bonly (with|if)\b|\bcannot (offer|accept|do)\b[^.]*\bwithout\b|\binsist|non-negotiable")
TERM_WORDS = {"index_clause": r"index|clause|Preisgleitklausel|surcharge", "payment_days": r"payment|Zahlungsziel",
              "contract_months": r"contract (term|length|duration)|\bmonths\b", "lead_time_days": r"lead ?time|Lieferzeit|delivery time",
              "volume_per_year": r"volume", "incoterm": r"incoterm|delivery terms|\bDAP\b|\bFCA\b|\bEXW\b",
              "effective_date": r"start date|effective|valid from", "ppm_commitment": r"ppm|quality commitment",
              "chargeback_eur_per_complaint": r"chargeback", "tooling_eur": r"tooling"}
FIXED_WORDS = {"payment_days": r"payment|zahlungsziel|pay faster|faster payment", "volume_per_year": r"volume",
               "lead_time_days": r"lead time|lieferzeit|delivery time", "contract_months": r"contract (length|term)",
               "incoterm": r"incoterm|delivery terms|\bDAP\b|\bFCA\b|\bEXW\b", "effective_date": r"start date|valid from"}
WORDS = {"unit_price": "price", "payment_days": "payment terms", "contract_months": "contract length",
         "effective_date": "the start date", "lead_time_days": "lead time", "incoterm": "delivery terms",
         "volume_per_year": "the annual volume"}
BREAKDOWN = re.compile(r"\| ([\d.]+) \|[^\n]*\n[^\n]*\| ([\d.]+) \|[^\n]*\n[^\n]*conversion[^|]*\| ([\d.]+)")
SIGN = ["", "Best regards", "Hollerau Pumpenwerke, Purchasing"]
# facts the whole case shares (one claim per case, api.md) as opposed to a supplier's own (its scorecard)
SHARED = ("cost:", "fc:", "po:", "idx:", "news:", "quote:", "doc:", "ctr:")


def fmt(terms):
    bits = [f"€{terms['unit_price']:.2f}"]
    for k, label in (("payment_days", "{} days payment"), ("contract_months", "{} months"),
                     ("effective_date", "from {}"), ("lead_time_days", "{} days lead time"), ("incoterm", "{}")):
        if terms.get(k) is not None:
            bits.append(label.format(terms[k]))
    return ", ".join(bits)


class Thread:
    def __init__(self, sid, events):
        self.sid, self.events = sid, list(events)
        self.std = standard_terms(self.events)
        self.est = {}  # supplier estimate: standard, floor, full_cost, interest_rate
        self.facts_used = 0
        self.pushes = 0
        self.rounds = 0  # our messages in the RFQ loop (its own clock)
        self.in_flight = False  # our message is out and its reply has not arrived yet
        self.replied_at = time.time()  # the 60-second clock runs from the supplier's last reply
        self.moves = []  # opponent model: per-field changes of its standing sheet

    @property
    def last(self):
        return next(m for m in reversed(self.events) if m.get("from") != "buyer")

    @property
    def status(self):
        return self.last.get("status")

    @property
    def sheets(self):
        return self.last.get("term_sheets") or []

    def sent(self):
        return sum(m.get("from") == "buyer" for m in self.events)


class Negotiator:
    def __init__(self, client, case_id, cfg=Config(), quiet=False, deadline=None):
        self.c, self.case_id, self.cfg, self.quiet, self.log = client, case_id, cfg, quiet, []
        self.deadline, self.slowest = deadline, 0.0  # wave cap (epoch seconds) and our slowest round so far
        r = client.open_session(case_id)
        self.sid, self.case = r["session_id"], r["case"]
        self.threads = {s: Thread(s, ev) for s, ev in r["threads"].items()}
        for t in self.threads.values():
            self._docs(t.events)
            t.std = standard_terms(t.events)
        self.b = self.case["buyer"]
        self.alt = self.b.get("alternative") or {}
        self.c_alt = total_cost(self.case, self.alt["terms"]) if self.alt.get("terms", {}).get("unit_price") else float("inf")
        self.relationship = self.b.get("category_goal") in ("stabilise", "secure_supply")
        self.c_open = min((self.C(t, t.sheets[0]["terms"]) for t in self.threads.values() if t.sheets), default=float("inf"))
        if len(self.threads) > 1:  # RFQ-only overrides
            over = {k[4:]: v for k, v in asdict(cfg).items() if k.startswith("rfq_") and v is not None
                    and k not in ("rfq_bar", "rfq_hold", "rfq_stagger")}
            if over:
                self.cfg = cfg = replace(cfg, **over)
        self.note("config", **asdict(cfg))
        self._estimate()
        self.note("open", session=self.sid, c_alt=self.c_alt, c_open=self.c_open)

    # ---------- bookkeeping ----------
    def note(self, kind, **kw):
        self.log.append({"t": round(time.time(), 1), "kind": kind, **kw})
        if not self.quiet:
            print(f"[{self.case_id}] {kind}: {json.dumps(kw, default=str)[:700]}", flush=True)

    def _docs(self, events):
        for m in events:
            for a in m.get("attachments") or []:
                if a.get("attachment_id") and "text" not in a:
                    try:
                        a["text"] = read_document(a["name"], self.c.attachment(self.sid, a["attachment_id"]))
                    except ArenaError as e:  # e.g. 404 after the session ended (a late reply in an RFQ thread)
                        a["text"] = ""
                        self.note("attachment_missing", attachment=a.get("attachment_id"), status=e.status)

    def C(self, t, terms):
        return total_cost(self.case, terms, t.std, t.est if self.relationship and t.est else None)

    # ---------- target C from in-game evidence ----------
    def _estimate(self):
        b = self.b
        lowest_open = min((t.sheets[0]["terms"]["unit_price"] for t in self.threads.values() if t.sheets), default=None)
        texts = {s: " ".join((m.get("body") or "") + " " + " ".join(a.get("text") or "" for a in m.get("attachments") or [])
                             for m in t.events if m.get("from") != "buyer") for s, t in self.threads.items()}
        material = None  # material cost per unit from any breakdown we hold (same bar for every supplier)
        for txt in texts.values():
            if m := re.search(r"BAR-\S+ \(material[^|]*\| ([\d.]+)", txt):
                material = float(m.group(1))
        for s, t in self.threads.items():
            std = {**t.std, **self.case.get("fixed_terms", {})}
            std.setdefault("payment_days", b["reference_payment_days"])
            std.setdefault("incoterm", max(b["freight_eur_per_unit"], key=b["freight_eur_per_unit"].get))
            est = {"standard": std, "interest_rate": CASH_RATE.get(s, 0.10), "basis": None}
            txt = texts[s]
            if b.get("current_unit_price") and self.relationship:
                # healthy at today's price (sustainable margin), cost moved only by the drivers it cites
                drift = sum(float(mv) * float(sh) / 1e4 for _, mv, sh in
                            re.findall(r"(\S+) rose ([\d.]+) % in twelve months and is (\d+) % of our cost", txt))
                full = b["current_unit_price"] / (1 + b["sustainable_margin_pct"] / 100) * (1 + drift)
                est.update(full_cost=round(full, 2), floor=round(full, 2), basis=f"current price / (1+margin) x (1+{drift:.4f})")
            elif bd := BREAKDOWN.search(txt):
                est.update(floor=round(sum(float(x) for x in bd.groups()), 2), basis="own cost breakdown: material + wages + conversion")
            elif material and (sh := re.search(r"Material accounts for about (\d+) %", txt)):
                est.update(floor=round(material / (int(sh.group(1)) / 100), 2), basis=f"material {material} / {sh.group(1)} % share")
            elif lowest_open:
                est.update(floor=round(0.85 * lowest_open, 2), basis="prior: 85 % of the lowest opening price")
            t.est = est
        rows = target(self.case, {s: t.est for s, t in self.threads.items() if t.est.get("floor")})
        self.target_c, self.target_sup, self.target_terms = rows[0] if rows else (float("inf"), None, None)
        self.note("target", c_target=self.target_c, supplier=self.target_sup, terms=self.target_terms,
                  floors={s: (t.est.get("floor"), t.est.get("basis")) for s, t in self.threads.items()})

    # ---------- offers ----------
    def best_standing(self):
        best = None
        for t in self.threads.values():
            if t.status in ENDED:
                continue
            for sh in t.sheets:
                if must_haves_ok(self.case, sh["terms"], t.std):
                    c = self.C(t, sh["terms"])
                    if best is None or c < best[0]:
                        best = (c, t, sh)
        return best

    def goal(self, rnd):
        best = self.best_standing()
        ref = self.c_open if self.cfg.toward == "open" else (best[0] if best else self.c_open)
        ref = min(ref, self.c_alt)
        start = self.target_c * (1 + self.cfg.anchor)
        if self.cfg.bottleneck_anchor and self.b.get("category_goal") == "secure_supply":
            # practice P10: never far below a bottleneck's opening PRICE (its opening C is inflated when it covers
            # only part of the need), but always with full coverage: the cheapest such package at that price
            start = max(start, self.bottleneck_floor_c())
        prior = ROOM_PRIOR.get(self.b.get("category_goal"))
        if self.cfg.target_prior and prior and self.c_open < float("inf"):
            # practice P07: our data floor gave a first ask above the best possible deal; never be more timid
            # than a typical room for this goal
            start = min(start, self.c_open * (1 - prior))
        if self.cfg.ask_cap and self.c_open < float("inf"):
            # every goal, last so that it wins: a floor estimate far under the quotes (the P06 file: a should-cost
            # 30 % below) must not open 30 % below the market - real suppliers harden at that (P10 at 17 %, P02 at
            # 6 %); 3-17 % worked
            start = max(start, self.price_floor_c(self.cfg.ask_cap))
        if self.cfg.anchor_mode == "opening" and self.c_open < float("inf"):
            # teammates' rule: the first ask sits a goal-specific % below the opening, never below our target
            start = max(start, self.c_open * (1 - GOAL_ANCHOR.get(self.b.get("category_goal"), 0.10)))
        frac = min(1.0, max(rnd, 0) / self.cfg.T) ** (1 / self.cfg.e)
        return start + (ref - start) * frac

    def bottleneck_floor_c(self):
        return self.price_floor_c(self.cfg.bottleneck_anchor)

    def price_floor_c(self, frac):
        """C of the cheapest full-coverage package at `frac` below the lowest opening price: the lowest goal a
        first ask may have, whatever our floor estimate says. Plain C, without the supplier-health term: at a
        squeezed price that term would inflate the floor above the opening itself (stabilise cases)."""
        cache = self.__dict__.setdefault("_pfc", {})
        if frac not in cache:
            prices = [t.sheets[0]["terms"]["unit_price"] for t in self.threads.values() if t.sheets]
            if not prices:
                return 0.0
            floor_p = min(prices) * (1 - frac)
            t0 = next(iter(self.threads.values()))
            cs = [total_cost(self.case, {**g, "unit_price": floor_p}, t0.std) for g in lever_grid(self.case, t0.std)
                  if must_haves_ok(self.case, {**g, "unit_price": floor_p}, t0.std)]
            cache[frac] = min(cs) if cs else 0.0
        return cache[frac]

    def recalled(self, t):
        """P18/P08: its offers got worse after our last move. Propose its best earlier package (it offered it
        itself, so it will most likely agree) instead of pushing further."""
        if not self.cfg.recall_best or getattr(t, "recalled_once", False):
            return []
        seen = [(self.C(t, s2["terms"]), s2["terms"]) for m in t.events if m.get("from") not in ("buyer", "arena")
                for s2 in m.get("term_sheets") or [] if must_haves_ok(self.case, s2["terms"], t.std)]
        if len(seen) < 2 or not t.sheets:
            return []
        now = min(self.C(t, s2["terms"]) for s2 in t.sheets)
        best_c, best_terms = min(seen, key=lambda z: z[0])
        if best_c < now * 0.997:
            t.recalled_once = True
            self.note("recall_best", supplier=t.sid, best_c=round(best_c), now=round(now))
            return [complete_offer(self.case, best_terms)]
        return []

    def fallback_counter(self, t):
        """No package survives the guards (P10): counter at the supplier's own price with every must-have
        restored and full coverage, the cheapest such package for us - instead of walking away."""
        their = t.sheets[0]["terms"] if t.sheets else {}
        p = their.get("unit_price")
        if p is None:
            return []
        ok = [complete_offer(self.case, {**g, "unit_price": p}) for g in lever_grid(self.case, t.std)]
        ok = [x for x in ok if must_haves_ok(self.case, x, t.std)]
        ok.sort(key=lambda x: self.C(t, x))
        return ok[:1]

    def frozen_packages(self, t):
        """P03: "management has frozen all price reductions - we can talk about the terms instead". Keep its price
        and propose the packages with the best terms for us at that price."""
        their = t.sheets[0]["terms"] if t.sheets else {}
        p = their.get("unit_price")
        if p is None:
            return []
        pk = [complete_offer(self.case, {**g, "unit_price": p}) for g in lever_grid(self.case, {**t.std, **their})]
        pk = [x for x in pk if must_haves_ok(self.case, x, t.std) and self.C(t, x) < self.C(t, their) - 1]
        pk.sort(key=lambda x: self.C(t, x))
        if pk:
            self.note("price_frozen", supplier=t.sid, price=p, best_c=round(self.C(t, pk[0])))
        return pk[: self.cfg.meso_n]

    def meso(self, t, c_goal):
        """Up to meso_n packages that each cost us c_goal, differing in the levers the supplier may value."""
        if self.cfg.price_freeze and FREEZE.search(t.last.get("body") or "") and (fp := self.frozen_packages(t)):
            return fp
        # "equal cost to us" must be tight where the room is small (P02: 1 % of C was more than the whole room)
        room = max(self.c_open - self.target_c, 0.0) if self.c_open < float("inf") else 0.01 * c_goal
        tol = max(min(0.002 * c_goal, 0.1 * room), 0.0005 * c_goal)
        offered = t.sheets[0]["terms"] if t.sheets else {}
        grid = [g for g in lever_grid(self.case, {**t.std, **offered}) if must_haves_ok(self.case, g, t.std)]
        if self.cfg.lead_cap and "lead_time_days" in self.case["negotiable"]:
            # never beyond our need: a longer lead time costs us late days and suppliers rarely pay for it (P10)
            need = self.b.get("need_lead_time_days")
            grid = [g for g in grid if g.get("lead_time_days") is None or g["lead_time_days"] <= need] or grid
        if self.cfg.meet_cheapest:
            # a term the supplier explicitly insists on becomes a condition of EVERY package, in the variant of that
            # term that is cheapest for us - for an index clause: same series, widest deadband (P08/P18). Only a term
            # named in the same sentence as the insistence, and never one that cuts our coverage or a must-have.
            t.required = getattr(t, "required", {})
            sentences = re.split(r"(?<=[.!?])\s+", t.last.get("body") or "")
            opts = self.case.get("term_options", {})
            for f in self.case["negotiable"]:
                v = offered.get(f)
                if f == "unit_price" or v is None or f in t.required or not opts.get(f) or f not in TERM_WORDS:
                    continue
                said = any(re.search(INSIST, x, re.I) and re.search(TERM_WORDS[f], x, re.I) for x in sentences)
                # ... or a term it INTRODUCED itself (not in its opening offer, never proposed by us) and kept in its
                # last two offers: its condition, even if it never says "mandatory" (practice P18)
                sup_offers = [((m.get("term_sheets") or [{}])[0].get("terms") or {}) for m in t.events
                              if m.get("from") not in ("buyer", "arena")]
                # a structured clause it adds on its own is a demand at once; a changed plain number (payment days,
                # months) is ordinary counter-offering, so it must be kept for two offers in a row
                need_n = 1 if isinstance(v, dict) else 2
                introduced = (len(sup_offers) >= need_n + 1 and sup_offers[0].get(f) != v
                              and all(o.get(f) == v for o in sup_offers[-need_n:]))
                if not (said or introduced):
                    continue
                if any(((m.get("term_sheets") or [{}])[0].get("terms") or {}).get(f) == v or
                       any(s3.get("terms", {}).get(f) == v for s3 in m.get("term_sheets") or [])
                       for m in t.events if m.get("from") == "buyer"):
                    continue  # an echo of our own proposal is not its condition (sandbox D02: "DAP as you requested")
                family = ([o for o in opts[f] if isinstance(o, dict) and o.get("series") == v.get("series")]
                          if isinstance(v, dict) else [v])
                def _full(g):
                    return (g.get("volume_per_year") or self.b["need_per_year"]) >= self.b["need_per_year"] and (
                        g.get("contract_months") is None or g["contract_months"] >= 12 * self.b["horizon_years"])
                base = next((g for g in grid if _full(g)), grid[0] if grid else {})
                price = offered.get("unit_price") or 1.0
                ok = []
                for o in family:
                    cand = complete_offer(self.case, {**base, f: o, "unit_price": price})
                    full = (cand.get("volume_per_year") or self.b["need_per_year"]) >= self.b["need_per_year"] and (
                        cand.get("contract_months") is None or cand["contract_months"] >= 12 * self.b["horizon_years"])
                    if must_haves_ok(self.case, cand, t.std) and full:
                        ok.append((self.C(t, cand), o))
                if ok:
                    ok.sort(key=lambda z: z[0])
                    t.required[f] = [ok[0][1]]
                    self.note("required_term", supplier=t.sid, field=f, theirs=v, ours=ok[0][1])
            for f, allowed in t.required.items():
                grid = [g for g in grid if g.get(f) in allowed] or grid
        months = self.case.get("term_options", {}).get("contract_months")
        if self.cfg.long_contract and months and "contract_months" in self.case["negotiable"]:
            longest = max(months)  # beyond the horizon it costs nothing; suppliers value the security
            if longest >= 12 * self.b["horizon_years"]:
                grid = [g for g in grid if g.get("contract_months") == longest] or grid
        their_price = offered.get("unit_price")
        their_c = self.C(t, offered) if offered.get("unit_price") is not None else float("inf")
        priced = []
        for g in grid:
            p = price_for_c(self.case, g, t.std, c_goal, t.est if self.relationship else None)
            terms = complete_offer(self.case, {**g, "unit_price": p})
            c = self.C(t, terms)
            if p <= 0.5 or (abs(c - c_goal) > max(tol, 0.01 * c_goal) and c < c_goal):
                continue
            # guard (teammates' P02 zero): never offer a higher price than the supplier itself asks - cap at its price
            # (still a better package for us: P10) - and never a package that costs us more than its standing offer
            capped = False
            if their_price is not None and p > their_price:
                terms = complete_offer(self.case, {**g, "unit_price": their_price})
                p, c, capped = their_price, self.C(t, terms), True
            if c >= their_c:
                continue
            near = sum(terms.get(k) != offered.get(k) for k in terms if k != "unit_price" and k in offered)
            terms["_capped"] = capped
            sv = supplier_value(self.case, {k: v for k, v in terms.items() if k != "_capped"}, t.est)
            if self.cfg.penalty_aversion:  # suppliers price penalty clauses far above their expected cost (P11)
                sv -= self.cfg.penalty_aversion * (terms.get("chargeback_eur_per_complaint") or 0) * (terms.get("ppm_commitment") or 0) / 1e6
            priced.append((sv, near, terms, c))
        everything = list(priced)
        hits = [x for x in priced if abs(x[3] - c_goal) <= tol or x[2].get("_capped")]
        # full coverage first (P10): a package covering the whole need over the horizon beats a partial one
        def full(x):
            tt = x[2]
            vol_ok = (tt.get("volume_per_year") or self.b["need_per_year"]) >= self.b["need_per_year"]
            months = tt.get("contract_months", self.case.get("fixed_terms", {}).get("contract_months"))
            return vol_ok and (months is None or months >= 12 * self.b["horizon_years"])
        if any(full(x) for x in hits):
            hits = [x for x in hits if full(x)]
        if not hits and priced:
            # the goal is out of reach (e.g. below what the supplier-health term allows): offer the
            # packages closest to it, i.e. the cheapest ones for us, each at its cheapest price
            lowest = min(x[3] for x in priced)
            hits = [x for x in priced if x[3] <= lowest * 1.005]
        priced = [(x[0], x[1], {k: v for k, v in x[2].items() if k != "_capped"}) for x in hits]
        everything = [(x[0], x[1], {k: v for k, v in x[2].items() if k != "_capped"}, x[3]) for x in everything]
        if not priced:
            return []
        if self.cfg.pick == "near":
            priced.sort(key=lambda x: (x[1], -x[0]))
        else:
            priced.sort(key=lambda x: -x[0])
        picks = [priced[0][2]]
        for _, _, terms in priced[1:]:
            if len(picks) >= self.cfg.meso_n:
                break
            if self.cfg.pick == "near" or all(sum(terms.get(k) != q.get(k) for k in terms if k != "unit_price") >= 2 for q in picks):
                picks.append(terms)
        for _, _, terms in priced[1:]:
            if len(picks) >= self.cfg.meso_n:
                break
            if terms not in picks:
                picks.append(terms)
        if (self.cfg.clause_pay_best and self.relationship and "index_clause" in self.case["negotiable"]
                and "payment_days" in self.case["negotiable"]):
            # a clause package keeps its clause but goes out at the payment term and price where it costs us least
            # (P02: Nordmark agreed at once to every clause package, all at 60 days at the round's goal; on the arena's
            # bill the 90-day clause package at its cheapest price scores about 0.76 against 0.65-0.71)
            est, std = t.est, t.std
            if self.cfg.clause_pay_rate:
                # the arena's supplier-health charge fits P02's 24 deals exactly with the supplier's OPENING payment
                # term as its standard (30 days) and a 6.6 % cost of money; the quote PDF lists no standard payment
                # term, so the engine fell back to our 60-day reference and priced the package EUR 2.3 too low
                first = ((t.events[0].get("term_sheets") or [{}])[0].get("terms") or {}) if t.events else {}
                if first.get("payment_days") is not None:
                    std = {**std, "payment_days": first["payment_days"]}
                    est = {**est, "standard": {**est.get("standard", {}), "payment_days": first["payment_days"]}}
                if (est.get("interest_rate") or 1.0) < self.cfg.clause_pay_rate:
                    est = {**est, "interest_rate": self.cfg.clause_pay_rate}
            for i, pk in enumerate(picks):
                if not pk.get("index_clause"):
                    continue
                cands = []
                for g in grid:
                    if g.get("index_clause") != pk["index_clause"] or any(
                            g.get(k) != pk.get(k) for k in g if k not in ("payment_days", "unit_price")):
                        continue
                    p = price_for_c(self.case, g, std, 0.0, est)  # target 0 is out of reach: its cheapest price
                    if their_price is not None and p > their_price:
                        p = their_price
                    terms = complete_offer(self.case, {**g, "unit_price": p})
                    cands.append((total_cost(self.case, terms, std, est), terms))
                if cands:
                    c_best, best_terms = min(cands, key=lambda z: z[0])
                    if (best_terms.get("payment_days"), best_terms.get("unit_price")) != (pk.get("payment_days"), pk.get("unit_price")) \
                            and c_best < total_cost(self.case, pk, std, est) and self.C(t, best_terms) < their_c:
                        self.note("clause_pay", supplier=t.sid, was=pk.get("payment_days"), now=best_terms.get("payment_days"),
                                  price=best_terms.get("unit_price"))
                        picks[i] = best_terms
        if self.cfg.theirs_sheet and offered and len(priced) > 1 and not (self.cfg.theirs_rfq_only and len(self.threads) < 2):
            # one package on the supplier's own levers (its standing + standard terms, clamped to our must-haves):
            # cheap gives for us can be dear to it (D02: 42 instead of 35 days' lead costs us EUR 0.09/unit, while
            # C1 wrote that the shorter lead time "increases our operational costs")
            own = {**t.std, **offered}

            def dist(terms):
                d = 0.0
                for k, v in terms.items():
                    if k == "unit_price" or own.get(k) is None or v is None:
                        continue
                    if isinstance(v, (int, float)) and isinstance(own[k], (int, float)):
                        d += abs(v - own[k]) / max(abs(own[k]), 1)
                    else:
                        d += v != own[k]
                return d

            theirs = min((x[2] for x in priced), key=dist)
            if theirs not in picks:
                if len(picks) >= self.cfg.meso_n:
                    picks[-1] = theirs
                else:
                    picks.append(theirs)
                self.note("theirs_sheet", supplier=t.sid, terms=theirs)
        if self.cfg.meet_fields and offered and not self.cfg.meet_cheapest:  # meet_cheapest supersedes this rule
            # practice P08/P18: the supplier insisted on its index clause and we never offered one back
            ours = [s2["terms"] for m in t.events if m.get("from") == "buyer" for s2 in m.get("term_sheets") or []]
            theirs = [(m.get("term_sheets") or [{}])[0].get("terms", {}) for m in t.events if m.get("from") not in ("buyer", "arena")]
            order = sorted((f for f in self.case["negotiable"] if f != "unit_price"), key=lambda f: f != "index_clause")
            for f in order:  # at most one met field per message, the index clause first
                if f not in offered or offered[f] is None or any(q.get(f) == offered[f] for q in picks):
                    continue
                if f in getattr(t, "required", {}):
                    continue  # already a condition of every package, in the variant cheapest for us
                # only a term the supplier introduced itself (never in our sheets) and kept in its last two offers,
                # after it has seen at least one of ours - not an echo of our own packages (sandbox D01)
                persisted = f in getattr(t, "met", {}) and t.met[f] == offered[f]
                insisted = self.cfg.meet_insist and persisted or self.cfg.meet_insist and re.search(
                    r"mandatory|essential|require|must|not possible|cannot (offer|do)|non-negotiable|only with",
                    t.last.get("body") or "", re.I)
                if not ours or (any(o.get(f) == offered[f] for o in ours) and not persisted):
                    continue
                if not insisted and (len(theirs) < 2 or any(x.get(f) != offered[f] for x in theirs[-2:])):
                    continue
                if insisted:
                    # our best package with only this field changed, re-priced to the goal (not some other package)
                    base = {**picks[0], f: offered[f]}
                    p2 = price_for_c(self.case, base, t.std, c_goal, t.est if self.relationship else None)
                    if their_price is not None and self.cfg.meet_band:
                        # it insisted on this term: ask close to its own price (P18: 8 % below hardened it)
                        p2 = min(their_price, max(p2, round(their_price * (1 - self.cfg.meet_band), 2)))
                    cand = complete_offer(self.case, {**base, "unit_price": p2})
                    if (must_haves_ok(self.case, cand, t.std) and (their_price is None or 0.85 * their_price <= p2 <= their_price)):
                        t.met = {**getattr(t, "met", {}), f: offered[f]}  # keep meeting it in later rounds
                        if len(picks) >= self.cfg.meso_n:
                            picks[-1] = cand
                        else:
                            picks.append(cand)
                        self.note("meet_field", supplier=t.sid, field=f, value=offered[f], price=p2, why="insisted")
                        break
                cands = [x for x in everything if x[2].get(f) == offered[f]
                         and (their_price is None or x[2]["unit_price"] >= 0.85 * their_price)]  # no absurd asks
                if cands:
                    best = min(cands, key=lambda x: abs(x[3] - c_goal))[2]
                    if len(picks) >= self.cfg.meso_n:
                        picks[-1] = best
                    else:
                        picks.append(best)
                    self.note("meet_field", supplier=t.sid, field=f, value=offered[f], price=best["unit_price"])
                    break
        return picks

    def facts_for(self, t):
        """[(ref or [refs], sentence)] to drip into the e-mails; subclasses build them from data."""
        return FACTS.get(self.case_id, {}).get(t.sid, [])

    def moving(self, t):
        """Its own last two offers differ by more than a stall (or it has answered fewer than twice)."""
        own = [self.C(t, m["term_sheets"][0]["terms"]) for m in t.events
               if m.get("from") not in ("buyer", "arena") and m.get("term_sheets")]
        return len(own) < 2 or own[-2] - own[-1] > self.cfg.stall_gave * own[-1]

    def rival_for(self, t):
        """Auction: the best rival offer that beats t's own and that t has not been shown yet (a new offer ID is a
        fresh, checkable fact for it); else the best rival offer that beats t's own; else none."""
        own = self.C(t, t.sheets[0]["terms"]) if t.sheets else float("inf")
        shown = {r for m in t.events if m.get("from") == "buyer" for r in m.get("refs") or [] if r.startswith("offer:")}
        others = sorted((self.C(x, s2["terms"]), s2["term_sheet_id"], s2["terms"]) for x in self.threads.values()
                        if x is not t and x.status not in ENDED for s2 in x.sheets[:1]
                        if must_haves_ok(self.case, s2["terms"], x.std))
        better = [o for o in others if o[0] < own]
        fresh = [o for o in better if o[1] not in shown]
        pick = (fresh or better or [None])[0]
        return pick[1:] if pick else None

    def facts_left(self, t):
        """The planner's best land chance among the facts not yet sent to `t` (0 without a planner)."""
        return 0.0

    def fact_count(self, t, most):
        """How many facts this mail carries (the planner: just enough that one likely lands)."""
        return most

    def pick_facts(self, t, facts, n):
        """RFQ: a case fact counts once per case (api.md), so a shared one (should-cost, forecast, orders, an index,
        news, a quote) goes only to the supplier whose standing offer is best for us now, and never twice; a
        supplier's own facts (its scorecard) go to it. Practice P05: the index pair cited to the second supplier
        came back "duplicate"; sandbox D02: the should-cost spent on the staggered lead came back from the winner
        as "already taken that data into account"."""
        best = self.best_standing()
        leader = best[1] if best else None
        spent = self.__dict__.setdefault("spent", set())
        used = t.__dict__.setdefault("used_facts", set())
        out = []
        for ref, text in facts:
            ids = ref if isinstance(ref, list) else [ref]
            shared = any(i.startswith(SHARED) for i in ids)
            other_sc = any(i.startswith("sc:") and i.split("@")[0] != "sc:" + t.sid.split(":")[-1] for i in ids)
            if tuple(ids) in used or other_sc or (shared and (t is not leader or any(i in spent for i in ids))):
                continue
            out.append((ref, text))
            used.add(tuple(ids))
            if shared:
                spent.update(ids)
            if len(out) >= n:
                break
        return out

    # ---------- wording ----------
    def our_calculation(self, t):
        """Our calculation from this supplier's own cost breakdown (never another supplier's figures)."""
        txt = " ".join(a.get("text") or "" for m in t.events for a in m.get("attachments") or [])
        if bd := BREAKDOWN.search(txt):
            mat, wag, conv = (float(x) for x in bd.groups())
            direct = mat + wag + conv
            return (f"# Our calculation for {self.case['parts'][0]}\n\n| Element | EUR per unit |\n|---|---|\n"
                    f"| Material (bar) | {mat:.2f} |\n| Wages | {wag:.2f} |\n| Conversion | {conv:.2f} |\n"
                    f"| Direct cost | {direct:.2f} |\n| + 8 % overhead and margin | {direct * 0.08:.2f} |\n"
                    f"| **Fair price** | **{direct * 1.08:.2f}** |\n\nFor a 24-month award of "
                    f"{self.b['need_per_year']:,} pieces a year paid in 14 days.\n")
        return None

    def write(self, t, rnd, sheets, rival=None):
        cfg, warm = self.cfg, self.cfg.tone == "warm"
        facts = self.facts_for(t)
        n_facts = cfg.facts if rnd == 0 or not cfg.facts_later else cfg.facts_later
        if cfg.plan_facts:
            n_facts = self.fact_count(t, cfg.plan_first if rnd == 0 else cfg.plan_later)
        if cfg.allocate_facts and len(self.threads) > 1:
            new = self.pick_facts(t, facts, n_facts)
        else:
            new = facts[t.facts_used:t.facts_used + n_facts]
            t.facts_used += len(new)
        refs = [r for f in new for r in (f[0] if isinstance(f[0], list) else [f[0]])]
        lines = ["Hello,", ""]
        if rnd == 0:
            if self.case.get("type") == "price_increase":
                lines.append("Thank you for your letter and the quote. Energy and wage costs have clearly been a strain for a foundry "
                             "this year, and after many years together we want you healthy and on our side." if warm
                             else "Thank you for your letter and the quote.")
            else:
                lines.append("Thank you for your quote. We'd like to award this part to a partner for the full 24 months." if warm
                             else "Thank you for your quote.")
        elif warm:
            moved = t.moves[-1] if t.moves else {}
            lines.append("Thank you for moving on " + " and ".join(sorted({WORDS.get(k, k) for k in moved})) + ". That helps."
                         if moved else "Thank you for the quick answer.")
        asked = t.last.get("body") or "" if rnd else ""
        if cfg.say_fixed and asked:
            fixed = self.case.get("fixed_terms", {})
            told = [f for f, pat in FIXED_WORDS.items() if f in fixed and f not in self.case["negotiable"]
                    and fixed[f] is not None and re.search(pat, asked, re.I) and not (f == "volume_per_year" and cfg.volume)]
            if told:
                lines.append("Please note: " + "; ".join(f"{WORDS.get(f, f)} is fixed in this enquiry at {fixed[f]}" for f in told)
                             + ". The term sheet covers everything we can still move.")
        if cfg.volume_framing and (rnd == 0 or re.search(r"volume|batch|lot", asked, re.I)) and not getattr(t, "framed", 0) >= 2:
            t.framed = getattr(t, "framed", 0) + 1
            months = self.case.get("fixed_terms", {}).get("contract_months") or 12 * self.b["horizon_years"]
            lines.append(f"We can commit to {self.b['need_per_year']:,} pieces a year over {months:.0f} months; our planning baseline "
                         f"is {self.b['need_per_year'] / 12:,.0f} per month, in predictable call-offs.")
            if rnd == 0:
                lines.append("If a larger binding lot would change the price, please quote us the exact trade-off.")
            lead = max((s2.get("lead_time_days") or 0) for s2 in sheets) if sheets else 0
            if lead and re.search(r"overtime|premium", " ".join(m.get("body") or "" for m in t.events if m.get("from") != "buyer"), re.I):
                lines.append(f"A {lead}-day lead time lets you plan production without overtime.")
        if cfg.breakdown_arg and not getattr(t, "breakdown_cited", False):
            txt = " ".join(a.get("text") or "" for m in t.events for a in m.get("attachments") or [])
            if bd := BREAKDOWN.search(txt):
                mat, wag, conv = (float(x) for x in bd.groups())
                t.breakdown_cited = True
                months = self.case.get("fixed_terms", {}).get("contract_months") or 12 * self.b["horizon_years"]
                lines.append(f"Your own cost breakdown shows €{mat:.2f} material, €{wag:.2f} labour and €{conv:.2f} conversion, "
                             f"i.e. €{mat + wag + conv:.2f} direct cost. A {months:.0f}-month award with quick payment still leaves "
                             "you a positive margin at the prices we propose.")
        if cfg.volume and re.search(r"volume", asked, re.I) and not cfg.volume_framing:
            months = self.case.get("fixed_terms", {}).get("contract_months") or 24
            lines.append(f"On volume: we commit bindingly to {self.b['need_per_year']:,} pieces a year for {months} months. "
                         "That is our entire need for this part, all of it with you; we cannot honestly promise more.")
        for f in new:
            lines.append(f[1][0].upper() + f[1][1:] + ".")
        attachments = []
        if rival:
            rid, rterms = rival
            refs.append(rid)
            lines.append(f"For transparency: another supplier's standing offer ({rid}) is {fmt(rterms)}; I attach it."
                         + (" We'd prefer to give the order to you." if warm else ""))
            attachments.append(("competing-offer.md", f"# Competing offer {rid} (standing terms)\n\n{fmt(rterms)}\n"))
        if cfg.calc and re.search(r"calculation|which figures|send us the data", asked, re.I) and (calc := self.our_calculation(t)):
            lines.append("You asked for our calculation: it is attached, built from the cost breakdown we received.")
            attachments.append(("our-calculation.md", calc))
        if len(sheets) > 1:
            lines.append(f"We put together {len(sheets)} packages; each works equally well for us, so pick the one that suits you best.")
        else:
            lines.append("Our proposal is attached as a term sheet.")
        if rnd == 0:
            lines.append("Could you also send us your cost breakdown, so we can see which costs really moved?")
        elif warm:
            lines.append("What would you need from us to get closer to these numbers?" if rnd == 1
                         else "How could we close the remaining gap today?")
        msg = {"subject": self.case["title"], "body": "\n".join(lines + SIGN), "refs": refs,
               "term_sheets": [{"terms": s} for s in sheets]}
        if attachments:
            msg["attachments"] = [{"name": n, "type": "md", "content_b64": base64.b64encode(c.encode()).decode()}
                                  for n, c in attachments]
        return msg

    # ---------- the loop ----------
    def send(self, t, msg):
        prev = t.sheets[0]["terms"] if t.sheets else {}
        t0 = time.time()
        try:
            r = self.c.send_message(self.sid, t.sid, msg)
        except ArenaError as e:
            self.note("error", supplier=t.sid, status=e.status, detail=str(e.detail)[:300])
            if e.status == 409:
                self.resync(t)
            return None
        if "result" in r and "status" not in r:
            return r
        self._docs([r])
        t.replied_at = time.time()
        self.slowest = max(self.slowest, t.replied_at - t0)
        t.events += [{**msg, "from": "buyer"}, r]
        new = (r.get("term_sheets") or [{}])[0].get("terms", {})
        t.moves.append({k: (prev.get(k), new.get(k)) for k in new if prev.get(k) != new.get(k)})
        self.note("reply", supplier=t.sid, status=r.get("status"), claims=r.get("claim_results"),
                  sheets=[(s["term_sheet_id"], s["terms"], round(self.C(t, s["terms"]))) for s in r.get("term_sheets") or []],
                  moved=t.moves[-1], body=(r.get("body") or "")[:600])
        return r

    def push(self, t, sh):
        """A small ask below its standing price, same terms, before we accept."""
        t.pushes += 1
        ask = complete_offer(self.case, {**sh["terms"], "unit_price": round(sh["terms"]["unit_price"] * (1 - self.cfg.push_pct), 2)})
        self.note("push", supplier=t.sid, n=t.pushes, ask=ask, c=round(self.C(t, ask)))
        return self.send(t, {"subject": self.case["title"], "term_sheets": [{"terms": ask}], "refs": [],
                             "body": "\n".join(["Hello,", "", "thank you, we are very close and I would like to close this with you today. "
                                                f"On exactly your terms, can you do €{ask['unit_price']:.2f}? If yes, we sign immediately."] + SIGN)})

    def close(self, t, sheet):
        # only the supplier's first (primary) sheet is its standing offer; an alternative ("-a")
        # has to be sent back as our terms first - the supplier then answers "agreed"
        if t.sheets and sheet["term_sheet_id"] != t.sheets[0]["term_sheet_id"]:
            self.note("mirror_alternative", supplier=t.sid, sheet=sheet)
            r = self.send(t, {"subject": self.case["title"], "term_sheets": [{"terms": sheet["terms"]}], "refs": [],
                              "body": "\n".join(["Hello,", "", "thank you, we take your alternative exactly as offered: "
                                                 f"{fmt(sheet['terms'])}. Please confirm and we sign today."] + SIGN)})
            if not r or not t.sheets:
                return self.walk()
            sheet = t.sheets[0]
        try:
            r = self.c.send_message(self.sid, t.sid, {"action": {"type": "accept", "term_sheet_id": sheet["term_sheet_id"]}})
        except ArenaError as e:
            # P05: late on the arena's clock (our accept counted as a timeout) -> its standing sheet changed. Read the
            # thread and accept what stands now, if it still beats our alternative and keeps the must-haves.
            self.note("accept_retry", supplier=t.sid, error=str(e.detail)[:200])
            self.resync(t)
            if t.status in ENDED or not t.sheets:
                raise
            sheet = t.sheets[0]
            if not must_haves_ok(self.case, sheet["terms"], t.std) or self.C(t, sheet["terms"]) > self.c_alt:
                raise
            r = self.c.send_message(self.sid, t.sid, {"action": {"type": "accept", "term_sheet_id": sheet["term_sheet_id"]}})
        res = r.get("result", r)
        self.note("result", **{k: res.get(k) for k in ("deal", "supplier_id", "terms", "c_open", "c_deal", "c_best", "score", "cost_breakdown")})
        return res

    def walk(self):
        live = [t for t in self.threads.values() if t.status not in ENDED] or list(self.threads.values())
        r = self.c.send_message(self.sid, live[0].sid, {"action": {"type": "walk_away"}})
        res = r.get("result", r)
        self.note("result", **{k: res.get(k) for k in ("deal", "c_open", "c_deal", "c_best", "score")})
        return res

    def near_cap(self):
        """The kit's closing rule: act max(90 s, slowest round + 15 s) before the wave's cap."""
        return self.deadline is not None and time.time() > self.deadline - max(90, self.slowest + 15)

    def closing_move(self):
        best = self.best_standing()
        self.note("cap_close", best=round(best[0]) if best else None)
        if best and best[0] <= self.c_alt:
            return self.close(best[1], best[2])
        return self.walk()

    def resync(self, t):
        """After a 409: read the thread from the arena (timeouts, a walk-away, the session's end)."""
        try:
            th = self.c.thread(self.sid, t.sid)
        except ArenaError:
            t.events.append({"from": "arena", "status": "walked_away", "term_sheets": []})
            return
        msgs = th.get("messages") or t.events
        self._docs(msgs)
        t.events = list(msgs)
        if th.get("closed"):
            t.events.append({"from": "arena", "status": "walked_away", "term_sheets": []})
        self.note("resync", supplier=t.sid, closed=th.get("closed"), status=t.status)

    def run_rfq(self):
        """Several suppliers: one worker per thread, each answering its supplier at once (the
        60-second clock runs per thread). Shared goal, best offer and acceptance under a lock."""
        import threading

        cfg, limit = self.cfg, self.case.get("round_limit", 10)
        lock, state = threading.RLock(), {"done": None, "prev_c": None, "holds": 0, "estimated": False}
        # a resting final offer is ours to lose: its 60-second clock runs from its reply, and under load a reply
        # reaches us 20-50 s after that. It waits only while a rival's reply is in flight, FINAL_GRACE_S at most
        # (sandbox D02 095febf129ec15fd: a €13.90 final offer lost while we rested 37 s for the rival; bug #9)

        def finish(kind, t=None, sh=None):
            if state["done"] is None:
                try:
                    state["done"] = self.close(t, sh) if kind == "close" else self.walk()
                except ArenaError as e:  # e.g. that thread ended meanwhile: take the next best or walk
                    self.note("close_failed", error=str(e.detail)[:200])
                    try:
                        if t is not None:
                            self.resync(t)
                        nb = self.best_standing()
                        state["done"] = self.close(nb[1], nb[2]) if nb and nb[0] <= self.c_alt else self.walk()
                    except (ArenaError, AttributeError) as e2:
                        self.note("close_failed_2", error=str(e2)[:200])
                        st = self.c.session(self.sid)
                        if st.get("status") != "ended":  # still live: try every acceptable standing sheet, best first
                            for x in self.threads.values():
                                self.resync(x)
                            cands = sorted(((self.C(x, x.sheets[0]["terms"]), x) for x in self.threads.values()
                                            if x.status not in ENDED and x.sheets and must_haves_ok(self.case, x.sheets[0]["terms"], x.std)),
                                           key=lambda z: z[0])
                            for c3, x in cands:
                                if c3 > self.c_alt:
                                    break
                                try:
                                    r3 = self.c.send_message(self.sid, x.sid, {"action": {"type": "accept", "term_sheet_id": x.sheets[0]["term_sheet_id"]}})
                                    state["done"] = r3.get("result", r3)
                                    self.note("result", **{k: state["done"].get(k) for k in ("deal", "supplier_id", "c_deal", "c_best", "score")})
                                    return
                                except ArenaError:
                                    continue
                            st = self.c.session(self.sid)
                        state["done"] = st.get("result") or {"deal": False, "score": 0.0, "end_reason": st.get("end_reason")}

        def decide(t):
            """Under the lock: ('close'|'walk'|'send'|'wait'|'stop', payload)."""
            live = [x for x in self.threads.values() if x.status not in ENDED]
            best = self.best_standing()
            if not live or self.near_cap():
                if self.near_cap():
                    self.note("cap_close", best=round(best[0]) if best else None)
                return ("close", best[1:]) if best and best[0] <= self.c_alt else ("walk", None)
            rnd = t.rounds  # every thread keeps its own clock (a fast supplier may be negotiated further)
            goal, next_goal = self.goal(rnd), self.goal(rnd + 1)
            untouched = any(x.sent() < 1 and x.status not in ENDED for x in live) and time.time() - t_start < 90
            hold_close = bool(best) and best[1].status == "open" and (untouched or best[1].in_flight or (  # its offer may change,
                any(x.in_flight for x in live if x is not best[1]) and time.time() - best[1].replied_at < 20))  # or a rival's beat it
            # (an agreed or final offer is never held: under load its 60 s may already be running out - P05)
            if best and best[0] <= self.c_alt and not hold_close:
                # (closing waits while another supplier's reply is on its way - it may be better: sandbox D02 0.269;
                #  the threads themselves keep negotiating below)
                c, bt, sh = best
                open_rivals = [x for x in live if x is not bt and x.status == "open"]
                first = state["prev_c"] is None
                gave = (state["prev_c"] - c) if state["prev_c"] is not None else 0
                state["prev_c"] = c
                # a stall is the best supplier's OWN last two offers (the best across bidders does not move when a
                # rival replies - judging that as a stall accepted sandbox D02 after three mails)
                own = [self.C(bt, m["term_sheets"][0]["terms"]) for m in bt.events
                       if m.get("from") not in ("buyer", "arena") and m.get("term_sheets")]
                stalled = len(own) >= 2 and own[-2] - own[-1] <= cfg.stall_gave * own[-1]
                auction = cfg.auction_rfq and any(self.moving(x) and x.sent() < limit - 2 for x in open_rivals)
                more = cfg.plan_facts and self.facts_left(bt) >= cfg.plan_hold and not stalled
                if (((state["holds"] < cfg.holds and gave > cfg.hold_gave * c) or auction or more) and c <= next_goal
                        and bt.status == "open" and bt.sent() < limit - 2):
                    state["holds"] += 1
                    self.note("hold", c=c, gave=round(gave), goal=round(goal), auction=auction, facts=more)
                    t.rounds -= cfg.hold_back
                    goal = self.goal(t.rounds)
                elif (cfg.rfq_bar and bt.status == "agreed" and open_rivals and not state.get("bar")
                      and time.time() - bt.replied_at < 40):
                    state["bar"] = bt.sid  # teammates' P05 lesson: an early agreement is the bar for the rivals
                    self.note("bar", supplier=bt.sid, c=c)
                elif cfg.patient and bt.status == "open" and not stalled and bt.sent() < limit - 2:
                    goal = min(goal, c * (1 - cfg.patient_gap))  # still moving: ask a little below it, with a new fact
                    self.note("patient", supplier=bt.sid, c=c, gave=round(gave), goal=round(goal))
                elif c <= next_goal or bt.status == "agreed" or (cfg.patient and stalled):
                    if not (cfg.rfq_bar and state.get("bar") and open_rivals and time.time() - bt.replied_at < 50):
                        self.note("accept", why="goal" if c <= next_goal else "agreed" if bt.status == "agreed" else "stalled",
                                  c=c, goal=next_goal)
                        return ("close", (bt, sh))
                idle = time.time() - bt.replied_at
                rival_pending = any(x.in_flight for x in open_rivals)
                if bt.status == "final_offer" and (not open_rivals or not rival_pending or idle > FINAL_GRACE_S):
                    allowed = cfg.push == "all" or (cfg.push == "rfq" and len(live) > 1)
                    if allowed and bt.pushes < cfg.pushes and bt.sent() < limit - 1:
                        return ("push", (bt, sh))
                    self.note("accept", why="final_offer" + (" (idle)" if open_rivals else ""), c=c)
                    return ("close", (bt, sh))
                if all(x.sent() >= limit - 1 or x.rounds >= cfg.max_rounds for x in live):
                    self.note("accept", why="out of rounds: best seen", c=c)
                    return ("close", (bt, sh))
            if t.status in ENDED:
                return ("stop", None)
            if t.status == "agreed":
                return ("wait", None)  # never push an agreement: it is the bar (or about to be accepted)
            if (cfg.rfq_hold and t.status == "final_offer" and not t.pushes and not getattr(t, "held_mail", False)
                    and time.time() - t.replied_at > 35 and t.sent() < limit - 2):
                t.held_mail = True  # keep its clock alive while the rivals still move
                return ("send", {"subject": self.case["title"], "refs": [], "body": "\n".join(
                    ["Hello,", "", "thank you for your offer. We are completing our evaluation and will come back to you "
                     "very shortly with our decision."] + SIGN)})
            if t.status == "final_offer" or t.rounds >= cfg.max_rounds or t.sent() >= limit - 1:
                if best is None and all(x.status == "final_offer" or x.rounds >= cfg.max_rounds for x in live):
                    return ("walk", None)
                return ("wait", None)
            sheets = self.recalled(t) or self.meso(t, goal)
            if not sheets:
                return ("wait", None)
            others = [(self.C(x, s2["terms"]), s2["term_sheet_id"], s2["terms"]) for x in self.threads.values()
                      if x is not t and x.status not in ENDED for s2 in x.sheets if must_haves_ok(self.case, s2["terms"], x.std)]
            rival = min(others, key=lambda o: o[0])[1:] if cfg.rival and others and (t.rounds >= 1 or getattr(t, "staggered", False)) else None
            if cfg.auction_rfq and rival is not None:
                rival = self.rival_for(t)
            msg = self.write(t, t.rounds, sheets, rival)
            self.note("send", supplier=t.sid, rnd=t.rounds, goal=round(goal), sheets=[(s2, round(self.C(t, s2))) for s2 in sheets],
                      refs=msg["refs"], attachments=[a["name"] for a in msg.get("attachments", [])], body=msg["body"])
            t.rounds += 1
            return ("send", msg)

        def _send_or_wait(t, goal, rnd):
            """t is a different, open thread: it may keep negotiating while we wait for the pending reply."""
            if t.rounds >= cfg.max_rounds or t.sent() >= limit - 1:
                return ("wait", None)
            sheets = self.meso(t, goal)
            if not sheets:
                return ("wait", None)
            others = [(self.C(x, s2["terms"]), s2["term_sheet_id"], s2["terms"]) for x in self.threads.values()
                      if x is not t and x.status not in ENDED for s2 in x.sheets if must_haves_ok(self.case, s2["terms"], x.std)]
            rival = min(others, key=lambda o: o[0])[1:] if cfg.rival and others and (t.rounds >= 1 or getattr(t, "staggered", False)) else None
            if cfg.auction_rfq and rival is not None:
                rival = self.rival_for(t)
            msg = self.write(t, t.rounds, sheets, rival)
            self.note("send", supplier=t.sid, rnd=t.rounds, goal=round(goal), sheets=[(s2, round(self.C(t, s2))) for s2 in sheets],
                      refs=msg["refs"], attachments=[a["name"] for a in msg.get("attachments", [])], body=msg["body"])
            t.rounds += 1
            return ("send", msg)

        lead = None
        if cfg.rfq_stagger and len(self.threads) > 1:
            # the friend's D02 move: talk to the cheapest quote first; open the others citing its fresh answer
            # the cheapest quote that keeps our must-haves (P05: the cheapest opened at a 52-day lead against a 42-day
            # must-have; its price is no bar for the others)
            lead = min((x for x in self.threads.values() if x.sheets and must_haves_ok(self.case, x.sheets[0]["terms"], x.std)),
                       key=lambda x: x.sheets[0]["terms"]["unit_price"], default=None)
            if lead is None:
                lead = min((x for x in self.threads.values() if x.sheets), key=lambda x: x.sheets[0]["terms"]["unit_price"], default=None)
            for x in self.threads.values():
                x.staggered = x is not lead
            self.note("stagger", lead=lead.sid if lead else None)
        t_start = time.time()

        def worker(t):
            if lead is not None and t is not lead:
                while lead.sent() < 1 and time.time() - t_start < 40:
                    time.sleep(0.5)  # wait for the lead's FIRST reply only (max 40 s: the others' clocks are running)
            while True:
                if lead is not None and t is lead and t.sent() >= 1 and time.time() - t_start < 60 and any(
                        x.sent() < 1 and x.status not in ENDED for x in self.threads.values() if x is not t):
                    time.sleep(0.5)  # the lead pauses after round 0 until every other supplier has its first message
                    continue
                with lock:
                    if state["done"] is not None:
                        return
                    kind, payload = decide(t)
                    if kind in ("close", "walk"):
                        finish(kind, *(payload or (None, None)))
                        return
                    if kind == "push":
                        self.push(*payload)  # replies come back inside the lock: the case is closing anyway
                        continue
                if kind == "stop":
                    return
                if kind == "wait":
                    time.sleep(2)
                    continue
                with lock:
                    t.in_flight = True
                r = self.send(t, payload)  # outside the lock: other threads keep their own clocks
                with lock:
                    t.in_flight = False
                with lock:
                    if r is not None and not state["estimated"] and all(x.sent() >= 1 or x.status in ENDED for x in self.threads.values()):
                        state["estimated"] = True
                        self._estimate()  # round-1 documents (cost breakdowns) sharpen the target

        with ThreadPoolExecutor(len(self.threads)) as ex:
            list(ex.map(worker, list(self.threads.values())))
        if state["done"] is None:
            best = self.best_standing()
            finish("close", best[1], best[2]) if best and best[0] <= self.c_alt else finish("walk")
        return state["done"]

    def run(self):
        if len(self.threads) > 1:
            return self.run_rfq()
        cfg, limit = self.cfg, self.case.get("round_limit", 10)
        rnd, prev_c, holds = 0, None, 0
        last_goal = None  # C of our last ask (the planner never asks for more than last time)
        while True:
            if self.near_cap():
                return self.closing_move()
            best = self.best_standing()
            live = [t for t in self.threads.values() if t.status not in ENDED]
            if not live:
                return self.walk() if best is None else self.close(best[1], best[2])
            goal, next_goal = self.goal(rnd), self.goal(rnd + 1)
            if best and best[0] <= self.c_alt:
                c, t, sh = best
                open_rivals = [x for x in live if x is not t and x.status == "open"]
                first = prev_c is None
                gave = (prev_c - c) if prev_c is not None else 0
                prev_c = c
                stalled = not first and gave <= cfg.stall_gave * c
                more = (cfg.plan_facts and not (stalled and getattr(t, "stalled_before", False))
                        and self.facts_left(t) >= cfg.plan_hold)
                t.stalled_before = stalled
                if ((holds < cfg.holds and gave > cfg.hold_gave * c) or more) and c <= next_goal and t.status == "open" \
                        and t.sent() < limit - 2:
                    if cfg.plan_facts and last_goal is not None and c <= last_goal * 1.0001:
                        self.note("accept", why="meets our last ask", c=c, goal=last_goal)
                        return self.close(t, sh)
                    holds += 1  # it is still moving: one more round at our current goal before we take it
                    if cfg.plan_facts and last_goal is not None:
                        # a visible step toward it, never the same ask (Tugra's A10, P08: a 4th mail at an unchanged
                        # goal drew "we are withdrawing from this negotiation" - a zero without an alternative)
                        goal = max(goal, last_goal + 0.25 * (c - last_goal))
                    self.note("hold", c=c, gave=round(gave), goal=round(goal), facts=more)
                    rnd -= cfg.hold_back if not more else min(cfg.hold_back, 0.75)  # facts left: a small move too
                elif cfg.patient and t.status == "open" and not stalled and t.sent() < limit - 2:
                    # it is open and still moving: ask again, a little below its offer (it may agree), with a new fact
                    goal = min(goal, c * (1 - cfg.patient_gap))
                    self.note("patient", c=c, gave=round(gave), goal=round(goal))
                elif c <= next_goal or t.status == "agreed" or (cfg.patient and stalled):
                    self.note("accept", why="goal" if c <= next_goal else "agreed" if t.status == "agreed" else "stalled",
                              c=c, goal=next_goal)
                    return self.close(t, sh)
                if t.status == "final_offer" and not open_rivals:
                    backup = [x for x in live if x is not t and x.sheets]
                    allowed = cfg.push == "all" or (cfg.push == "rfq" and backup)
                    if allowed and t.pushes < cfg.pushes and t.sent() < limit - 1:
                        self.push(t, sh)
                        continue
                    self.note("accept", why="final_offer", c=c)
                    return self.close(t, sh)
                if rnd >= cfg.max_rounds or all(x.sent() >= limit - 1 for x in live):
                    self.note("accept", why="out of rounds: best seen", c=c)
                    return self.close(t, sh)
            elif rnd >= cfg.max_rounds:
                return self.walk()
            if cfg.plan_facts and last_goal is not None:
                goal = max(goal, last_goal)  # never ask for more than last time
            last_goal = goal
            self.note("round", rnd=rnd, c_target=round(self.target_c), goal=round(goal),
                      reserve=round(best[0]) if best else None)
            jobs = []
            for t in live:
                if t.status == "final_offer":
                    continue  # rests while a rival is still open
                sheets = self.recalled(t) or self.meso(t, goal)
                if not sheets:
                    continue
                others = [(self.C(x, sh["terms"]), sh["term_sheet_id"], sh["terms"]) for x in self.threads.values()
                          if x is not t and x.status not in ENDED for sh in x.sheets if must_haves_ok(self.case, sh["terms"], x.std)]
                rival = min(others, key=lambda o: o[0])[1:] if cfg.rival and others and rnd >= 1 else None
                msg = self.write(t, rnd, sheets, rival)
                self.note("send", supplier=t.sid, sheets=[(s, round(self.C(t, s))) for s in sheets], refs=msg["refs"],
                          attachments=[a["name"] for a in msg.get("attachments", [])], body=msg["body"])
                jobs.append((t, msg))
            if not jobs and cfg.never_walk and self.c_alt == float("inf") and rnd < cfg.max_rounds:
                for t in live:
                    if t.status != "final_offer" and (counter := self.fallback_counter(t)):
                        self.note("fallback_counter", supplier=t.sid, sheet=counter[0])
                        jobs.append((t, self.write(t, rnd, counter, None)))
            if not jobs:
                if best:
                    self.note("accept", why="no thread left to push", c=best[0])
                    return self.close(best[1], best[2])
                return self.walk()
            with ThreadPoolExecutor(len(jobs)) as ex:
                list(ex.map(lambda j: self.send(*j), jobs))
            if rnd == 0 and holds == 0:
                self._estimate()  # documents from round 1 (cost breakdowns) sharpen the target
            rnd += 1


def play(case_id, cfg=Config(), client=None, log_dir=LOG_DIR, quiet=False, deadline=None):
    """Play one case to its end; always leaves the session closed. Returns (session_id, result)."""
    client = client or ArenaClient(timeout=25, retries=7)
    n = Negotiator(client, case_id, cfg, quiet=quiet, deadline=deadline)
    Path(log_dir).mkdir(parents=True, exist_ok=True)
    with open(Path(log_dir).parent / "opened.txt", "a") as f:  # cleanup may only ever close our own sessions
        f.write(n.sid + "\n")
    res = None
    try:
        res = n.run()
    except Exception as e:  # never leave a session open: it blocks one of our 10 slots
        n.note("crash", error=repr(e)[:500])
        try:
            st = client.session(n.sid)
            if st.get("status") == "ended" and st.get("result"):  # the deal may already be done: report the arena's result
                res = st["result"]
                n.note("result_after_crash", score=res.get("score"), deal=res.get("deal"))
            else:
                res = n.walk()
        except Exception:
            res = {"score": 0.0, "error": repr(e)[:200]}
    finally:
        Path(log_dir).mkdir(parents=True, exist_ok=True)
        (Path(log_dir) / f"{case_id.replace(':', '_')}-{n.sid}.json").write_text(json.dumps(n.log, indent=1, default=str))
        with open(Path(log_dir).parent / "closed.txt", "a") as f:
            f.write(n.sid + "\n")
    return n.sid, res


if __name__ == "__main__":
    load_env()
    cfg = Config(**json.loads(os.environ.get("ENGINE_CFG", "{}")))
    with ThreadPoolExecutor(len(sys.argv[1:])) as ex:
        for case_id, (sid, res) in zip(sys.argv[1:], ex.map(lambda c: play(c, cfg), sys.argv[1:])):
            print(f"\n=== {case_id} session {sid}: score {res.get('score')} c_deal {res.get('c_deal')} c_best {res.get('c_best')}")
            print(f"replay: https://arena.tacto.ai/replay/{sid}")
