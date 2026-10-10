---
tags: [plan, review]
created: 2026-10-10
status: snapshot 15:00
---
# Review 2026-10-10 · where the points are

Snapshot of the practice standings, what each zero was, and what to change next. Numbers from `GET /v1/sessions`
and the arena results (c_open / c_best per case), code from commit `47c0ad4` + the uncommitted working tree.

## Standing (practice board, ~15:00)
| Rank | Team | Total | Deals |
|---|---|---|---|
| 1 | Boo | 49.0 | 10/10 |
| 2 | y/agent | 45.9 | 10/10 |
| 3 | **makeAnother.md** | 28.8 | 5/10 |

The board counts the best score per hosted case, mean × 100. Our zeros are the gap, not our deals: our five deals
average 0.72, which would be first place if every case closed like that. Quota: 178 sessions left at 15:00.

## Room per hosted case (from the arena's own c_open / c_best)
| Case | Type · goal | Room open→best | Our best | What happened |
|---|---|---|---|---|
| P01 | price_increase · stabilise | 4.9 % | 0.76 | deal, supplier agreed to our 2nd sheet |
| P02 | price_increase · stabilise | 2.1 % | 0.16 | crash (analysis), then a rerun whose *opening sheet was priced above the supplier's own quote* → 0 |
| P03 | renewal · stabilise | 7.9 % | 0.83 | crash (analysis), then 0.83 on the rerun |
| P04 | renewal · routine | 1.2 % | 0.86 | deal |
| P05 | rfq · leverage | **26.9 %** | 0.00 | accepted the first offer after 0 messages (fixed in `dce12e5`); should-cost floor 37.61 above all three openings |
| P07 | bundling · routine | **23.5 %** | 0.64 | final offer after 3 rounds: "your proposed price remains unchanged" |
| P08 | raw_material · leverage | 15.5 % | 0.00 | only the 13:28 baseline batch, timed out - never replayed |
| P10 | capacity · secure_supply | **31.2 %** | 0.00 | only the baseline batch, timed out - never replayed; no alternative, must-have volume ≥ 22,230 |
| P11 | quality · quality_first | 11.6 % | 0.63 | 4 rounds of the same ask, supplier wanted faster payment (fixed term) |
| P18 | raw_material · leverage | **24.6 %** | 0.00 | only the baseline batch, timed out - never replayed |

Four of the five zeros are cases the orchestra has never finished. P05, P10, P18, P08 and P07 hold 120 of the ~150
room-points on the board. Hidden cases share these types: RFQ, capacity and raw-material cases are where the final
is won.

## What the zeros and weak deals teach (code, not suppliers)
1. **Sheets above the supplier's own offer.** P02 `4d6d4f0f`: we opened 370.50 @ 14 d and 371.83 @ 30 d against a
   quote of 370.96 @ 30 d. Both sheets cost us *more* than the quote (C 2,286,896 / 2,287,027 vs 2,281,676). The
   supplier said `agreed` at once; the agent re-sent the same two sheets four times and closed at 0. Cause: the
   relationship estimate from the should-cost table (374.95 > the quote) says the supplier is already below its
   sustainable margin, so the "optimum" price is *above* the quote, and `solve_price` picks the rising side.
   Guard needed in `meso()` / `next_move`: drop any sheet whose C ≥ C(their standing offer) and ≥ the reserve;
   on `agreed` above our limit, lower the ask instead of repeating it.
2. **The should-cost table is not the supplier's cost.** P05: floor 37.61 vs openings 36.00 / 31.50 / 38.50 and a
   C_best of ≈ €26.6 per unit. P02: should-cost 374.95 vs a quote of 370.96 and C_best ≈ 365.9. The arena's own
   breakdown charged `relationship: 0` at 368.45. Treat should-cost as a weak prior: it may lower an anchor, never
   lift it above (1 − goal anchor) × opening (`analysis.py:358-362`, `min_price` at `:476`).
3. **Profiles make us timid.** With the hook on, anchors were 2.4 % (P10), 3.8 % (P02), 4.0 % (P03), 5.9 % (P04),
   7.1 % (P11), 8.3 % (P18), 9.4 % (P08) below the opening, while the room is 8-31 % in six cases. The multipliers
   (`strategy.ARCHETYPES`, dependency factors) shrink the goal defaults in almost every case. Practice says the deal
   lands near our first ask. Until the A/B shows otherwise, let a profile only *raise* the anchor and pick the
   trades; floor it at the goal default.
4. **A free lever we never pull.** `contract_months` beyond the horizon costs nothing (P03: C identical at 24 and
   36 months) and suppliers reward it (P07: "the 36-month contract … allows us to improve our offer"; P03: "we can
   talk about the terms instead - payment, volume or contract length"). `meso()` excludes coverage levers from the
   trades (`analysis.py:446`); only a profile `gives` entry adds them. Put the longest term ≥ horizon in every
   sheet of renewals, bundles and capacity cases.
5. **No new data → no move.** P07, P11, P02: once the two or three generated claims are spent, replies turn into
   "since you didn't bring any new data, our price stays". `claims()` only builds index, notice, rival-quote,
   scorecard and forecast sentences; it never uses `po:` price history, `cost:` or `news:` rows the brief lists as
   checkable. One fresh verified fact per round for five rounds needs a bigger pool.
6. **Suppliers ask for things outside the negotiable set** (P11 payment, P07 a volume commitment that is already
   fixed at 30,000). Say so in the e-mail ("payment terms are fixed in this enquiry; the term sheet binds 30,000
   kits a year") instead of leaving the ask unanswered round after round.

## Final-day risks (operational)
- **Timing.** A round is 5-11 s planning + up to 25 s writing + up to 60 s supplier. Five rounds can take 6-8 min;
  the wave cap is 8 min and `CLOSE_BEFORE_CAP_S = 75` (`orchestra.py:41`) is less than one supplier reply plus a
  plan. Use the kit's rule (`max(90, slowest round + 15)`) and derive the round budget from the seconds left.
- **Command.** CLAUDE.md and the Timeline still say `--agent llm` for the final; the orchestra is the agent.
- **Hold e-mails** to a `final_offer` supplier (RFQ) are untested on hosted suppliers: a no-move message may count
  as pushing. Check once in the sandbox D02.
- **Sunday 08:00:** `arena data` → rebuild profiles (`python -m arena_kit.profiles`) → `arena vault suppliers` →
  one practice case through the final machine. Hidden cases cite the release.
- **Quota.** 178 left. A full pass of the 10 hosted cases costs 10. Keep ~40 for Sunday morning.

## Priorities, in order of points per hour
1. **Play P05, P08, P10, P18 (and P07) to a deal with the fixed build** - 4 zeros × up to 10 board points, costs
   4-5 sessions. Read those replays before anything else: they are the case types with the most room.
2. **The two guards** (no sheet above their offer; `agreed` above limit → lower the ask). One zero in a wave of
   ten costs 10 points.
3. **Should-cost as a weak prior, profiles floor at the goal default** (findings 2-3).
4. **Longest contract term in every sheet where it is free** (finding 4).
5. **Claims pool: po / cost / news rows**, one new fact per round (finding 5).
6. **Final timing + command** (risks above), then a full `--parallel 10` rehearsal from the final machine.

## Split for the two running agents
- Orchestrator agent: guards, anchor floor, contract-months lever, timing (items 2-4, 6).
- Strategy agent: the never-finished case types - RFQ (P05: three threads, one at 31.50 with a 52-day lead time
  that breaks the must-have), capacity (P10: no alternative, must-have volume), raw material (P08/P18: index
  clause vs fixed price, AS-14404 path +6 %) - and the claims pool (items 1, 5).
