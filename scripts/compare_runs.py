"""Compare runs side by side from the local event log, and write their run notes with the variant label.

    uv run --directory starter-kit python ../scripts/compare_runs.py            # every variant in logs/events.jsonl
    uv run --directory starter-kit python ../scripts/compare_runs.py profiles noprofiles --notes

A run's variant is its ARENA_VARIANT. Per case: score, deal, € saved against the opening, rounds, the supplier's
archetype and how the case ended. --notes writes a vault/Team-Knowledge/Runs note per session, labelled
`orchestra+<variant>` (needs the arena key: it reads each session's trace).
"""

import argparse
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "starter-kit"))


def load(path):
    runs, cases = {}, defaultdict(dict)  # run -> variant; (variant, case) -> facts
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e["kind"] == "run":
            runs[e["run"]] = e.get("variant") or "-"
        v = runs.get(e["run"])
        if not v or not e.get("case"):
            continue
        row = cases[(v, e["case"])]
        row.setdefault("session", e.get("session"))
        row["rounds"] = row.get("rounds", 0) + (e["kind"] == "buyer")
        if e["kind"] == "analysis":
            row["archetypes"] = sorted({(s.get("tactics") or {}).get("archetype") or "-" for s in e["suppliers"].values()})
        if e["kind"] == "result":
            row.update(score=e.get("score"), deal=e.get("deal"), c_open=e.get("c_open"), c_deal=e.get("c_deal"),
                       c_alt=e.get("c_alt"), c_best=e.get("c_best"), end=e.get("end_reason"), session=e.get("session"))
        if e["kind"] == "plan" and e.get("move") in ("accept", "walk"):
            row["why"] = e.get("why")
    return cases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("variants", nargs="*")
    ap.add_argument("--log", default=str(ROOT / "logs" / "events.jsonl"))
    ap.add_argument("--notes", action="store_true", help="write labelled run notes into the vault")
    args = ap.parse_args()
    cases = load(args.log)
    variants = args.variants or sorted({v for v, _ in cases})
    ids = sorted({c for v, c in cases if v in variants})
    head = f"{'case':<10}" + "".join(f"{v[:22]:>24}" for v in variants)
    print(head + "\n" + "-" * len(head))
    means = defaultdict(list)
    for cid in ids:
        cells = []
        for v in variants:
            r = cases.get((v, cid))
            if not r or r.get("score") is None:
                cells.append(f"{'-':>24}")
                continue
            means[v].append(r["score"])
            saved = (r.get("c_open") or 0) - (r.get("c_deal") or r.get("c_alt") or r.get("c_open") or 0)
            cells.append(f"{r['score']:>8.2f} {'deal' if r.get('deal') else 'none':>4} {saved / 1000:>7.1f}k r{r['rounds']:<2}")
        print(f"{cid[5:]:<10}" + "".join(cells))
    print("-" * len(head))
    print(f"{'mean':<10}" + "".join(f"{100 * statistics.mean(means[v]):>23.1f}%" if means[v] else f"{'-':>24}" for v in variants))
    print(f"{'zeros':<10}" + "".join(f"{sum(s < 0.005 for s in means[v]):>24}" for v in variants))
    for v in variants:
        for cid in ids:
            r = cases.get((v, cid)) or {}
            if r.get("archetypes") and r.get("archetypes") != ["-"]:
                print(f"  {v}: {cid[5:]} {', '.join(r['archetypes'])} -> {r.get('score')} ({r.get('why') or r.get('end')})")
    if args.notes:
        from arena_kit import ArenaClient, vault
        from arena_kit.cli import commit, load_env

        load_env(ROOT / "starter-kit" / ".env")
        load_env(ROOT / ".env")
        client = ArenaClient()
        import os

        for (v, cid), r in sorted(cases.items()):
            if v in variants and r.get("session") and r.get("score") is not None:
                path = vault.log_session(client.session(r["session"]), os.environ.get("ARENA_URL", ""),
                                         f"orchestra+{v}", commit())
                print("note:", path)


if __name__ == "__main__":
    main()
