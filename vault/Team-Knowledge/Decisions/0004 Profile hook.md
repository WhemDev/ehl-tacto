---
date: 2026-10-10
status: accepted
tags: [decision, agent, profiles]
---
# 0004 Profile hook: supplier type sets the orchestra's tactics

**Context.** [[0003 Generalise, don't overfit|0003]] built profiles for all 46 suppliers (`starter-kit/profiles/`,
`arena_kit/profiles.py`): archetype (+ secondary, confidence), situation (cash pressure, capacity, how much it needs
us / we need it, relationship, who decides), wants, protects, trades, arguments, avoid, tone. The hidden cases most
likely use the ~24 suppliers practice never shows, so the agent should learn *type → strategy*, not supplier quirks.

**Decision.** `arena_kit/strategy.py` turns a profile into the orchestra's per-supplier tactics:
- **anchor** = the category goal's anchor × the archetype factor (blended 70/30 with the secondary archetype,
  scaled by confidence) × the situation (it needs us → harder; we need it → softer; under-used capacity → harder;
  strained relationship → softer; a protected price → softer, push on terms).
- **e** (Boulware) = the goal's × the archetype factor (capacity-constrained and near-monopolists concede sooner).
- **gives** = trades the type values, offered in MESO sheets 2 and 3 at equal C for us: cash-short → fastest payment;
  hungry for work → longer contract / more volume; family firm → longer contract, its own effective date;
  capacity-constrained → longer lead time, longer contract; near-monopolist → its index clause / date.
  A give that would cost more than 4 % of the price, or break a must-have, is dropped.
- **protect** = fields its profile says it will hardly move: we give it its own value there.
- **interest** = the supplier's cost of money (ours + 0.3 × cash pressure) for the relationship charge of strategic
  goals - paying a cash-short supplier faster then lets the price drop without squeezing its margin.
- **voice** for the writer: who it is, tone, who decides, what it values, talking points (IDs stripped), what to avoid.

Archetype table: `strategy.ARCHETYPES`; tune without code via `ARENA_STRATEGY` (JSON or a file, works in
`experiments/variants/*.json` "env"); `ARENA_PROFILES=off` switches the hook off for A/B.

**Evidence so far** (practice, see [[Practice learnings]]): P07's hungry-for-work supplier: "the 36-month contract
provides mutual stability, which allows us to improve our offer"; P11's cash-short supplier asked for faster payment
every round (its profile said so; payment days were fixed in that case). A/B profiles vs none: batch 1 P01 0.76 vs
0.72, P04 0.86 vs 0.86; batch 2 (8 cases) running.

**Consequences.** Rebuild the profiles after the Sunday 08:00 release (`uv run python -m arena_kit.profiles`) before
the final. A supplier without a profile gets the goal's defaults.
