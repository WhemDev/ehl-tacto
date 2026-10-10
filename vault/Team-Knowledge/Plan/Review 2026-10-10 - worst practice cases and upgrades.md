---
date: 2026-10-10
tags: [review, practice, improvements]
---
# Worst practice cases: where the money went, and the upgrades

Board at 17:40: **#3 with 69.8** (TakeTheMoneyAndRun 74.1, NoIdea 72.1), 70 practice sessions used, 130 left
(the quota resets Sun 13:28, after the final). Sources: the replays and supplier back offices of all 42 finished
sessions of the weak cases (free GETs, `logs/practice_states.json`), the arena's own cost formula
(`cost_breakdown`), the data package, Tugra's vault and branch `tugra` (A4-A6), and Sudeep's three branches.

## The seven weakest cases

The gap is the price that would have reached C_best with the deal's own terms. "Lost on terms" means cost
components we could have avoided at the same price.

| Case | Type | Team best | Deal | Price for C_best | Lost on terms | What went wrong |
|---|---|---|---|---|---|---|
| **P18** | raw material | **0.39** | €5.50 | €4.58 (−17 %) | index clause with **0 % deadband**: €7.0k | final at round 3; nothing we cited counted |
| **P08** | raw material | **0.52** | €5.38 | €4.94 (−8 %) | index clause with **0 % deadband**: €27.5k | the same supplier pattern |
| **P05** | RFQ, 3 suppliers | 0.61 | €30.00 | €26.26 (−12 %) | 14-day payment: €2.6k | all three final at €30-32 by round 3-4; Tugra's A5 timed out (0.00) |
| **P10** | capacity | 0.68 | €31.50 | €27.38 (−13 %) | **56-day lead vs our 42-day need: €33.6k** | final at round 2 |
| **P02** | price increase, copper | 0.68 | €359.45 | €362.78 (+1 %) | **relationship charge €35.5k**, copper-clause risk €17.6k | we squeezed it below its sustainable margin |
| **P07** | bundle | 0.71 | €5.43 | €4.99 (−8 %) | none | it kept asking for "more volume" |
| **P11** | quality | 0.71 | €45.50 | €43.77 (−4 %) | none (freight is fixed: FCA) | it kept asking for faster payment (fixed) |

## What the replays show

1. **Raw material (P08, P18): the same supplier pattern.** The suppliers open about 4 % above today's price.
   They insist on the AS-14404 index clause for any contract over 12 months, make one big step in round 1, then
   €0.05-0.10 steps, and go final at round 3.
   - **We offered the clause with a 0 % deadband ourselves.** It is the dearest option for us: at the same price, a
     5 % deadband is €23k cheaper on P08 and €5.9k cheaper on P18. The suppliers priced the 5 % deadband at only
     +€0.05-0.12 in their own alternatives.
   - **Our old build argued for the supplier.** It cited AS-14404 +5.9 %, PPI-C2431 +12.3 % and LCI-C +2.7 %, and
     got "Your figures confirm our case: that driver rose." (Fixed since `78774e4`, but now we have almost nothing
     to cite there.)
   - **Evidence neither agent uses:**
     - (a) **P18: we buy the same 1.4404 bar from the other supplier at €5.45/kg** (`po:4500014455-10`,
       24 Sep 2026), 6.7 % below Werdenfels' €5.84. Both agents only cite the supplier's own orders ("holds,
       but does not change our calculation").
     - (b) **Both main cost drivers have fallen since June:** AS-14404 −5.5 % (`idx:AS-14404@2026-06` →
       `@2026-09`) and PPI-C2431 −2.3 % (`@2026-06` → `@2026-08`). Over 12 months both rose, so 12-month windows
       hide this.
     - (c) **Its own history:** in each of its last three renewals of this part it settled 3-4 points below its
       ask (EV-2024/2025/2026-70740-370010: −2.4 → −5.7, −2.6 → −4.5, −0.6 → −4.2).
2. **P10 (capacity): lead time cost more than price.** We offered a 56-day package at "equal C", with a lower price
   to make up for our late-delivery cost. The supplier took the 56 days, kept its price and went final in round 2.
   At the same €31.50, 42 days would have saved €33.6k (+0.056).
3. **P02 (copper, stabilise): the opposite mistake.** We got the price low enough that it falls below the
   supplier's sustainable margin. The relationship charge (€35.5k) and the copper clause's risk (€17.6k) cost
   more than the price saved. A higher price without the clause was better. Tugra's engine got this deal (0.68);
   ours scored 0-0.18 there.
4. **P05 (RFQ): each verified fact moves a supplier once.**
   - In round 1 every new fact was "taken into account": an index, a scorecard, the should-cost, the first rival
     quote.
   - Repeats got "holds, but it does not change our calculation". A repeat of the same rival quote was flagged
     "duplicate" ("you just sent the exact same rival quote again").
   - By round 3-4 all three suppliers were final. The cheapest opener (70240, Czech, €31.50) walked away in round 5.
5. **Suppliers ask for things the case has fixed** (P07, P11, P08: "more volume", "faster payment"). Every round
   spent on it is lost.

## How far behind the case records we are (Tugra's run tables)

| Case | Team best | Case record (holder) | House agent | Gap to record |
|---|---|---|---|---|
| P18 | 0.39 | 0.673 (NoIdea) | 0.386 | **−0.29** |
| P05 | 0.61 | 0.824 (TakeTheMoneyAndRun) | 0.555 | **−0.21** |
| P08 | 0.52 | 0.647 (NoIdea) | **0.752** | **−0.13** (−0.24 to the house agent) |
| P11 | 0.71 | 0.794 (TakeTheMoneyAndRun) | 0.314 | −0.08 |
| P07 | 0.71 | 0.779 (sellm) | 0.782 | −0.07 |
| P01 | 0.88 | 0.932 (Boo) | 0.966 | −0.05 |
| P02 | 0.68 | 0.684 (us) | 0.74 | − (−0.06 to the house agent) |

Other teams prove P18, P05 and P08 can be pushed much further. P18 and P08 alone are a third of the gap to #1.

## What teammates found (Tugra's vault E15-E27, branch `tugra` A4-A6, Sudeep's branches)

- **Tugra's raw-material history** (P18: A 0.29 → A3 0.28 → A4 0.25 → A5 0.27; P08 0.35-0.48):
  - A2 only met a clause the supplier had kept for two offers in a row. A4 meets it at the first insistence, but
    the A4 ask was too low and the supplier hardened.
  - A4 and A5 dropped the clause again in round 3 (bug). A6 keeps the met clause for good and recalls the
    supplier's best earlier offer (never played on practice).
  - **A6 still meets the clause at the supplier's own deadband (0 %)**, the dearest option for us.
- **The house agent got 0.75 on P08.** Tugra's notes: our 14-day payment there cost €10.5k, while 90 days would have
  saved €6.9k (≈ 0.10 score); Donautal valued 90 vs 30 days at only €0.05/kg.
- **P05 zero (A5, `b371991467d124b0`).** Two suppliers had agreed (€29.27 and €29.97). The in-flight close guard
  (from A2, also in A3) held the accept while a rival reply was pending. Replies took 48-113 s under load, so the
  accept arrived 60+ s after the supplier's move: `late` → `422 not a standing offer` → no deal.
  - A6 accepts agreed/final offers at once and recovers from a failed accept.
  - **Our hybrid runs A3, which has the same guard.** In the final, under load, it can lose an RFQ the same way.
- **Lead time.** Suppliers price overtime into short lead times: Hrvelec in P05, "A shorter Lieferzeit means
  overtime; that is priced in". Every P05 deal used 28 days although our need is 35. Ravensteiner's (P10) standard
  lead time is 42 days, exactly our need, yet we gave it 56.
- **What suppliers ask for and never got.**
  - Binding volume or forecast data (P05, P07, P08, P18).
  - Paying invoices on time (P11: "we really need you to pay your invoices on time"). In P05 "we will fix that" got
    "that helps us a lot".
- **A6** (sandbox D01 0.982, D02 0.696-0.710 vs A3's 0.740) adds:
  - P02: the tight equal-cost tolerance, so the supplier can no longer pick a dearer clause package.
  - P07, P11: target priors of 15/8/8 % below the opening (leverage/routine/quality).
  - Price-freeze terms, and our data attached when the supplier asks for it.
  - None of it has been played on practice.
- **Sudeep** (sandbox only):
  - The evidence trader showed every new verified fact moves J1 once, and an ask without new evidence made it final.
  - The A_hybrid schedule tweak gave no gain over A6.
  - In his A_hybrid batch, 4 of 20 runs failed on the 10-session limit.

## Upgrades, by expected points

| # | Upgrade | Cases | Agent | Expected | Effort |
|---|---|---|---|---|---|
| 1 | **Clause right from round 1:** every package carries the supplier's index clause at the **largest deadband (5 %)**, 90-day payment, 36 months; push the base price. Never offer a 0 % deadband. | P08, P18 (+ final raw-material wave) | orchestra (+ tell Tugra: A6 meets at 0 %) | P08 +0.13 / P18 +0.08 at the same price | small |
| 2 | **New evidence for raw material and leverage:** (a) cheaper POs for the same part at another supplier (P18 `po:4500014455-10` €5.45; also P04); (b) cost drivers that fell recently although up over 12 months (AS-14404 −5.5 %, PPI-C2431 −2.3 %: P05, P08, P09, P13, P18); (c) never a rising index | P18, P08, P05, P04, P13 | both | unknown, likely the biggest on P18 (the record is 0.67) | medium |
| 3 | **Lead time:** never offer beyond our need; within it, the supplier's standard lead time (no overtime) | P10 (42 d: +0.056), P05 (35-42 d instead of 28) | both | +0.05 on P10; P05 price | small |
| 4 | **RFQ accept fix (A6):** accept agreed/final offers at once, recover from a failed accept | P05 + every RFQ in the final | engine in the hybrid | avoids a 0 (lost a 0.7 deal) | small (port from A6) |
| 5 | **Answer what they ask:** binding volume with the forecast ID, "we pay on time" (P11), the fixed terms at once | P05, P07, P08, P11, P18 | both | small but cheap | small |
| 6 | **Bundle volume framing:** the bundle moves parts to it that we buy elsewhere today | P07 | engine | the record is 0.78 | small |

**Validation:** unit tests and arena-sim for plumbing (free). The suppliers' reactions can only be checked on
practice: P18, P08, P10, P05 (4 sessions), then the per-type pass of the final build (~7).
