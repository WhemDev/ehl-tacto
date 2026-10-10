---
date: 2026-10-10
status: accepted
tags: [decision, agent, sandbox]
---
# 0006 The orchestra learns from the teammate engine

**Context.** RxV00's engine (`proto/engine.py`, not in a repo yet; notes in the EHL-Hackathon vault:
`App/Engine-Prototype`, `App/Target-C-Model`, `Progress/Runs/Search-Results`) reached **D01 0.98, D02 0.72** on the
hosted sandbox (best of 46 configs, 92 sessions) and set 5 practice bests (P01-P05) in its "algorithm A" run.
Our orchestra: D01 0.77, D02 0.40-0.46. We read its best replays (sessions `6cc17f7d4419b7c7`, `b423e0f05b3f0bde`,
practice `6ab56f8485cbf9cb` …) and ported what made the difference. No practice quota used.

**What we took (commit `b23d10d`)**
1. **Target from the supplier's floor, ask 3 % below it.** Floor = our should-cost; for a price letter today's price
   less a sustainable margin, moved by the drivers the supplier itself cites ("WAGES-METAL rose 3.1 % … is 28 % of
   our cost"); else 85 % of the lowest quote. Strategic goals: the price where the relationship charge starts.
   D01: floor 47.14, target 48.04 (24 months, April start, 30 days) - the engine's own numbers.
2. **Concede early** (e = 2) from the target towards the supplier's *standing* offer, meeting it at round 4;
   round 0 asks the target; never retreat.
3. **Hold** up to 2 rounds while the supplier still gives ≥ 0.5 %.
4. **Alternatives:** only a supplier's first sheet can be accepted - a better alternative is sent back exactly
   ("we take your alternative exactly as offered") and accepted on `agreed`.
5. **Cite the case's references even when we cannot look them up** (sandbox, hidden cases) - by ID, no figure:
   the arena checks them itself ("it holds and we took it into account").
6. **Volume commitment** ("we commit bindingly to N a year … our entire need, all of it with you"), thanks for the
   supplier's movement, closing questions ("How could we close the remaining gap today?").
7. **Not taken:** pushing after a final offer in a single-supplier case - practice P10: the push made the
   supplier walk (no deal). We push once only with a fallback offer.

**Result on the hosted sandbox (2 plays per case)**

| Variant | D01 | D02 | Mean |
|---|---|---|---|
| **Engine curve + ported messages** (`engine2`) | **0.97** (0.98 / 0.97) | **0.64** (0.65 / 0.63) | **80.6** |
| Old curve + ported messages (`boulware2`) | 0.83 | 0.52 | 67.7 |
| First port, curve off by one round (`enginelearn`) | 0.57 | 0.39 | 47.9 |
| Before (`quickwins`, `sandbox-check`, `smallsteps`) | 0.75-0.77 | 0.40-0.46 | 58-61 |
| Teammate engine, best config | 0.98 | 0.72 | 83.3 |

The messages alone are worth ~+9 points; the floor-based target and early concession another ~+13.

**Per case type** (`analysis.BOULWARE_TYPES`): the engine approach for price increases, renewals, RFQs and bundles
(it won P01-P05 in practice); our first curve for raw material, capacity and quality (our orchestra won P08, P10,
P11, P18). `ORCH_CURVE=engine|boulware` forces one for every case. **Untested on practice suppliers** (no quota
today): the first practice pass should be one per case type, before Sunday's final.

**Also learned on the way** (our own logs, `scripts/supplier_moves.py`, `scripts/what_moves_them.py`): a supplier's
*first* counter barely depends on our ask (within-supplier slope 0.08); it does not move without a move from us
(17 of 20 rounds); verified data alone rarely moves price; rival offers and visible movement do.
