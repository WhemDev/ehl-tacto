"""Astra (gpt-6-astra) plans, Sol (gpt-6.1-sol) sub-agents code. We review before anything is applied.

    PYTHONPATH=. uv run python proto/astra/orchestrate.py plan                 # Astra -> proto/astra/plan.json
    PYTHONPATH=. uv run python proto/astra/orchestrate.py code T1 T2 ...       # Sol coders (parallel) -> proto/astra/edits/<id>.json
    PYTHONPATH=. uv run python proto/astra/orchestrate.py apply T1 T2 ...      # apply reviewed edits to the source

Only OPENAI_API_KEY is read from .env; the arena key and .env are never sent.
"""

import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

from arena_kit.cli import load_env

HERE = Path(__file__).parent
ROOT = HERE.parent.parent  # starter-kit/
FILES = ["proto/engine.py", "proto/practice.py", "proto/target.py", "proto/variants.py", "arena_kit/cost.py"]
ASTRA, ASTRA_EFFORT = os.environ.get("ASTRA_MODEL", "gpt-6-astra"), os.environ.get("ASTRA_EFFORT", "high")
SOL, SOL_EFFORT = os.environ.get("SOL_MODEL", "gpt-6.1-sol"), os.environ.get("SOL_EFFORT", "high")


def call(model, effort, prompt, tag):
    key = os.environ["OPENAI_API_KEY"]
    t0 = time.time()
    r = httpx.post("https://api.openai.com/v1/responses", timeout=2400,
                   headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                   json={"model": model, "reasoning": {"effort": effort}, "input": prompt})
    if r.status_code != 200:
        raise RuntimeError(f"{tag}: HTTP {r.status_code} {r.text[:800]}")
    data = r.json()
    text = data.get("output_text") or "\n".join(
        c.get("text", "") for it in data.get("output", []) if it.get("type") == "message"
        for c in it.get("content", []) if c.get("type") in ("output_text", "text"))
    print(f"[{tag}] {model}/{effort} {time.time() - t0:.0f}s usage={data.get('usage', {}).get('total_tokens')}", flush=True)
    (HERE / "raw").mkdir(exist_ok=True)
    (HERE / "raw" / f"{tag}-{time.strftime('%H%M%S')}.txt").write_text(text)
    return text


def extract_json(text):
    m = re.search(r"```json\s*(.*?)```", text, re.S)
    raw = m.group(1) if m else text[text.find("{"): text.rfind("}") + 1]
    return json.loads(raw)


def sources(files=FILES):
    return "\n\n".join(f"===== FILE: {f} =====\n{(ROOT / f).read_text()}" for f in files)


PLAN_PROMPT = """You are Astra, the lead engineer of a hackathon team building an autonomous AI buyer agent for the Tacto
Negotiation Arena. Your job now: review everything below (the team's full review with all measurements, and the complete
source of the engine) and produce an IMPROVEMENT PLAN that coding sub-agents (GPT-6.1-sol, one per task, working in
parallel on the same files) will implement. The user said: "we need improvements" - the goal is the highest expected
score in the hidden final (5 waves of unseen cases, 8 minutes each), measured on the 10 hosted practice cases.

How to think:
- First fix what produces ZEROS (robustness, protocol, timing, trust) - one zero costs more than many small gains.
- Then the biggest systematic gaps (first-ask calibration where the deal lands; RFQs; raw-material clauses; narrow rooms).
- Respect the team's measurements in section 3 of the review: do not re-propose ideas that were measured to be worse,
  unless you change the mechanism in a way that addresses why they failed (say so explicitly).
- Every rule must be GENERIC (case type/goal, data, statuses, supplier text) - never case or supplier IDs or prices.
- Every task must be small enough for one coder working independently, put new behaviour behind new Config flags
  (default off), and name the exact functions to change. Tasks may touch the same file but should not edit the same
  function; if two changes need the same function, merge them into one task.
- Also define the new variant (name "A11") that turns the chosen flags on, as its own task or inside one task.

Output: first a short assessment (max 25 lines), then ONE json block:
```json
{"assessment": "...",
 "tasks": [
   {"id": "T1", "title": "...", "priority": 1, "expected_gain": "...", "risk": "...",
    "files": ["proto/engine.py"], "functions": ["Negotiator.run_rfq"],
    "spec": "precise implementation spec for the coder: what to change, triggers, parameters, guards, Config flags",
    "test": "how to verify cheaply (smoke / sandbox / which practice case)"}
 ],
 "variant": {"name": "A11", "base": "A10", "flags": {"flag_name": "value"}},
 "not_doing": ["ideas considered and rejected, with reason"]}
```
Limit to the 6-9 tasks with the best expected score gain per hour; we have ~12 hours.

=== TEAM REVIEW ===
{review}

=== SOURCE ===
{source}
"""

CODE_PROMPT = """You are a senior Python engineer (sub-agent of the lead, Astra). Implement exactly ONE task in the code
below. Other engineers implement other tasks in parallel on the same files, so touch only what your task needs.

Rules:
- Return ONLY edits as exact search/replace pairs. Each "old" must be copied verbatim from the current source (including
  indentation), be unique in its file, and be as short as possible while unique. "new" is the full replacement text.
- New behaviour behind the Config flag(s) named in the task (default off: existing variants must behave exactly as before).
- Add new Config fields at the end of the Config dataclass field list, each with a one-line comment.
- Generic only: no case IDs, supplier IDs or case-specific prices. Numbers come from code; never invent data IDs.
- Python 3.12, no new dependencies, keep the code style (short comments explaining *why*).
- Must not block: no sleeps longer than 2 s in loops, stay inside the 60 s per-thread clock.

Output: a 3-10 line explanation, then ONE json block:
```json
{"task": "{task_id}", "edits": [{"file": "proto/engine.py", "old": "...", "new": "..."}], "notes": "..."}
```

=== TASK ===
{task}

=== CONTEXT: TEAM REVIEW (for background) ===
{review}

=== SOURCE ===
{source}
"""


def plan():
    review = (HERE / "review.md").read_text()
    text = call(ASTRA, ASTRA_EFFORT, PLAN_PROMPT.replace("{review}", review).replace("{source}", sources()), "astra-plan")
    (HERE / "plan.md").write_text(text)
    p = extract_json(text)
    (HERE / "plan.json").write_text(json.dumps(p, indent=1))
    print(f"plan: {len(p['tasks'])} tasks -> proto/astra/plan.json")
    for t in p["tasks"]:
        print(f"  {t['id']} (prio {t.get('priority')}) {t['title']} | {t.get('functions')}")


def code(ids):
    p = json.loads((HERE / "plan.json").read_text())
    review = (HERE / "review.md").read_text()
    src = sources()
    tasks = [t for t in p["tasks"] if t["id"] in ids]
    (HERE / "edits").mkdir(exist_ok=True)

    def one(t):
        prompt = CODE_PROMPT.replace("{task_id}", t["id"]).replace("{task}", json.dumps(t, indent=1)) \
            .replace("{review}", review).replace("{source}", src)
        try:
            text = call(SOL, SOL_EFFORT, prompt, f"sol-{t['id']}")
            e = extract_json(text)
            (HERE / "edits" / f"{t['id']}.json").write_text(json.dumps(e, indent=1))
            return t["id"], len(e.get("edits", [])), None
        except Exception as ex:  # keep the others going
            return t["id"], 0, repr(ex)[:300]

    with ThreadPoolExecutor(len(tasks)) as ex:
        for tid, n, err in ex.map(one, tasks):
            print(f"  {tid}: {n} edits {'ERROR ' + err if err else ''}")


def apply(ids):
    for tid in ids:
        e = json.loads((HERE / "edits" / f"{tid}.json").read_text())
        for i, ed in enumerate(e.get("edits", [])):
            p = ROOT / ed["file"]
            s = p.read_text()
            n = s.count(ed["old"])
            if n != 1:
                print(f"  {tid} edit {i} in {ed['file']}: old text found {n} times -> SKIPPED")
                continue
            p.write_text(s.replace(ed["old"], ed["new"], 1))
            print(f"  {tid} edit {i} applied to {ed['file']}")


if __name__ == "__main__":
    load_env()
    cmd = sys.argv[1]
    {"plan": lambda: plan(), "code": lambda: code(sys.argv[2:]), "apply": lambda: apply(sys.argv[2:])}[cmd]()
