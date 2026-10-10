# Detailed report #2: buyer agent state after A10, the LLM writer (A10w) and the A11 integration

Team "makeAnother.md", Tacto Negotiation Arena. Written for Astra (lead engineer) to produce a detailed improvements page;
GPT-6.1-sol coders will implement the approved tasks. Everything below is measured unless marked as a hypothesis.

## 1. Challenge (rules that matter for code)
- Each case: case file (need/year, horizon, current price, alternative price + risk, category goal ∈ {stabilise,
  secure_supply, leverage, routine, quality_first}, negotiable fields with allowed options, fixed terms, must-haves),
  1–3 LLM supplier bots with hidden economics (floor, style, concession behaviour).
- Messages: body + ≤3 term sheets (each sets every negotiable field to an allowed option) + refs (data IDs; ≤3 checked
  claims per message incl. attachments; each ID counts once per case → repeats = `duplicate`; an ID not in `facts.json`
  or a wrong figure = `contradicted` and "costs trust"). Supplier replies: body, primary sheet (+ optional alternative
  "-a"), status (`open`, `final_offer`, `agreed`, `walked_away`, `no_bid`), claim results.
- Only the primary sheet is acceptable; an alternative must be mirrored back first, then the supplier says `agreed`,
  then accept. Arena-generated timeout replies create NEW offer ids (`thread['timeouts']`).
- 60 s per message per thread on the arena clock (from the supplier's reply; messages have no timestamps; the session
  endpoint gives `seconds_left` per thread). 3 timeouts end a thread; all threads ended → session ends.
- The arena message schema rejects unknown keys (HTTP 422 "Extra inputs are not permitted").
- Score = clip((C_open − C_deal)/(C_open − C_best), 0, 1); no deal = alternative (0 if none or worse); broken must-have = 0.
- Final: 5 waves × 8 min, ≤10 cases in parallel, unseen suppliers/types → generic rules only. Practice quota: 450 sessions.

## 2. Current engine (A10) and the new options
- `target.py`: target C = min over the lever grid of C at the price where the supplier's cash value meets our
  estimated floor. `practice.py`: facts and floors from the data package (breakdown → material share → should-cost
  capped at opening/(1+margin) → current/(1+m)×drift → 85 % of opening).
- `engine.py` `Negotiator`: concession `goal(rnd) = start + (ref − start)·min(1, rnd/T)^(1/e)` with e=2, T=4; anchor
  −3 % below target (RFQ −8 %); MESO: 2 packages of "equal C" (RFQ 1); 2 facts per message (RFQ 1); staggered RFQ
  opening; per-thread RFQ workers under a lock; 1 hold round; pushes only with a rival backup; insisted terms kept at the
  variant cheapest for us; lead time capped at need; bottleneck anchor; target priors (leverage 15 %, routine/quality
  8 %); price-freeze packages; recall best earlier offer; proof attachment; conditional-agreement repair; cap reserve;
  never walk without an alternative. Templated e-mails (`write()`).
- **New: `llm_writer` (A10w)** - Claude Sonnet 5.5 rewrites each body in the supplier's register (rule-based style
  profile: greeting, formality, warmth, brevity, values, cost-defensiveness); the engine keeps sheets, refs,
  attachments and all decisions; a deterministic validator (same numbers, same IDs, no new promises/pressure words,
  questions kept, no signature) falls back to the template; 7 s cap; no lock held while waiting.
- **New: A11 flags (Sol coders, behind flags)**: `resilient_rfq` (T1 RFQ coordinator with snapshots, keeps
  negotiating after failed accepts), `safe_close` (T2 transactional closing), `arena_clock_guard` (T3 arena clock via
  `seconds_left`, io locks, ambiguous-POST handling), `safe_claims` (T4 citation provenance + case-wide claim ledger),
  `safe_single` (T5 no unchanged-goal hold without a useful alternative), `clause_explore` (T6 bounded clause package),
  `calibrated_anchor` + `anchor_probe` (T7 cost-split probe before the first priced ask, bounded boost).

## 3. Measurements (do NOT re-propose what failed unless the mechanism changes)
| Idea | Result |
|---|---|
| Slow concession (Boulware e=0.2) | worse: D01 0.845 / D02 0.408 vs e=2 0.849/0.640 |
| Reciprocal concession (mirror theirs) | worse: 0.823/0.513, 0.656/0.534 |
| Simultaneous RFQ opening | worse than staggered (D02 0.626 → 0.728/0.765 with stagger) |
| Opening-percentage anchors (6–16 % below opening) | worse than target-based anchor (D01 0.609 vs 0.979) |
| Removing "never above supplier's price" cap | rejected: teammate got a 0 on P02 that way |
| Objection-based fact ordering | D01 0.982 → 0.959 |
| Leverage room boost ×1.3 when no breakdown | D02 0.772 → 0.688 |
| Push after a final offer in single-supplier cases | P10 walked away (0) |
| 3 term sheets vs 2 | 2 better; RFQ: 1 best |
| Widest-deadband index clause once insisted | P08 0.48 → 0.59, P18 0.27 → 0.49/0.53 |
| **LLM writer (A10w) vs template (A10), practice, 1 run/case** | mean 0.682 vs 0.693 (−0.011, within noise); P05 +0.051, P08 +0.015, P01 −0.075, P18 −0.065; 90 % of e-mails written by the LLM, median 2.5 s |
| **A11 combined (all flags), sandbox** | D01 0.977 vs 0.982; D02 0.598 vs 0.771 (after fixing 3 integration crashes; before: 0.000 ×4) |
| A11 without T7 | D02 0.237 |
| **A11 ablation, each flag alone on A10 (sandbox)** | see section 6 |

## 4. Practice history (hosted suppliers)
| Case | Type · goal | A5 | A9 | A10 run 1 | A10 run 2 | A10w | Best ours | Board record |
|---|---|---|---|---|---|---|---|---|
| P01 | price increase · stabilise | 0.881 | 0.956 | 0.956 | 0.956 | 0.881 | 0.956 | 0.932 |
| P02 | price increase (copper) · stabilise | 0.679 | 0.360 | 0.360 | 0.360 | 0.335 | 0.684 | 0.684 |
| P03 | renewal · stabilise | 0.923 | 0.923 | 0.923 | 0.923 | 0.924 | 0.924 | 0.923 |
| P04 | renewal · routine | 0.810 | 0.810 | 0.810 | 0.810 | 0.810 | 0.874 | 0.874 |
| P05 | RFQ, 3 suppliers · leverage | 0.000 | 0.665 | 0.000 | 0.659 | 0.710 | 0.710 | 0.824 |
| P07 | bundling · routine | 0.710 | 0.710 | 0.710 | 0.710 | 0.697 | 0.710 | 0.779 |
| P08 | raw material · leverage | 0.482 | 0.586 | 0.000 | 0.603 | 0.618 | 0.618 | 0.647 |
| P10 | capacity · secure_supply | 0.679 | 0.671 | 0.671 | 0.671 | 0.671 | 0.679 | 0.679 |
| P11 | quality · quality_first | 0.710 | 0.710 | 0.710 | 0.710 | 0.710 | 0.710 | 0.794 |
| P18 | raw material · leverage | 0.270 | 0.485 | 0.532 | 0.532 | 0.467 | 0.532 | 0.673 |
| Mean | | 0.614 | 0.688 | 0.567 | 0.693 | 0.682 | 0.739 | 0.781 |

Note: the same code scored 0.567 and 0.693 on two runs (zeros on P05/P08 in run 1) → run-to-run variance is large on
RFQ and leverage cases; many single-supplier cases are fully deterministic (identical scores across runs).

## 5. Where the points are lost (latest A10 / A10w practice runs)
"room captured by our target" = (C_open − our target C)/(C_open − C_best) (1.0 = our target equals the true best);
"first ask" = the C of our first package as a share of the true room.

| Case | Variant | Score | C_open | C_target (ours) | first ask C | C_deal | C_best | room captured by our target | rounds | statuses |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P01 | A10 | 0.956 | 1,153,780 | 1,118,223 | 1,122,988 (0.54 of room) | 1,099,346 | 1,096,816 | 0.62 | 3 | open,open,agreed |
| P01 | A10w | 0.881 | 1,153,780 | 1,118,223 | 1,122,988 (0.54 of room) | 1,103,602 | 1,096,816 | 0.62 | 2 | open,agreed |
| P02 | A10 | 0.360 | 2,282,867 | 2,261,882 | 2,224,276 (1.24 of room) | 2,265,799 | 2,235,514 | 0.44 | 3 | open,open,open |
| P02 | A10w | 0.335 | 2,282,867 | 2,261,882 | 2,224,276 (1.24 of room) | 2,266,983 | 2,235,514 | 0.44 | 3 | open,open,open |
| P03 | A10 | 0.923 | 4,246,314 | 3,942,422 | 3,929,192 (0.94 of room) | 3,935,069 | 3,909,043 | 0.90 | 3 | open,open,open |
| P03 | A10w | 0.924 | 4,246,314 | 3,942,422 | 3,929,192 (0.94 of room) | 3,934,826 | 3,909,043 | 0.90 | 3 | open,open,open |
| P04 | A10 | 0.810 | 198,846 | 168,642 | 163,477 (15.27 of room) | 196,970 | 196,529 | 13.04 | 3 | open,open,final_offer |
| P04 | A10w | 0.810 | 198,846 | 168,642 | 163,477 (15.27 of room) | 196,970 | 196,529 | 13.04 | 3 | open,open,final_offer |
| P05 | A10 | 0.659 | 270,199 | 253,687 | 229,672 (0.87 of room) | 251,462 | 223,424 | 0.35 | 5 | open,open,open,final_offer |
| P05 | A10w | 0.710 | 270,199 | 241,903 | 229,672 (0.87 of room) | 247,219 | 223,424 | 0.60 | 10 | open,open,open,open,open,open,open,final_offer,final_offer,final_offer |
| P07 | A10 | 0.710 | 391,027 | 318,889 | 317,429 (0.80 of room) | 325,829 | 299,241 | 0.79 | 4 | open,open,open,final_offer,agreed |
| P07 | A10w | 0.697 | 391,027 | 318,889 | 317,429 (0.80 of room) | 327,029 | 299,241 | 0.79 | 4 | open,open,open,final_offer,agreed |
| P08 | A10 | 0.603 | 1,135,887 | 983,114 | 966,164 (0.97 of room) | 1,030,030 | 960,309 | 0.87 | 4 | open,open,open,open |
| P08 | A10w | 0.618 | 1,135,887 | 986,881 | 966,164 (0.97 of room) | 1,027,315 | 960,309 | 0.85 | 4 | open,open,open,final_offer |
| P10 | A10 | 0.671 | 1,932,492 | 1,260,946 | 1,370,641 (0.93 of room) | 1,527,586 | 1,328,927 | 1.11 | 1 | final_offer,agreed |
| P10 | A10w | 0.671 | 1,932,492 | 1,260,946 | 1,370,641 (0.93 of room) | 1,527,586 | 1,328,927 | 1.11 | 1 | final_offer,agreed |
| P11 | A10 | 0.710 | 817,578 | 723,927 | 702,144 (1.21 of room) | 750,082 | 722,500 | 0.98 | 4 | open,open,open,final_offer |
| P11 | A10w | 0.710 | 817,578 | 723,927 | 702,144 (1.21 of room) | 750,082 | 722,500 | 0.98 | 4 | open,open,open,open |
| P18 | A10 | 0.532 | 295,173 | 247,662 | 250,958 (0.61 of room) | 256,557 | 222,651 | 0.66 | 3 | open,open,final_offer |
| P18 | A10w | 0.467 | 295,173 | 247,662 | 250,958 (0.61 of room) | 261,308 | 222,651 | 0.66 | 3 | open,open,final_offer |


Observations:
- **Deterministic single-supplier cases reach the same deal every run** (P02 0.36, P04 0.81, P10 0.671, P11 0.71,
  P03 0.923): the supplier bots answer the same messages identically, so only a different strategy moves these.
- **P02, P04, P11: our first ask is beyond the true best (1.2–15× of the room) yet the deal lands at 0.36–0.81** → the
  first ask is not the problem there; the supplier does not follow and we concede to its number within 3–4 rounds.
  P02: supplier says "Our calculation is our property", sits at 373–374 and asks "Which volume can you commit to?"; we
  accept at €373.12 after 3 rounds. A5 got 0.68 via a copper-clause package (now excluded by the equal-C rule).
  P04: 1.2 % room, supplier goes `final_offer` in round 3 at its opening price (we gained nothing beyond terms).
  P11 (quality_first): supplier stays at its terms; we accept at round 4.
- **P10 (secure_supply)**: first reply is already `final_offer`; we accept immediately (pushing a final offer in
  single-supplier cases made it walk away earlier) → 0.671 every run. Our target overshoots (1.11 of room).
- **P18 / P08 (raw material · leverage)**: target captures 0.66 / 0.87 of the room; deal lands well above it (0.53 /
  0.60). Clause packages decide these.
- **P05 (RFQ, 3 suppliers)**: score varies 0 – 0.71 with timing; duplicates (rival quote and index IDs re-cited to the
  same supplier) and one `contradicted` (SQL-only forecast ID `fc:320070@2026-09`) appear every run.
- **P01 A10w**: the LLM e-mail made the supplier agree one round earlier - to our **second** package (€133.10,
  30 days, January start) whose true C was €4k higher than the deal A10 reached → our two "equal-C" packages are not
  equal in the arena's C (relationship/payment terms estimated wrongly) and a cooperative supplier picks the one that is
  worse for us.
- **P07 (bundling)**: 0.71 both runs; supplier agrees at a price above our goal after `final_offer`.

## 6. A11 integration and ablation (sandbox, each Sol task alone on top of A10)
| Variant (A10 + one task) | D01 | D02 (2 runs) | Verdict |
|---|---|---|---|
| A10 (same batch) | 0.982 | 0.734 (0.786, 0.682) | baseline |
| + T1 `resilient_rfq` | 0.982 | **0.354** (0.354, 0.354) | ❌ opens the second supplier only after ~22 s, then negotiates serially; concedes fast to the first supplier and accepts its "agreed" while the cheaper one has barely started |
| + T2 `safe_close` | 0.982 | 0.755 (0.786, 0.724) | ✅ neutral/positive; guards failed accepts |
| + T3 `arena_clock_guard` | 0.982 | 0.685 (0.730, 0.639) | ❌ slightly worse |
| + T4 `safe_claims` (after fixing bug 5) | **0.990** | 0.465 (0.640, 0.289) | D01 best ever; D02 run 2 lost on arena latency (J1's final offer reached us 95 s after our message, accept too late, fallback closed C1 at €16.20) |
| + T5 `safe_single` | 0.957 | 0.786 (0.786, 0.786) | ✅ −0.025 on D01, but removes the P08 walk-away zero |
| + T6 `clause_explore` | 0.982 | 0.734 (0.765, 0.703) | neutral; targets P02 (practice only) |
| + T7 `calibrated_anchor`+`anchor_probe` | 0.982 | **0.618** (0.640, 0.596) | ❌ |

Sandbox D02 depends strongly on arena latency (replies took 20–95 s during these runs vs 0.2–15 s earlier).

Combined, in one low-latency batch (deterministic; every rep identical):
| Variant | D01 | D02 (3 runs) |
|---|---|---|
| A10 | 0.982 | 0.765 ×3 |
| A11b = A10 + T2 + T4 + T5 + T6 | 0.977 | 0.640 ×3 (T4's case-wide claim ledger costs 0.125 on the RFQ case) |
| A11b − T4 (= **A11c**: T2 + T5 + T6) | 0.957 | 0.765 ×3 (T5 costs 0.025 on D01) |

Practice A11c (10 cases, vs A10 run 2): **mean 0.657 vs 0.693** → worse.
| Case | A10 | A11c | Why |
|---|---|---|---|
| P01 | 0.956 | 0.956 | same |
| P02 | 0.360 | **0.397** | T6: different package path; deal €372.82 vs €373.12 |
| P03 / P04 / P05 / P11 | 0.923 / 0.810 / 0.659 / 0.710 | same | same |
| P07 | 0.710 | 0.691 | small |
| P08 | 0.603 | **0.361** | T2 bug: after the FIRST reply A11c accepted with reason "budget/clock" (its near-deadline test fires far too early) at €5.52 instead of negotiating to €5.42 |
| P10 | 0.671 | **0.570** | T2 bug: the supplier's better sheet was an alternative "-a"; A10 mirrors it and gets "agreed" (€31.70); A11c tried to accept the primary 7× and then accepted a worse sheet on the clock |
| P18 | 0.532 | 0.497 | small |
Verdict: **A10 stays the best**. Of the A11 work only T6 (clause, +0.04 on P02), T4's provenance part (no SQL-only IDs; D01 0.990) and T5's idea (no unchanged-goal hold without an alternative) look worth keeping in a corrected form; T1, T3, T7 hurt; T2 has two closing bugs.

Integration bugs found by our own tests (the coders' unit tests used mocks and missed all of them):
1. T4 `_safe_facts_for` crashed when the case alternative has `ref: null` (7/19 cases).
2. T7 copied terms with `json.loads(json.dumps(...))` → crashed on read-only `mappingproxy` index-clause options.
3. T1 snapshots `copy.deepcopy` threads, but T3 put an `RLock` on every thread → every RFQ worker crashed on its first
   step **silently** (no log line, futures never read) → no e-mail sent, D02 = 0 ×4. Fixed: `Thread.__deepcopy__`
   shares the lock, `mappingproxy` registered as immutable for deepcopy, every RFQ worker wrapped (crash → log + retry).
4. T1's snapshot `resync` stand-in did not accept T3's new `refresh_clock=` keyword → every second RFQ send failed.
5. T4's claim finalizer (`prepare_message`) was only called inside T3's clock-guard send path → with T4 alone the
   internal keys `_claim_plan`, `_claim_blocks`… were sent to the arena → HTTP 422 on every message → after 3 failures
   the engine accepted the opening quote → D01 = 0. It also ran after the LLM writer and rebuilt the body (discarding
   it). Fixed: finalized once at the top of `send()`, before the writer.
Lessons for the coders: never put private keys on arena messages; test each flag alone AND combined; never
`deepcopy` objects holding locks/mappingproxy; when changing a method signature, update every stand-in/lambda;
background workers must log exceptions.

## 7. The LLM writer in detail (A10w)
- 39 e-mails in the practice A/B: 35 written by Sonnet 5.5, 4 rejected by the validator (repeated ID, "forecast",
  "commit", a new number); latency median 2.5 s, p90 3.5 s, max 5.4 s; prompt cache hit from the 2nd call.
- Register mirroring works ("Guten Tag," / "Hallo," / "Dear Sir or Madam", Angebot, Zahlungsziel). Some e-mails are
  softer than the template ("we appreciate the openness in your reply").
- No measurable score gain yet; one run per case cannot separate ±0.05. The writer cannot change any number, so it can
  only change how quickly/whether the supplier moves. Ideas: firmer instructions; per-supplier persuasion emphasis
  (data-minded → evidence first; relationship-minded → long-term framing); let the writer answer supplier questions
  using engine-provided answers; package explanation ("package A if you need cash, package B if you value the
  longer contract").

## 8. Open weaknesses (prioritised by expected points)
1. **Deterministic single-supplier cases where the supplier does not follow** (P02, P04, P10, P11, P07; ~0.7 avg):
   our concession path ends at the supplier's number. Need a different lever: what makes these bots move? (They react
   to verified data that "changes our calculation", binding volume, payment terms, contract length, clauses; they
   ignore data that "does not change our calculation".)
2. **Package design**: "equal-C" packages are not equal under the arena's C → cooperative suppliers pick the worse
   one (P01). Packages should differ only in ways we have measured to be neutral, or the second one must be strictly
   cheaper for us.
3. **Raw-material leverage cases (P08, P18)**: clause structure and price jointly; deals 0.5–0.6.
4. **RFQ robustness/variance (P05)**: zero-risk from timing; duplicates/contradicted claims every run.
5. **First-ask calibration**: leverage targets too timid (0.66 of room on P18), secure_supply overshoots (1.11 on P10).
6. **Evidence quality**: "it holds, but it does not change our calculation" is the most common reply → we spend claims
   on data that has no effect on that supplier.

## 9. Constraints for any change
1. Generic only (case features, data, statuses, supplier text) - never case/supplier IDs or prices.
2. Numbers from code; every cited ID must exist in `facts.json` (or be a case ref / session offer ID).
3. New behaviour behind `Config` flags (default off); existing variants must behave exactly as before.
4. No new dependencies; Python 3.12; keep the code style; no private keys on arena messages.
5. 60 s per-thread clock, 8-minute wave, no busy loops, no network wait under the RFQ lock.
6. Free test path: offline smoke test of all 19 practice case files and sandbox D01/D02; practice costs quota (450).
