"""Evolutionary search over the LLM writer's style (ENGINE_STYLE) on the hosted practice cases.

    uv run --directory starter-kit python ../scripts/evolve_style.py --generations 2 --population 4 --practice
    uv run --directory starter-kit python ../scripts/evolve_style.py --dry        # show the seeds, no sessions

Every style is one short instruction on tone and wording (never numbers: the engine decides those, and the writer's
guards keep every data ID and figure). A generation plays each style on every hosted practice case (fresh replies,
since the wording differs) through `arena run --set practice --agent hybrid`, scores it by the mean, keeps the best
`--keep`, and asks the writer model for new styles that recombine and vary the winners. Costs population x cases
practice sessions per generation. Results: logs/evolve_style.jsonl; the styles and scores printed per generation.
"""

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "starter-kit"))
LOG = ROOT / "logs" / "evolve_style.jsonl"
HOSTED = ["P01", "P02", "P03", "P04", "P05", "P07", "P08", "P10", "P11", "P18"]
SEEDS = [
    "Warm and personal: thank them for concrete things they did, name the long cooperation, and sound glad to "
    "continue it. Short sentences.",
    "Brief and factual: no pleasantries beyond one line, the facts and the packages, one clear question at the end.",
    "Collaborative: treat the gap as a shared problem, ask what would make the package work on their side (cash, "
    "planning, volume certainty) and offer to help there.",
    "Calm buyer with options: mention plainly that we compare offers and have alternatives, without any threat or "
    "deadline, and keep the door open.",
]
MUTATE = """You improve the writing style of a purchasing team's negotiation e-mails to industrial suppliers.
Below are style instructions that were tried, each with its mean negotiation score (0-1, higher is better).
Propose {n} NEW style instructions, each one or two sentences, that recombine what the best ones do and vary it
(tone, structure, how facts and packages are framed, how questions are asked). Never mention prices, numbers,
deadlines, threats or urgency. Reply with a JSON list of {n} strings and nothing else.

{tried}"""


def mean_score(variant):
    """Mean score of the sessions this run labelled `variant`, from the event log."""
    scores, runs = {}, set()
    for line in (ROOT / "logs" / "events.jsonl").read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("kind") == "run" and e.get("variant") == variant:
            runs.add(e["run"])
        if e.get("run") in runs and e.get("kind") == "result" and e.get("score") is not None:
            scores[e["case"]] = e["score"]
    return (statistics.mean(scores.values()) if scores else None), scores


def play(style, variant, cases, parallel, practice):
    env = {**os.environ, "ENGINE_WRITER": "llm", "ENGINE_STYLE": style, "ARENA_VARIANT": variant}
    cmd = ["uv", "run", "arena", "run", "--set", "practice", "--agent", "hybrid", "--parallel", str(parallel),
           "--cases", *cases]
    if practice:
        cmd.append("--practice")
    out = ROOT / "logs" / f"evolve-{variant}.log"
    with open(out, "w", encoding="utf-8") as f:
        subprocess.run(cmd, cwd=ROOT / "starter-kit", env=env, stdout=f, stderr=subprocess.STDOUT, check=False)
    return mean_score(variant)


def mutate(tried, n, complete):
    text = "\n".join(f"- score {s:.3f}: {st}" for st, s in tried)
    out = complete("You are a concise writing coach.", MUTATE.format(n=n, tried=text))
    try:
        styles = json.loads(re.search(r"\[.*\]", out, re.S).group(0))
    except Exception:  # noqa: BLE001
        return []
    return [str(s).strip() for s in styles if isinstance(s, str) and 20 < len(str(s)) < 400][:n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", nargs="+", default=HOSTED)
    ap.add_argument("--population", type=int, default=4)
    ap.add_argument("--keep", type=int, default=2)
    ap.add_argument("--generations", type=int, default=2)
    ap.add_argument("--parallel", type=int, default=10)
    ap.add_argument("--practice", action="store_true", help="spend practice sessions (population x cases a generation)")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    from arena_kit.agents import llm_from_env
    from arena_kit.cli import load_env

    load_env(ROOT / "starter-kit" / ".env")
    load_env(ROOT / ".env")
    if os.environ.get("CLAUDE_API_KEY"):
        os.environ.setdefault("ANTHROPIC_API_KEY", os.environ["CLAUDE_API_KEY"])
    population = SEEDS[: a.population]
    if a.dry:
        print("\n".join(f"- {s}" for s in population))
        return
    complete = llm_from_env()
    tried = []
    tag = time.strftime("%H%M")
    for gen in range(a.generations):
        print(f"\n=== generation {gen}: {len(population)} styles x {len(a.cases)} cases", flush=True)
        results = []
        for i, style in enumerate(population):
            variant = f"style-{tag}-g{gen}-{i}"
            mean, scores = play(style, variant, a.cases, a.parallel, a.practice)
            results.append((style, mean or 0.0))
            row = {"gen": gen, "style": style, "variant": variant, "mean": mean, "scores": scores}
            with open(LOG, "a", encoding="utf-8") as f:
                f.write(json.dumps(row) + "\n")
            print(f"  {mean if mean is None else round(mean, 3)}  {style[:110]}", flush=True)
        tried += results
        best = sorted(tried, key=lambda r: -r[1])[: a.keep]
        print("best so far:", [(round(s, 3), st[:60]) for st, s in best], flush=True)
        if gen + 1 < a.generations:
            population = [st for st, _ in best] + mutate(tried, a.population - len(best), complete)
    print("\nfinal ranking:")
    for st, s in sorted(tried, key=lambda r: -r[1]):
        print(f"  {s:.3f}  {st}")


if __name__ == "__main__":
    main()
