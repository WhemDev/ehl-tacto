"""Astra round 5: innovative ideas and different approaches, given everything measured up to E65."""
import json, sys
from dataclasses import asdict
from pathlib import Path
sys.path.insert(0, "proto/astra")
from arena_kit.cli import load_env
load_env()
import orchestrate as o
from proto.engine import Config
from proto.variants import VARIANTS

V = Path.home() / "Documents/Obsidian/EHL-Hackathon"
read = lambda p: Path(p).read_text() if Path(p).exists() else ""

log = read(V / "Progress/Experiment-Log.md")
base = asdict(Config())
catalog = "\n".join(f"- **{n}**: {d} | {json.dumps({k: v for k, v in asdict(c).items() if base.get(k) != v}, default=str)}"
                    for n, (d, c) in VARIANTS.items())
review4 = read("proto/astra/review4/answer.md")
round3 = read("proto/astra/round3/answer.md")
convs = "\n\n".join(read(p)[:9000] for p in sorted((V / "Progress/Runs/2026-10-11-G8s-practice").glob("P*.md")))
arena = read(V / "App/Arena-Workflow-and-Learnings.md")

PROMPT = f"""You are Astra, the lead engineer of our hackathon team (Tacto Negotiation Arena: an autonomous BUYER agent negotiates by
e-mail with LLM supplier bots; score per case = (C_open - C_deal)/(C_open - C_best) on total cost C). Our final default is
G8u (= G8s + truthful text fixes + safe exception paths). Practice mean ~0.73 (P01 0.956, P02 0.733, P03 0.924, P04 0.810,
P05 0.66-0.71, P07 0.704, P08 0.614, P10 0.671, P11 0.710, P18 0.532); sandbox D01 1.000, D02 ~0.70-0.79.

Since your full review (attached) we ran your roadmap to the end and more. Everything incremental is now equal or worse:
- E62/E63: launcher, audit, exception paths, text fixes (equal scores, safer).
- E64: your R3-2 shared-index skip halves duplicate claims but closes worse on P05 (0.688 vs 0.710, deterministic x2);
  duplicates cost nothing. S5-6 clause buy-out never fires: suppliers declare the clause mandatory.
- E65: "keep the negotiation longer" (slower curve T 8, repeated holds) LOST badly: P02 0.433 vs 0.733, P07 0.652 vs 0.704,
  P08 0.549 vs 0.614. These bots go final by REPLY COUNT (3rd-4th reply; D01's at the 6th) and MIRROR our pace.
- Earlier: Boulware/patience lost 7x; bolder anchors, floor priors, mirror jump, offer memory, figures answer, exclusive
  volume wording, adopted lane, alternative negotiators ALT-1..6, game-theory/AI deciders - all equal or worse.

What we know about the bots (from ~700 logged sessions; verify against the log):
- They finalise after a fixed-ish number of replies; each reply concedes a share that tracks our own visible concession.
- Verified data claims ("we checked the X data you cited; it holds and we took it into account") move their price;
  "it holds, but it does not change our calculation" does not. Up to 3 checked claims per message; IDs count once.
- They sometimes "agree" to our own package when it lands inside their acceptance zone (P01/P02 at reply 3).
- Single-supplier bots are deterministic (identical messages -> identical replies); RFQ (multi-supplier) is noisy.
- Structured terms they introduce (index clause) are mandatory for them.
- The final has unseen suppliers and case types: generic rules only.

YOUR TASK: think beyond tuning. Give us genuinely INNOVATIVE ideas and approaches we have NOT tried, designed around the
mechanics above (reply-count finality, pace mirroring, claim verification as the main lever, acceptance zone for our own
packages, deterministic single-supplier replies). Think, for example, about: how to get the most price movement out of a
fixed number of supplier replies; what makes a claim "change their calculation" vs not, and how to select/sequence claims;
how to find their acceptance zone (package design that they "agree" to); multi-issue logrolling within allowed options;
using the 60 s clock, message structure, attachments, the 3-claim budget and the reply budget; information they reveal
that we do not use; how to transfer this to unseen suppliers. Wild ideas are welcome if they are honest and testable.

For each idea: name, the bot mechanic it exploits (cite the log/transcripts), exact mechanism and trigger, why it differs
from everything in the log (name the closest failed experiment and the difference), expected gain (honest range, say
"unmeasured"), risk, and the cheapest test (offline replay of logs > sandbox D01/D02 > practice; practice only with the
lead's OK - quota is limited). Rank by expected value per effort. Then at most 3 "different approaches" (whole-system
redesigns) with a realistic verdict. Finish with ONE json block:
{{"ideas": [{{"id": "I1", "title": "...", "mechanic": "...", "spec": "...", "targets": ["..."], "expected_gain": "...",
"effort": "S|M|L", "risk": "...", "test": "...", "closest_failed": "..."}}], "approaches": [{{"id": "X1", "title": "...",
"summary": "...", "worth_it": "yes|maybe|no", "why": "..."}}]}}

Hard constraints: generic rules only (no case/supplier IDs or prices); numbers from code; never invented facts or figures
(the arena checks claims; invented data is deceptive and forbidden); only allowed term options and must-haves; sandbox
first.

=== ARENA RULES AND LEARNINGS ===
{arena}

=== EXPERIMENT LOG E0-E65 ===
{log}

=== EVERY VARIANT (description | settings that differ from Config()) ===
{catalog}

=== YOUR FULL REVIEW (E61) - do not repeat these ideas unless you change the mechanism ===
{review4}

=== YOUR ROUND 3 IDEAS (E59) ===
{round3}

=== CURRENT BEST: PRACTICE CONVERSATIONS (trimmed per case) ===
{convs}
"""
Path("proto/astra/round5/prompt.md").write_text(PROMPT)
print("prompt chars", len(PROMPT), flush=True)
text = o.call(o.ASTRA, o.ASTRA_EFFORT, PROMPT, "astra-round5")
Path("proto/astra/round5/answer.md").write_text(text)
try:
    j = o.extract_json(text)
    Path("proto/astra/round5/ideas.json").write_text(json.dumps(j, indent=1))
    print("ideas", len(j.get("ideas", [])), "approaches", len(j.get("approaches", [])), flush=True)
except Exception as e:
    print("json parse failed", e, flush=True)
