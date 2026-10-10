"""Offline calibration audit (GPT-6.1-sol #8): our target C vs the arena's C_best on every finished practice session.

    PYTHONPATH=. uv run python proto/calibrate.py
Room = C_open - C; a ratio of our room to the true room > 1 means our target was too bold, < 1 too timid.
"""
import glob
import json
from collections import defaultdict

rows = [json.loads(l) for l in open("proto/runs/variants/results.jsonl")]
cases = {}
by_goal = defaultdict(list)
seen = set()
for r in rows:
    if not r["case"].startswith("case:P") or r.get("c_best") is None or r["session"] in seen:
        continue
    seen.add(r["session"])
    f = glob.glob(f"proto/runs/variants/*/{r['case'].replace(':', '_')}-{r['session']}.json")
    if not f:
        continue
    ev = json.load(open(f[0]))
    tg = [e for e in ev if e["kind"] == "target"]
    op = next((e for e in ev if e["kind"] == "open"), {})
    cfg = next((e for e in ev if e["kind"] == "config"), {})
    res = next((e for e in reversed(ev) if e["kind"] == "result"), {})
    c_open = res.get("c_open") or op.get("c_open")
    if not tg or not c_open:
        continue
    target = tg[-1]["c_target"]
    true_room = c_open - r["c_best"]
    our_room = c_open - target
    cases.setdefault(r["case"], []).append((r["variant"], our_room / true_room if true_room > 0 else None, target, r["c_best"], c_open))
from arena_kit import ArenaClient
from arena_kit.cli import load_env
load_env()
meta = {c["case_id"]: c for c in ArenaClient().cases("practice")}
print(f"{'case':9} {'goal':14} {'true room %':>11} {'our room / true room (per run)':40}")
for case in sorted(cases):
    goal = meta[case]["buyer"]["category_goal"]
    vals = [v for _, v, *_ in cases[case] if v is not None]
    tr = (cases[case][0][4] - cases[case][0][3]) / cases[case][0][4] * 100
    by_goal[goal] += vals
    print(f"{case:9} {goal:14} {tr:10.1f}% {', '.join(f'{v:.2f}' for v in vals[-6:])}")
print()
for g, v in by_goal.items():
    v = sorted(v)
    print(f"{g:14} n={len(v):2} median ratio {v[len(v)//2]:.2f}  (min {v[0]:.2f}, max {v[-1]:.2f})")
