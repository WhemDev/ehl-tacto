"""Astra review 4: everything (logs, changes, how the app works, every algorithm) -> sectioned judgement + improvements."""
import ast, glob, json, sys
from dataclasses import asdict, fields
from pathlib import Path
sys.path.insert(0, "proto/astra")
from arena_kit.cli import load_env
load_env()
import orchestrate as o
from proto.engine import Config
from proto.variants import VARIANTS

V = Path.home() / "Documents/Obsidian/EHL-Hackathon"
read = lambda p: Path(p).read_text() if Path(p).exists() else ""

# 1. how the app works
app = "\n\n".join(f"===== {p.name} =====\n{read(p)}" for p in sorted((V / "App").glob("*.md")))
app += "\n\n===== Progress/Handoff-2026-10-11.md =====\n" + read(V / "Progress/Handoff-2026-10-11.md")
# 2. every change
log = read(V / "Progress/Experiment-Log.md")
# 3. every algorithm: description + settings that differ from Config()
base = asdict(Config())
cat = []
for name, (desc, cfg) in VARIANTS.items():
    diff = {k: v for k, v in asdict(cfg).items() if base.get(k) != v}
    cat.append(f"- **{name}**: {desc} | {json.dumps(diff, default=str)}")
catalog = "\n".join(cat)
# 4. practice results (all tables)
tables = []
for p in sorted((V / "Progress/Runs").glob("*.md")):
    tables.append(f"===== {p.name} =====\n{read(p)[:9000]}")
for d in sorted((V / "Progress/Runs").glob("2026-10-11-*-practice")):
    tables.append(f"===== {d.name}/table.md =====\n{read(d / 'table.md')}")
tables = "\n\n".join(tables)
# 5. the current best's conversations (trimmed per case)
g8s = V / "Progress/Runs/2026-10-11-G8s-practice"
convs = "\n\n".join(read(p)[:9000] for p in sorted(g8s.glob("P*.md")))
# 6. outside advice we assessed
advice = "\n\n".join(read(V / "Progress/Advisor" / n) for n in
                     ["2026-10-10 GPT-6.1-sol advice - assessment.md", "2026-10-11 Research review - BOA, Boulware, logrolling.md"])
# 7. engine
src = read("proto/engine.py")
cfg_src = next("\n".join(src.splitlines()[n.lineno - 2:n.end_lineno]) for n in ast.parse(src).body
               if isinstance(n, ast.ClassDef) and n.name == "Config")
interface = read("proto/astra/alt/interface.py")

PROMPT = f"""You are Astra, the lead engineer of our hackathon team (Tacto Negotiation Arena: an autonomous BUYER agent negotiates by
e-mail with LLM supplier bots; score per case = (C_open - C_deal)/(C_open - C_best) on total cost C). The team lead sends you
EVERYTHING we have: how the app works, every algorithm we built (catalogue with exact settings), the complete experiment
log (every change and its measured effect, E0-E60), every practice result table, the current best agent's full practice
conversations, the outside advice we assessed, and the engine's Config and interface.

Your job - a thorough, honest technical review, organised in these sections:
1. **How the system works** - a precise architecture map of our buyer agent as it is today (G8s): modules, decision flow
   per message, data/evidence path, RFQ coordination, guards, the LLM components (writer, stance analyser) and the
   orchestration/testing tooling. Point out anything in the docs that is outdated or contradicts the code/log.
2. **Catalogue of all systems, grouped into families** (e.g. concession engines A..A10; LLM writer; Astra/Sol rounds
   A11/A12; D02 evolution G1-G5; game theory + AI deciders G4; alternative negotiators ALT-1..6; CS/SAFEZONE; G6-G10;
   stance; timid-target fixes R1-R3; outside-review ideas G9/G9v/G10). For each family: what it tried, the measured
   result, and your **judgement** (why it worked/failed, mechanism-level, citing the log), plus whether a re-test with a
   changed mechanism could be worth it.
3. **Cross-cutting lessons** about these supplier bots and about our process (what the sandbox can and cannot tell us,
   determinism, quota use, overfitting to D01/D02, integration bugs, how decisions were made). Be critical.
4. **Judgement of the current best (G8s)** - strengths, weaknesses per case (P01-P18, D01, D02), risks for the hidden final
   (unseen suppliers and case types, 5 waves x 8 minutes, up to 10 cases in parallel), robustness gaps.
5. **Improvements to G8s** - concrete, generic, ranked by expected value per effort; each with mechanism, trigger, target
   cases, expected gain (honest ranges), risk, why it is not a measured failure, and the cheapest test (sandbox first;
   practice only with the lead's OK).
6. **Different approaches** - genuinely different system designs worth considering (not repeats of ALT-1..6 unless you
   change the mechanism), with a realistic assessment of whether they could beat G8s within the time left.
7. **Final-readiness checklist** - what must be true before the final (robustness, timeouts, parallel load, unseen case
   types, fallbacks), and anything in the code/process that is a risk.
8. **Prioritised roadmap** - the next 5-8 steps in order, with test protocol and stop criteria.
9. ONE json block: {{"improvements": [{{"id": "S5-1", "title": "...", "section": 5, "targets": ["P18"], "expected_gain":
   "...", "effort": "S|M|L", "risk": "...", "test": "...", "spec": "..."}}], "approaches": [{{"id": "S6-1", "title": "...",
   "summary": "...", "worth_it": "yes|maybe|no", "why": "..."}}], "final_risks": ["..."]}}

Hard constraints for every proposal: generic rules only (no case/supplier IDs or prices from sandbox/practice); numbers
from code; never invented facts or figures (the arena checks claims and invented data is deceptive); only allowed options
and must-haves; no network waits under the RFQ lock; sandbox first, practice only with the lead's explicit OK. Ground every
claim in the material below and say "unmeasured" where it is a hypothesis.

=== 1. HOW THE APP WORKS (vault App/ docs + hand-over note; some docs may be outdated - say so) ===
{app}

=== 2. EXPERIMENT LOG E0-E60 (every change and its measured effect) ===
{log}

=== 3. CATALOGUE OF EVERY ALGORITHM / VARIANT (description | settings that differ from Config()) ===
{catalog}

=== 4. PRACTICE AND SANDBOX RESULT TABLES ===
{tables}

=== 5. CURRENT BEST G8s: PRACTICE CONVERSATIONS (trimmed per case) ===
{convs}

=== 6. OUTSIDE ADVICE WE ASSESSED ===
{advice}

=== 7. ENGINE Config (every switch) ===
{cfg_src}

=== 8. ENGINE / ADAPTER INTERFACE (excerpt) ===
{interface}
"""
Path("proto/astra/review4/prompt.md").write_text(PROMPT)
print("prompt chars", len(PROMPT), "variants", len(VARIANTS), flush=True)
text = o.call(o.ASTRA, o.ASTRA_EFFORT, PROMPT, "astra-review4")
Path("proto/astra/review4/answer.md").write_text(text)
try:
    j = o.extract_json(text)
    Path("proto/astra/review4/plan.json").write_text(json.dumps(j, indent=1))
    print("improvements", len(j.get("improvements", [])), "approaches", len(j.get("approaches", [])), flush=True)
except Exception as e:
    print("json parse failed", e, flush=True)
