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
PLAN = os.environ.get("PLAN", "plan.json")  # round 2: PLAN=plan2.json EDITS=edits2 REVIEW=review2.md
EDITS = os.environ.get("EDITS", "edits")
REVIEW = os.environ.get("REVIEW", "review.md")


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
    # outermost fence: code inside the JSON may itself contain ```json fences (G1-9)
    start = text.find("```json")
    if start >= 0:
        body = text[start + 7:]
        end = body.rfind("```")
        try:
            return json.loads(body[:end] if end >= 0 else body)
        except json.JSONDecodeError:
            pass
    return json.loads(text[text.find("{"): text.rfind("}") + 1])


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
- Lessons from the last round (5 integration bugs the unit tests missed):
  * never put private/internal keys on a message dict that reaches `self.c.send_message` (the arena returns 422);
  * your flag must work ALONE on top of the base variant and together with the other flags;
  * never `copy.deepcopy` objects holding locks; when you change a method signature, update every caller, override
    and lambda stand-in (grep for the name);
  * background workers must log exceptions (`self.note(...)`) and keep going, never die silently;
  * `case`/term option values may be read-only `MappingProxyType` - do not json-dump them;
  * dict.get("key", "") returns None when the key exists with None.
- Write a self-contained test file only if cheap; the team tests on real case files (smoke) and the sandbox.

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


WRITER_PROMPT = """You are Astra, the lead engineer of the hackathon team (context: the full team review and engine source below).
New direction from the team lead: GET RID OF THE TEMPLATED E-MAILS. Every e-mail body we send to a supplier bot should be
written by an LLM - Claude Sonnet 5.5 (Anthropic Messages API, model id "claude-sonnet-5-5", Python SDK `anthropic`
1.12 is installed; thinking cannot be disabled on this model, use output_config effort "low"; structured JSON output via
output_config.format json_schema is available) - so that our TONE ADAPTS TO EACH SUPPLIER (the supplier bots are LLM
personas: some formal German ("Guten Tag", "Angebot", "Zahlungsziel"), some warm/partnership, some terse, some defensive
about costs; see the sample replies below).

Write a DETAILED IMPLEMENTATION PLAN that I (the team lead) will implement directly. Hard requirements:
1. The engine stays in charge of every DECISION: term sheets, prices, all numbers, which facts/IDs are cited (refs), the
   claim budget (<=3 checked claims per message incl. attachments; each ID once per case), attachments, accept/mirror/walk.
   The LLM only writes the BODY text. It must never invent a number, a data ID, a commitment, a deadline or a fact.
2. Hard validation of every LLM body before sending, with automatic fallback to the current template body on any failure:
   numbers in the body must be a subset of an allowed set (from the template body, the sheets, the supplier's own last
   message, case facts); every required figure/fact sentence must still be present (in substance, with the exact figure);
   no data IDs except the refs we send (and the arena checks figures next to cited IDs - a wrong figure = contradicted =
   lost trust); no promises beyond the template's (e.g. volume, payment discipline); length bounds; language.
3. Timing: arena gives 60 s per message per thread measured from the supplier's reply, replies under load already take
   up to ~2 min; LLM call must have a hard timeout (suggest a number) with template fallback, must not hold the engine
   lock while waiting, and work for up to 3 parallel threads x 10 parallel cases in the final (rate limits, retries).
   Teammates measured Sonnet 5.5 median ~3.9 s per short mail.
4. Tone adaptation per supplier: define how we derive a per-thread style profile (language/greeting conventions,
   formality, warmth vs terseness, what this supplier values: partnership, data, speed, volume) from its messages - by
   rules, by the same LLM call, or a cached one-off call - and how it is passed to the writer. Mirror their register but
   stay a firm, credible buyer; acknowledge their concrete points; answer their direct questions only with what the
   engine supplied (if we cannot answer, say we will follow up or that the term sheet covers it).
5. Cover ALL message kinds the engine sends: opening (write rnd 0), counters (write rnd>0, with rival/breakdown/proof/
   fixed-terms/volume/answer_plus content), push(), close() mirror of an alternative, conditional repair, fallback_counter,
   closing_move / RFQ notices if any. Recommend the cleanest hook point (e.g. a single rewrite step inside send() given
   the template msg + thread history, vs. a structured "content plan" produced instead of template lines). Prefer the
   smallest change that keeps existing variants byte-identical when the flag is off.
6. Prompt design: give the full system prompt and user-message layout for the writer (what context: case summary,
   our goal, supplier's last 1-2 messages, the template body as the content plan, sheets in plain words, required
   points, style profile), the JSON output schema, and few-shot guidance if useful. Keep prompts stable for caching.
7. A/B test plan: flag `llm_writer` (default off) + variant A10w (A10 + writer); offline dry test of the writer and the
   validator on recorded threads (no arena), sandbox D01/D02 A10 vs A10w with repeats, then practice (quota - only with
   the lead's OK). Which metrics to log (fallback rate, latency, validator rejects, claim results, score).
8. Risks and mitigations (e.g. LLM tone making us look soft -> supplier concedes less; ambiguity causing the supplier to
   misread our offer; leaking our target or alternative; injection from supplier text).

Output: the plan in Markdown (sections: architecture, hook point, data flow, style profile, prompts (full text), schema,
validator rules (precise, as pseudo-code), fallback & timing, config flags, per-message-kind handling, test plan,
risks), then ONE json block {"files": [...], "functions": [...], "flags": {...}, "steps": ["..."]} summarising it.

=== SAMPLE SUPPLIER REPLIES (recorded practice runs, A10) ===
{personas}

=== TEAM REVIEW ===
{review}

=== SOURCE ===
{source}
"""


def writer():
    review = (HERE / "review.md").read_text()
    prompt = WRITER_PROMPT.replace("{personas}", (HERE / "personas.md").read_text()).replace("{review}", review) \
        .replace("{source}", sources(["proto/engine.py", "proto/practice.py", "proto/variants.py"]))
    text = call(ASTRA, ASTRA_EFFORT, prompt, "astra-writer-plan")
    (HERE / "writer_plan.md").write_text(text)
    print("writer plan -> proto/astra/writer_plan.md")


IMPROVE_PROMPT = """You are Astra, the lead engineer of the hackathon team. Below: a detailed report (#2) with every measurement,
the per-case transcripts of our two latest practice runs (A10 template, A10w LLM writer) and the complete engine source
(base: A10 + LLM writer + the A11 flags T1-T7, all default off; A10 is still our best variant). Produce a DETAILED IMPROVEMENTS PAGE for the team and a task
plan for GPT-6.1-sol coders (high effort, one coder per task, working in parallel on the same files).

Goal: the highest expected score in the hidden final (5 waves of unseen cases, 8 minutes each, <=10 cases in parallel),
measured on the 10 hosted practice cases (we have ~400 practice sessions left) and the free sandbox D01/D02.

How to think:
- Read the transcripts: find, per case, the exact moment and mechanism where points are lost, and which generic rule
  would have changed it. Deterministic single-supplier bots answer identical messages identically - so new levers, not
  new wording, move those cases.
- Respect the measurements (section 3 and the ablation in section 6); do not re-propose what failed unless you change the
  mechanism and say why.
- Prefer few, high-value, low-risk tasks. Each task: one coder, named functions, behind a new Config flag (default off),
  generic triggers only, measurable on sandbox and/or specific practice cases. Two tasks must not edit the same function.
- Include a final integration task that defines variant "A12" (base A10 + the chosen flags + the A11 flags that the
  ablation supports) and nothing else.

Output, in this order:
1. The improvements page in Markdown: (a) diagnosis per practice case (where/why points are lost, with transcript
   evidence), (b) cross-case patterns, (c) the improvement list ranked by expected score gain, each with mechanism,
   trigger, expected gain, risk, how to test, (d) what NOT to do, (e) test protocol (sandbox, then practice, repeats).
2. ONE json block:
```json
{"tasks": [{"id": "U1", "title": "...", "priority": 1, "expected_gain": "...", "risk": "...",
            "files": ["proto/engine.py"], "functions": ["Negotiator.meso"], "flag": "flag_name",
            "spec": "precise implementation spec for the coder", "test": "how to verify"}],
 "variant": {"name": "A12", "base": "A10", "flags": {"flag_name": true}},
 "not_doing": ["..."]}
```

=== DETAILED REPORT #2 ===
{review}

=== TRANSCRIPTS: A10 (template) latest practice run ===
{t_a10}

=== TRANSCRIPTS: A10w (LLM writer) latest practice run ===
{t_a10w}

=== TRANSCRIPTS: A11c (A10 + T2 safe close + T5 safe single + T6 clause) practice run ===
{t_a11c}

=== SOURCE ===
{source}
"""


def improve():
    review = (HERE / "review2.md").read_text()
    prompt = IMPROVE_PROMPT.replace("{review}", review).replace("{t_a10}", (HERE / "transcripts_A10.md").read_text()) \
        .replace("{t_a10w}", (HERE / "transcripts_A10w.md").read_text()) \
        .replace("{t_a11c}", (HERE / "transcripts_A11c.md").read_text()).replace("{source}", sources(FILES + ["proto/writer.py"]))
    text = call(ASTRA, ASTRA_EFFORT, prompt, "astra-improve")
    (HERE / "improve_plan.md").write_text(text)
    p = extract_json(text)
    (HERE / "plan2.json").write_text(json.dumps(p, indent=1))
    print(f"improvements: {len(p['tasks'])} tasks -> proto/astra/plan2.json")
    for t in p["tasks"]:
        print(f"  {t['id']} (prio {t.get('priority')}) {t['title']} | {t.get('functions')}")


D02_PROMPT = """You are Astra, the lead engineer. Task: improve our buyer agent on the sandbox RFQ case D02 (and with it every
RFQ in the hidden final: unseen suppliers, so only GENERIC rules - triggers from case data, statuses, supplier text,
documents, offers; never supplier IDs, D02 prices or D02-specific numbers). We will run an evolutionary loop: you propose
many DIFFERENT ideas, we test every one in the free sandbox (D02 x2-3, D01 x1 as a guard that single-supplier play does
not change), we send you the results, you propose the next generation (refinements and combinations of the winners plus
fresh ideas), and so on. The best generation is finally run on the 10 hosted practice cases.

{history}

Think from the transcripts: where exactly does the deal stop 0.12-0.25 short of C_best? Candidate levers include (not
limited to): payment-days/incoterm trades (we always end at 14 days - is that right under our C?), which supplier we
push and when, how the rival bar is presented, when we accept a final offer vs. play the other supplier, hold/push
rules after final_offer with a live rival, using the cost breakdown, first-ask level per supplier, MESO across
suppliers, timing of the stagger, closing on the alternative sheet, lead-time trades (28 vs 35 days), how many rounds.

Produce {n} ideas, each either:
- type "params": only Config values on top of VARIANTS["A10"] (any existing Config field, incl. rfq_* overrides:
  rfq_e, rfq_T, rfq_anchor, rfq_holds, rfq_pushes, rfq_push_pct, rfq_meso_n, rfq_facts, and e, T, toward, hold_gave,
  push, pushes, rival, calc, volume, tone, breakdown_arg, volume_framing, rfq_bar, rfq_hold, ...). Read the Config
  dataclass in the source for exact names/types. These are tested immediately; no coder needed.
- type "code": a small new behaviour behind ONE new Config flag (default off; NEVER name it rfq_* - that prefix is
  reserved for RFQ overrides), with a precise spec for a GPT-6.1-sol coder: functions to change (prefer helpers; do
  not rewrite run_rfq), trigger, guards. Two code ideas must not edit the same function unless you say they are
  alternatives (mutually exclusive variants of one coder task).
Aim for at least half params ideas (cheap) and several bold code ideas. Make them genuinely different.

Output: a short analysis (max 30 lines), then ONE json block:
```json
{"analysis": "...",
 "ideas": [{"id": "G{gen}-1", "title": "...", "type": "params", "params": {"rfq_anchor": -0.12},
            "hypothesis": "...", "risk": "..."},
           {"id": "G{gen}-2", "title": "...", "type": "code", "flag": "new_flag_name", "params": {"new_flag_name": true},
            "files": ["proto/engine.py"], "functions": ["Negotiator.helper_x (new)", "Negotiator.write"],
            "spec": "precise spec for the coder", "hypothesis": "...", "risk": "..."}],
 "notes": "..."}
```

=== D02 BRIEF ===
{brief}

=== D02 TRANSCRIPTS (A10: best, typical, worst run) ===
{transcripts}

=== SOURCE ===
{source}
"""


D02_NEW_PROMPT = """You are Astra, the lead engineer. Three generations of incremental tuning on our A10 buyer agent have hit a
plateau on the sandbox RFQ case D02 (results below). The team lead now wants RADICALLY DIFFERENT approaches - not more
parameter tuning of the same concession curve:

(A) GAME-THEORETIC MECHANISMS, for example (choose, adapt, or invent better ones):
  - estimating each supplier's reservation price online from its concession sequence (fit a decaying concession
    curve / exponential to its successive offers, detect the asymptote) and targeting just above it;
  - Zeuthen-strategy / risk-of-breakdown reasoning: who should concede next and by how much;
  - Nash / Kalai-Smorodinsky bargaining split between our target and the estimated floor;
  - an explicit reverse (descending) auction between the RFQ suppliers: "beat the current best landed cost by X"
    with clear rules and a stated end, using the rival's real standing offer;
  - commitment devices / final-round structure (credible last call, sealed best-and-final round to all suppliers at
    once), signalling theory for first asks, tit-for-tat with forgiveness;
(B) AN AI DEAL MAKER: an LLM (we have Claude Sonnet 5.5 via the Anthropic API, ~2.5 s median for short structured
  outputs, and OpenAI gpt-6.1-sol / gpt-6-astra via the Responses API, slower) that makes some of the negotiation
  DECISIONS: e.g. at each turn choose the action (counter / accept / push / hold / last call / switch focus to the
  other supplier), the price and the package from the allowed options, given a compact state (case, our C function
  results for candidate packages, both suppliers' offer histories with C, statuses, their latest messages, time
  left). The engine keeps HARD GUARDS: never above a supplier's standing price, allowed options and must-haves only,
  never accept a C above our alternative, respect the 60 s per-thread clock (decision budget <= 8 s, fall back to
  A10's own decision on timeout/invalid output), structured JSON output validated by code, no invented data IDs.
  Variants: an advisor that only picks the counter price; one that only decides accept-vs-push-vs-hold on a final
  offer; a full decider.

Constraints: generic (any RFQ and, where sensible, single-supplier cases; no supplier IDs or D02 numbers), behind one
new Config flag each (default off; never name it rfq_*), implementable by one GPT-6.1-sol coder each as NEW helper
methods plus ONE small hook (name the exact hook location; we wire hooks for parallel coders), testable in the free
sandbox (D02 x3, D01 x1 guard). The LLM ideas must include the exact system prompt, the JSON schema, the state
fields and the guard/fallback rules in the spec.

{history}

Produce {n} ideas (type "code"), at least 3 game-theoretic and at least 3 AI-deal-maker designs, all genuinely
different. Output: a short analysis (max 30 lines), then ONE json block in the same format as before:
```json
{"analysis": "...", "ideas": [{"id": "G{gen}-1", "title": "...", "type": "code", "flag": "...", "params": {"flag": true},
 "files": ["proto/engine.py"], "functions": ["Negotiator.new_helper (new)", "hook: ..."], "spec": "...",
 "hypothesis": "...", "risk": "..."}], "notes": "..."}
```

=== D02 BRIEF ===
{brief}

=== D02 TRANSCRIPTS (A10: best, typical, worst run) ===
{transcripts}

=== SOURCE ===
{source}
"""


def d02(gen, n):
    hist_path = HERE / "d02" / "history.md"
    history = hist_path.read_text() if hist_path.exists() else "=== RESULTS SO FAR === (generation 1: none yet)"
    prompt = D02_PROMPT.replace("{history}", history).replace("{n}", str(n)).replace("{gen}", str(gen)) \
        .replace("{brief}", (HERE / "d02" / "brief.md").read_text()) \
        .replace("{transcripts}", (HERE / "d02" / "transcripts_A10_D02.md").read_text()).replace("{source}", sources())
    if os.environ.get("D02_NEW"):
        prompt = D02_NEW_PROMPT.replace("{history}", history).replace("{n}", str(n)).replace("{gen}", str(gen)) \
            .replace("{brief}", (HERE / "d02" / "brief.md").read_text()) \
            .replace("{transcripts}", (HERE / "d02" / "transcripts_A10_D02.md").read_text()) \
            .replace("{source}", sources(FILES + ["proto/writer.py"]))
    text = call(ASTRA, ASTRA_EFFORT, prompt, f"astra-d02-g{gen}")
    (HERE / "d02" / f"gen{gen}.md").write_text(text)
    p = extract_json(text)
    (HERE / "d02" / f"gen{gen}.json").write_text(json.dumps(p, indent=1))
    print(f"gen {gen}: {len(p['ideas'])} ideas -> proto/astra/d02/gen{gen}.json")
    for i in p["ideas"]:
        print(f"  {i['id']} [{i['type']}] {i['title']} | {i.get('params')}")


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
    p = json.loads((HERE / PLAN).read_text())
    review = (HERE / REVIEW).read_text()
    src = sources()
    tasks = [t for t in p["tasks"] if t["id"] in ids]
    (HERE / EDITS).mkdir(exist_ok=True)

    def one(t):
        prompt = CODE_PROMPT.replace("{task_id}", t["id"]).replace("{task}", json.dumps(t, indent=1)) \
            .replace("{review}", review).replace("{source}", src)
        try:
            text = call(SOL, SOL_EFFORT, prompt, f"sol-{t['id']}")
            e = extract_json(text)
            (HERE / EDITS / f"{t['id']}.json").write_text(json.dumps(e, indent=1))
            return t["id"], len(e.get("edits", [])), None
        except Exception as ex:  # keep the others going
            return t["id"], 0, repr(ex)[:300]

    with ThreadPoolExecutor(len(tasks)) as ex:
        for tid, n, err in ex.map(one, tasks):
            print(f"  {tid}: {n} edits {'ERROR ' + err if err else ''}")


def apply(ids):
    for tid in ids:
        e = json.loads((HERE / EDITS / f"{tid}.json").read_text())
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
    {"plan": lambda: plan(), "writer": lambda: writer(), "improve": lambda: improve(),
     "d02": lambda: d02(int(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 14), "code": lambda: code(sys.argv[2:]), "apply": lambda: apply(sys.argv[2:])}[cmd]()
