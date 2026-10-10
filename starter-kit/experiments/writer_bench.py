"""Replay the same e-mail-writer prompts through several models: speed and rule-keeping, no supplier noise.

    uv run python experiments/writer_bench.py opus sonnet haiku gpt          # 20 captured prompts each
    uv run python experiments/writer_bench.py opus gpt --prompts 40 --parallel 6

The prompts are real ones the orchestra sent while playing (experiments/out/llm_calls.jsonl, written by
run.py). Every model answers the identical prompt, so differences are the model's. Checks per answer, from
the writer's own rules (agents/orchestra.py SYSTEM): valid JSON, at most 140 words, every ARGUMENTS
sentence verbatim, no figure or data ID the prompt did not give, no leak (urgency, deadline, budget,
target price, should-cost, cost model, no alternative), a question, the signature. Rows go to
experiments/out/writer_bench.jsonl.
"""

import argparse
import json
import re
import statistics
import time
from concurrent.futures import ThreadPoolExecutor

from run import CALLS, OUT, append, applied, load_variant, setup_env  # experiments/ is on sys.path

import arena_kit.agents as agents
from arena_kit.agents.orchestra import ID_RE

BENCH = OUT / "writer_bench.jsonl"
NUM_RE = re.compile(r"(?<![\w.])\d+(?:[.,]\d+)?(?![\w])")
LEAK_RE = re.compile(
    r"urgen|deadline|asap|as soon as possible|budget|target price|should[- ]cost|cost model|no alternative|"
    r"without (an )?alternative|walk away|terminate|lawyer|legal action",
    re.I,
)


def prompts(n):
    """Distinct writer prompts captured from real plays, newest first."""
    seen, out = set(), []
    rows = [json.loads(x) for x in CALLS.read_text().splitlines() if x.strip()] if CALLS.exists() else []
    for r in reversed(rows):
        key = r.get("prompt")
        if key and "PACKAGES" in key and key not in seen:
            seen.add(key)
            out.append((r["system"], key))
    return out[:n]


def numbers(text):
    return {x.replace(",", ".") for x in NUM_RE.findall(text)}


def check(prompt, out):
    """The writer's rules, checked on one answer. Returns a dict of findings."""
    res = {"json_ok": False}
    try:
        d = json.loads(out[out.index("{") : out.rindex("}") + 1])
        body = str(d.get("body") or "")
        res["json_ok"] = bool(body)
    except ValueError:
        return res
    args = prompt.split("ARGUMENTS:\n", 1)[1].split("\nQUESTIONS:", 1)[0] if "ARGUMENTS:\n" in prompt else ""
    sentences = [s.strip() for s in args.splitlines() if s.strip() and s.strip() != "(none)"]
    given = numbers(prompt)
    invented = sorted(x for x in numbers(body) - given if x not in {"1", "2", "3"})  # "package 2" is fine
    res.update(
        words=len(body.split()),
        over_140=len(body.split()) > 140,
        args_missing=sum(s not in body for s in sentences),
        invented_numbers=invented,
        invented_ids=sorted(set(ID_RE.findall(body)) - set(ID_RE.findall(prompt))),
        leaks=sorted({m.group(0).lower() for m in LEAK_RE.finditer(body)}),
        asks=("?" in body),
        signed=("Hollerau" in body),
    )
    return res


def bench(v, cases, parallel):
    undo = applied(v)
    try:
        complete = agents.llm_from_env()
        model = v.get("env", {}).get("LLM_MODEL")
    finally:
        undo()

    def one(case):
        system, prompt = case
        t0 = time.monotonic()
        try:
            out = complete(system, prompt)
            row = {"ok": True, **check(prompt, out), "body": out[:3000]}
        except Exception as e:
            row = {"ok": False, "error": f"{type(e).__name__}: {e}"[:300]}
        row.update(variant=v["name"], model=model, took=round(time.monotonic() - t0, 2), prompt=prompt[:200])
        append(BENCH, row)
        return row

    with ThreadPoolExecutor(max_workers=parallel) as pool:
        return list(pool.map(one, cases))


def summary(name, rows):
    ok = [r for r in rows if r.get("ok") and r.get("json_ok")]
    took = sorted(r["took"] for r in rows if r.get("ok"))
    p = lambda q: took[min(len(took) - 1, int(round(q * (len(took) - 1))))] if took else 0  # noqa: E731
    n = len(rows) or 1
    share = lambda k: sum(bool(r.get(k)) for r in ok) / max(1, len(ok))  # noqa: E731
    print(
        f"{name:<10}{len(rows):>4}{len(ok) / n:>7.0%}{p(0.5):>7.1f}{p(0.95):>7.1f}{max(took or [0]):>7.1f}"
        f"{statistics.mean([r['words'] for r in ok] or [0]):>7.0f}{share('over_140'):>8.0%}"
        f"{sum(r['args_missing'] > 0 for r in ok) / max(1, len(ok)):>9.0%}{share('invented_numbers'):>9.0%}"
        f"{share('invented_ids'):>8.0%}{share('leaks'):>7.0%}{share('asks'):>6.0%}{share('signed'):>7.0%}"
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("variants", nargs="+", help="variant names (experiments/variants/*.json) with an LLM")
    ap.add_argument("--prompts", type=int, default=20)
    ap.add_argument("--parallel", type=int, default=4, help="calls at once per model")
    args = ap.parse_args()
    setup_env()
    cases = prompts(args.prompts)
    if not cases:
        raise SystemExit("no captured prompts yet: play some cases with experiments/run.py first")
    print(f"{len(cases)} captured writer prompts")
    results = {}
    for name in args.variants:
        results[name] = bench(load_variant(name), cases, args.parallel)
    head = f"\n{'model':<10}{'n':>4}{'valid':>7}{'p50 s':>7}{'p95 s':>7}{'max s':>7}{'words':>7}{'>140w':>8}"
    print(f"{head}{'arg miss':>9}{'new num':>9}{'new ID':>8}{'leak':>7}{'asks':>6}{'signed':>7}")
    for name, rows in results.items():
        summary(name, rows)
    print("\nshares are of valid answers; 'new num' = a figure the prompt did not give (beyond 1-3)")


if __name__ == "__main__":
    main()
