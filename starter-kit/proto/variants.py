"""Named algorithms (our search winner + the teammates' ideas) and a parallel runner.

    PYTHONPATH=. uv run python proto/variants.py --cases case:D01:1 case:D02:3 --variants A B C D
    PYTHONPATH=. uv run python proto/variants.py --practice --cases case:P05:1 --variants A D   # costs quota!

`case:D02:3` plays each variant 3 times on D02 (D02 is noisy, D01 is deterministic).
Results: proto/runs/variants/results.jsonl; summary printed per variant and case.
"""

import argparse
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
    # The D02 search settings (1 package, -8 %, 3 pushes of 3 %, 2 holds, 1 fact) were found on cached sandbox replies.
    # On fresh replies (a tag in the subject) they lose: D02 0.563 (0.51/0.60/0.58) vs 0.694 (0.68/0.68/0.72) with
    # A6's RFQ play, A3 0.691 (arda, 2026-10-10 19:00, `arena run --set sandbox --agent hybrid`). The hybrid plays this.
    # Patience (19:25, practice, fresh replies): we accepted at round 3-4 of 10 while the supplier was still open and
    # giving 0.3-0.5 % a round (P02, P08). 3 holds at >= 0.3 %: P02 0.425 -> 0.677, P08 0.592 -> 0.607 (a 6-round curve
    # instead: 0.373 / 0.560 - suppliers go final while our asks are still far away).
    # RFQ fact allocation (20:12, practice P05, fresh): a shared fact goes only to the leading bidder, never twice -
    # 0.713 / 0.736 / 0.710 vs 0.665-0.688 without (6 runs). The supplier's-levers package on top: 0.717 / 0.717 / 0.710,
    # and alone on single-supplier cases it is agreed at our goal instead of conceding (P01 0.91 -> 0.82): off.
    # 23:35: + clause packages in supplier-health cases at their cheapest payment term and price for us (P02 fresh:
    # 0.735 x 2 vs 0.628-0.682; see A9h-clausepay2). The frozen 21:05 build without it: "A9h-frozen".
    "A9h": ("A9 with A6's RFQ play (no RFQ-only overrides, no breakdown argument), 3 holds, RFQ fact allocation, "
            "clause packages at their cheapest payment term in supplier-health cases",
            replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                    bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                    price_freeze=True, meet_cheapest=True, lead_cap=True, evidence_plus=True, answer_plus=True,
                    holds=3, hold_gave=0.003, allocate_facts=True, ask_cap=0.18, pushes=0,
                    clause_pay_best=True, clause_pay_rate=0.064)),
    "A9h-frozen": ("the final build as frozen at 21:05 (before the clause-package rule)",
                   replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                           bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                           price_freeze=True, meet_cheapest=True, lead_cap=True, evidence_plus=True, answer_plus=True,
                           holds=3, hold_gave=0.003, allocate_facts=True, ask_cap=0.18, pushes=0)),
    # 20:50 validation of the review bundle (10 fresh sessions): with facts 2-then-1 and a quarter-step hold the mean
    # fell to 0.717 (P18 0.443, P07 0.671, P08 0.592) while P05 rose to 0.717 - the pacing changes are kept as options
    # 21:40, patience with movement (see Config.patient): the frozen A9h plus patient asks 1.5 % below an open
    # supplier's standing offer until it stalls, one new fact every round, no holds (patience replaces them)
    "A10": ("A9h + patient: never accept an open offer that still moves; ask 1.5 % below it with a new fact each round",
            replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                    bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                    price_freeze=True, meet_cheapest=True, lead_cap=True, evidence_plus=True, answer_plus=True,
                    allocate_facts=True, ask_cap=0.18, pushes=0, holds=0, patient=True, patient_gap=0.007,
                    facts_later=1)),
    "A9h-paced": ("A9h + one fact per round after the first + quarter-step holds (lost 0.01 on the 20:50 pass)",
                  replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                          bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                          price_freeze=True, meet_cheapest=True, lead_cap=True, evidence_plus=True, answer_plus=True,
                          holds=3, hold_gave=0.003, allocate_facts=True, ask_cap=0.18, pushes=0,
                          facts_later=1, hold_back=0.75)),
    # 22:50, the fact planner (Plan/Options 2026-10-10 - beyond tuning, O1): every checkable, favourable fact for the
    # supplier ranked by measured land rate, 3 claims in the first mail and 2 after, a type the supplier waved off drops
    # back, and the holds go on (a quarter step each) while a fact likely to land is left
    "A9h-plan": ("A9h + fact planner: typed inventory ranked by land rate, 3 then 2 claims, holds while facts last",
                 replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                         bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                         price_freeze=True, meet_cheapest=True, lead_cap=True, evidence_plus=True, answer_plus=True,
                         holds=3, hold_gave=0.003, allocate_facts=True, ask_cap=0.18, pushes=0, plan_facts=True)),
    "A9h-plan-rfq": ("A9h-plan + RFQ rival loop: no close at goal while a rival still bids down, fresh better rival offers",
                     replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                             bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                             price_freeze=True, meet_cheapest=True, lead_cap=True, evidence_plus=True, answer_plus=True,
                             holds=3, hold_gave=0.003, allocate_facts=True, ask_cap=0.18, pushes=0, plan_facts=True,
                             auction_rfq=True)),
    # 23:30, cost of money of good-credit suppliers in supplier-health cases: 5 % -> 6.4 % (arena-implied 6.6 % / 6.1 %)
    "A9h-cash": ("A9h + good-credit suppliers' cost of money 6.4 % in supplier-health cases (arena-implied)",
                 replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                         bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                         price_freeze=True, meet_cheapest=True, lead_cap=True, evidence_plus=True, answer_plus=True,
                         holds=3, hold_gave=0.003, allocate_facts=True, ask_cap=0.18, pushes=0, cash_rate_rel=0.064)),
    # 00:15, a clause package in a supplier-health case at its cheapest payment term for us (P02: 90 instead of 60 days)
    "A9h-clausepay": ("A9h + clause packages at the payment term cheapest for us in supplier-health cases",
                      replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                              bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                              price_freeze=True, meet_cheapest=True, lead_cap=True, evidence_plus=True, answer_plus=True,
                              holds=3, hold_gave=0.003, allocate_facts=True, ask_cap=0.18, pushes=0,
                              clause_pay_best=True)),
    "A9h-clausepay2": ("A9h-clausepay, the clause package priced with the arena-implied 6.4 % cost of money",
                       replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                               bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                               price_freeze=True, meet_cheapest=True, lead_cap=True, evidence_plus=True, answer_plus=True,
                               holds=3, hold_gave=0.003, allocate_facts=True, ask_cap=0.18, pushes=0,
                               clause_pay_best=True, clause_pay_rate=0.064)),
    # 01:05, the supplier's cash rate learned from its own priced payment alternatives, for ranking packages only
    "A9h-payrate": ("A9h + cash rate learned from the supplier's payment-only alternatives (package ranking only)",
                    replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                            bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                            price_freeze=True, meet_cheapest=True, lead_cap=True, evidence_plus=True, answer_plus=True,
                            holds=3, hold_gave=0.003, allocate_facts=True, ask_cap=0.18, pushes=0,
                            clause_pay_best=True, clause_pay_rate=0.064, pay_rate_learn=True)),
    # 00:30, R1 fact selection (RESEARCH split, candidate B): only facts that can land, so the falling own-driver indices
    # fill the first mail. Caution: the 22:26 planner probe (both indices + forecast in R1) gave P08 0.597 (= base) and
    # P18 0.401 (base 0.532) - test last
    "A9h-landing": ("A9h + only facts that can land (no plain statements, no own order prices)",
                    replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                            bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                            price_freeze=True, meet_cheapest=True, lead_cap=True, evidence_plus=True, answer_plus=True,
                            holds=3, hold_gave=0.003, allocate_facts=True, ask_cap=0.18, pushes=0,
                            clause_pay_best=True, clause_pay_rate=0.064, landing_only=True)),
    # + the R4 fork's two RFQ ideas (fact allocation, a package on the supplier's own levers): under test
    "A9hr": ("A9h + RFQ fact allocation + supplier's-levers package",
             replace(VARIANTS_A2, rfq_stagger=True, meet_insist=True, penalty_aversion=3.0, never_walk=True,
                     bottleneck_anchor=0.10, meet_band=0.03, recall_best=True, proof=True, target_prior=True,
                     price_freeze=True, meet_cheapest=True, lead_cap=True, evidence_plus=True, answer_plus=True,
                     holds=3, hold_gave=0.003, allocate_facts=True, theirs_sheet=True)),
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
# 2026-10-11 00:30 (research over 1,572 sessions): collect a step the supplier announced for its next reply (an approval
# from its management, a rival half step's rest) instead of accepting on that reply, and keep a resting final-offer
# thread alive in RFQs (a timeout after a final offer ended the thread 77 of 81 times; a no-sheet mail kept it 29 of 29)
VARIANTS["A9h-owed"] = ("A9h + collect an announced step (approval / rival rest) + RFQ keep-alive for final offers",
                        replace(VARIANTS["A9h"][1], collect_owed=True, rfq_hold=True))


# Independently reversible candidates: select A9h to disable every new lever.
for name, overrides in {
    "A9h-indices-first": {"first_indices": True},
    "A9h-economic-lead": {"economic_lead": True},
    "A9h-extreme-pay": {"extreme_payment": True},
    "A9h-candidate": {"first_indices": True, "economic_lead": True, "extreme_payment": True},
}.items():
    VARIANTS[name] = (name, replace(VARIANTS["A9h"][1], **overrides))


def run_one(client, name, cfg, case, rep, practice, generic=True):
    if practice or generic:  # the generic (final) code path is the default; --handfacts uses the sandbox-only facts
        from proto.practice import PracticeNegotiator
        eng.Negotiator = PracticeNegotiator
    for attempt in range(6):
        try:
            sid, res = eng.play(case, cfg, client=client, log_dir=OUT / name, quiet=True)
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
