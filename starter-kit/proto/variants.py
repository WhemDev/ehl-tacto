"""Named algorithms (our search winner + the teammates' ideas) and a parallel runner.

    PYTHONPATH=. uv run python proto/variants.py --cases case:D01:1 case:D02:3 --variants A B C D
    PYTHONPATH=. uv run python proto/variants.py --practice --cases case:P05:1 --variants A D   # costs quota!

`case:D02:3` plays each variant 3 times on D02 (D02 is noisy, D01 is deterministic).
Results: proto/runs/variants/results.jsonl; summary printed per variant and case.
"""

import argparse
import os
import json
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, replace
from pathlib import Path

from arena_kit import ArenaClient, ArenaError
from arena_kit.cli import load_env

import proto.engine as eng
from proto.engine import Config

OUT = Path("proto/runs/variants")

# A: the tactic search's winner (gen 1 best mean, with 2 term sheets - best on both cases in the effect table)
A = Config(e=2.0, anchor=-0.03, hold_gave=0.005, pushes=2, push_pct=0.01, facts=2, calc=False, meso_n=2)
VARIANTS = {
    "A": ("Search best", A),
    "B": ("A + teammates' opening-based anchors", replace(A, anchor_mode="opening")),
    "C": ("A + RFQ: agreement as bar, hold e-mail", replace(A, rfq_bar=True, rfq_hold=True)),
    "D": ("A + all teammate ideas", replace(A, anchor_mode="opening", rfq_bar=True, rfq_hold=True,
                                           long_contract=True, say_fixed=True, news=True)),
    "E": ("A + say-fixed + long contract (practice levers only)", replace(A, long_contract=True, say_fixed=True)),
    # A2: fixes from practice run A (Progress/Practice-Run-A-Findings)
    "A2": ("A + practice fixes: safe push, bottleneck anchor, say-fixed, meet fields",
           replace(A, push="rfq", bottleneck_anchor=0.03, say_fixed=True, meet_fields=True)),
    # from the friend's D02 replay e843da929222686e (0.661)
    "F": ("A2 + staggered RFQ opening", replace(VARIANTS_A2 := replace(A, push="rfq", bottleneck_anchor=0.03,
          say_fixed=True, meet_fields=True), rfq_stagger=True)),
    "G": ("A2 + breakdown argument + volume framing", replace(VARIANTS_A2, breakdown_arg=True, volume_framing=True)),
    "H": ("A2 + all three friend ideas", replace(VARIANTS_A2, rfq_stagger=True, breakdown_arg=True, volume_framing=True)),
    "A3": ("Main algorithm: A2 + staggered RFQ opening (= F)", replace(VARIANTS_A2, rfq_stagger=True)),
    "A4": ("A3 + practice fixes 2: price-based bottleneck anchor, never walk, meet at first insistence, penalty aversion",
           replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                   bottleneck_anchor=0.10)),
    "A5": ("A4 + insisted terms kept every round, priced within 3 % of the supplier's price (generic P18 fix)",
           replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                   bottleneck_anchor=0.10, meet_band=0.03)),
    "A6": ("A5 + all fixes from the A5 practice run (incl. target prior and price-freeze terms)",
           replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                   bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                   price_freeze=True)),
    # D02 search (proto/runs/search_d02, 46 sandbox sessions): RFQ-only settings on top of A6
    "A7": ("A6 + D02 search winner: RFQ 1 package, anchor -8 %, 3 pushes of 3 %, 2 holds, breakdown argument, 1 fact",
           replace(VARIANTS["A6"][1] if False else replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0,
                   never_walk=True, bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True,
                   target_prior=True, price_freeze=True),
                   rfq_anchor=-0.08, rfq_holds=2, rfq_pushes=3, rfq_push_pct=0.03, rfq_meso_n=1, breakdown_arg=True, facts=1)),
    "A7b": ("A7 but 2 facts per message (as A6, keeps single-supplier play unchanged)",
            replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                    bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                    price_freeze=True, rfq_anchor=-0.08, rfq_holds=2, rfq_pushes=3, rfq_push_pct=0.03, rfq_meso_n=1,
                    breakdown_arg=True)),
    "A8": ("A6 + D02 search winner as RFQ-only settings: 1 package, 1 fact, anchor -8 %, 3 pushes of 3 %, 2 holds, breakdown argument",
           replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                   bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                   price_freeze=True, rfq_anchor=-0.08, rfq_holds=2, rfq_pushes=3, rfq_push_pct=0.03, rfq_meso_n=1,
                   rfq_facts=1, breakdown_arg=True)),
    # team review of the weakest practice cases (2026-10-10 17:40) - all generic rules (see Experiment-Log E29)
    "A9": ("A8 + insisted term in every package (cheapest variant for us), lead time cap, new evidence, answers",
           replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                   bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                   price_freeze=True, rfq_anchor=-0.08, rfq_holds=2, rfq_pushes=3, rfq_push_pct=0.03, rfq_meso_n=1,
                   rfq_facts=1, breakdown_arg=True, meet_cheapest=True, lead_cap=True, evidence_plus=True,
                   answer_plus=True)),
    "A9nolead": ("A9 without the lead-time cap (to price it on D02)",
           replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                   bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                   price_freeze=True, rfq_anchor=-0.08, rfq_holds=2, rfq_pushes=3, rfq_push_pct=0.03, rfq_meso_n=1,
                   rfq_facts=1, breakdown_arg=True, meet_cheapest=True, evidence_plus=True, answer_plus=True)),
    "A8mc": ("A8 + meet_cheapest only", replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
             bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True, price_freeze=True,
             rfq_anchor=-0.08, rfq_holds=2, rfq_pushes=3, rfq_push_pct=0.03, rfq_meso_n=1, rfq_facts=1, breakdown_arg=True,
             meet_cheapest=True)),
    "A8ev": ("A8 + evidence_plus only", replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
             bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True, price_freeze=True,
             rfq_anchor=-0.08, rfq_holds=2, rfq_pushes=3, rfq_push_pct=0.03, rfq_meso_n=1, rfq_facts=1, breakdown_arg=True,
             evidence_plus=True)),
    "A8ans": ("A8 + answer_plus only", replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
             bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True, price_freeze=True,
             rfq_anchor=-0.08, rfq_holds=2, rfq_pushes=3, rfq_push_pct=0.03, rfq_meso_n=1, rfq_facts=1, breakdown_arg=True,
             answer_plus=True)),
    "A2all": ("A2 but pushing after every final offer (to price the safety)",
              replace(A, push="all", bottleneck_anchor=0.03, say_fixed=True, meet_fields=True)),
}

VARIANTS["A10nomap"] = ("A10 without the objection map", replace(VARIANTS["A9"][1], cap_reserve=True, conditional_repair=True,
                       push_scaled=True))
VARIANTS["A10"] = ("A9 + GPT-6.1-sol advice: cap reserve for alternatives, conditional-agreement repair, push scaled to room, plain proof",
                   replace(VARIANTS["A9"][1], cap_reserve=True, conditional_repair=True, push_scaled=True, proof_plain=True))
VARIANTS["A10b"] = ("A10 + leverage room boost x1.3 when our floor estimate is weak (practice-only effect)",
                    replace(VARIANTS["A10"][1], lev_room_boost=1.3))
VARIANTS["A10map"] = ("A10 + objection map (cost D01 0.02 in the sandbox)", replace(VARIANTS["A10"][1], objection_map=True))

# Candidate only: proto.test_a11_integration must pass before release.
VARIANTS["A11"] = ("A10 + guarded closing, clocks, claims, single-supplier safety, clauses and calibrated discovery",
                   replace(VARIANTS["A10"][1], resilient_rfq=True, safe_close=True, arena_clock_guard=True,
                           safe_claims=True, safe_single=True, clause_explore=True, calibrated_anchor=True,
                           anchor_probe=True))
VARIANTS["A10w"] = ("A10 + Claude Sonnet 5.5 writes every body in the supplier's register (template fallback)",
                    replace(VARIANTS["A10"][1], llm_writer=True))
VARIANTS["A11nc"] = ("A11 without T7 (calibrated anchor + cost-split probe)",
                     replace(VARIANTS["A11"][1], calibrated_anchor=False, anchor_probe=False))
VARIANTS["A11w"] = ("A11 + Claude Sonnet 5.5 writer", replace(VARIANTS["A11"][1], llm_writer=True))


# A11 ablation: each Sol task alone on top of A10
for _n, _flags in {"A10+T1": dict(resilient_rfq=True), "A10+T2": dict(safe_close=True), "A10+T3": dict(arena_clock_guard=True),
                   "A10+T4": dict(safe_claims=True), "A10+T5": dict(safe_single=True), "A10+T6": dict(clause_explore=True),
                   "A10+T7": dict(calibrated_anchor=True, anchor_probe=True)}.items():
    VARIANTS[_n] = (f"A10 + {_flags}", replace(VARIANTS["A10"][1], **_flags))

VARIANTS["A11b"] = ("A10 + the A11 tasks the ablation supports: T2 safe close, T4 claim provenance, T5 safe single, T6 clause",
                    replace(VARIANTS["A10"][1], safe_close=True, safe_claims=True, safe_single=True, clause_explore=True))
VARIANTS["A11b-T4"] = ("A11b without T4", replace(VARIANTS["A11b"][1], safe_claims=False))
VARIANTS["A11c"] = ("A10 + T2 safe close + T5 safe single + T6 clause exploration (= A11b without T4; sandbox D02 equal to A10)",
                    replace(VARIANTS["A10"][1], safe_close=True, safe_single=True, clause_explore=True))
VARIANTS["A11bw"] = ("A11b + Claude Sonnet 5.5 writer", replace(VARIANTS["A11b"][1], llm_writer=True))

VARIANTS["A12"] = ("A10 + Astra round 2: U1 package frontier, U2 bounded RFQ race, U3 claim provenance, U4 close recovery, + T6 clause",
                   replace(VARIANTS["A10"][1], package_frontier_v2=True, bounded_rfq_race=True, claim_provenance_only=True,
                           close_recovery_v2=True, clause_explore=True))
VARIANTS["A12b"] = ("A12 without U2 (U2 opens the second RFQ supplier late: D02 0.660 x2)",
                    replace(VARIANTS["A12"][1], bounded_rfq_race=False))
VARIANTS["A12c"] = ("A10 + U1 package frontier + U4 close recovery + T6 clause (U2 opens late, U3 weakens evidence on RFQ)",
                    replace(VARIANTS["A12"][1], bounded_rfq_race=False, claim_provenance_only=False))
VARIANTS["A12d"] = ("A12c with U1 only in single-supplier cases (RFQs keep A10's packages)",
                    replace(VARIANTS["A12c"][1], frontier_single_only=True))
for _n, _flags in {"A10+U1": dict(package_frontier_v2=True, clause_explore=True), "A10+U2": dict(bounded_rfq_race=True),
                   "A10+U3": dict(claim_provenance_only=True), "A10+U4": dict(close_recovery_v2=True)}.items():
    VARIANTS[_n] = (f"A10 + {_flags}", replace(VARIANTS["A10"][1], **_flags))

# D02 evolution (proto/astra/d02/gen*.json): every idea becomes a variant on top of A10 (or its "base" variant)
import glob as _glob
import json as _json
from dataclasses import fields as _fields

_known = {f.name for f in _fields(Config)}
for _g in sorted(_glob.glob(str(Path(__file__).parent / "astra" / "d02" / "gen*.json"))):
    for _idea in _json.load(open(_g)).get("ideas", []):
        _params = _idea.get("params") or {}
        if not set(_params) <= _known:
            continue  # a code idea whose flag is not implemented yet
        _base = VARIANTS.get(_idea.get("base", "A10"), VARIANTS["A10"])[1]
        try:
            VARIANTS[_idea["id"]] = (_idea["title"], replace(_base, **_params))
        except TypeError:
            pass

VARIANTS["G5-1"] = ("G3-4 (retain freight + stable incoterm + no hold rewinds) + G4-2 Nash package bargaining",
                    replace(VARIANTS["A10"][1], retain_freight_concession=True, stable_incoterm_basis=True, rfq_holds=0,
                            nash_package_bargain=True))
VARIANTS["G5-2"] = ("G5-1 + G4-1 reservation-band goal", replace(VARIANTS["G5-1"][1], reservation_band_goal=True))

# ALT paradigms (proto/astra/alt/ideas.json): completely different negotiators, Config.strategy = module
for _idea in (_json.load(open(Path(__file__).parent / "astra" / "alt" / "ideas.json")).get("ideas", [])
              if (Path(__file__).parent / "astra" / "alt" / "ideas.json").exists() else []):
    VARIANTS[_idea["id"]] = (_idea["title"], replace(VARIANTS["A10"][1], strategy=_idea["module"]))

# The lead's CLUSTER / SAFEZONE spec (proto/alt/cluster_safezone.py) on top of G5-1, positive-tone Sonnet writer
VARIANTS["CS-60"] = ("CLUSTER/SAFEZONE spec, tension threshold 60 %",
                     replace(VARIANTS["G5-1"][1], strategy="cluster_safezone", cs_tension=0.60, llm_writer=True,
                             writer_positive=True))
VARIANTS["CS-45"] = ("CLUSTER/SAFEZONE spec, tension threshold 45 % (lead's review point 2)",
                     replace(VARIANTS["CS-60"][1], cs_tension=0.45))

# Lead's price-range anchor: soft first ask (1-2 % below our estimated best) for parts under EUR 25, D01 (~EUR 50) unchanged
VARIANTS["RA-15"] = ("G5-1 + price-range anchor, 1.5 % soft ask below EUR 25", replace(VARIANTS["G5-1"][1], range_anchor=0.015))
VARIANTS["RA-10"] = ("G5-1 + price-range anchor, 1 % soft ask below EUR 25", replace(VARIANTS["G5-1"][1], range_anchor=0.010))
VARIANTS["RA-20"] = ("G5-1 + price-range anchor, 2 % soft ask below EUR 25", replace(VARIANTS["G5-1"][1], range_anchor=0.020))

# Fixes from the E48 report (coded by Claude Sonnet 5.5): G6 = G5-1 + hygiene + stance hold + single-supplier slow ask + quality packages + room recall
_FIX = dict(fc_provenance=True, no_dup_claims=True, stance_hold=True, slow_ask_single=True, quality_packages=True, recall_room=True)
VARIANTS["G6"] = ("G5-1 + E48 fixes (provenance, no duplicates, stance hold, slow single ask, quality packages, room recall)",
                  replace(VARIANTS["G5-1"][1], **_FIX))
VARIANTS["CS2-45"] = ("CLUSTER/SAFEZONE v2: no direct accept, beat rounds after final offers, stagger, locked incoterm + E48 fixes",
                      replace(VARIANTS["CS-45"][1], cs_no_direct_accept=True, cs_beat_rounds=2, cs_stagger=True,
                              cs_lock_incoterm=True, **_FIX))
VARIANTS["G5-1s"] = ("G5-1 + spread the strong arguments over the conversation", replace(VARIANTS["G5-1"][1], spread_args=True))
VARIANTS["G6s"] = ("G6 + spread the strong arguments over the conversation", replace(VARIANTS["G6"][1], spread_args=True))
VARIANTS["G6ss"] = ("G6 + spread the strong arguments only with a single supplier",
                    replace(VARIANTS["G6"][1], spread_args=True, spread_single_only=True))
VARIANTS["G7"] = ("G5-1 + slow single-supplier ask + spread arguments with a single supplier (RFQ play = G5-1)",
                  replace(VARIANTS["G5-1"][1], slow_ask_single=True, spread_args=True, spread_single_only=True))
VARIANTS["G7sw"] = ("G7 + Option 2 sweetener / partnership package in every counter", replace(VARIANTS["G7"][1], sweetener_pkg=True))
VARIANTS["G8"] = ("G7 + slow-ask guard + clause package + evidence hygiene + quality packages (E53 improvements)",
                  replace(VARIANTS["G7"][1], slow_ask_guard=True, clause_pkg=True, fc_provenance=True, no_dup_claims=True,
                          quality_packages=True))
VARIANTS["G8b"] = ("G8 with the clause package only in stabilise cases", replace(VARIANTS["G8"][1], clause_pkg_stabilise=True))
VARIANTS["G8s"] = ("G8b + slow ask only in stabilise cases", replace(VARIANTS["G8b"][1], slow_ask_stabilise=True))
VARIANTS["G8c"] = ("G8b + slow ask only for conceding suppliers (concession-profile opponent model)", replace(VARIANTS["G8b"][1], slow_ask_profile=True))
# Review of the external G8s critique (E56): each recommendation we agree with, alone on G8s, then combined
VARIANTS["R1"] = ("G8s + floor prior 0.72 x opening (RFQ 0.78 x lowest opening) without cost evidence",
                  replace(VARIANTS["G8s"][1], floor_prior=0.72, floor_prior_rfq=0.78))
VARIANTS["R2"] = ("G8s + bolder first ask (-7 %, RFQ -13 %)", replace(VARIANTS["G8s"][1], anchor=-0.07, rfq_anchor=-0.13))
VARIANTS["R3"] = ("G8s + concession-velocity hold (do not accept while the supplier still moves)",
                  replace(VARIANTS["G8s"][1], stance_hold=True, velocity_hold=True))
VARIANTS["CS2-60"] = ("CLUSTER/SAFEZONE v2 at 60 %", replace(VARIANTS["CS2-45"][1], cs_tension=0.60))


VARIANTS["G9a"] = ("G8s + mirror jump (single supplier: one jump to the midpoint when the supplier copies our step size)",
                   replace(VARIANTS["G8s"][1], mirror_jump=True))
VARIANTS["G9b"] = ("G8s + offer memory (mirror back a cheaper earlier package instead of taking a final offer; room recall)",
                   replace(VARIANTS["G8s"][1], offer_memory=True, recall_room=True))
VARIANTS["G9c"] = ("G8s + figures answer (real data facts, full claim budget, when asked which figures)",
                   replace(VARIANTS["G8s"][1], figures_answer=True))
VARIANTS["G9"] = ("G8s + mirror jump + offer memory + figures answer",
                  replace(VARIANTS["G8s"][1], mirror_jump=True, offer_memory=True, recall_room=True, figures_answer=True))

VARIANTS["G9bc"] = ("G8s + offer memory + figures answer (no mirror jump)",
                    replace(VARIANTS["G8s"][1], offer_memory=True, recall_room=True, figures_answer=True))

VARIANTS["G9v"] = ("G8s + exclusive-volume wording (100 % of demand, no split; no 'cannot promise more')",
                   replace(VARIANTS["G8s"][1], exclusive_volume=True))

VARIANTS["G10a"] = ("G8s + R3-2 shared-index skip (RFQ: no index ID already given to another supplier)",
                    replace(VARIANTS["G8s"][1], shared_index_skip=True))
VARIANTS["G10b"] = ("G8s + R3-3 adopted lane (keep the payment/contract lane the supplier took from our 2nd package)",
                    replace(VARIANTS["G8s"][1], adopted_lane=True))

VARIANTS["G8t"] = ("G8s + audit text fixes (real contract months, supplier type only when evidenced, no duplicate IDs)",
                   replace(VARIANTS["G8s"][1], text_fixes=True))

VARIANTS["G8u"] = ("G8t + safe exception paths (no walk after a failed promotion / read / crash while an acceptable offer stands)",
                   replace(VARIANTS["G8t"][1], safe_exceptions=True))

VARIANTS["G8v"] = ("G8s + safe exception paths only (plays exactly like G8s; no walk after a failed promotion / read / crash) - final default",
                   replace(VARIANTS["G8s"][1], safe_exceptions=True))

VARIANTS["G8w"] = ("G8u + R3-2 shared-index skip (RFQ)", replace(VARIANTS["G8u"][1], shared_index_skip=True))

VARIANTS["G8x"] = ("G8u + S5-6 clause buy-out (2nd package without a supplier-introduced clause, inside the win-win window)",
                   replace(VARIANTS["G8u"][1], clause_buyout=True))
# E65 long game (single supplier only; RFQ pinned to G8u's T=4 / no holds): P01-P03 never went final, we accepted
# at its 3rd reply while it was still moving (P08 5.46 -> 5.44 -> 5.41)
VARIANTS["L1"] = ("G8u + slower single-supplier curve (T 4 -> 8; RFQ unchanged)",
                  replace(VARIANTS["G8u"][1], T=8, rfq_T=4))
VARIANTS["L2"] = ("G8u + keep countering while the single supplier still moves (4 holds at >= 0.1 % of C; RFQ unchanged)",
                  replace(VARIANTS["G8u"][1], holds=4, hold_gave=0.001, rfq_holds=0))
VARIANTS["L3"] = ("G8u + long game: L1 + L2 (single supplier only)",
                  replace(VARIANTS["G8u"][1], T=8, rfq_T=4, holds=4, hold_gave=0.001, rfq_holds=0))
# E67 Astra round 5 ideas, each alone on top of G8u
for _name, _desc, _flags in [
        ("I1", "G8u + bind evidence (facts state what the package makes actionable)", dict(bind_evidence=True)),
        ("I3a", "G8u + evidence-first layout in counters", dict(verify_layout=True)),
        ("I3b", "G8u + 'verify these inputs, then reflect them in your primary sheet'", dict(verify_request=True)),
        ("I3", "G8u + verify-then-settle (layout + request)", dict(verify_layout=True, verify_request=True)),
        ("I4", "G8u + quote-implied exchange-rate package", dict(quote_exchange=True)),
        ("I5", "G8u + RFQ counter waits briefly for an in-flight rival reply", dict(rival_defer=True)),
        ("I6", "G8u + same-cost carrier package (larger visible price step at equal C)", dict(same_cost_carrier=True))]:
    VARIANTS[_name] = (_desc, replace(VARIANTS["G8u"][1], **_flags))

def run_one(client, name, cfg, case, rep, practice, generic=True):
    cls = None
    if practice or generic:  # the generic (final) code path is the default; --handfacts uses the sandbox-only facts
        from proto.practice import PracticeNegotiator
        cls = PracticeNegotiator
    if cfg.strategy:  # a completely different negotiator (proto/alt/<strategy>.py, class Negotiator)
        import importlib
        cls = importlib.import_module(f"proto.alt.{cfg.strategy}").Negotiator
    for attempt in range(6):
        try:
            # watchdog: a frozen negotiator (G4-8) must not hang the whole batch; the arena ends the session itself
            from concurrent.futures import ThreadPoolExecutor as _TPE, TimeoutError as _TO
            _ex = _TPE(1)
            _fut = _ex.submit(eng.play, case, cfg, client=client, log_dir=OUT / name, quiet=True, cls=cls)
            try:
                sid, res = _fut.result(timeout=float(os.environ.get("SESSION_WATCHDOG", "600")))
            except _TO:
                sid, res = None, {"score": None, "error": "watchdog: negotiator hung > 10 min"}
            _ex.shutdown(wait=False)
            break
        except ArenaError as e:  # e.g. 429 too many open sessions: wait for a slot
            time.sleep(10 * (attempt + 1))
    else:
        sid, res = None, {"score": None, "error": "could not open a session"}
    row = {"variant": name + ("-generic" if generic and not practice else ""), "case": case, "rep": rep, "session": sid, "cfg": asdict(cfg), "score": res.get("score"),
           "c_deal": res.get("c_deal"), "c_best": res.get("c_best"), "terms": res.get("terms"), "error": res.get("error")}
    with open(OUT / "results.jsonl", "a") as f:
        f.write(json.dumps(row) + "\n")
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", nargs="+", default=["case:D01:1", "case:D02:3"])
    ap.add_argument("--variants", nargs="+", default=list(VARIANTS))
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--practice", action="store_true", help="data-package facts/floors (costs practice quota!)")
    ap.add_argument("--generic", action="store_true", default=True, help="(default) the final's generic code path")
    ap.add_argument("--handfacts", action="store_true", help="sandbox with the old hand-written D01/D02 facts (not used in the final)")
    a = ap.parse_args()
    load_env()
    OUT.mkdir(parents=True, exist_ok=True)
    client = ArenaClient(timeout=25, retries=7)  # under load a reply can stall: re-fetch it (same move id) every 25 s
    jobs = []
    for spec in a.cases:
        case, _, n = spec.rpartition(":") if spec.count(":") == 2 else (spec, None, "1")
        for rep in range(int(n)):
            for v in a.variants:
                jobs.append((v, VARIANTS[v][1], case, rep))
    print(f"{len(jobs)} sessions, {a.workers} at a time", flush=True)
    rows = []
    with ThreadPoolExecutor(a.workers) as ex:
        futs = [ex.submit(run_one, client, v, cfg, case, rep, a.practice, not a.handfacts) for v, cfg, case, rep in jobs]
        for i, f in enumerate(as_completed(futs), 1):
            r = f.result()
            rows.append(r)
            print(f"  [{i}/{len(jobs)}] {r['variant']} {r['case']} rep{r['rep']} score={r['score']} err={r['error']}", flush=True)
    table = defaultdict(lambda: defaultdict(list))
    for r in rows:
        table[r["variant"].replace("-generic", "")][r["case"]].append(r["score"] if r["score"] is not None else 0.0)
    cases = sorted({r["case"] for r in rows})
    print("\nvariant | " + " | ".join(cases))
    for v in a.variants:
        cells = []
        for c in cases:
            s = table[v][c]
            cells.append(f"{sum(s) / len(s):.3f} {[round(x, 3) for x in s]}" if s else "-")
        print(f"{v} {VARIANTS[v][0]} | " + " | ".join(cells))


if __name__ == "__main__":
    main()
