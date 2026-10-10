---
tags: [plan, report, practice]
created: 2026-10-10
status: snapshot 16:00
branch: arda
---
# Report 2026-10-10 · profile hook and practice A/B

**In one line:** the orchestra now reads each supplier's profile, 30 practice sessions turned five zeros into deals,
and we are **#2 on the practice board: 60.1, 10/10 deals** (was 28.8, 5/10 at 15:00; leader y/agent 63.0).

## Summary
- **Built:** the profile hook (`arena_kit/strategy.py`, [[0004 Profile hook]]) - each supplier's archetype and
  situation set its anchor, concession speed, trades to offer, protected fields and the writer's voice.
- **Measured:** profiles vs no profiles on all 10 hosted cases: **58.0 vs 56.8** (mean × 100). Half the cases ended
  at identical terms. The hook's numbers barely change outcomes; its trades and tone show up in the replies.
- **Fixed** six bugs that only real suppliers exposed (crashes, a deal worse than the opening, an accepted first
  offer, abandoned sessions blocking the key, timid anchors, a concession curve aimed at the wrong price).
- **Learned** how the hosted suppliers behave (section below) - mostly about *our* numbers, not their quirks.

## Practice sessions (30 of the 25-30 budget; team quota left: 159)
| Batch | Time | Sessions | What |
|---|---|---|---|
| 1 | 14:39 | 11 | A/B profiles vs none, all 10 cases - 4 crashed, 7 blocked by the open-session limit (no quota) |
| 2 | 14:52 | 16 | A/B on the 8 cases batch 1 missed, after fixes `dce12e5` |
| 3 | 15:55 | 3 | validation of fixes `3d78de2` on P02, P05, P18 |

## Results per case (score 0-1; best per case is what the board counts)
| Case | Type · goal | Room open→best | Profiles | No profiles | After fixes | **Best** |
|---|---|---|---|---|---|---|
| P01 | price increase · stabilise | 4.9 % | 0.76 | 0.72 | - | **0.76** |
| P02 | price increase · stabilise | 2.1 % | 0.16 | 0.00 | 0.18 | **0.18** |
| P03 | renewal · stabilise | 7.9 % | 0.83 | 0.83 | - | **0.83** |
| P04 | renewal · routine | 1.2 % | 0.86 | 0.86 | - | **0.86** |
| P05 | RFQ, 3 suppliers · leverage | 26.9 % | 0.29 | 0.30 | 0.41 | **0.41** |
| P07 | bundling · routine | 23.5 % | 0.70 | 0.69 | - | **0.70** |
| P08 | raw material · leverage | 15.5 % | 0.52 | 0.52 | - | **0.52** |
| P10 | capacity · secure supply | 31.2 % | 0.66 | 0.66 | - | **0.66** |
| P11 | quality · quality first | 11.6 % | 0.63 | 0.71 | - | **0.71** |
| P18 | raw material · leverage | 24.6 % | 0.39 | 0.39 | 0.32 | **0.39** |
| **Mean** | | | **58.0** | **56.8** | | **60.1** |

Sandbox (free, demo suppliers), same code line: D01 0.77-0.83, D02 0.40-0.46. Run notes per session: `Runs/`
(agent `orchestra+profiles2`, `+noprofiles2`, `+fixes3`, …). Table from the event log:
`uv run --directory starter-kit python ../scripts/compare_runs.py profiles2 noprofiles2 fixes3`.

## Bugs found in practice, and the fixes (branch `arda`)
| # | Seen in | Problem | Fix (commit) |
|---|---|---|---|
| 1 | P02, P03 | quote PDFs list only some standard terms → analysis crashed | fill from the opening offer and our plan (`dce12e5`) |
| 2 | batch 1 | a crashed case left its session open; 4 abandoned + 8 running hit the 10-session limit, 7 cases never started | crash-safe close (never abandon), wait for a free slot (`dce12e5`, `47c0ad4`) |
| 3 | P05 | an expensive supplier's worker accepted the cheapest rival's *opening* at round 0 → 0 | accept against that supplier's own curve, never a first offer (`dce12e5`) |
| 4 | P02 | should-cost (374.95) above the quote (370.96) made the quote look like a squeeze; a sheet priced *above* the quote was agreed → deal worse than the opening, 0 | one measure (the arena's C) everywhere; full cost capped so the opening keeps a sustainable margin; never offer above their standing offer (`3d78de2`) |
| 5 | P05 | instant agreement accepted while a cheaper rival still talked | RFQ: anchor below the cheapest rival quote; hold an early agreement as the bar (`3d78de2`) |
| 6 | P05 | German should-cost above every opening | country factors; a generic estimate is only a weak floor (`dce12e5`, `3d78de2`) |
| 7 | P11 | concession curve aimed at the opening price → we asked their own price from round 3 and they stopped | curve aims at their *current* offer (`dce12e5`) |
| 8 | P18 | supplier added an index clause; we never offered one back | fields it moved to become trades at equal C (`3d78de2`) - not yet effective, see open issues |

## What the hosted suppliers taught us
1. **The deal lands near our first ask.** Where there was room (P05, P07, P11, P18) our anchor was the limit, not
   their floor. Bolder goal anchors (`dce12e5`) helped P05 (0.29 → 0.41).
2. **They end fast:** final offer or agreement after 2-4 of our messages (P01 r2, P04 r2-3, P07 r3-4, P08 r3,
   P10 r2, P18 r3). Our 5-round plan with a slow Boulware start rarely reaches the bigger concessions (P18: our
   target moved 0.5 % in 3 rounds, then they went final).
3. **No move from us, no move from them.** P07: "As your proposed price remains unchanged, we must maintain our
   offer." P11: "Since you didn't bring any new data to the table, our price stays."
4. **Data is checked, rarely decisive:** "it holds, but it does not change our calculation". New data each round
   matters more than more data at once.
5. **Profile trades land:** P07 (hungry for work): "the 36-month contract provides mutual stability, which allows us
   to improve our offer." P11 (cash-short, as profiled): "Faster payment would help us more than anything" -
   every round, but payment days were fixed in that case.

## Open issues and next steps (merged with [[Review 2026-10-10 - where the points are]])
1. **Final timing (risk):** `CLOSE_BEFORE_CAP_S = 75` is less than one supplier reply + a plan; use the kit's
   `max(90, slowest round + 15)` and plan rounds from `seconds_left`. Final command: `--agent orchestra`, not `llm`.
2. **Plan 4 rounds, concede visibly from round 1** (lesson 2) - test on the persona simulator, then 1 practice pass.
3. **Profiles only raise the anchor** (floor at the goal default) and pick trades/voice - the A/B shows no gain from
   their softer anchors; the review found them timid in 7 of 10 cases.
4. **Free lever:** longest `contract_months` ≥ horizon in every sheet where it costs nothing (P03, P07).
5. **Raw material (P08 0.52, P18 0.39, room 15-25 %):** index clause with deadband + a much lower base price is
   probably where C_best is; our clause trade came too late (they went final at r3).
6. **Claims pool:** add `po:` price history, `cost:`, `news:` rows - one fresh verified fact per round.
7. **Say what is fixed:** when a supplier asks for a fixed term (P11 payment, P07 volume), say so in the e-mail.
8. **Sunday 08:00:** `arena data` → rebuild profiles → `arena vault suppliers` → one practice case on the final
   machine. Keep ~40 practice sessions for Sunday.
