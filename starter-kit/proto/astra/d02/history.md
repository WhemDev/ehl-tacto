=== RESULTS SO FAR ===
## Generation 1 (sandbox, every idea on top of A10; D01 is the single-supplier guard)
| Idea | D01 | D02 (3 runs) |
|---|---|---|
| A10 control (two batches) | 0.982 | 0.772 (0.765, 0.765, 0.786) / 0.759 (0.724, 0.765, 0.786) |
| G1-1 runway rfq_T=6, no holds, rfq_hold | 0.982 | 0.608 (0.703, **0.417**, 0.703) - one run closed C1 at €15.20 |
| G1-2 no rival disclosure | 0.982 | 0.640 (0.619, 0.619, 0.682) → rival citation is worth ~+0.13 |
| G1-3 pick near | 0.984 | 0.723 (0.702, 0.734, 0.734) - J1 €14.20 at 30 days |
| G1-4 volume framing | 0.982 | 0.724 ×3 |
| G1-5 rfq_facts 0 | 0.982 | **0.542** (0.535, 0.535, 0.556) → facts matter a lot |
| G1-6 tone brief | 0.973 | 0.696 |
| G1-7 LLM writer 3 s | 0.982 | 0.710 |
| G1-8 owned final probe (code) | 0.982 | 0.731 (0.682, 0.724, 0.786) |
| G1-10 payment trade probe (code) | 0.982 | 0.682 (0.703, 0.661, 0.682) |
| G1-11 free lead slack (code) | 0.982 | 0.717 (0.724, 0.682, 0.745) - lead 35 |
| G1-12 retain freight concession (code) | 0.982 | **0.758 (0.786, 0.702, 0.786)** - ≈ A10, keeps DAP |
| G1-13 evidence concession rebase (code) | 0.982 | 0.709 |
| G1-14 cost residual bridge (code) | 0.982 | 0.752 (0.724, 0.765, 0.765) |
| G1-9 selective rival bar (code) | 0.982 | 0.717 (0.766, 0.661, 0.724) |

## Per-run deals (winner, price, payment, incoterm, lead; our messages; final_offers seen)
A10:
  0.765: J1 €14.0 14d DAP lead 28; 8 msgs; finals [('J1', [14.0]), ('C1', [16.0])]
  0.786: J1 €13.9 14d DAP lead 28; 8 msgs; finals [('J1', [13.9]), ('C1', [15.9])]
  0.765: J1 €14.0 14d DAP lead 28; 8 msgs; finals [('J1', [14.0]), ('C1', [16.0])]
  0.765: J1 €14.0 14d DAP lead 28; 8 msgs; finals [('J1', [14.0]), ('C1', [16.0])]
  0.703: J1 €13.9 14d FCA lead 28; 8 msgs; finals [('J1', [13.9]), ('C1', [15.6])]
  0.765: J1 €14.0 14d DAP lead 28; 8 msgs; finals [('J1', [14.0]), ('C1', [16.0])]
  0.786: J1 €13.9 14d DAP lead 28; 8 msgs; finals [('J1', [13.9]), ('C1', [15.9])]
  0.703: J1 €13.9 14d FCA lead 28; 8 msgs; finals [('J1', [13.9]), ('C1', [15.6])]
  0.765: J1 €14.0 14d DAP lead 28; 8 msgs; finals [('J1', [14.0]), ('C1', [16.0])]
  0.786: J1 €13.9 14d DAP lead 28; 8 msgs; finals [('J1', [13.9]), ('C1', [15.9])]
  0.765: J1 €14.0 14d DAP lead 28; 8 msgs; finals [('J1', [14.0]), ('C1', [16.0])]
  0.724: J1 €13.8 14d FCA lead 28; 7 msgs; finals [('J1', [13.8])]
G1-1:
  0.703: J1 €13.9 14d FCA lead 28; 8 msgs; finals [('C1', [15.5]), ('J1', [14.0]), ('J1', [13.9]), ('J1', [13.9]), ('J1', [13.9])]
  0.417: C1 €15.2 14d FCA lead 35; 8 msgs; finals [('J1', [13.9]), ('C1', [15.2]), ('J1', [13.8]), ('J1', [13.8])]
  0.703: J1 €13.9 14d FCA lead 28; 8 msgs; finals [('J1', [14.0]), ('C1', [15.5]), ('J1', [13.9]), ('J1', [13.9]), ('J1', [13.9])]
G1-2:
  0.682: J1 €14.0 14d FCA lead 28; 8 msgs; finals [('J1', [14.0]), ('C1', [16.3])]
  0.619: J1 €14.3 14d FCA lead 28; 8 msgs; finals [('J1', [14.3]), ('C1', [16.4])]
  0.619: J1 €14.3 14d FCA lead 28; 8 msgs; finals [('C1', [16.0]), ('J1', [14.3])]
G1-3:
  0.702: J1 €14.3 14d DAP lead 28; 8 msgs; finals [('C1', [15.5]), ('J1', [14.4])]
  0.734: J1 €14.2 30d DAP lead 28; 9 msgs; finals [('C1', [15.7]), ('J1', [14.2])]
  0.734: J1 €14.2 30d DAP lead 28; 9 msgs; finals [('J1', [14.2]), ('C1', [15.7])]
G1-4:
  0.724: J1 €13.8 14d FCA lead 28; 9 msgs; finals [('J1', [13.8]), ('C1', [15.8])]
  0.724: J1 €13.8 14d FCA lead 28; 8 msgs; finals [('C1', [16.0]), ('J1', [13.8])]
  0.724: J1 €13.8 14d FCA lead 28; 8 msgs; finals [('J1', [13.8]), ('C1', [16.0])]
G1-5:
  0.535: J1 €14.5 14d EXW lead 28; 8 msgs; finals [('J1', [14.7]), ('C1', [15.9])]
  0.535: J1 €14.5 14d EXW lead 28; 9 msgs; finals [('C1', [15.8]), ('J1', [14.7])]
  0.556: J1 €14.6 14d FCA lead 28; 9 msgs; finals [('J1', [14.6]), ('C1', [16.3])]
G1-6:
  0.682: J1 €13.8 14d EXW lead 28; 9 msgs; finals [('J1', [13.8]), ('C1', [15.8])]
  0.682: J1 €13.8 14d EXW lead 28; 8 msgs; finals [('C1', [16.0]), ('J1', [13.8])]
  0.724: J1 €13.6 14d EXW lead 28; 9 msgs; finals [('C1', [15.9]), ('J1', [13.6])]
G1-7:
  0.723: J1 €14.2 14d DAP lead 28; 8 msgs; finals [('J1', [14.2]), ('C1', [15.8])]
  0.682: J1 €13.8 14d EXW lead 28; 9 msgs; finals [('C1', [15.9]), ('J1', [13.8])]
  0.724: J1 €13.8 14d FCA lead 28; 7 msgs; finals [('J1', [13.8]), ('C1', [15.8])]
G1-8:
  0.786: J1 €13.9 14d DAP lead 28; 8 msgs; finals [('J1', [13.9]), ('C1', [15.9])]
  0.682: J1 €14.0 14d FCA lead 28; 8 msgs; finals [('J1', [14.0]), ('C1', [15.9])]
  0.724: J1 €13.8 14d FCA lead 28; 8 msgs; finals [('C1', [15.6]), ('J1', [13.9]), ('J1', [13.8])]
G1-10:
  0.703: J1 €13.9 14d FCA lead 28; 7 msgs; finals [('J1', [13.9])]
  0.682: J1 €14.0 14d FCA lead 28; 8 msgs; finals [('J1', [14.0])]
  0.661: J1 €14.1 14d FCA lead 28; 8 msgs; finals [('J1', [14.1])]
G1-11:
  0.745: J1 €13.7 14d FCA lead 35; 8 msgs; finals [('C1', [15.4]), ('J1', [13.7])]
  0.682: J1 €14.0 14d FCA lead 35; 7 msgs; finals [('C1', [16.0]), ('J1', [14.0])]
  0.724: J1 €13.8 14d FCA lead 35; 7 msgs; finals [('J1', [13.8])]
G1-12:
  0.702: J1 €14.3 14d DAP lead 28; 7 msgs; finals [('J1', [14.3])]
  0.786: J1 €13.9 14d DAP lead 28; 8 msgs; finals [('J1', [13.9]), ('C1', [15.9])]
  0.786: J1 €13.9 14d DAP lead 28; 8 msgs; finals [('J1', [13.9]), ('C1', [15.9])]
G1-13:
  0.723: J1 €14.2 14d DAP lead 28; 7 msgs; finals [('J1', [14.2]), ('C1', [15.6])]
  0.681: J1 €14.4 14d DAP lead 28; 7 msgs; finals [('J1', [14.4]), ('C1', [15.8])]
  0.723: J1 €14.2 14d DAP lead 28; 6 msgs; finals [('J1', [14.2])]
G1-14:
  0.724: J1 €13.8 14d FCA lead 28; 8 msgs; finals [('J1', [13.8]), ('C1', [15.4])]
  0.765: J1 €14.0 14d DAP lead 28; 8 msgs; finals [('J1', [14.0]), ('C1', [16.0])]
  0.765: J1 €14.0 14d DAP lead 28; 8 msgs; finals [('J1', [14.0]), ('C1', [16.0])]
## Team-lead analysis after generation 1
1. **Every deal is J1 at €13.80–14.00, 14-day payment, lead 28.** J1's final offer lands at €13.80–14.00 whatever we do
   (except worse with fewer facts / no rival). This looks like J1's reservation price at 14 days.
2. **Incoterm alone swings the score by 0.08**: €13.90 DAP = 0.786 vs €13.90 FCA = 0.703 (FCA costs us €0.40/unit
   freight ≈ 4.8k C). Keeping DAP (G1-12) reproduces 0.786 twice.
3. **C1 is never pushed toward its own floor**: it goes final at €15.30–16.00 (its defended EXW price) and serves only
   as J1's rival bar. C1's signal ("material ≈ 45 % of cost", material €5.56 → €12.36) and C_best = 156,739 suggest
   the true best deal may be with **C1** (≈ €12.3–12.5 EXW + 0.60 freight) or with J1 at terms we never offered
   (≈ €13.06 at 60 d DAP). Our engine always converges on J1 because J1 moves first and furthest.
4. Moving the 14-day payment, the lead time, the tone, the volume framing or the acceptance timing did not move J1's
   final number. Disclosure of the rival (+0.13) and facts (+0.22) are the strongest levers seen so far.
Question for generation 2: how do we get either supplier materially below J1's ~€13.90 final, or close on terms
whose C is lower at the same price - generically (any RFQ, unseen suppliers)?

## Generation 2 (sandbox; A10 control 0.765 ×3 in both batches; D01 0.982 for every idea)
| Idea | D02 (3 runs) |
|---|---|
| G2-1 rfq_T 6, holds 2, no hold mail | 0.512 (0.417 ×2: closed C1 at €15.20) |
| G2-2 rfq_e 1.0 | 0.605 |
| G2-3 rfq_anchor 0.0 | 0.703 |
| G2-4 rfq_holds 0 | 0.752 (0.765, 0.786, 0.703) |
| G2-5 rfq_T 6, 1 push of 6 % | 0.682 ×3 |
| G2-6 breakdown_arg off | 0.724 ×3 (→ the breakdown argument is worth +0.04) |
| G2-7 material-share bridge (code) | 0.724 |
| G2-8 stable incoterm basis (code) | 0.752 (0.786, 0.765, 0.703) |
| **G2-9 challenger rebid (code)** | **0.772 (0.765, 0.765, 0.786)** - but the rebid to C1 after its final offer (asking ~€13.65 vs its €16.00 final) made C1 **walk away** both times; the score comes from J1 as usual |
| G2-10 payment lanes (code) | 0.689 |
| G2-11 actionable rival (code) | 0.682 ×3 |
| G2-12 leader cost first (code) | 0.716 |

## Team-lead analysis after generation 2
- C_best (156,739) ≈ **J1 at its own direct cost €12.76** (14 d, DAP) - a zero-margin price no bot concedes. J1's
  final_offer lands at €13.80–14.00 (≈ 9 % margin) in every run; C1's at €15.30–16.00 and it walks away when asked
  far below its final. So the realistic D02 ceiling with these bots is ≈ 0.79–0.80.
- What still varies in our runs and is worth up to 0.08: **(a) incoterm of the final deal** (€13.90 DAP 0.786 vs
  €13.90 FCA 0.703 vs €14.00 DAP 0.765) and **(b) whether J1's final is €13.80/13.90 or €14.00**.
- Every "more patience / firmer / fewer concessions / more rounds" variant lost (0.41–0.70): J1 rewards quick visible
  moves; C1 must be kept alive as a bar but never pushed past its final.
Ask for generation 3: combinations and refinements that make **J1 at €13.80–13.90 DAP** the reliable outcome (and do
not lose D01 or practice-like single-supplier play), e.g. combine G2-9 (without the walk-away-prone rebid), G1-12
retain-freight, G2-8 stable incoterm, G2-4 no rewinds, G1-14 cost bridge - each combination as a "params" idea
(all flags above exist now) - plus at most 3 new small code ideas.

## Generation 3 - combinations (sandbox; A10 control 0.738 (0.765, 0.682, 0.765))
| Combo | D02 (3 runs) |
|---|---|
| G3-1 retain freight + stable incoterm | 0.765 ×3 |
| G3-2 retain freight, holds 0 | 0.744 |
| G3-3 stable incoterm, holds 0 | 0.745 |
| **G3-4 retain freight + stable incoterm + holds 0** | **0.772 (0.786, 0.765, 0.765)** - best of 3 generations |
| G3-5 G3-4 + cost residual bridge | 0.765 ×3 |
| G3-6 G3-4 + free lead slack | 0.758 |
| G3-7 G3-4 + rfq_e 2.5 | 0.723 |
Freight protection removes A10's bad FCA deals (0.68–0.70) but nothing gets J1 below its final €13.80–14.00:
**incremental tuning has plateaued at ≈ 0.765–0.786.**
