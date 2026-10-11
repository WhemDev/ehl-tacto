---
date: 2026-10-11
tags: [research, suppliers, mechanics, plan]
---
# How the supplier bots decide (research, night of 10-11 Oct)

Six analysis tracks over **all 1,572 sessions on our key** (309 practice, 1,263 sandbox; traces, supplier reasons,
back offices), the case files and the arena's cost formula. Four tracks finished their checks; the rest is marked.
Numbers are from code on the dump (`/v1/sessions` + `/v1/sessions/{sid}` + back office, free GETs).

## The opponent, as far as we can tell
1. **The numbers come from rules over our term sheets; the LLM writes the e-mail.** Same history of term sheets,
   fresh replies: identical terms in 77-83 % of pairs even when our text differed; identical status in 98-99.9 %.
   Our wording is a small lever (style search 0.699-0.721; writer tests: parity).
2. **Round 1 is a recomputation that sets most of the case.** The first counter delivers 64-100 % of everything a
   supplier ever concedes (P08 64 %, P18 46 % of the room, P03/P04/P10 ~100 %). It hardly follows our ask: P08
   answers 5.45-5.52 whether we ask 5.06 or 5.43. An ask far beyond the room hardens it (probes: P08 asked 5.00 ->
   5.72; P18 asked 4.95 -> 5.60).
3. **Each persona goes final at a fixed round**: P10 R1 (24/30), P18 R3 (30/31), P04 R3, P07 and P11 R4, P08 R3-5.
   In between it is reciprocal: our move + a new fact that lands -> counter 85 %, 1.97 % mean; a move without a
   fact 0.33 %; neither -> hold 69 %. Some personas price on a grid (P05, P11 EUR 0.50; P18, P10, P01 EUR 0.10).
4. **The endpoint is a plateau far above the floor.** In floor-bound cases (leverage, routine, quality, capacity,
   RFQ) suppliers stop 4-15 % above the price that C_best implies (P10 +15 %, P18 +14-15 %, P05 +10 %, P07 +9 %,
   P08 +5-7 %, P11 +4 %). Records sit 1-4.5 % below our endpoints. In stabilise cases we already reach ~C_best.
5. **C_best is reproducible offline** (to EUR 0.01): min over supplier x lever options x price above a hidden floor
   of `total_cost`, relationship charge included. The arena's true supplier: full cost = its own should-cost / 1.02;
   cash rate ~9-9.6 % (family/founder) or 6.1-6.6 % (group); payment-only alternatives reveal it (P02 6.6 %).
6. **Two real "extra step" mechanisms, both visible in the e-mail:**
   - *Approval:* "Any further step needs approval from our management." With one more ask below its offer the next
     reply carried the approval 31 of 40 times (median -1.3 % of price, 0 walk-aways). We threw 39 away by
     accepting in that round (P02 6c1f4006871e6587: accepted at the band end, 0.157).
   - *Rival half step (RFQ):* a verified rival price >= ~5 % below its standing offer -> "We need to clarify this
     internally - we will come back to you on price" (half step, ~11-14 % of C), the rest on its next reply. Once
     per supplier; owner-run suppliers fire in R1 (J1, Dralveck), export managers rarely (Hrvelec never).
7. **Final offers:** a timeout after a final offer ends the thread 77/81; a message without a term sheet keeps it
   alive 29/29; mirroring its own alternative is agreed 156/156; a lower ask on the same package gained 0 of 53
   practice pushes and lost 2 suppliers (decision 0008 stands).
8. **Levers:** contract length is worth 0 to the bots (8/8 alternatives); the deadband is a wash; C_best always
   uses an extreme payment term (fastest if the supplier's cash rate > our 8 %, else 90 days); long-lead suppliers
   charge ~0.5 % of price per day of acceleration while our late cost is flat (P10: 42 vs 54 days = +EUR 1.9/unit).

## What we tested tonight (AI brain, fresh replies)
| Idea | Result |
|---|---|
| First ask -6 % (`knob-anchor6`) | 0.672, **but it changed round 1 in only 3 of 10 cases** |
| Six holds / linear curve | 0.701 / P02 0.46 |
| Fact planner + RFQ rival loop | 0.715 (= A9h) |
| Firm far ask + management request + 36-month "volume" framing (probes P08, P18) | both hardened, both withdrew after a push: no deal |
| Landing facts first (`A9h-landing`) | P08 0.560, P18 0.497: no gain |
| Cash rate from payment alternatives (`A9h-payrate`) | inside the usual ranges: no gain |
| Clause package at its cheapest payment term (P02) | **0.735 x 5 vs 0.63-0.68: in the final build** |

## Caveats
- **The arena caches replies** keyed on the whole conversation: a byte-identical mail gets the stored reply in
  < 3 s. 13 % of practice sessions were replays (e.g. the 19:04 pass = the 18:49 pass). Guard: median reply >= 15 s.
- **The AI budget runs dry**: practice and sandbox fell back to a rule-based brain at ~23:45 and came back at
  ~00:00 (reset at midnight). Sunday morning may hit the fallback again. The final is never affected.

## RFQ: the rival trigger, used properly (Sunday 02:40-03:20, AI brain, fresh replies)
A9h wasted the rival trigger. It picked the rival by *our* C among must-have-compliant sheets, sent the stagger lead
none, and showed the leader dearer rivals (D02: J1 at 15.00 was shown C1's 15.80, twice). Three flags on branch
`gap`, all off in A9h:
- `collect_owed` (`A9h-owed`): never accept on a reply that announces a step ("needs approval from our
  management", "need to clarify this internally"); ask once more; in an RFQ never close while a bidder owes it.
  Alone it changed nothing measurable (MAIN's paired P05/P02 check): the step came anyway.
- `rival_gap` (`A9h-rival`): from the first mail, cite the lowest-priced rival offer (any package; the supplier
  checks only the price) not yet shown, if >= 5 % below the recipient's own price; never a dearer one.
- `owed_hold` (`A9h-rival-hold`): while a supplier owes its step, keep our previous ask. A supplier agrees only at or
  above its own computed price, so a lower ask never costs price, and the rest arrives anyway.

| | A9h | A9h-rival | A9h-rival-hold |
|---|---|---|---|
| P05 (practice) | 0.61-0.69 (best ever 0.736) | 0.739 x2 (28.72) | **0.814 x2 (28.00)** |
| D02 (sandbox) | 0.670 (n=6) | 0.724 x6 | **0.745 mean (n=6: 0.766, 0.745 x4, 0.724)** |

P05 path with hold: Dralveck shown Hrvelec's 31.50 -> 36.00 to 30.50 "clarify internally" -> we keep 26.93 -> final
28.00; Fuchsreiter (fired 5/28 before) shown a price 18-21 % below -> 38.50 to 30.50 -> 29.00 -> 28.50. Sessions take
~3 min. Single-supplier cases are unchanged unless an approval cue appears.

## Concede share while a step is owed (04:00, paired, AI brain 36-61 s)
MAIN's `owed_concede` (A9h since `e78168f`: 0.25 of the curve's step) vs 0.0 (`A9h-owedask0` on `gap2` = the hold above):
P05 0.846/0.846 (0.0) vs 0.846/0.814 (0.25); D02 0.682/0.745/0.724 vs 0.724/0.745/0.777 (13.40, new D02 best).
**A tie: A9h keeps 0.25.**

## Would an LLM reader find announced steps the regex misses? (04:10, offline, no quota)
Haiku labelled all 4,615 unique supplier replies (11,124 in 1,572 stored sessions): "does it announce a further step
on its next reply?". Outcome: after an open reply we answered with a lower ask, did its next reply move?
| | practice: n, moved, mean step | sandbox D02 |
|---|---|---|
| regex cue (LLM agrees on all but 1) | 28, **100 %, 5.95 %** | 630, 98 %, 5.85 % |
| LLM only | 12, 42 %, 1.6 % | 378, 85 %, 2.9 % |
| neither | 1,020, 63 %, 3.8 % | 5,030, 64 %, 4.4 % |
- The regex already catches every real announced step. The LLM-only hits are mostly the step being *delivered*
  ("we have clarified this internally and can move further", "management has approved") or conditional lever hints
  ("a binding higher volume would help us and can improve the price"); in practice they move *less* than the base.
- The cue texts are templates, identical across personas (P05 Dralveck 24, Fuchsreiter 5, P02 1): unseen final
  suppliers most likely use the same sentences. **No LLM reader.** Scripts: research session scratchpad `cues/`.

## Open
- ~~Adoption into the final build~~ done 03:45: A9h = rival trigger + announced steps collected, owed_concede 0.25 (`e78168f`, [[0007 The final build]]).
- Nobody has found what gets single-supplier records 1-4.5 % below our plateaus (P08, P18, P11, P07).
