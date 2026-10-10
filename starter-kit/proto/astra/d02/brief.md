# D02 improvement brief (sandbox RFQ: award one of two suppliers)

## The case
- `case:D02` "New stainless pump shaft SH-220: award one of two suppliers": J1 (German job shop) and C1 (Polish
  machining). Category `leverage`. Need 6,000/yr × 24 months (contract fixed 24 months). Negotiable: unit_price,
  payment_days {14,30,45,60}, lead_time_days {21,28,35,42,49}, incoterm {EXW,FCA,DAP}. Must-have lead ≤ 42 days;
  every day beyond 35 costs €150. Freight per unit EXW 0.60 / FCA 0.40 / DAP 0.00. Interest 8 %, reference payment 60
  days. Alternative: quote:D02-ALT €19.90 DAP 60 d 35 d (C 238,800). round_limit 10.
- Openings: C1 €16.60 DAP 14 d (C ≈ 202,500) with alternative €16.00 EXW; J1 €17.10 (C ≈ 214,300).
- **C_open 214,296 · C_best 156,739** (score = (C_open − C_deal)/(C_open − C_best)).
- **How C maps to terms (our cost function):** at €14.00: 14 d FCA = 174,517; 60 d DAP = 168,000. At €13.00: 14 d FCA =
  162,395; 60 d DAP = 156,000. **C_best ≈ €13.06 at 60 d DAP or €12.53 at 14 d FCA.** Every €0.10 ≈ 1,200 C ≈ 0.021
  score. Payment 60 vs 14 days ≈ 1.7k C, DAP vs FCA ≈ 4.8k C - but the supplier prices these terms too.
- Supplier documents arrive in round 1: J1 attaches its cost breakdown (material 5.56, labour 4.39, conversion 2.81 →
  direct 12.76); C1 says "Material accounts for about 45 % of our cost; more detail we do not share" (→ 12.36).

## Where A10 stands on D02
- A10 (all features below) scores **0.765 typical**, 0.786 best, 0.682–0.703 worst over ~20 runs; deals are always J1,
  14-day payment, 28-day lead, €13.60–14.00 FCA/DAP (C 169–175k). Our own target after the breakdowns: C 156,345
  (C1 €12.20 EXW 14 d) - close to C_best, so our *target* is right; the *path* stops ~0.12–0.25 short.
- A10 RFQ mechanics: staggered opening (cheapest quote C1 first, then J1 citing C1's fresh offer id), per-thread
  workers with their own 60 s clocks under a case lock, RFQ overrides `rfq_meso_n=1`, `rfq_facts=1`,
  `rfq_anchor=-0.08`, `rfq_pushes=3`, `rfq_push_pct=0.03` (push scaled to room), `rfq_holds=2`, rival offer cited
  with an attachment every round, breakdown argument ("Your own cost breakdown shows … direct cost"), concession
  e=2, T=4, accept when a standing offer is at/below the next goal, "hold" when the supplier still gives > 0.5 %.

## Everything already measured on D02 (do not repeat unless the mechanism changes)
| Idea | D02 |
|---|---|
| simultaneous opening (no stagger) | 0.626 → stagger 0.728–0.765 (+0.10) |
| slow concession e=0.2 / reciprocal α | 0.408 / 0.513–0.534 |
| opening-% anchors | worse |
| 2–3 packages per message in RFQ | worse than 1 |
| 2 facts per message in RFQ | 0.698 vs 1 fact 0.765 |
| leverage room boost ×1.3 (before breakdowns) | 0.688 |
| T1 snapshot coordinator (late second opening, serial) | 0.354 |
| T3 arena-clock urgency | 0.685 |
| T4 case-wide claim ledger | 0.640 |
| T7 cost-split probe before first priced ask | 0.618 |
| U2 bounded 12 s race before close (opened 2nd supplier at ~23 s) | 0.660 |
| U3 provenance-only facts (weak "the enquiry lists X" claims, cross-supplier scorecards) | 0.577–0.598 |
| U1 package frontier in RFQ | 0.682–0.703 |
| U4 close recovery | 0.786 ×2 (neutral/positive) |
| LLM writer | not tested on D02 |
| random search over RFQ settings (46 sessions) | best 0.786; 1 sheet + 1 fact + bolder −8 % anchor + 3×3 % pushes won |

## Observations from the transcripts (attached)
- J1 reacts strongly to fresh rival quotes ("which beats the Polish offer you mentioned") and to the breakdown
  argument; it values 14-day payment ("14 days payment is good for us"); it goes `final_offer` around €13.90–14.00.
- C1 defends EXW ("shifting to DAP would require a significant price increase"), sits at €15.30–15.90, goes
  final_offer at €15.30–15.60, and is mostly used as the rival bar for J1.
- The winner is always J1; the deal lands when J1 says final_offer; our goal by then is ≥ J1's number.
- Claims: rival quote IDs are re-cited every round → `duplicate`; the scorecard and cost IDs verify but "do not change
  our calculation".
