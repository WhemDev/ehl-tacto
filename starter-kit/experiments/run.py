"""Try agent variants on the hosted sandbox (free, no practice quota) and log every result.

    uv run python experiments/run.py baseline                    # D01 + D02, once each
    uv run python experiments/run.py opus sonnet haiku -n 3      # three variants, 3 plays per case each
    uv run python experiments/run.py --report                    # summary of experiments/results.jsonl

A variant is a JSON file in experiments/variants/ (see README.md). Results are appended to
experiments/results.jsonl, one line per case played; every LLM call (latency, size, the prompt) goes to
experiments/out/llm_calls.jsonl. Variants that differ only in the model are played interleaved in random
order, so they meet the same suppliers at the same time of day. Sandbox only: practice costs quota.
"""

import argparse
import copy
import hashlib
import json
import os
import random
import statistics
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
RESULTS = HERE / "results.jsonl"
CALLS = OUT / "llm_calls.jsonl"
EXCLUDED = HERE / "excluded.json"  # {session_id: why} plays ended by something outside the agent: not scored
SANDBOX = ("D01", "D02")
NARRATE_S = 25  # the orchestra's writer budget: a slower answer is replaced by the template e-mail
# Read only when the agent is built, so variants that differ only in these can be played side by side.
FACTORY_ENV = {"LLM_PROVIDER", "LLM_MODEL", "LLM_EFFORT", "LLM_REASONING_EFFORT", "LLM_BASE_URL", "ARENA_NARRATOR"}
# Keep our own event log and observations out of the team's dashboard (set before arena_kit loads).
os.environ.setdefault("ARENA_EVENTS", str(OUT / "events.jsonl"))
os.environ.setdefault("ARENA_OBSERVATIONS", str(OUT / "observations.jsonl"))

import arena_kit.agents as agents  # noqa: E402
from arena_kit import analysis  # noqa: E402
from arena_kit import events as event_log  # noqa: E402
from arena_kit.cli import agent_factory, commit, load_env  # noqa: E402
from arena_kit.client import ArenaClient, ArenaError  # noqa: E402
from arena_kit.play import RemoteTable, play  # noqa: E402

_write = threading.Lock()


def append(path, row):
    with _write, open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def load_variant(name):
    path = HERE / "variants" / f"{name}.json"
    v = json.loads(path.read_text())
    v["name"] = name
    v["hash"] = hashlib.sha1(path.read_bytes()).hexdigest()[:8]  # same name, edited file: a new hash
    return v


def applied(v):
    """Set the variant's env vars and goal parameters; return a function that undoes both."""
    old_env = {k: os.environ.get(k) for k in v.get("env", {})}
    old_goals = copy.deepcopy(analysis.GOALS)
    os.environ.update({k: str(x) for k, x in v.get("env", {}).items()})
    for goal, params in v.get("goals", {}).items():
        targets = analysis.GOALS if goal == "*" else {goal: analysis.GOALS[goal]}
        for g in targets.values():
            g.update(params)

    def undo():
        for k, x in old_env.items():
            os.environ.pop(k, None) if x is None else os.environ.__setitem__(k, x)
        analysis.GOALS.clear()
        analysis.GOALS.update(old_goals)

    return undo


def timed(v, complete):
    """Log every LLM call of this variant: latency, success, the prompt (for offline replays)."""
    model = os.environ.get("LLM_MODEL")

    def wrapped(system, user):
        t0, row = time.monotonic(), {"variant": v["name"], "hash": v["hash"], "model": model}
        try:
            out = complete(system, user)
            row.update(ok=True, out_chars=len(out))
            try:
                body = json.loads(out[out.index("{") : out.rindex("}") + 1]).get("body", "")
                row["words"] = len(str(body).split())
            except ValueError:
                row["json_ok"] = False
            return out
        except Exception as e:
            row.update(ok=False, error=f"{type(e).__name__}: {e}"[:300])
            raise
        finally:
            row.update(took=round(time.monotonic() - t0, 2), at=time.strftime("%F %T"), system=system, prompt=user)
            append(CALLS, row)

    return wrapped


def new_agent(v, data):
    """The variant's agent factory, built with its env applied (the model is fixed at this point)."""
    undo, real = applied(v), agents.llm_from_env
    agents.llm_from_env = lambda: timed(v, real())  # agent_factory looks it up when called
    try:
        base = agent_factory(v.get("agent", "orchestra"), data)
    finally:
        agents.llm_from_env = real
        undo()

    def make():
        agent = base()
        if "rounds" in v and hasattr(agent, "rounds"):
            agent.rounds = v["rounds"]
        return agent

    return make


def interleavable(variants):
    return all(not v.get("goals") and set(v.get("env", {})) <= FACTORY_ENV for v in variants)


def play_one(client, v, make, case, repeat, sha):
    row = {"variant": v["name"], "hash": v["hash"], "commit": sha, "case": case, "repeat": repeat}
    for _ in range(20):  # a free session is waited for, up to 10 minutes
        table, t0 = RemoteTable(client), time.monotonic()
        try:
            r = play(table, f"case:{case}", make())
            row.update({k: r.get(k) for k in ("score", "deal", "supplier_id", "c_open", "c_deal", "c_best")})
            row.update(end_reason=r.get("end_reason"), must_haves_ok=r.get("must_haves_ok"))
            state = client.session(table.session_id)
            row["rounds"] = state.get("rounds") or r.get("rounds")
            row["replay"] = state.get("replay_url")
            break
        except ArenaError as e:
            if e.status == 429 and table.session_id is None:  # the team's 10 open sessions are in use: wait
                print(f"  {v['name']:<16} {case} #{repeat}  waiting for a free session ({e.detail})")
                time.sleep(30)
                continue
            row.update({"score": None, "error": f"ArenaError {e.status}: {e.detail}"[:300]})
            break
        except Exception as e:  # one broken case must not stop the others; counted, not scored
            row.update({"score": None, "error": f"{type(e).__name__}: {e}"[:300]})
            break
    row.update({"session": table.session_id, "seconds": round(time.monotonic() - t0, 1), "at": time.strftime("%F %T")})
    append(RESULTS, row)
    print(f"  {v['name']:<16} {case} #{repeat}  score {row.get('score')}  {row.get('end_reason') or row.get('error')}")
    return row


def _pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))] if xs else None


def report(names=None):
    rows = [json.loads(x) for x in RESULTS.read_text().splitlines() if x.strip()] if RESULTS.exists() else []
    calls = [json.loads(x) for x in CALLS.read_text().splitlines() if x.strip()] if CALLS.exists() else []
    excluded = json.loads(EXCLUDED.read_text()) if EXCLUDED.exists() else {}
    groups, timing = defaultdict(list), defaultdict(list)
    for r in rows:
        if (not names or r["variant"] in names) and r.get("session") not in excluded:
            groups[(r["variant"], r["hash"])].append(r)
    for c in calls:
        timing[(c["variant"], c["hash"])].append(c)
    head = f"{'variant':<14}{'hash':<10}{'n':>3}{'mean':>6}{'sd':>6}{'deals':>6}{'zero':>5}{'err':>4}"
    print(f"\n{head}{'rnds':>5}{'calls':>6}{'p50 s':>6}{'p95 s':>6}{'>25s':>5}{'fail':>5}{'words':>6}   per case")
    order = sorted(groups.items(), key=lambda kv: -statistics.mean([r["score"] or 0 for r in kv[1]]))
    for (name, h), rs in order:
        done = [r for r in rs if r.get("score") is not None]
        s = [r["score"] for r in done] or [0]
        per = defaultdict(list)
        for r in done:
            per[r["case"]].append(r["score"])
        cases = "  ".join(f"{c} {statistics.mean(x):.2f}" for c, x in sorted(per.items()))
        sd = statistics.stdev(s) if len(s) > 1 else 0
        deals, zeros = sum(bool(r.get("deal")) for r in done), sum(r["score"] == 0 for r in done)
        rounds = statistics.mean([r["rounds"] for r in done if r.get("rounds")] or [0])
        cs = timing.get((name, h), [])
        took = [c["took"] for c in cs if c.get("ok")]
        words = [c["words"] for c in cs if c.get("words")]
        fails = sum(not c.get("ok") or c.get("json_ok") is False for c in cs)
        slow = sum(c["took"] > NARRATE_S for c in cs)
        broke = len(rs) - len(done)
        line = f"{name:<14}{h:<10}{len(done):>3}{statistics.mean(s):>6.2f}{sd:>6.2f}{deals:>6}{zeros:>5}{broke:>4}"
        p50, p95 = _pct(took, 0.5), _pct(took, 0.95)
        timing_cols = f"{len(cs):>6}{p50 or 0:>6.1f}{p95 or 0:>6.1f}{slow:>5}{fails:>5}"
        avg_words = f"{statistics.mean(words):>6.0f}" if words else f"{'-':>6}"
        print(f"{line}{rounds:>5.1f}{timing_cols}{avg_words}   {cases}")
    skipped = sum(r.get("session") in excluded for r in rows if not names or r["variant"] in names)
    print(f"\nmean/sd over finished plays; err = plays that broke (not scored); {skipped} excluded (excluded.json)")
    print(">25s = writer answers slower than the orchestra's budget (the template e-mail went out instead)")


def setup_env():
    """.env as `arena` reads it: starter-kit/.env, then the team secrets at the repo root."""
    load_env()
    load_env(HERE.parents[1] / ".env")
    if os.environ.get("CLAUDE_API_KEY"):
        os.environ.setdefault("ANTHROPIC_API_KEY", os.environ["CLAUDE_API_KEY"])


def main():
    setup_env()  # before the defaults: ARENA_DATA and the LLM settings come from .env
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("variants", nargs="*", help="names of files in experiments/variants/ (without .json)")
    ap.add_argument("-n", "--repeats", type=int, default=1, help="plays per case (suppliers are noisy: use 3+)")
    ap.add_argument("--cases", default=",".join(SANDBOX), help="sandbox cases, default D01,D02")
    ap.add_argument("--parallel", type=int, default=2, help="sessions at once; the team shares 10 per key")
    ap.add_argument("--data", default=os.environ.get("ARENA_DATA") or "../data", help="the data package")
    ap.add_argument("--seed", type=int, default=None, help="order of the interleaved plays")
    ap.add_argument("--report", action="store_true", help="only print the summary")
    args = ap.parse_args()
    if args.report or not args.variants:
        return report(args.variants)
    cases = [c.strip().removeprefix("case:") for c in args.cases.split(",")]
    if any(c not in SANDBOX for c in cases):
        sys.exit(f"sandbox only ({', '.join(SANDBOX)}); practice runs cost quota, use `arena run --practice`")

    OUT.mkdir(exist_ok=True)
    event_log.install()
    client, sha = ArenaClient(), commit()
    variants = [load_variant(n) for n in args.variants]
    for v in variants:
        print(f"{v['name']} ({v['hash']}): {v.get('note', '')}")
    jobs = [(v, c, i) for v in variants for i in range(1, args.repeats + 1) for c in cases]
    workers = min(args.parallel, 10)
    if interleavable(variants):  # every variant's model is fixed in its factory: play them side by side
        makers = {v["name"]: new_agent(v, args.data) for v in variants}
        random.Random(args.seed).shuffle(jobs)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(lambda j: play_one(client, j[0], makers[j[0]["name"]], j[1], j[2], sha), jobs))
    else:  # goal patches and runtime env are process-wide: one variant at a time
        for v in variants:
            undo = applied(v)
            try:
                make = new_agent(v, args.data)
                mine = [j for j in jobs if j[0] is v]
                with ThreadPoolExecutor(max_workers=workers) as pool:
                    list(pool.map(lambda j, m=make: play_one(client, j[0], m, j[1], j[2], sha), mine))
            finally:
                undo()
    report(args.variants)


if __name__ == "__main__":
    main()
