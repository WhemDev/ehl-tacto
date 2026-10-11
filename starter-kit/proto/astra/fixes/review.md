---
tags: [runs, practice, G5-1, report, improvements]
created: 2026-10-11
---
# G5-1 on the 10 practice cases (11 Oct 2026, 01:10) – what happened and what to improve

Run: 10 practice sessions (quota), variant **G5-1** (current best). Every conversation in full text (fetched from the
arena), our engine's decisions and the supplier stance per message are in the case files: [[P01]] [[P02]] [[P03]]
[[P04]] [[P05]] [[P07]] [[P08]] [[P10]] [[P11]] [[P18]]. Raw data: `summary.json`. Generator: `proto/full_report.py`.

## 1. Results

| Case | Type · goal | **G5-1 now** | G5-1 run 1 | A10 | Board record | Gap | Deal | C_deal vs C_best |
|---|---|---|---|---|---|---|---|---|
| P01 | price increase · stabilise | **0.956** | 0.956 | 0.956 | 0.932 | **+0.024** | €133.40, Apr 2027, 14 d | +0.2 % |
| P02 | price increase (copper) · stabilise | **0.360** | 0.360 | 0.360 | 0.684 | −0.324 | €373.12, 90 d | +1.4 % |
| P03 | renewal · stabilise | **0.923** | 0.923 | 0.923 | 0.923 | ±0 | €432.15, 90 d, 24 m | +0.7 % |
| P04 | renewal · routine | **0.810** | 0.810 | 0.810 | 0.874 | −0.064 | €4.91, 60 d, 36 m | +0.2 % |
| P05 | RFQ, 3 suppliers · leverage | **0.659** | 0.665 | 0.659 | 0.824 | −0.165 | 70210 €29.50 DAP | +12.5 % |
| P07 | bundling · routine | **0.710** | 0.710 | 0.710 | 0.779 | −0.069 | €5.43 | +8.9 % |
| P08 | raw material · leverage | **0.603** | 0.603 | 0.603 | 0.647 | −0.044 | €5.42 + clause | +7.3 % |
| P10 | capacity · secure_supply | **0.671** | 0.671 | 0.671 | 0.679 | −0.008 | €31.70 (mirrored alternative) | +14.9 % |
| P11 | quality · quality_first | **0.710** | 0.710 | 0.710 | 0.794 | −0.084 | €45.50 | +3.8 % |
| P18 | raw material · leverage | **0.532** | 0.532 | 0.532 | 0.673 | −0.141 | €5.40 + clause, 90 d | +15.2 % |
| **Mean** | | **0.693** | 0.694 | 0.693 | 0.781 | −0.088 | | |

- **Deterministic:** 9 of 10 cases scored exactly as in the previous two runs - the single-supplier bots answer identical
  messages identically. Only the RFQ (P05) varies.
- **Claims:** all verified except P05 (14 verified, **7 duplicate, 4 contradicted**) and P04 (2 duplicate).
- **Every deal closes in 1–4 of our messages** (P05: 10 across three suppliers). 9 of 10 closed on our concession
  goal ("goal"), P10 on its immediate final offer.

## 2. What happened, case by case

**P01 (0.956, ahead of the board).** Notice-period evidence (letter 51 days vs contract 90) + should-cost: the foundry
accepted the 1 April 2027 start and 14-day payment at €133.40 in 3 messages. Nothing to fix - protect it.

**P02 (0.360, −0.32 - the biggest gap).** Room is only 2.1 %. The supplier refuses data ("Our calculation is our
property"); delivery and price-history evidence "holds, but does not change our calculation". We asked for 90-day
payment, and the supplier priced it in: €370.96 (30 d) → €372.65 (60 d) → €374.33 (90 d) → **€373.12 (90 d)**. We
accepted in round 3 **while the supplier was still open and moving** (stance move +0.45, stop_risk 0.10 = lowest band,
85 % of such suppliers concede again). A5 once reached 0.684 here with a copper-clause package at €360.32.

**P03 (0.923, = board).** Management has "frozen all price reductions until December 2027"; we used the freeze package
(price unchanged, better terms) and closed at €432.15 / 90 d / 24 m. Little left to gain.

**P04 (0.810, −0.06).** Tiny room (1.2 %); the supplier sits at €4.91 from its first reply and goes final in round 3.
It asked **"Which figures is that based on? Please send us the data"** - the strongest stop signal in our stance
analysis - and our re-cited IDs came back *duplicate* twice. An earlier alternative (€4.94, 90 d, 24 m) was €117
cheaper in C than the deal and disappeared.

**P05 (0.659, −0.17).** Three suppliers, staggered opening; deal 70210 at €29.50 DAP after its final offer. Two
problems: (1) **trust** - we cite `fc:320070@2026-09`, a forecast ID that exists in the SQL tables but **not in
facts.json**: *"I checked that forecast ID you sent and it doesn't exist, so I need real proof… That costs trust"*
(4 contradicted claims); (2) **7 duplicate claims** - the same rival-offer and index IDs re-cited to the same supplier.
Our target (€29.39) came from another supplier's should-cost capped at the opening, so we accepted as soon as a supplier
reached it; the board's 0.824 implies ≈ €28.30.

**P07 (0.710, −0.07).** Bundling. Delivery and history evidence do not move the supplier; verified volume + 36 months /
60 days do (€5.49 → €5.45 → €5.43). We mirror its final alternative and close. Deal 8.9 % above C_best.

**P08 (0.603, −0.04).** Raw material; the supplier introduces the index clause, we keep the cheapest (5 % deadband)
variant. Closed at €5.42 with the clause, **still open** (stop_risk 0.41).

**P10 (0.671, ≈ board).** First reply is already final (€33.60 primary, €31.70 alternative with 54-day lead); we mirror
the alternative (−€60k C) and close. A push here made it walk away in an earlier run - correct to take it.

**P11 (0.710, −0.08).** Quality-first. The supplier keeps asking for faster payment (fixed in this case) and "Please send
us the data"; quality evidence and on-time payment move it to €46.00 → €45.50; final in round 4 (stop_risk 0.60).
Quality / chargeback packages were never explored.

**P18 (0.532, −0.14).** Raw material, leverage. Opening €6.10 / 30 d / 12 m. Our first ask €5.33 (only 12.6 % below)
while C_best implies ≈ €4.7 and the board's 0.673 ≈ €5.13. The supplier adds the AS-14404 clause, moves €5.50 → €5.40 and
goes final in round 3; we accept on goal. Deal 15 % above C_best.

## 3. Patterns

1. **We stop while suppliers are still moving.** 4 of 10 deals were accepted from an *open* supplier (P01, P02, P03,
   P08), two of them with a low stop_risk. In our stance data, bottom-quartile stop_risk → 85 % concede again.
2. **Timid targets in leverage cases.** P05, P08, P18 close 7–15 % above C_best; our target captures only ≈ 53–66 % of
   the room when there is no supplier cost breakdown (our calibration audit said the same: leverage median 0.68).
3. **Evidence hygiene costs trust in RFQs.** Contradicted SQL-only IDs and duplicate re-citations (P05, P04).
4. **Data requests precede stops.** "Which figures is that based on? / Please send us the data" (P04, P11) - answer
   them at once with the proof attachment, without re-citing IDs.
5. **Single-supplier cases are deterministic** → every gain must come from a different message sequence; small
   generic rule changes are testable here with one session per case.

## 4. Improvements (ranked by expected gain per risk)

| # | Change (generic) | Evidence | Expected | Risk | Test |
|---|---|---|---|---|---|
| 1 | **Forecast-ID provenance:** cite a forecast (or any SQL-derived ID) only if it exists in `facts.json`; otherwise state the volume without an ID. Narrow fix - not U3's whole evidence rewrite (which cost D02). | P05: 4 contradicted, "costs trust" | P05 +0.02–0.05; protects every final RFQ | very low | P05 + D02 |
| 2 | **No duplicate claims:** never re-cite an ID already cited to that supplier; refresh the rival citation only when the rival's offer ID is new. | P05: 7 duplicates; P04: 2 | small, +trust | low | P05, P04 |
| 3 | **Stance-gated hold:** when we would accept on goal but the supplier is still *open* with stop_risk in the bottom quartile (< 0.17), counter once more at the same goal instead of accepting (`proto/stance.py`). | P02 accepted while moving (stop 0.10); D02 lowest band 8 % final next | P02 / P01 / P03 +0.0–0.1 each | medium (one more round can harden a supplier) | P02, P01, P03, P08 + D01/D02 |
| 4 | **Answer data requests immediately** ("Which figures…", "send us the data") with the plain proof attachment (no IDs). | P04, P11 asked; stance: strongest stop signal | P04/P11 small | low | P04, P11 |
| 5 | **Stronger first ask for single-supplier leverage cases without a cost breakdown** - only after round 1 and not in RFQs (the ×1.3 boost that hurt D02 fired before breakdowns arrived). Use the CS "slow aggressive ask" that got D01 0.999 (E46) for single suppliers. | P18 / P08 deals 7–15 % above C_best; D01 0.982 → 0.999 with the slow ask | P18 +0.05–0.1, P08 +0.03 | medium (deterministic bots may harden) | P18, P08, P07, D01 |
| 6 | **P02 clause package:** offer a copper-clause package next to the price-only one (A5 reached 0.684 that way); keep 90-day payment only if its C gain exceeds the supplier's price mark-up. | A5 P02 0.684; supplier priced 90 d at +€3.37 | P02 up to +0.3 | medium | P02 |
| 7 | **Quality / chargeback packages for quality_first** (P11): explore the allowed ppm / chargeback options instead of price only. | P11 never offered them | P11 +0.03–0.08 | medium | P11 |
| 8 | **Keep earlier better alternatives** (P04: €117 cheaper alternative lost): recall with a smaller threshold relative to the case's room, before the final offer. | P04 | P04 +0.05 | low–medium | P04 |

**Not recommended** (measured worse before): softer first asks (E47), slower concessions in RFQs, auctions, LLM deciding
prices, simultaneous RFQ opening, the CS strategy for RFQs (E46).

**Suggested next step:** implement #1 + #2 (pure hygiene) and #3 (stance-gated hold) as flags on G5-1, verify in the
sandbox, then one practice session each on P02, P04, P05 (3 sessions) before a full 10-case run.
