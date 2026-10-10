"""Evolutionary search over engine tactics on the sandbox cases (free: no practice quota).

    PYTHONPATH=. uv run python proto/search.py --pop 24 --gens 5 --goal 0.90

Each generation plays every new Config on every case, at most 10 sessions at once (the arena's
limit per key) through one shared, rate-limited client. The sandbox suppliers are deterministic,
so a Config already played is never replayed - except one control per generation that checks
exactly that. Keeps the elites (best mean + best per case), breeds mutations and crossovers.
Results: proto/runs/search/results.jsonl (one line per session) and summary.json.
"""

import argparse
import json
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, fields, replace
from pathlib import Path

from arena_kit import ArenaClient, ArenaError
from arena_kit.cli import load_env

from proto.engine import Config, play

OUT = Path("proto/runs/search")
CASES = ["case:D01", "case:D02"]
SPACE = {
    "e": [0.5, 1.0, 1.5, 2.0, 3.0],
    "T": [2, 3, 4, 5, 6],
    "toward": ["standing", "open"],
    "anchor": [-0.03, 0.0, 0.03, 0.06],
    "holds": [0, 1, 2],
    "hold_gave": [0.005, 0.01, 0.02],
    "push": ["all", "rfq", "off"],
    "pushes": [1, 2],
    "push_pct": [0.01, 0.015, 0.03],
    "meso_n": [1, 2, 3],
    "pick": ["diverse", "near"],
    "facts": [1, 2],
    "rival": [True, False],
    "calc": [True, False],
    "volume": [True, False],
    "tone": ["warm", "brief"],
}
SEEDS = [Config(), Config(e=2.0)]  # run 9 and run 8: the best so far


def random_config(rng):
    return Config(**{k: rng.choice(v) for k, v in SPACE.items()})


def mutate(cfg, rng, n=None):
    changes = {}
    for k in rng.sample(list(SPACE), n or rng.choice([1, 1, 2, 3])):
        changes[k] = rng.choice([v for v in SPACE[k] if v != getattr(cfg, k)])
    return replace(cfg, **changes)


def crossover(a, b, rng):
    return Config(**{f.name: getattr(rng.choice([a, b]), f.name) for f in fields(Config)})


class Search:
    def __init__(self, workers=10):
        self.client = ArenaClient(timeout=25, retries=7)  # under load a reply can stall: re-fetch it (same move id) every 25 s  # thread-safe pacing: one client keeps all sessions under the rate limit
        self.workers = workers
        self.cache = {}  # (config key, case) -> score
        OUT.mkdir(parents=True, exist_ok=True)
        self.results = OUT / "results.jsonl"
        for line in self.results.read_text().splitlines() if self.results.exists() else []:
            r = json.loads(line)
            if r.get("score") is not None and not r.get("control"):
                self.cache[(r["key"], r["case"])] = r["score"]

    def one(self, cfg, case, gen, control=False):
        for attempt in range(6):
            try:
                sid, res = play(case, cfg, client=self.client, log_dir=OUT / f"g{gen}", quiet=True)
                break
            except ArenaError as e:  # e.g. 429 too many open sessions: wait for a slot
                time.sleep(10 * (attempt + 1))
        else:
            sid, res = None, {"score": None, "error": "could not open a session"}
        row = {"gen": gen, "case": case, "key": cfg.key(), "cfg": asdict(cfg), "session": sid, "control": control,
               "score": res.get("score"), "c_deal": res.get("c_deal"), "c_best": res.get("c_best"),
               "terms": res.get("terms"), "error": res.get("error")}
        with open(self.results, "a") as f:
            f.write(json.dumps(row) + "\n")
        return row

    def evaluate(self, configs, gen, control=None):
        jobs = [(c, case, False) for c in configs for case in CASES if (c.key(), case) not in self.cache]
        if control:
            jobs += [(control, case, True) for case in CASES]
        print(f"gen {gen}: {len(jobs)} sessions ({len(configs)} configs, {self.workers} at a time)", flush=True)
        rows = []
        with ThreadPoolExecutor(self.workers) as ex:
            futs = [ex.submit(self.one, c, case, gen, ctl) for c, case, ctl in jobs]
            for i, f in enumerate(as_completed(futs), 1):
                r = f.result()
                rows.append(r)
                if not r["control"] and r["score"] is not None:
                    self.cache[(r["key"], r["case"])] = r["score"]
                print(f"  [{i}/{len(jobs)}] {r['case']} score={r['score']} {'(control)' if r['control'] else ''}", flush=True)
        return rows

    def table(self, configs):
        out = []
        for c in configs:
            s = [self.cache.get((c.key(), case)) for case in CASES]
            if None not in s:
                out.append((sum(s) / len(s), s, c))
        return sorted(out, key=lambda x: -x[0])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pop", type=int, default=24)
    ap.add_argument("--gens", type=int, default=5)
    ap.add_argument("--goal", type=float, default=0.90)
    ap.add_argument("--patience", type=int, default=2)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--workers", type=int, default=6, help="parallel sessions; the key's limit of 10 is shared with teammates")
    a = ap.parse_args()
    load_env()
    rng = random.Random(a.seed)
    s = Search(workers=a.workers)
    seen = {}
    pop = list(SEEDS)
    while len(pop) < a.pop:
        c = random_config(rng)
        if c.key() not in {p.key() for p in pop}:
            pop.append(c)
    best_mean, stale, summary = -1, 0, []
    for gen in range(a.gens):
        for c in pop:
            seen[c.key()] = c
        ranked = s.table(seen.values())
        control = ranked[0][2] if ranked else None
        rows = s.evaluate(pop, gen, control=control)
        ctl = [r for r in rows if r["control"]]
        drift = [(r["case"], r["score"], s.cache.get((r["key"], r["case"]))) for r in ctl]
        ranked = s.table(seen.values())
        per_case = {case: max(((s.cache.get((c.key(), case)), c) for c in seen.values()
                               if s.cache.get((c.key(), case)) is not None), key=lambda x: x[0]) for case in CASES}
        top_mean, top_scores, top_cfg = ranked[0]
        summary.append({"gen": gen, "best_mean": top_mean, "best_scores": top_scores, "best_cfg": asdict(top_cfg),
                        "per_case": {k: (v[0], asdict(v[1])) for k, v in per_case.items()},
                        "control": drift, "played": len(seen)})
        (OUT / "summary.json").write_text(json.dumps(summary, indent=1))
        print(f"\n=== gen {gen}: best mean {top_mean:.3f} {top_scores}  per case "
              + ", ".join(f"{k} {v[0]:.3f}" for k, v in per_case.items()) + f"  control {drift}", flush=True)
        for m, sc, c in ranked[:5]:
            diff = {k: v for k, v in asdict(c).items() if v != getattr(Config(), k)}
            print(f"   {m:.3f} {sc} {diff}", flush=True)
        if top_mean >= a.goal:
            print("goal reached", flush=True)
            break
        stale = stale + 1 if top_mean <= best_mean + 1e-6 else 0
        best_mean = max(best_mean, top_mean)
        if stale >= a.patience:
            print(f"no improvement for {a.patience} generations: stop", flush=True)
            break
        # next generation: elites = top 2 by mean + best per case; children = mutations + crossovers
        elites = [c for _, _, c in ranked[:2]] + [v[1] for v in per_case.values()]
        elites = list({c.key(): c for c in elites}.values())
        children = []
        tries = 0
        while len(children) < a.pop - len(elites) and tries < 5000:
            tries += 1
            if rng.random() < 0.3 and len(elites) > 1:
                child = mutate(crossover(*rng.sample(elites, 2), rng), rng, n=1)
            else:
                child = mutate(rng.choice(elites), rng)
            if child.key() not in seen and child.key() not in {c.key() for c in children}:
                children.append(child)
        pop = children  # elites are already cached (deterministic suppliers): no need to replay them
    print(json.dumps(summary[-1], indent=1))


if __name__ == "__main__":
    main()
