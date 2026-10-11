"""Astra round 3: ideas for improving G8s (ideas only - nothing is built or run from this)."""
import ast, json, re, sys
from pathlib import Path
sys.path.insert(0, "proto/astra")
from arena_kit.cli import load_env
load_env()
import orchestrate as o

VAULT = Path.home() / "Documents/Obsidian/EHL-Hackathon/Progress"
log = (VAULT / "Experiment-Log.md").read_text()
head = log[:log.find("### E0")] if "### E0" in log else log[:6000]
tail = log[log.find("### E35"):]
runs = VAULT / "Runs/2026-10-11-G8s-practice"
transcripts = "\n\n".join((runs / f).read_text() for f in ["table.md"] + [f"P{n:02d}.md" for n in (1, 2, 3, 4, 5, 7, 8, 10, 11, 18)] if (runs / f).exists())
src = Path("proto/engine.py").read_text()
cfg = next("\n".join(src.splitlines()[n.lineno - 2:n.end_lineno]) for n in ast.parse(src).body if isinstance(n, ast.ClassDef) and n.name == "Config")
rules = Path("proto/astra/review2.md").read_text().split("## 2.")[0]
interface = Path("proto/astra/alt/interface.py").read_text()
stance = (Path.home() / "Documents/Obsidian/EHL-Hackathon/App/Supplier-Stance-Analysis.md").read_text()

PROMPT = f"""You are Astra, the lead engineer of our hackathon team (Tacto Negotiation Arena, autonomous buyer agent). The team
lead asks you for POSSIBLE IMPROVEMENTS to our current best agent **G8s**. This round is ideas only: the lead decides which
to build; we test every change in the free sandbox first (D01 single supplier, D02 two-supplier RFQ) and only run hosted
practice cases with the lead's explicit OK (quota).

Where we stand
- G8s practice mean 0.731 (P01 0.956, P02 0.733, P03 0.924, P04 0.810, P05 0.659-0.710, P07 0.704, P08 0.614, P10 0.671,
  P11 0.710, P18 0.532); best other teams per case: P01 0.932, P02 0.684, P03 0.923, P04 0.874, P05 0.824, P07 0.779,
  P08 0.647, P10 0.679, P11 0.794, P18 0.673. Sandbox: D01 1.000, D02 0.70-0.79 (J1's landed floor is EUR 13.90 in 338
  runs; C_best assumes zero margin, realistic ceiling about 0.79).
- The 9 single-supplier practice bots are deterministic (same messages -> same replies), so a new message sequence is the
  only way to move them. Suppliers go final at about their 3rd-4th reply.

What you must respect
- Read the measurements (experiment log E35-E58 and the "current best" table): do NOT re-propose ideas that were measured
  to lose (slow/Boulware or firmer concessions, longer runway, bold first asks / floor priors without evidence, auctions,
  sealed rounds, RFQ barriers, 3-sheet menus, two-option sweeteners, LLM price/accept deciders, the six alternative
  negotiators, cluster/SAFEZONE, mirror jumps, offer memory on final offers, exclusive-volume wording) unless you change the
  mechanism and say exactly why it would now work.
- Generic rules only (no case or supplier IDs, no sandbox/practice prices); numbers from code; NEVER invented facts or
  figures (the arena checks claims; invented data is contradicted and deceptive); only allowed options and must-haves.
- Two outside reviews claimed "prompt gates" (e.g. "Which figures is that based on?") unlock discounts; our practice logs
  show that phrase arrives INSIDE the supplier's final offer. Ground every claim in the transcripts below.

What to deliver
1. A short diagnosis (max 25 lines): per weak case (P18, P05, P11, P07, P04, P08), the exact moment and mechanism where
   points are lost, quoting the transcripts.
2. 6-10 improvement ideas ranked by expected gain per effort, each with: mechanism, the generic trigger, which cases it
   targets, expected gain (be honest; small is fine), risk, why it is NOT one of the measured failures, and the cheapest
   test (which sandbox signal shows it is safe; which 1-3 practice cases would show it works). Mark ideas that can only be
   validated on practice.
3. What NOT to do next, and whether you think the remaining gap (~0.05 vs the board) is reachable by generic rules at all.
4. ONE json block: {{"ideas": [{{"id": "R3-1", "title": "...", "flag": "...", "targets": ["P18"], "expected_gain": "...",
   "risk": "...", "test": "...", "functions": ["Negotiator...."], "spec": "short implementation spec"}}]}}

=== EXPERIMENT LOG: current best table ===
{head}

=== EXPERIMENT LOG: E35-E58 (everything measured in the last two days) ===
{tail}

=== G8s PRACTICE RUN: every conversation, engine decision and stance read ===
{transcripts}

=== CHALLENGE RULES ===
{rules}

=== STANCE ANALYSER (words vs. actions on 3,683 replies) ===
{stance}

=== ENGINE: Config (every switch) ===
{cfg}

=== ENGINE / ADAPTER INTERFACE (excerpt) ===
{interface}
"""
Path("proto/astra/round3/prompt.md").write_text(PROMPT)
print("prompt chars", len(PROMPT))
text = o.call(o.ASTRA, o.ASTRA_EFFORT, PROMPT, "astra-round3")
Path("proto/astra/round3/answer.md").write_text(text)
try:
    j = o.extract_json(text)
    Path("proto/astra/round3/ideas.json").write_text(json.dumps(j, indent=1))
    for i in j.get("ideas", []):
        print(f"  {i['id']} {i['title']} | targets {i.get('targets')} | gain {i.get('expected_gain')}")
except Exception as e:
    print("json parse failed", e)
