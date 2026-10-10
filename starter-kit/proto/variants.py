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
    "A2all": ("A2 but pushing after every final offer (to price the safety)",
              replace(A, push="all", bottleneck_anchor=0.03, say_fixed=True, meet_fields=True)),
    # Hybrid experiments: preserve A3's Target C, equal-cost MESOs, staggered RFQ and acceptance;
    # add the target-cost candidate's response-conditioned package trade language.
    "A3trade": ("A3 + response-aware D02 trade wording",
                replace(VARIANTS_A2, rfq_stagger=True, adaptive_trade=True)),
    "A3trade_facts": ("A3trade + supplier breakdown and volume framing",
                      replace(VARIANTS_A2, rfq_stagger=True, adaptive_trade=True,
                              breakdown_arg=True, volume_framing=True)),
    "A3trade3": ("A3trade + three equal-cost package choices",
                 replace(VARIANTS_A2, rfq_stagger=True, adaptive_trade=True, meso_n=3)),
    "A3trade3near": ("A3trade3 + package selection nearest supplier terms",
                     replace(VARIANTS_A2, rfq_stagger=True, adaptive_trade=True,
                             meso_n=3, pick="near")),
    "A3fca35": ("A3 + response-aware trade, prioritize equal-cost 14-day FCA/35-day lead",
                replace(VARIANTS_A2, rfq_stagger=True, adaptive_trade=True, d02_fca35=True)),
    "A3fca35_ambitious": ("A3fca35 + 2% lower D02 opening target",
                           replace(VARIANTS_A2, rfq_stagger=True, adaptive_trade=True, d02_fca35=True,
                                   d02_target_multiplier=0.98)),
    "A3fca35_patient": ("A3fca35 + slower D02 concessions (e=1.2)",
                         replace(VARIANTS_A2, rfq_stagger=True, adaptive_trade=True, d02_fca35=True,
                                 d02_e=1.2)),
    "A3mirror": ("A3 + response-aware trade + supplier-preferred package repriced at target cost",
                 replace(VARIANTS_A2, rfq_stagger=True, adaptive_trade=True,
                         mirror_supplier_package=True)),
}


def run_one(client, name, cfg, case, rep, practice):
    if practice:
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
    row = {"variant": name, "case": case, "rep": rep, "session": sid, "cfg": asdict(cfg), "score": res.get("score"),
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
    a = ap.parse_args()
    load_env()
    OUT.mkdir(parents=True, exist_ok=True)
    client = ArenaClient()
    jobs = []
    for spec in a.cases:
        case, _, n = spec.rpartition(":") if spec.count(":") == 2 else (spec, None, "1")
        for rep in range(int(n)):
            for v in a.variants:
                jobs.append((v, VARIANTS[v][1], case, rep))
    print(f"{len(jobs)} sessions, {a.workers} at a time", flush=True)
    rows = []
    with ThreadPoolExecutor(a.workers) as ex:
        futs = [ex.submit(run_one, client, v, cfg, case, rep, a.practice) for v, cfg, case, rep in jobs]
        for i, f in enumerate(as_completed(futs), 1):
            r = f.result()
            rows.append(r)
            print(f"  [{i}/{len(jobs)}] {r['variant']} {r['case']} rep{r['rep']} score={r['score']} err={r['error']}", flush=True)
    table = defaultdict(lambda: defaultdict(list))
    for r in rows:
        table[r["variant"]][r["case"]].append(r["score"] if r["score"] is not None else 0.0)
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
