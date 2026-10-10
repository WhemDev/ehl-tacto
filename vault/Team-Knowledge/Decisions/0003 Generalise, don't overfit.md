---
date: 2026-10-10
status: proposed
tags: [decision, agent, evaluation]
---
# 0003 Generalise, don't overfit: supplier profiles, a persona simulator, staged evaluation

**Problem.** The final has ~50 hidden cases in 5 waves. Up to a third of them combine supplier types and case types
that practice never shows. We can only play **10 hosted practice cases**, plus the 2 sandbox cases with 3 demo
suppliers. Quota is 200 sessions per 24 h for the whole team, about 20 full passes. Hosted suppliers are LLM-driven
and noisy. An agent tuned to those 12 cases will mostly learn noise and the practice suppliers' quirks.

**What the data shows.** `world.sqlite` has 46 suppliers with intel and negotiation history. Practice and sandbox
use 22 of them. The brief says the hidden cases have "new suppliers", so they are very likely the other ~24, and
we already have their data.

**Decision.**
1. **One buyer voice, no personas for us.** Warm, short, firm on numbers ([[App/Research-Negotiation-Techniques]]).
   Tone is not something we tune. The "desperate" persona stays out.
2. **Supplier profiles for all 46 suppliers, built offline before the freeze.** A strong model, no time limit,
   cached as JSON:
   - type (family firm with a memory / group with an approval ladder / cash-short job shop / near-monopolist / …);
   - cash pressure, how much work it has, how much it depends on us;
   - who must approve bigger moves, its likely cost floor (should-cost), and what it wants.

   Rebuild after the Sunday 08:00 release. The orchestra reads the profile, and its type sets the strategy
   parameters (anchor, Boulware e, levers to trade). The agent learns *type → strategy*, which carries over to new
   suppliers.
3. **A persona simulator from the same profiles.** An LLM supplier with a hidden floor and approval ladder, speaking
   the arena API (extend `arena-sim`). This gives 46 suppliers × 7 case types instead of 12 cases, including unseen
   combinations. Check it: replay our practice messages against it and compare its answers with the real replies.
   It earns trust only if it ranks our variants the way practice does.
4. **Numbers stay in code.** Unchanged from [[0002 Orchestra agent|0002]]: C, guards, accept rule, MESO,
   Boulware. Only a few parameters per goal or supplier type are tuned, not prompt wording.
5. **Every variant passes three gates:**
   - **Gate 1, free:** `starter-kit/experiments/` on the sandbox. Kill any variant with a timeout, a broken
     must-have, or a slow 95th-percentile turn.
   - **Gate 2, LLM cost only:** the persona simulator across many suppliers. Rank by mean score minus a heavy penalty
     for zeros.
   - **Gate 3, quota:** hosted practice, only for the top 2–3 variants.
6. **Overfitting controls:**
   - Measure noise first: the same agent 3× on 3 cases.
   - Keep 2–3 hosted cases untouched (one per distinct type) and don't read their replays until the finalists are
     validated.
   - Prompt and playbook rules name a supplier type or case type, never a supplier or a price.
   - Optimise the floor: one zero costs 10 points of a wave.
7. **Models.** Fix the harness first with one mid model, then swap models per role: profiles (strongest, offline),
   reader and writer (fast). Aim for under 20 s per turn. A **Claude ↔ GPT fallback** per role on 429 or timeout
   is worth more than an ensemble.
8. **Evolutionary search: only on the simulator, only over parameters.**
   - The genome is the parameters plus a short list of playbook rules, not free-form prompts.
   - Fitness is the persona simulator across many suppliers, with a holdout set of suppliers.
   - Mutation is reflective: an LLM reads the losing transcripts and proposes edits (GEPA-style), so it needs few
     rollouts.
   - The sandbox and practice only check the winners.
   - Never run evolution on the sandbox (2 cases) or practice (quota, and a shared limit of 10 sessions per key).

**Consequences.** Supplier profiles come first, because the simulator and the type → strategy mapping both need
them. Tuning against the 10 practice cases is out unless a change also holds on the simulator.

**Next.** Tasks in [[Progress/Tasks]]: profile builder, persona simulator, a type → parameters table in
`analysis.py`, provider fallback, a noise measurement.
