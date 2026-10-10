---
agent: false
tags: [playbook, practice, learnings]
created: 2026-10-10
---
# Practice learnings (hosted practice suppliers, orchestra agent)

From the first A/B practice batch (orchestra with vs without supplier profiles, 2026-10-10 ~14:40) and the
suppliers' own reasons in the replays. Run notes: `Runs/` (agent `orchestra+profiles` / `orchestra+noprofiles`).

## What we saw
| Case | Room (open → best) | Our anchor | Outcome | Score |
|---|---|---|---|---|
| P01 price increase, stabilise | ~5 % | relationship optimum | supplier **agreed** to our 2nd sheet | 0.76 / 0.72 |
| P04 renewal, routine | ~1 % | 3-7 % below | final at round 2-3, ≈ best | 0.86 / 0.86 |
| P07 bundling, routine | **~23 %** | 6 % below | final 5.58 vs best ≈ 5.0 | 0.64 |
| P11 quality | ~12 % | 6 % below | final 46.00, held 3 rounds | 0.63 |

## Lessons (code changes in commit `dce12e5`)
1. **The deal lands near our first ask.** Suppliers follow our numbers; where there was room (P07, P11) our
   anchor was too timid. → bolder goal anchors (routine 12 %, leverage 16 %, quality 10 %).
2. **No move from us = no move from them.** P07: "As your proposed price remains unchanged, we must maintain our
   offer." P11: we asked the same target 3 rounds in a row and it went final. → the concession curve now aims at
   the supplier's *current* offer and stays below it until the last round, so every round is a real move.
3. **New data each round, not all at once.** P11: "Since you didn't bring any new data to the table, our price
   stays." Verified data rarely moves the price on its own ("it holds, but it does not change our calculation").
   Spread the arguments: one new one per round.
4. **The profile's trades land.** P07 (hungry for work): "Building on your second package, the 36-month contract
   provides mutual stability, which allows us to improve our offer." P11 (cash-short, as its profile says):
   "Faster payment would help us more than anything" - every round. Payment days were fixed in P11, so we could
   not trade them; where they are negotiable, offer them.
5. **Suppliers end fast:** final offer or agreement after 2-4 of our messages. Plan for 4-5 rounds.
6. **Operational:** a crashed case must close, not abandon its session (abandoned sessions block the key's 10
   open sessions for minutes); quotes may list only some standard terms.

## Batch 2 and validation (16:00)
Full A/B over 10 cases: profiles 58.0 vs none 56.8 - no measurable gain; half the cases ended identical. More
lessons: suppliers go final at round 2-4 (plan 4 rounds); an early `agreed` in an RFQ is the bar, not the deal
(P05 0.29 → 0.41); never offer above their standing offer (P02). Board: **60.1, #2, 10/10 deals**.
Details and next steps: [[Report 2026-10-10 - profile hook and practice A-B]].

## Open questions
- Does the bolder anchor make any supplier type walk away? (sandbox check, then practice batch 2)
- Profiles vs no profiles: P01 0.76 vs 0.72, P04 equal - not enough yet (batch 2: 8 more pairs).
