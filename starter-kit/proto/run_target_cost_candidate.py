"""Repeat the target-cost D02 sandbox policy and append results to proto/runs/.

From starter-kit/: `PYTHONPATH=. uv run python proto/run_target_cost_candidate.py --repeats 3`
This opens sandbox demos only; do not point it at practice cases.
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from arena_kit import ArenaClient
from arena_kit.cli import load_env
from arena_kit.play import RemoteTable, play

from proto.target_cost_candidate import TargetCostTraderAgent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--first-target", type=float, default=171000.0)
    parser.add_argument("--next-target", type=float, default=170638.57)
    parser.add_argument("--closing-probe", action="store_true")
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("--repeats must be at least 1")

    load_env()
    client = ArenaClient()
    agent = TargetCostTraderAgent(args.first_target, args.next_target, args.closing_probe)
    out = Path("proto/runs/target_cost_candidate")
    out.mkdir(parents=True, exist_ok=True)
    for rep in range(args.repeats):
        table = RemoteTable(client)
        result = play(table, "case:D02", agent)
        row = {
            "variant": "target_cost_candidate",
            "case": "case:D02",
            "rep": rep,
            "session": table.session_id,
            "config": {
                "first_target": args.first_target,
                "next_target": args.next_target,
                "closing_probe": args.closing_probe,
            },
            "score": result.get("score"),
            "deal": result.get("deal"),
            "end_reason": result.get("end_reason"),
            "terms": result.get("terms"),
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        }
        with (out / "results.jsonl").open("a") as stream:
            stream.write(json.dumps(row) + "\n")
        print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
