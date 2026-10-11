---
tags: [runs, practice, G7, report, improvements]
created: 2026-10-11
---
# G7 on the 10 practice cases - what changed vs G5-1 and what to improve

G7 = G5-1 + `slow_ask_single` + `spread_args` (single supplier only). Sandbox: D01 1.000, D02 0.765 (= G5-1). Full
conversations: [[P01]] [[P02]] [[P03]] [[P04]] [[P05]] [[P07]] [[P08]] [[P10]] [[P11]] [[P18]] · table: [[table]] ·
data: `summary.json`. Comparison run: [[../2026-10-11-G5-1-practice/REPORT|G5-1 practice report]].

## Results
| Case | G5-1 | **G7** | Δ | Board | What changed |
|---|---|---|---|---|---|
| P01 | 0.956 | 0.794 | **−0.162** | 0.932 | round-2 ask €136.65 (Apr, 14 d) instead of €131.42 / €133.10 → foundry "agreed" at once |
| P02 | 0.360 | **0.469** | **+0.109** | 0.684 | 2nd package with a CU-NOTATION index clause (5 % deadband) at €365.47 / 60 d → "agreed" |
| P03 | 0.923 | 0.919 | −0.004 | 0.923 | price freeze; 2 duplicate claims |
| P04 | 0.810 | **0.860** | **+0.050** | 0.874 | closed €4.94 / 90 d / 24 m (cheaper in C than €4.91 / 60 d / 36 m) |
| P05 | 0.659 | 0.659 | = | 0.824 | RFQ - G7 identical (forecast-ID trust loss and 7 duplicates still there) |
| P07 | 0.710 | 0.678 | −0.032 | 0.779 | smaller concessions (€5.39 → €5.41) → supplier mirrored, final €5.48 vs €5.43 |
| P08 | 0.603 | 0.531 | **−0.072** | 0.647 | ask €5.23 instead of €5.30 → supplier moved less, final €5.47 vs €5.37–5.42 |
| P10 / P11 / P18 | 0.671 / 0.710 / 0.532 | same | = | | first-reply final (P10); final offers decide P11 / P18 |
| **Mean** | **0.693** | **0.682** | −0.011 | 0.781 | |

## Why
1. **Bug: the slow ask can be MORE generous than the normal curve.** It anchors on the supplier's current offer
   (target + 15 % of the gap to it). When that offer is close to our target zone (P01: €136.50 alternative), the slow
   ask lands above A10's own curve - here €136.65 vs €131.42 - and a cooperative supplier agrees instantly.
2. **Reciprocal suppliers punish small steps.** P07 and P08 match the size of our concessions (the measured E-series
   lesson "no move from us = no move from them"). D01's foundry does not, which is why the slow ask won only there.
3. **The clause package is the P02 lever** (A5 0.684, now 0.469 on its first reappearance): a supplier who refuses any
   cost discussion accepts a lower price when the copper risk is shared through an index clause.
4. Unchanged from the G5-1 report: P05 trust loss (forecast ID not in facts.json, 4 contradicted) and duplicates (P03,
   P04, P05); P18 / P08 leverage targets too timid; P11 never explores quality terms.

## Improvements (ranked)
| # | Change | Expected | Test |
|---|---|---|---|
| 1 | **Fix the slow ask:** ask = min(slow ask, the normal curve's goal) - never more generous than G5-1 | P01 back to 0.956 (−0.16 recovered), D01 unchanged | P01 (1 session), D01 |
| 2 | **Slow ask only for non-reciprocal suppliers:** keep it while the supplier's last concession ≥ ours; if it mirrors our small steps (P07, P08), return to the normal curve | P07 +0.03, P08 +0.07 | P07, P08, D01 |
| 3 | **Keep the clause package** that won P02 (now produced by G7's path) - make it explicit: in stabilise / raw-material cases with a negotiable index clause, always offer one clause package next to the price package | P02 +0.1–0.3 | P02, P08, P18 |
| 4 | Evidence hygiene from the G5-1 report (forecast-ID provenance, no duplicate facts; rival offers exempt) - already built as G6 flags, untested on practice | P05 +0.02–0.05 | P05, P03, P04 |
| 5 | Quality packages for quality_first (P11) - built as a G6 flag, untested on practice | P11 +0.03–0.08 | P11 |
With #1 + #2 the expected practice mean is ≈ 0.72 (G7's gains on P02 / P04 kept, its losses on P01 / P07 / P08 removed).
