"""Compare runs side by side from the local event log, and write their run notes with the variant label.

    uv run --directory starter-kit python ../scripts/compare_runs.py            # every variant in logs/events.jsonl
    uv run --directory starter-kit python ../scripts/compare_runs.py profiles noprofiles --notes

A run's variant is its ARENA_VARIANT. Per variant and case: every session's score (repeated runs are kept
apart), their mean, deals and rounds. --notes writes a vault/Team-Knowledge/Runs note per session, labelled
`orchestra+<variant>` (needs the arena key: it reads each session's trace).
"""

import argparse
import json
import os
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "starter-kit"))


def load(path):
    """{(variant, case): [session facts]}, one entry per session."""
    runs, by_session = {}, {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e["kind"] == "run":
            runs[e["run"]] = e.get("variant") or "-"
        v = runs.get(e["run"])
        sid = e.get("session")
        if not v or not e.get("case") or not sid or str(sid).startswith("sim"):
            continue
        row = by_session.setdefault(sid, {"variant": v, "case": e["case"], "session": sid, "rounds": 0})
        row["rounds"] += e["kind"] == "buyer"
        if e["kind"] == "result":
            row.update(score=e.get("score"), deal=e.get("deal"), c_open=e.get("c_open"), c_deal=e.get("c_deal"),
                       c_alt=e.get("c_alt"), c_best=e.get("c_best"), end=e.get("end_reason"))
        if e["kind"] == "plan" and e.get("move") in ("accept", "walk"):
            row["why"] = e.get("why")
    cases = defaultdict(list)
    for row in by_session.values():
        if row.get("score") is not None:
            cases[(row["variant"], row["case"])].append(row)
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
    head = f"{'case':<8}" + "".join(f"{v[:26]:>28}" for v in variants)
    print(head + "\n" + "-" * len(head))
    means = defaultdict(list)
    for cid in ids:
        cells = []
        for v in variants:
            rs = cases.get((v, cid)) or []
            if not rs:
                cells.append(f"{'-':>28}")
                continue
            sc = [r["score"] for r in rs]
            means[v].append(statistics.mean(sc))
            cell = f"{statistics.mean(sc):.2f} ({'/'.join(f'{x:.2f}' for x in sc[:4])})"
            cells.append(f"{cell:>28}")
        print(f"{cid[5:]:<8}" + "".join(cells))
    print("-" * len(head))
    print(f"{'mean':<8}" + "".join(f"{100 * statistics.mean(means[v]):>27.1f}%" if means[v] else f"{'-':>28}"
                                   for v in variants))
    print(f"{'plays':<8}" + "".join(f"{sum(len(cases.get((v, c)) or []) for c in ids):>28}" for v in variants))
    if args.notes:
        from arena_kit import ArenaClient, vault
        from arena_kit.cli import commit, load_env

        load_env(ROOT / "starter-kit" / ".env")
        load_env(ROOT / ".env")
        client = ArenaClient()
        for (v, cid), rs in sorted(cases.items()):
            if v in variants:
                for r in rs:
                    path = vault.log_session(client.session(r["session"]), os.environ.get("ARENA_URL", ""),
                                             f"orchestra+{v}", commit())
                    print("note:", path)


if __name__ == "__main__":
    main()
