# Full review: state of our buyer agent (algorithm A10) and where it fails

## 1. Challenge recap (rules that matter for code)
- Each case: case file (need/year, horizon, current price, fallback price + risk, category goal ∈ {stabilise, secure_supply, leverage, routine, quality_first}, negotiable fields with allowed options, fixed terms, must-haves, our alternative), 1–3 LLM supplier bots with hidden economics.
- Messages: body + ≤3 term sheets (each sets every negotiable field to an allowed option) + refs (data IDs; ≤3 checked claims per message incl. attachments; each ID counts once per case — repeats are `duplicate`; an ID not in `facts.json` or a wrong figure is `contradicted` and **costs trust**). Supplier replies: body, primary sheet (+ optional alternative), status (`open`, `final_offer`, `agreed`, `walked_away`, `no_bid`), claim results.
- **Only the primary sheet is acceptable**; an alternative must be sent back as our proposal first (supplier then says `agreed`), then accepted.
- **60 s per message per thread from the supplier's reply** (arena clock, not our receipt time; under load replies arrive 1–120 s after we send, and the arena's move may predate our receipt). Idle time counts as timeouts; 3 in a row end the thread; when every thread ends, the session ends (`timeout`).
- Score = clip((C_open − C_deal)/(C_open − C_best), 0, 1); no deal = alternative (0 if none or worse than opening); broken must-have = 0. Final: 5 waves × 8 min, ≤10 cases in parallel, hidden cases with unseen suppliers and type combinations → **only generic rules**.

## 2. Engine A10 (current) — see source files
`target.py` (target C from estimated floors via `supplier_value`), `engine.py` (`Config` flags, `Negotiator`: `goal` concession curve, `meso` package generator with guards, `write` templated e-mail, `run` single-supplier loop, `run_rfq` per-thread workers + coordinator, `close`, `push`, `recalled`, `fallback_counter`, `conditional_package`, `frozen_packages`), `practice.py` (`PracticeNegotiator`: facts and floors from the data package), `variants.py` (named configs; A10 is current). Key A10 settings: e=2, T=4, anchor −3 % (RFQ −8 %), 2 packages (RFQ 1), 2 facts (RFQ 1), pushes only with a rival backup (RFQ 3 × ≤3 % scaled to room), 1 hold round (gave > 0.5 %), staggered RFQ opening, insisted/introduced terms in every package at the variant cheapest for us, lead time capped at need, bottleneck anchor (secure_supply: ≥ opening price × 0.90), target priors (leverage 15 %, routine/quality 8 % below opening), price-freeze terms, recall best earlier offer, proof attachment, conditional-agreement repair, cap reserve, never walk without alternative.

## 3. What we measured (do NOT re-propose what failed)
| Idea | Result |
|---|---|
| Slow concession (Boulware e=0.2) | worse: sandbox D01 0.845 / D02 0.408 vs e=2 0.849/0.640; suppliers go final when we barely move |
| Reciprocal concession (mirror theirs, α 0.5/1.0) | worse: 0.823/0.513 and 0.656/0.534 |
| Simultaneous RFQ opening | worse than staggered: D02 0.626 → 0.728/0.765 with stagger (4/4) |
| Opening-percentage anchors (6–16 % below opening) | worse than our target-based anchor (D01 0.609 vs 0.979): the deal lands near the first ask |
| Removing the "never above supplier's price" cap | not done: a teammate's agent got a 0 on P02 that way |
| Objection-based fact ordering | D01 0.982 → 0.959 |
| Leverage room boost ×1.3 when no breakdown | D02 0.772 → 0.688 (fires before breakdowns arrive) |
| Push after a final offer in single-supplier cases | P10: supplier walked away (score 0) |
| 3 term sheets vs 2 | 2 better on both sandbox cases; RFQ: 1 best |
| Widest-deadband index clause in every package once insisted | P08 0.48 → 0.59, P18 0.27 → 0.49/0.53 |
| Staggered RFQ + immediate accept of agreed/final | P05 0.665 (A9) |

## 4. Practice history (hosted suppliers, best-per-case across our runs)
| Case | Type · goal | A5 | A9 | **A10** | Best ours | Board record |
|---|---|---|---|---|---|---|
| P01 | price increase · stabilise | 0.881 | 0.956 | 0.956 | 0.956 | 0.932 |
| P02 | price increase (copper) · stabilise | 0.679 | 0.360 | 0.360 | 0.684 | 0.684 |
| P03 | renewal · stabilise | 0.923 | 0.923 | 0.923 | 0.923 | 0.923 |
| P04 | renewal · routine | 0.810 | 0.810 | 0.810 | 0.874 | 0.874 |
| P05 | RFQ, 3 suppliers · leverage | 0.000 | 0.665 | **0.000** | 0.665 | 0.824 |
| P07 | bundling · routine | 0.710 | 0.710 | 0.710 | 0.710 | 0.779 |
| P08 | raw material · leverage | 0.482 | 0.586 | **0.000** | 0.586 | 0.647 |
| P10 | capacity · secure_supply | 0.679 | 0.671 | 0.671 | 0.679 | 0.679 |
| P11 | quality · quality_first | 0.710 | 0.710 | 0.710 | 0.710 | 0.794 |
| P18 | raw material · leverage | 0.270 | 0.485 | 0.532 | 0.532 | 0.673 |
| Mean | | 0.614 | 0.688 | 0.567 | 0.732 | |

Calibration audit (our target room ÷ true room): leverage median 0.68 (too timid without breakdown data), quality 0.98, secure_supply 1.11, routine mixed (P04 13× in a 1.2 % room; P07 0.78), stabilise not comparable.

## 5. Weaknesses found in the latest run (A10), with evidence

### W1 — P05 = 0: an RFQ with three live offers ended with NO deal (critical, robustness)
Timeline (seconds from start): 1 s 70210 offers €31.50; 24 s €29.50; 25 s 70250 €31.00; **we cited `fc:320070@2026-09` (exists in the SQL `forecasts` table but NOT in `facts.json`) → `contradicted`, "That costs trust"**; 143.5 s 70210 `final_offer` €29.50 → we immediately accept → at 154 s the arena says `not a standing offer` (70210 had walked away; its move predated our receipt under load). 143.5 s 70250 replies `open` €29.50 "At 29.50 with 14 days payment, **we have a deal**". 161 s we try to accept 70250's sheet → `422 not a standing offer` (stale sheet id or its state changed). 166 s fallback gives up; **the workers stop sending, all threads idle until 3 timeouts each, the session ends `timeout`, score 0**, although 70250 and 70240 were still open.
Root causes: (a) citing IDs that are not in `facts.json`; (b) after failed accepts, the engine stops negotiating instead of re-reading every thread and continuing (or re-proposing the agreed terms to get a fresh `agreed`); (c) accept attempts use possibly stale sheet ids.

### W2 — P08 = 0: we pressured a conceding single supplier into walking away
It conceded €5.47 → €5.44 (alt €5.40). Our "hold" rule then sent a 4th message at an **unchanged goal** (€5.38/€5.33); reply: "**We are withdrawing from this negotiation.**" No useful alternative (our alternative costs more than its opening) → 0. In A9 the same moment ended in a final offer (0.586). A hold without a visible move is a coin flip we should not take when nothing backs us up.

### W3 — P02 0.36 (was 0.68): narrow room, clause package excluded
Room 2.1 %. In A5 the supplier agreed to a copper-clause package at €360.32 (0.68); since A6 our tight equal-cost rule excludes clause packages whose C (with our estimated relationship charge and index risk) is higher, and we end at €373 without clause. Our C estimate for stabilise cases includes an *estimated* relationship charge that may be wrong.

### W4 — capped by our first ask (P07 0.71, P11 0.71, P18 0.53, P05 ~0.67)
The deal lands near the first ask; without breakdown/should-cost data our leverage targets capture ~68 % of the true room. A naive boost hurt D02 because it fired before breakdowns arrived.

### W5 — evidence quality
Verified ≠ convincing ("it holds, but it does not change our calculation"; "not our reality: our AS-14404 is covered at fixed prices until March 2027"); duplicates when IDs are repeated (attachments, rival quote re-cited to the same supplier); suppliers keep asking "Which figures is that based on? Please send us the data" and "Which volume can you commit to?".

### W6 — operational
Under load replies take up to ~2 min; HTTP stalls were fixed with a 25 s re-fetch; a session can also end because our side stops sending (W1).

## 6. Constraints for any change
1. **Generic only**: triggers on case features, data, statuses, or supplier text — never case/supplier IDs or prices.
2. Numbers from code; no invented facts or IDs; every cited ID must exist in `facts.json` (or be a case ref / a session offer ID).
3. New behaviour behind `Config` flags (default off), combined into a new variant; existing variants must behave exactly as before.
4. No new dependencies; Python 3.12; keep the code style.
5. Must stay within the 60 s per-thread clock and the 8-minute wave; no busy loops.
6. Free test path: offline smoke test of all 19 practice case files (`proto/smoke.py`) and sandbox D01/D02 (`proto/variants.py`); practice costs quota.
