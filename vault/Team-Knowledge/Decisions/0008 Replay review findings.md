---
date: 2026-10-10
status: accepted
tags: [decision, agent, practice, evidence]
---
# 0008 What 70 practice replays say, and the rules they changed

Three parallel reviews (20:10-20:35) of every practice session of ours (events log + arena states), the data
package and the arena's own cost formula. All rules below fire on case features, never on a case or supplier ID.

## Findings

1. **The arena's full cost = the package's should-cost / 1.0200** for every supplier with its own should-cost row
   (P01 1.0200, P02 1.0199, P03 1.0199; backed out of the supplier-health charges on 24 deals, r = the supplier's
   cash rate 0.06-0.10). Our engine used the should-cost itself, or capped it at opening/(1+margin) - fine for
   P02 (Nordmark opens 0.4 pt above its 0.5 % margin), 2 % high for P01/P03. With /1.02 the engine's own target
   lands on C_best for P01 and P03 (score-equivalent 0.62 → 0.998, 0.85 → 0.99) and at 0.66 for P02 (0.24 before).
   The target solver also scanned only €6 above the floor; P03's C-optimum lies €19 above - the window is now 15 %.
2. **P05's forecast citation was a phantom.** `answer_plus` cited the latest forecast row from the SQL tables,
   which is not in `facts.json`; the arena answered *"doesn't exist … that costs trust"* in every P05 run and
   the suppliers went final a round earlier (29.5 instead of 29.0). The adapter now cites only IDs it can look up
   (`tests/test_engine_refs.py` checks every hosted case).
3. **Suppliers go final right after a message with no new fact** (P08, P11, P07, P18: *"since you didn't bring
   any new data"*), and after a hold that repeats the same ask (*"you didn't move"*). The engine front-loaded
   2 + 5 + 1 facts and then sent empty rounds. Now: two facts in the first mail, one new one every round after;
   a hold rewinds the curve by three quarters of a round (the ask still moves a little).
4. **Pushes after a final offer gained nothing** in 5 tries (P05, P08) and risk a walk (P10): off.
5. **RFQ:** the stagger lead is the cheapest quote that keeps our must-haves (P05's cheapest, Hrvelec, opened at a
   52-day lead against a 42-day must-have, so citing its price to the others was no bar). Fact allocation (one
   shared fact to the leader only) was adopted at 20:15 (P05 0.720 vs 0.665-0.688).
6. **P02 is a clause case.** Nordmark agrees at once to any package with a copper clause (even €350) and holds
   €372-374 against no-clause packages; the arena's health charge puts its sustainable price at €367-368, so the
   best *acceptable* deal is the clause package at ≈ €359-361 (0.68-0.74), which the 3-holds build already gets.
7. **Raw material (P08, P18):** the first counter is the big step (−€0.55 to −0.70) and does not depend on our ask;
   a verified forecast or volume commitment buys one more step; 30-day payment and a 0 % deadband are priced by
   the suppliers at exactly what they cost us (a wash). Donautal's lowest ever: €5.32; Werdenfels stops at 5.40.
   The records (0.73 / 0.68) are not explained by anything in our replays.
8. **Unseen types** (the 9 case files never hosted) negotiate cleanly on arena-sim; P06 (two-supplier RFQ with a
   stabilise goal) opened 31 % below the quotes because the should-cost sits far under them → a first ask is now
   capped at 18 % below the lowest opening for every goal (hosted cases open 3-17 % below; the cap binds nowhere
   there).

## Build (A9h as of 20:45)
A9's rules + A6's RFQ play + 3 holds (quarter-step) + RFQ fact allocation + should-cost / 1.02 + facts 2 then 1 +
no pushes + compliant RFQ lead + first-ask cap 18 % + the phantom-ID guard. Writer: Sonnet 5.5 (parity, guards).

## What did not work tonight (10 sessions each unless noted)
6 holds 0.701 · first ask −6 % 0.672 · linear curve (P02 0.46) · supplier's-levers package (P01 −0.09) · three tone
styles 0.699-0.721 · more patience than 3 holds. Baseline: 0.721 (templates) / 0.726 (LLM writer).
