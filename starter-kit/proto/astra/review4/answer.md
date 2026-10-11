# Technical review: keep G8s, but do not confuse “best measured policy” with “final-ready system”

**My recommendation:** freeze G8s as the negotiation baseline. Prioritise protocol correctness, evidence integrity, deployment, and parallel-load testing before another broad strategy search.

G8s has the best supplied **complete ten-case practice run: 0.731, with ten deals**. That is meaningful progress. However:

- Most of its improvement over G5-1’s approximately 0.693 comes from **P02’s clause package**, not a broad improvement across suppliers.
- Several protections described in the documentation are **implemented only behind flags that G8s does not enable**.
- The supplied code still exposes potentially serious closing, clock, accounting, and provenance gaps.
- D01/D02 success does not establish readiness for five eight-minute waves with unseen case combinations.

**Evidence boundary:** I have reviewed the supplied logs, configurations, transcripts, and source excerpts. The actual `run_rfq`, complete `meso`, writer implementation, and final-wave adapter are not supplied. Consequently, I distinguish **visible code behaviour**, **behaviour reported in the log**, and **unmeasured hypotheses**. I cannot certify omitted code.

---

## 1. How the system works

### 1.1 Architecture as it exists today

G8s is a **deterministic economic policy with optional—but disabled—LLM components**.

Its effective lineage is:

**A10 → G5-1 → G7 → G8 → G8b → G8s**

The important separation is:

| Layer | Implementation | What it owns |
|---|---|---|
| Arena transport | `ArenaClient` | Session creation, messages, reads, same-move retries |
| Session/thread state | `Negotiator`, `Thread` | Supplier histories, standards, standing sheets, rounds, in-flight state |
| Data adapter | `PracticeNegotiator`, `practice.py` | SQL/facts lookups, factual arguments, supplier-cost estimates |
| Economic model | `target.py`, arena cost helpers | Estimated floors, target cost, price-for-cost solving |
| Bidding policy | `goal()`, `meso()` and tactic hooks | Concession trajectory and complete proposed packages |
| Negotiation language | `write()` | Templates, factual arguments, questions, rival disclosures |
| Closing | `best_standing()`, `close()`, `closing_move()` | Acceptance, alternative promotion, fallback closing |
| RFQ orchestration | `run_rfq()` | Staggered opening and independent supplier workers |
| Optional writer | `writer.py`, `styled()` | Body rewrite only; **off in G8s** |
| Optional stance analysis | `stance.py` | Text movement/stop signals; **not an active G8s decision component** |
| Experiment tooling | `variants.py`, `search.py`, reports, smoke tests | Candidate execution, comparison, logging |
| Development orchestration | `proto/astra/orchestrate.py` | Offline advisor/coder calls; not the live negotiator |

The older architecture diagram’s explicit **D01 policy / D02 J1 state-machine router is not the current G8s architecture**. Current rules predominantly trigger on supplier count, category goal, negotiable fields, supplier statements, and available evidence.

### 1.2 Effective G8s settings

The variant catalogue, combined with `Config` defaults, gives:

| Setting | Single supplier | RFQ |
|---|---:|---:|
| Curve exponent | `e=2` | `e=2` |
| Curve horizon | `T=4` | `T=4` |
| Reference | Current best standing cost, bounded by alternative | Same |
| Target anchor | `-0.03` | `-0.08` |
| Ordinary packages | Up to 2 | 1 |
| New fact entries | 2 | 1 |
| Ordinary holds | 1, movement threshold `0.005 × C` | 0 |
| Final-offer pushes | Effectively unavailable without another supplier backup | Up to 3 |
| Push size | Base 1%, but no single-supplier backup | Base 3%, scaled to estimated room |
| Max planned rounds | 8, additionally constrained by case round limit | Same |
| Slow ask | Single supplier, `stabilise`, guarded | Off |
| Argument spreading | Single supplier | Off |
| Proactive clause package | `stabilise` only | Subject to its generic trigger |
| LLM writer | Off | Off |
| Stance hold / velocity hold | Off | Off |
| A11 clock/closing/claim flags | Off | Off |
| U4 close recovery | Off | Off |

The RFQ overrides are applied by replacing fields in the effective configuration. The logged effective configuration therefore matters more than the named variant alone.

**Important:** ordinary single-supplier holds remain active. G8s is **not** “no holds without a useful alternative.” That protection belongs to the disabled `safe_single` path. P07, P08, and P11 transcripts explicitly show holds.

### 1.3 Decision flow per supplier message

#### A. Open and normalise

1. `open_session()` returns the case and initial supplier threads.
2. `Thread` stores messages, extracts standard terms, and records opening sheets.
3. `_docs()` loads attachment content; standards are refreshed.
4. The engine computes:
   - the outside alternative’s cost;
   - an internal opening cost;
   - supplier estimates and target cost.

Missing supplier terms must resolve through the supplier’s standard terms. This is essential: D02’s apparently cheapest opening quote was infeasible after resolving omitted lead time.

There are qualifications to this otherwise sound design:

- The visible constructor computes `c_open` from **primary opening sheets without an explicit must-have filter**.
- It computes that value before `_estimate()`.
- Alternative feasibility is explicitly checked only when `arena_clock_guard` is enabled; G8s does not enable it.
- `best_standing()` does validate must-haves, so opening-reference construction and standing-offer selection are not equivalent operations.

#### B. Estimate supplier economics

`PracticeNegotiator._estimate()` uses, approximately, this precedence:

1. Supplier’s own material/labour/conversion breakdown.
2. A material-share inference, potentially using another supplier’s material figure.
3. Supplier-specific should-cost where available, otherwise another supplier’s should-cost.
4. Current price adjusted by sustainable-margin assumption and driver drift.
5. Otherwise, 85% of the lowest observed opening-price proxy.

It then caps the estimate against a price divided by the sustainable-margin factor.

**Critical discrepancy:** with `calibrated_anchor=False`, that supposedly “opening” price is the **latest primary quote**, not the immutable opening. Thus concessions and term changes can alter the inferred cost floor. P02, P03, P07, P08, and P18 logs show targets changing on this basis.

The target solver enumerates allowed packages, solves supplier value against the estimated floor, and minimises buyer cost. For strategic cases it also considers prices above the estimated floor because relationship cost makes buyer cost non-monotone.

This is a useful bargaining model, **not knowledge of the supplier’s hidden reservation price**.

#### C. Set the round’s target

The ordinary curve is:

\[
g(r)=s+(R-s)\min(1,r/T)^{1/e}
\]

where:

- \(s\) is the anchored target, subject to applicable clamps;
- \(R\) is the current best standing cost, bounded by the alternative;
- \(e=2,\ T=4\).

Additional mechanisms include:

- `target_prior`: room priors for leverage/routine/quality;
- secure-supply price-based opening clamp;
- guarded slow asks for single-supplier stabilise cases.

**Acceptance implication:** as the curve reaches its reference, the next-goal rule becomes mechanically easy to satisfy. A log saying `offer C == goal` does **not** mean the agent reached its estimated economic optimum. Many G8s closes are schedule-driven convergence to the standing offer.

#### D. Generate packages

The documented generator:

- enumerates allowed contractual combinations;
- solves price for the round’s buyer-cost goal;
- respects fixed terms and must-haves;
- ranks using supplier value, with chargeback aversion;
- normally selects diverse packages;
- caps proposed prices against the supplier’s price;
- uses fallback feasible packages when the target cannot be reached.

Current additions include:

- retaining supplier-required terms;
- choosing the cheapest allowed version of an insisted term;
- lead-time cap for generated proposals;
- recall of a genuinely cheaper historical package;
- conditional-agreement repair;
- quality trade packages;
- RFQ freight retention, stable Incoterm handling, and Nash package bargaining.

The Nash implementation is omitted, so I can report its measured effect, not certify its precise optimisation.

**The lead cap is a bidding heuristic, not an acceptance must-have.** P10 correctly accepts a supplier-offered longer schedule when its total cost is better and the actual constraints permit it.

#### E. Build evidence and body

`facts_for()` assembles:

- contractual notice discrepancies;
- should-cost;
- falling cost-driver indices;
- historical orders;
- scorecards;
- forecasts;
- historical settlement gaps;
- genuine outside quotes;
- case-provided references absent from the local package.

`write()` adds:

- volume and fixed-term answers;
- supplier’s own breakdown argument;
- rival offer ID and proof attachment;
- proof attachments when requested;
- templated questions and closing language.

G8s enables:

- forecast-ID provenance;
- per-supplier duplicate suppression;
- plain-label proof attachments.

But the supplied conversations show that these are **not a complete evidence finalisation system**:

- P03 repeats the same forecast ID twice within one message.
- P05 repeats shared index evidence across suppliers.
- Several messages contain more than three IDs because one factual claim can use multiple IDs.
- Unknown case-only should-cost references are described as “below the current offer” even without a lookup proving that comparison.
- P02 receives a foundry-specific opening despite being a different supplier type.
- P11’s opening says “full 24 months,” while subsequent volume language and accepted contract refer to 12 months.
- P07’s bundle statement requires a scope/authorisation audit.

The docs alternate between **three claims** and **three IDs**. Those are not interchangeable. The final implementation must follow the arena’s actual claim semantics.

#### F. Accept, counter, or close

The visible single-supplier path:

1. Check wave-closing threshold.
2. Find cheapest feasible current sheet.
3. Compare it with the alternative and next goal.
4. Possibly hold once if the supplier is still conceding.
5. Accept on next goal or `agreed`.
6. On `final_offer`, push only if the configured backup condition permits; otherwise accept.
7. At round limits, close on the best available offer.
8. If no valid package exists and no alternative is available, try a must-have-restored counter.

Only a supplier’s **primary standing sheet** is directly acceptable. Alternatives are mirrored back for promotion, then accepted.

However, G8s uses the legacy closing path, whose visible weaknesses include:

- Failed alternative promotion can call `walk()` immediately.
- After promotion, it accepts the new primary without visibly checking that it is the exact package requested or still economically acceptable.
- An error-triggered retry checks must-haves and alternative cost, but normal acceptance relies on preceding state checks.
- The “no jobs, but best exists” branch does not visibly repeat the alternative-cost check.
- A transient `resync()` error can be represented as supplier withdrawal.
- An exception in `play()` can walk away from an otherwise live session.
- Unconfirmed closure may still be written to `closed.txt`.

These are readiness issues, not negotiation-style preferences.

### 1.4 RFQ coordination

Reported current behaviour, originating in E14–E18:

- One worker per supplier.
- Cheapest-quote-first stagger.
- Other suppliers open after the leader’s first reply, citing the fresh offer.
- The leader pauses after its first exchange until all suppliers have been contacted.
- Independent supplier clocks; no full-round reply barrier.
- Shared target and offer state.
- Guard against closing on an in-flight or untouched supplier.
- Later revisions avoid holding agreed/final best offers for an extended rival wait.
- Worker exceptions are logged and workers restarted.

This evolution solved real failures:

- waiting for all replies caused timeouts: E14;
- accepting just before a better reply arrived caused a bad award: E17;
- leader starvation prevented the second supplier being contacted: E18.

**What remains uncertified:** the omitted coordinator’s current locking, acceptance arbitration, stale-snapshot handling, and worker-exit behaviour.

“No network waits under the RFQ lock” must be verified by instrumentation and source inspection, not inferred from comments.

### 1.5 LLM components

#### Writer

`writer.py` rewrites only the email body:

- configured model: Sonnet 5.5;
- default writer timeout: 7 seconds;
- numbers, references, sheets, and attachments remain engine-controlled;
- validator rejects unsupported changes;
- any failure returns the template.

E37: 35 of 39 emails used the writer; median latency 2.5 seconds, maximum 5.4 seconds; practice mean **0.682 versus 0.693** for templates.

**G8s does not enable it.** The separate document proposing Sonnet with a GPT fallback belongs to another/orchestra configuration and is not evidence that G8s has that fallback.

#### Stance analyser

Three layers:

- token logic with negation;
- prototype embeddings;
- learned embedding direction.

It outputs separate movement and stop-risk signals. E45 reports useful predictive discrimination, but:

- it is not an active G8s control;
- raw `stop_risk` is not automatically a calibrated probability;
- stance annotations in reports do not mean the runtime used stance;
- case-held-out validation is not proof of unseen-supplier or unseen-language generalisation.

### 1.6 Tooling and documentation discrepancies

| Documentation statement | Current assessment |
|---|---|
| A2 plus J1 evidence trader is the final architecture | Outdated; G8s is the current generic engine |
| No LLM exists yet | Outdated as a repository description; accurate only for G8s’s active decision path |
| Sandbox suppliers are deterministic | Too strong; repeatability depends on path and execution conditions |
| G5-1 never scores below 0.765 on D02 | True for selected qualification batches, contradicted by later slow batches |
| G8s P05 is 0.659–0.710 | Supplied complete G8s run is 0.659; 0.710 is clearly measured for G8 |
| P02 0.733 beats the board record | Beats an old 0.684 snapshot; other supplied tables already show 0.847 |
| Every claim ID is used once per case | Not implemented by G8s; cross-thread index duplicates remain |
| All claims must exist in `facts.json` | Incomplete: authorised case-only refs and session offer IDs also exist |
| Robust arena clocks and transactional closing are active | False for G8s’s listed flags |
| Final session resume is implemented | Claimed by architecture docs, not demonstrated by the supplied constructor/adapter |
| Practice quota is 200 / 450 / 470 remaining | Historical and inconsistent; verify current authorised quota |
| “Full conversations supplied” | The included transcripts are explicitly trimmed, some mid-message |
| G8s is deployed/pushed | Handoff says it was not yet pushed; later deployment proof is absent |

Additional code concern: `Config` repeats several field definitions. Python keeps the later definitions; these are not separate safeguards. Remove the duplication after a behaviour-preserving configuration test.

---

## 2. Catalogue of systems, grouped into families

**Notation:** scores below are D01/D02 unless stated otherwise. “Not supplied” means no individual result is present; it does not mean the variant was never run.

### 2.1 Early baselines, specialist traders, and target model

| Systems | What they tried and measured result | Judgement and re-test value |
|---|---|---|
| Naive kit agent | Small price steps, early close. D01 0.20; initial practice P01 0.58, P07 0.12. E0 | Useful protocol baseline, economically weak. No strategic re-test needed. |
| Manual runs | Coverage, payment, effective date, evidence. D01 approximately 0.80–0.84; D02 0.22–0.33. E1 | Established structural levers and missing-term danger. Manual observations are not isolated causal experiments. |
| Separate `ControlledAgent`, `AdaptiveHybridAgent`, `LearningHybridAgent` | Controlled 0.657/0.251; adaptive 0.617/0.104; bandit 0.637/0.251. Testing-plan branch | Do not confuse these A/B/C names with engine variants A/B/C. The within-session bandit had little useful learning horizon. |
| J1 evidence trader: `j1_cost`, `j1_soft` | Demo-specific fixed bids and evidence sequence. Repeated 0.841495/0.660880; combined 0.751187 | Valuable mechanism discovery: valid rival first, early breakdown argument, complete-cost closing. Not deployable as generic policy because it contains demo identities, bids, and a hindsight-derived qualification threshold. |
| B1 / `A3fca35` | Specialist package-trading predecessor mentioned by A_hybrid | Full policy and results not supplied. Cannot rank it. |
| A_hybrid | A6 plus one supplier-quoted, buyer-cost-neutral lead-time relaxation; exact matching of all other non-price terms; €0.01 cost tolerance | Well-scoped experimental design. Measured comparison results are absent. A narrow re-test on current G8s could be reasonable only if it actually triggers. |
| Target estimator, E2 | Enumerate feasible terms at estimated supplier floor; D01 target error −2.7%, D02 post-document error −0.5% | Good economic scaffolding. The log’s “accurate enough” conclusion is too general: later practice exposes large and directionally inconsistent errors. |

### 2.2 Concession engines and A–A10

#### Core policy development

| Systems | Result | Mechanism-level judgement |
|---|---|---|
| Engine v1: `e=.2`, `T=6`, three packages | 0.845/0.408, E3 | Cost-aware packages helped; late concessions did not match these bots’ short bargaining horizon. |
| Answers, rival proof, own calculation, final push | 0.829/0.429, E4 | Rival proof helped D02; bundled changes prevent clean attribution. |
| Linear `e=1`, `T=4`; alternative promotion | 0.869/0.556, E5–E6 | Visible movement and executable closing were major improvements. |
| Early concession `e=2` | 0.849/0.619, E7 | Better D02, slightly worse D01 at that stage. Not a universal concession law. |
| Reciprocal α=.5 / 1 | 0.823/0.513 and 0.656/0.534, E8 | Confounded structural gains with price concessions; copied an early supplier move too generously or moved too little. Re-test only with same-package, total-cost-normalised movement—not the original rule. |
| Hold round | D02 up to 0.640; D01 unchanged in those runs, E9 | Sometimes bought another concession. Later P08 failure proves it is not free. |
| Evolutionary search | 92 sessions, 46 configurations; best single 0.943/0.724, unstable D02 replay, E12 | Found useful candidates, but main-effect tables were confounded and selected maxima were optimistic. |

#### Named variants

| Variants | What changed | Measured result and judgement |
|---|---|---|
| **A** | Search winner, two packages, two facts, early concessions | 0.979/0.640; practice 0.557. E15–E16. Strong sandbox policy, unsafe single-supplier pushing. |
| **B, D** | Opening-based anchors; D also bundled teammate ideas | B 0.609/0.577; D 0.609/0.584. Opening anchors weakened bargaining. Do not revive unchanged. |
| **C** | RFQ agreement-as-bar and holding email | 0.979/0.626. No demonstrated gain; holding executable deals creates timing risk. |
| **E** | Longer contract plus fixed-term answers | Separate result not supplied. Those mechanisms later entered more targeted rules. |
| **A2, A2all** | Safe pushes, bottleneck anchor, fixed-term answers, supplier-introduced terms | Final A2 0.979/0.626. A2all’s provisional comparison was 0.936/0.633. Safety mattered more than tiny demo differences. |
| **F=A3, G, H** | F stagger; G breakdown/framing; H all three | Fixed F became approximately 0.728 D02, later 0.740 ×5. G gave about +0.04 alone; H did not improve on stagger. E18–E20. Preserve stagger; do not add all language changes indiscriminately. |
| **A4** | Price-based secure-supply anchor, full coverage, fallback counter, immediate insistence handling, chargeback aversion | P10 0→0.679; P11 0.378→0.710; P18 worsened to 0.245. E22. Excellent examples of generic fixes derived from practice, but clause persistence was incomplete. |
| **A5** | Persist insisted terms, generic data path | Generic sandbox 0.982/0.706; practice 0.614 with P05 zero. E23–E25. Generalisation honestly reduced D02 score relative to hand-written facts. |
| **A6** | Closing repairs, tighter MESO tolerance, recall, proof, target prior, price-freeze handling | Sandbox D02 approximately 0.696–0.710; 19/19 smoke. No standalone full practice result supplied. Some repairs later proved incomplete. |
| **A7, A7b** | D02 search winner before proper RFQ isolation | A7 D01 0.869, D02 mean 0.755; A7b 0.982/0.698. E28. A single global fact-count change contaminated single-supplier behaviour. |
| **A8** | RFQ-only one package, one fact, −8% anchor, three pushes, breakdown | 0.982/0.765 ×4. E28. Strong scoped tuning; one RFQ package beat larger menus. |
| **A8mc, A8ev, A8ans; A9nolead** | Required-term, evidence, answer, and lead-cap ablations | Early isolated D02 results approximately 0.692/0.734/0.724; `A9nolead` result not supplied. Some results included subsequently fixed false triggers. |
| **A9** | Cheapest compatible required terms, lead cap, richer evidence/answers | 0.982/0.765; practice 0.688. E29–E30. Substantial raw-material improvement; first-insistence handling and exact lexical matching mattered. |
| **A10** | Alternative reserve, conditional repair, room-scaled pushes, plain proof | 0.982/0.772 in its batch. Practice 0.567 with two zeros, then 0.693 without zeros. E32–E37. A strong policy with fragile operational tails. |
| **A10map** | Objection-based evidence ordering | D01 0.959 versus 0.982. Do not reorder the whole evidence sequence again without a narrower trigger. |
| **A10b** | Weak-floor leverage room ×1.3 | D02 approximately 0.688 versus 0.772. It fired before documents arrived. A diagnosis of timid targets did not justify a global stronger ask. |
| **A10nomap** | Transitional configuration without objection map | Separate result not supplied; catalogue also differs from final A10 by plain-proof setting. Do not treat it as a verified alias. |

**Family judgement:** the gains came from structural package economics, timely evidence, and correctly scoped case-feature rules—not from endlessly making the concession curve firmer. Re-test economic-estimation mechanisms only after isolating accounting errors; do not repeat percentage-anchor sweeps.

### 2.3 LLM writer family

Includes **A10w, A11w, A11bw, G1-7**, and writer-enabled CS variants.

- A10w practice: **0.682 versus 0.693**, E37.
- Writer operational performance was good.
- A11w/A11bw standalone outcome tables are not supplied.
- G1-7 shortened the writer budget to three seconds; no individual score supplied.

**Judgement:** prose is not irrelevant, but the measured writer did not improve the portfolio. P01 demonstrates that a writer can induce earlier agreement to an economically inferior second package. It cannot repair an incorrect “equal-cost” frontier.

**Re-test:** low priority. A changed mechanism would restrict the writer to factual organisation or register, not add stronger persuasion, new commitments, or arithmetic.

### 2.4 Astra/Sol integration: A11 and A12

#### A11: eight-task integration

| Task | Standalone result on A10 | Assessment |
|---|---|---|
| T1 resilient RFQ | D02 0.354 | Accidentally serialised bargaining and accepted too early |
| T2 safe close | 0.982/0.755 | Promising in sandbox; later premature-close and promotion failures |
| T3 arena clock | 0.982/0.685 | Correct objective, harmful implementation |
| T4 claims | D01 0.990; D02 0.465 | Broad ledger and content changes weakened RFQ evidence |
| T5 safe single | 0.957/0.786 | Trade-off, not universal win |
| T6 clause | 0.982/0.734 | Weak/neutral standalone evidence |
| T7 calibrated discovery | 0.982/0.618 | Added delay and changed opening mechanism |

Combined outcomes:

- A11: initial D02 **0 ×4** from copying locks; then approximately 0.598 after fixes.
- A11nc: approximately 0.237.
- A11b: 0.977/0.640.
- A11b−T4 = A11c: 0.957/0.765; practice **0.657**.
- E35–E38.

**Judgement:** this was primarily an integration failure, not evidence that reliable clocks or truthful claims are bad ideas. Ninety-five edits across interacting code paths were too much to validate as one experiment.

#### A12: smaller follow-up

| Component | Result | Assessment |
|---|---|---|
| U1 package frontier | D01 0.995; D02 0.703 | Trusted uncertain cost estimates too strongly |
| U2 bounded RFQ race | D02 0.660 ×2 | Delayed second supplier opening |
| U3 provenance only | D01 0.995; D02 0.577–0.598 | Changed meaning/relevance, not merely provenance |
| U4 close recovery | 0.982/0.786 ×2 | Best isolated reliability candidate, but initially rejected valid supplier alternatives |

Combinations:

- A12: D02 approximately 0.535–0.577.
- A12b: no separate result supplied.
- A12c: 0.995/0.682–0.703.
- A12d: 0.995/0.765; practice **0.664**.
- Fixed A10+U4 restored P10 from 0.570 to 0.671. E39.

**Re-test:** yes, but only an **exception-path-only recovery patch**, preserving successful G8s decisions. Do not enable A11 or A12 wholesale.

### 2.5 D02 evolution: G1–G3

These were extensive searches with a relatively narrow payoff.

#### Generation 1

| Variants | Mechanism | Supplied measurement |
|---|---|---|
| G1-1 | Longer explicit runway/holding | D02 0.608 |
| G1-2 | Remove rival disclosure | 0.640 |
| G1-3, G1-4 | Near-supplier packages; volume framing | Individual results not supplied |
| G1-5 | Remove fact drips | 0.542 |
| G1-6, G1-7 | Brief tone; short-budget writer | Individual results not supplied |
| G1-8, G1-9 | Offer-owned final probe; selective rival bar | Individual results not supplied |
| G1-10, G1-11 | Payment experiment; free lead slack | Individual results not supplied |
| G1-12 | Retain freight concession | Mean 0.758, including 0.786 runs |
| G1-13 | Rebase after cost evidence | Individual result not supplied |
| G1-14 | Residual-cost bridge | 0.752 |

A10 was approximately 0.759–0.772 in those batches. No individual winner. E40.

#### Generation 2

| Variants | Mechanism | Supplied measurement |
|---|---|---|
| G2-1 | Longer runway | 0.512 |
| G2-2 | Firmer `e=1` | 0.605 |
| G2-3 | No extra target discount | Individual result not supplied |
| G2-4 | No hold rewinds | 0.752 |
| G2-5 | One larger terminal request | Individual result not supplied; also changed runway |
| G2-6 | Remove breakdown argument | 0.724 |
| G2-7 | Material-share bridge | Individual result not supplied |
| G2-8 | Stable Incoterm | 0.752 |
| G2-9 | Challenger rebid | 0.772, but challenger walked |
| G2-10–12 | Payment lanes, actionable rival bar, cost-first leader | Individual results not supplied |

E41. A small mean gain that comes from the incumbent closing normally while the challenger withdraws is not evidence the challenger tactic helped.

#### Generation 3

- G3-1–4 combine freight retention, stable Incoterm, and removal of hold rewinds.
- **G3-4**: six-run mean **0.776**, observed range 0.765–0.786, versus weaker same-batch A10 means.
- G3-5 adds cost bridge; G3-6 scheduling slack; G3-7 faster RFQ concessions. Individual results not supplied.
- G3-8 open-only challenger rebid: 0.772.
- G3-9 monotone late asks: 0.765.
- G3-10 conditional award language: 0.723.
- E42.

**Judgement:** protecting earned freight terms was valuable because price alone concealed landed-cost regressions. The improvement was modest and path-specific.

**Re-test:** preserve the successful combination. Retest only evidence-qualified contractual changes, not another general D02 search.

### 2.6 Game theory and AI deciders: G4–G5

| Variant | Result | Judgement |
|---|---|---|
| G4-1 reservation-band goal | D02 0.751 in research assessment | Too little information before finality; new goal did not beat the curve |
| G4-2 robust Nash package bargaining | 0.779 versus A10 0.765 | Useful bounded package-selection improvement |
| G4-3 descending evaluated-cost auction | Approximately 0.324 / unconfirmed closes | Incompatible with observed bot response/protocol behaviour |
| G4-4 sealed final round | 0.463 | Voluntarily removed useful bargaining opportunities |
| G4-5 price advisor; G4-6 final gate; G4-7 term picker | 0.717–0.751 | LLM decisions tended to concede faster; no improvement |
| G4-8 portfolio decider | Three timeout zeros; hung | Runtime design failure as well as weak evidence for the policy |
| **G5-1** | Sandbox batch 0.772; practice 0.694 | Best conservative combination: G3-4 plus Nash |
| G5-2 | D02 0.744 | Reservation-band addition weakened the combination |

E43.

**Re-test:** no live AI price/action decider before the final. A tightly constrained extraction component is a different mechanism; an LLM choosing how generous to be is not.

### 2.7 Alternative negotiators: ALT-1–6

Corrected second-round results, E44:

| Variant | D01 / D02 | Failure mechanism |
|---|---:|---|
| ALT-1 LLM principal | 0.629 / 0.319 | Accepted materially earlier/higher |
| ALT-2 digital twins/lookahead | 0.000 / 0.063 | Model/fallback failure; opening acceptance |
| ALT-3 Bayesian stopping | 0.655 / 0.440 | Overvalued stopping before extracting concessions |
| ALT-4 contingent protocols | 0.749 / 0.223 | Protocol selection did not reproduce strong RFQ sequence |
| ALT-5 objective settlement | 0.011 / 0.032 | One-shot “fairness” was not the scoring objective |
| ALT-6 constraint discovery | 0.000 / 0.217 | Discovery/settlement design failed to produce competitive valid outcomes |

Initial schema and estimator-initialisation bugs were real, but the corrected batch still failed badly.

Also, the catalogue’s ALT configurations retain A10-like settings and RFQ holds rather than all G5-1 additions. The experiment was a comparison against G5-1, not necessarily a clean “replace only the negotiator” ablation.

**Judgement:** reject these implementations for the final. They do not disprove every possible learned planner, but they decisively fail the time-left test.

### 2.8 CLUSTER / SAFEZONE and price-range anchors

#### CS-60 / CS-45

- CS-60: 0.999/0.632.
- CS-45: 0.977/0.597.
- Same-batch G5-1: 0.982/0.723. E46.

Problems:

- simultaneous opening lost the stagger advantage;
- Incoterm changes obscured the bargaining basis;
- stance thresholds mostly activated only after finality;
- clustering was effectively a no-op with two suppliers;
- a holding email did not create a contractually reserved offer;
- the additional PV transformation changed the objective away from official C without evidence of score benefit.

#### CS2-45 / CS2-60

Added stagger, Incoterm locking, no direct acceptance, and mandatory beat rounds.

- CS2-45 approximately 0.563 D02.
- CS2-60 approximately 0.542.
- E49.

It now executed more of the requested protocol, but led with the wrong supplier for the successful D02 sequence and locked costly freight terms.

**Judgement:** do not revive. The useful single-supplier slow ask was already extracted and then narrowed into G8s.

#### RA-10 / RA-15 / RA-20

Soft anchors based on unit-price bands.

- RA-10: 0.982/0.759.
- RA-20: 0.982/0.689.
- RA-15 individual batch result not supplied.
- Baseline D02 0.772. E47.

The lowest nominal price merely exchanged price for freight. Unit-price thresholds are also sensitive to price units and product scale.

**Re-test:** no; not a robust generic feature.

### 2.9 Stance family

E45:

- token logic current-concession AUC 0.834;
- next-concession AUC 0.688;
- learned direction next-stop AUC 0.769;
- observed stop frequency 8% in lowest versus 49% in highest quartile.

But:

- 76% D02 concentration is reported;
- replies within sessions are dependent;
- some bodies are truncated;
- current concession wording is partly a description of an already-visible structured move;
- leave-one-case-out is not necessarily leave-one-supplier-out;
- predictive associations do not identify which buyer action causes a better outcome.

G6 stance holds did not explain a gain; R3 later lost. The concession-profile gate in G8c classified too late.

**Judgement:** useful diagnostic telemetry, not a demonstrated stopping policy. Retest only after controlling for round, status, previous structured movement, and case/supplier grouping.

### 2.10 G6–G8s and sweetener packages

| Variant | Result | Judgement |
|---|---|---|
| G6 | 0.995/0.744 in its batch | Mixed bundle of evidence, stance, slow ask, quality, recall |
| G5-1s | D02 0.716 versus baseline 0.758 | Spreading evidence delayed the decisive breakdown argument |
| G6s | D01 1.000; D02 0.723 | Single-supplier benefit, RFQ loss |
| G6ss | 1.000/0.765 | Correctly scoped spreading |
| G7 | 1.000/0.765; practice 0.682 | Sandbox win failed to generalise; slow ask could be more generous than normal |
| G7sw | D02 0.569 versus same-batch G7 0.695 | Supplier’s own structure became an easy expensive anchor |
| G8 | Practice 0.718 | Fixed slow-ask generosity; P02 clause win; unsolicited leverage clauses hurt |
| G8b | Composite approximately 0.726 | Clause restricted to stabilise; composite, not a complete run |
| G8c | D01 0.982; P07 0.665, P08 0.553 | Learned profile gate arrived too late |
| **G8s** | D01 1.000; D02 baseline-equivalent; full practice 0.731 | Simple category gate beat late online classification |

E49–E55.

**Judgement:** this is the strongest example of successful scope reduction. It is not evidence that “slow asks work generally”; it is evidence for a guarded stabilise-only exception.

### 2.11 Timid-target fixes R1–R3

E56, same batch:

| Variant | D01 / mean D02 |
|---|---:|
| G8s | 1.000 / 0.751 |
| R1 lower floor priors | 0.979 / 0.681 |
| R2 bolder anchors | 0.991 / 0.723 |
| R3 velocity/stance hold | 1.000 / 0.716 |

**Judgement:** an overly high estimated target does not imply that lowering the opening ask or refusing to accept will unlock the missing score. The supplier response mechanism matters.

**Re-test:** only a genuinely corrected economic input or newly authorised trade—not another numerical aggression adjustment.

### 2.12 Outside-review ideas: G9, G9v, G10

- **G9a mirror jump:** did not trigger under its own ratio criterion; observed supplier ratios did not support the theory. Dropped.
- **G9b offer memory:** no genuinely cheaper historical package found in the tested practice cases.
- **G9c figures answer:** sandbox-safe; tested practice “gates” mostly were final-offer language or refusals.
- **G9 / G9bc:** sandbox unchanged; approved four-case G9bc practice unchanged.
- **G9v exclusive-volume wording:** D02 0.713 versus G8s 0.734 in the same batch. No delay to finality.
- **G10a shared-index skip:** duplicates reduced from 8 to 2 in the E60 comparison; P05 0.688, within the supplied 0.659–0.710 baseline-family range. Score benefit unproven.
- **G10b adopted lane:** P07 0.697 versus 0.704; P04 unchanged. Persisting a once-rewarded lane prevented a later useful trade.
- E57–E60.

**Judgement:** reject fabricated “proof,” unavailable terms, and invented historical offers outright. Keep G10a as a small confirmation candidate. Do not revive blind lane persistence or mirror jumps.

---

## 3. Cross-cutting lessons

### 3.1 What these suppliers appear to reward

The strongest supported mechanisms are:

1. **Complete-cost contractual trades.**
2. **Fresh, credible rival offers.**
3. **Verified and relevant evidence delivered before finality.**
4. **Visible buyer movement.**
5. **Packages that answer an actual supplier constraint.**
6. **Closing on an executable offer rather than an attractive-looking proposal.**

The reported ablations suggest substantial D02 effects from rival disclosure, facts, breakdown arguments, and staggered opening. These effects are **not additive**; they interact.

### 3.2 Text is informative, but not authoritative

The transcripts contain contradictions:

- P02 accepts a clause while saying it prefers no clause.
- P03 says prices are frozen but moves price.
- P11 requests faster payment after being told payment is fixed.
- Suppliers repeat volume questions after receiving forecasts.

Therefore:

- structured terms and status govern execution;
- prose can suggest an experiment;
- prose alone does not establish an economic floor, causal “gate,” or binding agreement.

E58’s fourth-reply finality is a useful observation for that tested bot/path. “Built into the bot” is stronger than the supplied evidence proves.

### 3.3 The D02 ceiling is empirical, not a theorem

Hundreds of runs support diminishing returns near the observed landed-cost plateau. That justifies stopping broad D02 optimisation.

It does **not** prove:

- an absolute supplier reservation price;
- that every allowed mechanism has been exhausted;
- that `C_best` was calculated from exactly the inferred direct-cost package.

The record itself includes different nominal prices and freight terms. Use “observed plateau under tested policies,” not “unreachable by definition.”

### 3.4 Repeatability and determinism are different

The sequence of claims was:

- identical early runs;
- large D02 replay differences;
- orchestration fixes;
- identical qualification batches;
- later slow-batch degradation again.

This supports **execution-sensitive repeatability**, not universal determinism.

Every comparison must control or at least record:

- variant order;
- concurrency;
- response latency;
- supplier contact order;
- retry count;
- complete action history;
- source/configuration revision.

### 3.5 Sandbox capability is narrow

Sandbox can test:

- runtime integration;
- baseline regressions;
- D01/D02 tactics;
- timing and concurrent orchestration under actual service conditions.

It cannot establish:

- quality negotiation performance;
- bundle-scope handling;
- all clause behaviours;
- hidden supplier generalisation;
- correctness of relationship-cost estimates;
- final-wave recovery.

A candidate that never triggers in D01/D02 has passed a regression check, **not an effectiveness test**. E57 is the clearest example.

### 3.6 The practice evidence is stronger than the demo search—but still selected

Most full practice batches have one run per case. Repeated unchanged single-supplier outcomes are encouraging, but RFQs remain variable.

Best-per-case tables and board maxima are not expected portfolio performance. Composite tables are not complete runs. Historical board values are inconsistent and stale.

Most importantly, G8s’s improvement over G5-1 is concentrated:

- P02 rises from 0.360 to 0.733.
- Divided across ten cases, that accounts for almost the entire approximately 0.038 mean improvement.

That is a valuable fix, but not broad proof that G8s understands suppliers better.

### 3.7 Our process improved, but integration discipline lagged

Good decisions:

- moved to a generic data path despite a lower demo score;
- retained negative results;
- ablated A11;
- stopped practice on weak alternatives;
- introduced explicit practice approval;
- pre-wired hooks before parallel coders;
- recovered real arena results after reporting crashes.

Bad or risky decisions:

- enabling large bundles before integration isolation;
- mocked tests that omitted real locks, immutable objects, and terminal states;
- repeatedly promoting “current best” from sandbox-only results;
- treating correctness rules as optional strategy flags;
- conflating policy gains with bug fixes;
- continuing D02 search well into diminishing returns;
- interpreting non-triggering tests as support;
- allowing code and documentation to drift across branches.

The cleanup incident in E11 also matters: session ownership is an operational safety boundary, not bookkeeping.

### 3.8 A smoke pass is not a safety proof

The 19/19 smoke test is useful. It did not catch:

- lock-copy failure;
- RFQ worker starvation;
- late acceptance;
- changed offer IDs;
- premature deadline closure;
- incorrect alternative promotion;
- actual package-cost disagreement;
- unsupported forecast IDs.

Final testing must exercise **state transitions and failures**, not just package construction.

---

## 4. Judgement of G8s

### 4.1 Per-case assessment

The IDs below are evaluation labels only, never proposed runtime selectors.

| Case | G8s evidence | Strength, weakness, and risk |
|---|---|---|
| **P01** | 0.956 | Excellent accepted package and date/payment trade. Internal accepted cost is about €1.119m versus official €1.099m: valuation mismatch remains. Earlier-package/date changes caused regressions in A12/G7. Protect this path. |
| **P02** | 0.733 | Largest real gain: allowed clause package unlocks a lower-cost agreement. Narrow score denominator makes small valuation errors important. Mutable “opening” floor and incorrect foundry boilerplate remain. |
| **P03** | 0.924 | Good coverage/payment result. `price_freeze=True` does not visibly prevent lower price asks; likely detection/path mismatch. Duplicate forecast in one message. Little reason for aggressive changes. |
| **P04** | 0.810 | Correctly avoids mistaking lower unit price for lower total cost. Target is far too optimistic: about €169k versus best benchmark about €197k. “Which figures?” occurs in final offer; not a demonstrated extra-round opportunity. |
| **P05** | 0.659 in complete G8s run | Biggest operational exposure: three suppliers, repeated shared evidence, previous zeros, approximately 101-second negotiation. Engine `c_open` approximately €270k differs from official €306k. Leader eligibility and opening normalisation need audit. |
| **P06** | Offline smoke only | RFQ/stabilise combination. Current rules may interact differently: relationship estimates, proactive clauses, RFQ overrides. Negotiation performance unmeasured. |
| **P07** | 0.704 | Works with payment/contract trades. Bundle scope and volume explanation may be inconsistent. A once-successful lane is not always the next best lane; G10b regressed. |
| **P08** | 0.614 | Required-clause handling and long payment are effective. Supplier says recent index fall is hedged out of current cost. Accepts while still open; that alone does not justify another hold—earlier hold caused a zero. |
| **P09** | Offline smoke only | Capacity scenario; allocation restoration and no-alternative behaviour need transition testing. Performance unmeasured. |
| **P10** | 0.671 | Correctly restores coverage, promotes alternative, and closes without a speculative push. Highest priority is preserving this success. The longer lead is economically better than the faster primary and is not automatically illegal. |
| **P11** | 0.710 | Strict PPM with zero chargeback was a major historical improvement. Current quality-package addition has not improved it further. Payment is fixed; cannot invent a cash lever. Supplier later explicitly asks for firm volume data, distinct from the earlier refusal phrase. |
| **P12** | Offline smoke only | Quality scenario. Must test allowed PPM/chargeback combinations, fixed terms, and attached quality documents. Performance unmeasured. |
| **P13** | Offline smoke only | Price-increase/leverage combination. Risk from broad room priors and evidence assumptions. Performance unmeasured. |
| **P14** | Offline smoke only | Renewal without alternative. Generic `never_walk` is not an end-to-end no-unnecessary-walk guarantee. Performance unmeasured. |
| **P15** | Offline smoke only | Bundling. `parts[0]` use is a material scope risk. Performance unmeasured. |
| **P16** | Offline smoke only | Steel-index scenario. Widest allowed clause variant is recognised in smoke tests; acceptance/trade behaviour unmeasured. |
| **P17** | Offline smoke only | Component-cost scenario. Different cost structure and units may stress evidence and floor inference. Performance unmeasured. |
| **P18** | 0.532 | Largest weak single-supplier case. Target remains materially above benchmark, but stronger generic anchors already failed. More plausible opportunity is a supplier-introduced contractual trade or better proof before finality. |
| **D01** | 1.000 in repeated recent comparisons | Saturated regression test, not a source of further score. New changes should preserve it without inferring universal stabilise behaviour. |
| **D02** | Often 0.765; slow-batch variation | Strong tested RFQ sequence. Still sensitive to execution and freight basis. Stop broad ceiling chasing; use it to detect regressions. |

P19 also passed offline smoke, but no hosted outcome is supplied.

### 4.2 Strengths

- Code owns prices and arithmetic.
- Total-cost comparison avoids nominal-price traps.
- Generic feature-based rules replaced demo identities.
- Good coverage and quality trade handling.
- Staggered RFQ opening and freight retention have concrete evidence.
- G8s fixes major earlier practice failures without wholesale policy replacement.
- Optional LLM components are not dependencies for the current best path.

### 4.3 Weaknesses

- Economic estimates are sometimes self-referential and materially wrong.
- Evidence selection is partly cached, generic, and source-insensitive.
- Claim correctness is not enforced uniformly at dispatch.
- Legacy closing and clock paths remain active.
- A large experimental engine makes flag interactions difficult to reason about.
- There is no demonstrated complete final-wave rehearsal in the supplied record.
- Only ten practice cases have hosted results; the other case types have construction tests.

### 4.4 Hidden-final risks

The final may combine precisely the features we have not jointly validated:

- RFQ plus strategic relationship cost;
- multiple parts plus fixed bundle scope;
- unfamiliar standard-term documents;
- invalid openings from every supplier;
- no useful alternative;
- different price units;
- supplier replies with no sheet;
- conditional agreements with different wording;
- slow or ambiguous transport responses;
- multiple simultaneous closes across supplier workers.

The code must handle these without relying on the demo bots’ phrasing or pacing.

---

## 5. Improvements to G8s

### Proposal rules

All proposals below:

- trigger on case data and state, never case/supplier identity;
- preserve code-computed numbers;
- use only authorised options and commitments;
- keep network/LLM waits outside the RFQ lock;
- start with offline tests and sandbox regression;
- require the lead’s explicit approval before practice.

The **0–0.04 per-case upside envelopes** below are unmeasured planning hypotheses consistent with E59, not statistical forecasts. Actual effects can be negative. Reliability gains cannot be honestly quantified without a failure-rate estimate.

### S5-1 — Exception-only transactional recovery and truthful session ownership

**Rank: highest expected value. Effort: M.**

**Mechanism**

Preserve healthy G8s decisions, but make failed execution a recoverable transaction:

- persist session ownership immediately after successful creation;
- distinguish “sent but response unknown” from “not sent”;
- reuse the same move ID only for the same ambiguous request;
- refresh authoritative state before choosing a different action;
- after alternative promotion, validate the actual returned primary, not the intended package;
- never infer withdrawal from a failed read;
- never mark a session closed without confirmed terminal state;
- after one supplier’s failed acceptance, re-evaluate remaining live feasible offers;
- do not walk merely because a promotion response was missing.

Use short local state reservations under the RFQ lock; perform HTTP outside it; validate state revision before committing the result.

**Trigger:** transport ambiguity, stale offer, failed promotion, conflicting close, crash/restart.

**Targets:** P05/P10 and hidden multi-supplier/no-alternative cases.

**Expected gain:** healthy-path score change should be zero. Tail-loss prevention is **unmeasured**, potentially more valuable than small bargaining improvements.

**Risk:** accidentally serialising suppliers or closing early.

**Why not a measured failure:** A11/T1/T2 and U4 changed healthy scheduling or rejected alternatives. This patch is confined to exceptional transitions and must prove healthy-path equivalence.

**Cheapest test:** replay exact successful decisions, then fault-inject dropped responses, stale IDs, term changes, failed reads, and competing accepts. Sandbox D01/D02 next; authorised practice only after equivalence and recovery pass.

---

### S5-2 — Source-backed payload audit, without broad evidence reordering

**Rank: very high. Effort: M.**

**Mechanism**

Introduce a final deterministic content audit that preserves the existing evidence order:

- deduplicate an identical ID within a single message;
- distinguish claim count from reference count;
- support every factual comparison with an actual value/source;
- replace unknown-reference assertions such as “below your offer” with neutral identification;
- remove unsupported supplier-persona claims;
- derive horizon and volume wording from authorised case scope;
- distinguish historical purchases from currently executable competing quotes;
- retain the supplier’s breakdown arithmetic, but describe any residual as **before unknown overhead/profit**, not guaranteed positive margin;
- audit bundle commitments against the case’s permitted award scope.

Forecasts, historical orders, and binding commitments must remain distinct concepts.

**Trigger:** every outbound body, reference list, and proof attachment.

**Targets:** P01/P02/P03/P05/P07/P11; all hidden cases.

**Expected gain:** score effect unmeasured; this is principally integrity and robustness work. It may sacrifice a misleading argument that previously appeared effective.

**Risk:** overbroad filtering removes useful verified evidence.

**Why not a measured failure:** T4/U3 also changed cross-thread allocation, relevance, and wording strength. This proposal changes only unsupported or duplicate content and leaves valid early RFQ evidence intact. It is not G2-6’s removal of the entire breakdown argument.

**Cheapest test:** generate payloads from recorded states and require source pointers for each factual sentence. Include P03’s duplicated forecast, P02’s foundry wording, and P11’s horizon mismatch as regression fixtures.

---

### S5-3 — Shadow cost/input reconciliation before changing targets

**Rank: high. Effort: M.**

**Mechanism**

Add a non-decision-changing audit recording, per evaluated package:

- fully resolved terms and source defaults;
- fixed-term precedence;
- price-unit normalisation;
- direct official-helper cost components;
- relationship component and its estimated inputs;
- opening eligibility;
- immutable opening price versus current quote used by the floor cap.

Reconcile historical accepted packages against official cost breakdowns. Separate:

1. deterministic normalisation errors;
2. hidden supplier-cost uncertainty;
3. policy choices such as the moving-price cap.

Only deterministic errors should become immediate fixes. Any target-policy change gets a separate flag and experiment.

**Trigger:** case initialisation, estimate refresh, package ranking, acceptance.

**Targets:** P01/P02/P03/P05; unseen price units and multi-part cases.

**Expected gain:** zero in shadow mode; downstream score gain **unmeasured and not credibly quantifiable yet**.

**Risk:** mistaking a legitimate hidden-cost difference for a calculator bug, then “correcting” a successful path.

**Why not a measured failure:** no bolder anchor, floor multiplier, discovery turn, or U1 re-ranking is introduced. This diagnoses why the inputs disagree before changing strategy.

**Cheapest test:** offline reconciliation of supplied completed sessions. Sandbox must show identical actions in shadow mode.

---

### S5-4 — Confirm G10a’s narrow shared-index handling

**Rank: high value per small effort. Effort: S.**

**Mechanism**

Retest the already-built `shared_index_skip` rule:

- RFQs only;
- skip an index fact already allocated to another supplier;
- choose the next unused fact;
- preserve rival references, breakdown argument, and all other evidence types;
- reserve index use locally at dispatch, without waiting for the network under lock.

Audit claim metrics by original response event so repeated order-confirmation claim results do not inflate counts.

**Trigger:** shared index evidence in a multi-supplier case.

**Targets:** P05 and hidden RFQs.

**Expected gain:** fewer duplicates is measured; **score gain remains unmeasured**, with a tentative 0–0.04 triggered-case upside envelope.

**Risk:** removing a repeated fact that still has persuasive value, or merely reducing verified claims without improving offers.

**Why not a measured failure:** E60 reduced duplicates and produced a score inside baseline variation. It is not the broad T4 ledger, and it does not suppress rivals.

**Cheapest test:** existing offline trigger tests plus sandbox regression. With approval, interleave G8s/G10a on the affected RFQ; do not compare one candidate run with a historical maximum.

---

### S5-5 — Request-specific proof in the existing counter, before finality

**Rank: medium-high. Effort: S–M; classify M for implementation planning.**

**Mechanism**

Expand proof handling only for concrete, current requests while the supplier remains open:

- “send competing offer” → supply the real current quote if one exists; otherwise identify the earlier statement as historical purchase evidence;
- “firm data or orders for volume” → attach the relevant actual forecast/orders and explain what they do and do not substantiate;
- “which calculation” → attach the corresponding sourced calculation, not an unrelated fact dump.

Keep the normal counter and evidence sequence. Do not add a discovery-only round, bypass a final offer, invent a larger commitment, or re-cite already-spent IDs unnecessarily.

**Trigger:** explicit unresolved evidence request on an open thread, with matching real evidence available.

**Targets:** P08/P18/P11; P04 only if proof can accompany the relevant statement before finality; P07 for authorised bundle scope.

**Expected gain:** **unmeasured**, 0–0.04 per triggered case.

**Risk:** supplier boilerplate is mistaken for a genuine gate; irrelevant attachments add complexity without benefit.

**Why not a measured failure:** G9 waited for a narrow late phrase and often never fired. This targets earlier specific requests visible in the transcripts. It must first demonstrate that G8s’s existing `proof` hook actually misses them.

**Cheapest test:** recorded-state trigger audit. If the existing hook already answers correctly, stop—no new feature. Otherwise sandbox regression, then approved targeted practice.

---

### S5-6 — Supplier-introduced clause trade, priced jointly

**Rank: medium. Effort: M.**

**Mechanism**

When an open supplier introduces an allowed clause alternative or an explicit price conditional on that clause:

1. resolve its exact offered structure;
2. preserve the normal primary package;
3. consider one secondary package using that supplier-introduced clause variant;
4. compute the required base-price adjustment with the cost solver;
5. retain fixed terms, coverage, must-haves, and price cap;
6. do not replace an economically superior package merely because the supplier once mentioned a term.

Treat the result as a counteroffer unless it exactly promotes a current supplier alternative.

**Trigger:** explicit supplier-introduced clause/price relationship, before finality.

**Targets:** P08/P18; potentially P16 after offline validation.

**Expected gain:** **unmeasured**, 0–0.04 per triggered case.

**Risk:** conceding clause economics without receiving the required price reduction; uncertain relationship costs can distort equivalence.

**Why not a measured failure:** unlike G8, it does not offer an unsolicited leverage clause. Unlike G10b, it does not persist a lane merely because it was previously adopted. Unlike existing conditional repair, it explicitly compares allowed clause variants and their required price compensation.

**Cheapest test:** offline replay proving a distinct candidate survives all guards. If it duplicates current conditional repair, stop. Then sandbox regression and lead-approved practice.

---

### S5-7 — Optional supplier-quoted, cost-neutral schedule relaxation

**Rank: low; only after readiness work. Effort: S if the A_hybrid implementation can be reused cleanly.**

**Mechanism**

Port the narrow A_hybrid rule onto G8s:

- open RFQ thread;
- lead time negotiable and not fixed;
- supplier has explicitly quoted a longer allowed schedule;
- every other non-price term matches after resolution;
- schedule remains within need;
- full buyer costs are finite and within the documented €0.01 tolerance;
- modify at most one package and ask whether the supplier can confirm the proposed price on that quoted schedule.

**Targets:** D02 as regression/trigger test; hidden RFQs with unnecessary requested speed. **Not P10’s later-than-need schedule.**

**Expected gain:** **unmeasured; likely small and possibly zero**. No defensible numeric forecast is supplied.

**Risk:** quote compatibility does not imply the lower proposed price is acceptable.

**Why not a measured failure:** G1-11/G3-6 broadly spent theoretical lead slack. This requires exact supplier-quoted feasibility and complete-cost equality. The supplied A_hybrid report gives a policy, not results.

**Cheapest test:** synthetic trigger fixtures and current G8s sandbox comparison. Stop if it never triggers or only reproduces an existing package.

---

## 6. Different approaches worth considering

The remaining time is not specified, so I will not pretend to know that a new architecture can be completed before the final. None has measured evidence of beating G8s.

### S6-1 — Event-sourced, pure-decision G8s executor

**Design**

Separate:

- immutable arena observations;
- pure G8s decision computation;
- proposed action;
- validated dispatch transaction;
- authoritative acknowledgement.

The policy consumes a snapshot and returns an action without performing I/O. A separate executor owns clocks, idempotency, recovery, and case-wide acceptance.

**Why genuinely different**

This is not ALT-4’s new bargaining scripts or A11’s larger threaded controller. It preserves G8s’s bargaining decisions while replacing implicit mutable execution with explicit state transitions.

**Could it beat G8s?**

- On healthy negotiation score: probably not; equivalence is the goal.
- On final realised score under faults: **possibly**, through avoided zeros.
- Within time left: worth implementing only the minimal journal/recovery slice now. A full rewrite is too risky without differential tests.

**Worth it:** **yes**, scoped to reliability.

### S6-2 — Robust conditional-trade compiler

**Design**

Represent a supplier’s explicit conditional offer as a source-linked constraint:

- quoted price;
- required allowed term;
- supporting text span;
- actual standing-sheet context.

Code enumerates only packages satisfying those extracted conditions and compares them under known costs plus explicitly uncertain relationship inputs. It abstains when the condition cannot be resolved.

The language model, if used, extracts text spans and categories; it does not invent numbers or select generosity.

**Why different from ALT-6**

ALT-6 spent interaction discovering constraints and then handed control to a new settlement design. This approach consumes already-received conditions, adds no discovery round, and cannot replace G8s closing with an invented “joint optimum.”

**Could it beat G8s?**

Maybe on unfamiliar clause, quality, and conditional-agreement wording. Benefit is unmeasured. A deterministic subset is feasible; broad LLM extraction before the final is not justified without strong source-validation tests.

**Worth it:** **maybe**.

### S6-3 — Offline adversarial policy portfolio, not online digital twins

**Design**

Build a local test environment with explicit supplier mechanisms and transport faults:

- short-horizon finality;
- reciprocal concessions;
- margin protection;
- clause dependence;
- volume sensitivity;
- missing terms;
- stale offers and delayed responses.

Evaluate a small set of generic policies and choose a conservative policy by worst-case regret or case-feature routing. Do not run LLM “imagined supplier” rollouts during timed negotiations.

**Why different from ALT-2**

ALT-2 depended on online model predictions and had catastrophic fallback behaviour. Here the simulator is an offline falsification tool. G8s remains the live fallback and policies cannot be promoted merely because they beat a simulator they were tuned against.

**Could it beat G8s?**

It may expose hidden-case weaknesses and improve robustness. It cannot establish a hosted score gain. Building and calibrating a useful portfolio is unlikely to beat a frozen G8s before an imminent final.

**Worth it:** **maybe** as testing infrastructure; **not** as a last-minute live replacement.

---

## 7. Final-readiness checklist

### Release identity and configuration

- [ ] G8s source, dependencies, data package, and effective configuration are committed and pushed.
- [ ] The final launcher explicitly selects G8s—not bare `Config()`, whose defaults include unsafe broad pushing and three packages.
- [ ] Runtime configuration hash and source revision are recorded per session.
- [ ] Documentation names the actual active flags and final adapter.
- [ ] Dormant experiments cannot be enabled accidentally through stale environment settings.

### Session and action correctness

- [ ] Session ownership is persisted immediately after creation.
- [ ] Restart resumes owned sessions instead of opening duplicates.
- [ ] An ambiguous POST cannot cause a different second action before resynchronisation.
- [ ] Alternative promotion validates the returned primary.
- [ ] Stale-ID recovery cannot accept a materially changed package without re-evaluation.
- [ ] Read failure is not converted into supplier withdrawal.
- [ ] “Closed” means arena-confirmed terminal, not “our worker stopped.”
- [ ] Local failure score is distinguished from official arena outcome.
- [ ] Cleanup touches only this runner’s owned sessions.

### Timing and parallelism

- [ ] Five-wave orchestration passes a rehearsal.
- [ ] Ten cases with up to three suppliers each are exercised locally under delayed responses.
- [ ] No HTTP, model call, document fetch, or wait occurs under the shared RFQ lock.
- [ ] Fast suppliers are not blocked behind slow suppliers.
- [ ] Staggered opening cannot leave a supplier untouched.
- [ ] Only one close transaction owns a case at a time.
- [ ] The wave deadline is actually supplied to G8s; otherwise legacy `near_cap()` returns false.
- [ ] Alternative promotion has its existing two-exchange reserve.
- [ ] The ten-minute experiment watchdog is not mistaken for compliance with an eight-minute final wave.
- [ ] Thread budgets use authoritative remaining time or a tested conservative mechanism, not document-read completion time.
- [ ] Writer/stance services are unnecessary when disabled and cannot silently become live dependencies.

### Terms and economic correctness

- [ ] Opening references, standing offers, and alternatives use consistent standard-term resolution.
- [ ] Must-haves are checked on every acceptance path.
- [ ] Only allowed buyer options are proposed; supplier-offered exceptions are handled according to the actual interface contract, not blanket trust.
- [ ] Price units, currencies, quantities, horizons, coverage, and effective dates are normalised.
- [ ] Multi-part cases do not silently become first-part-only negotiations.
- [ ] Missing/null alternative references and empty data are handled.
- [ ] Non-finite costs cannot enter package selection or acceptance.
- [ ] Relationship-cost uncertainty is logged rather than presented as exact knowledge.

### Evidence integrity

- [ ] Every claimed fact and comparison has provenance.
- [ ] SQL existence is not confused with arena-citable-ID existence.
- [ ] Case-only references are not assigned invented values or unsupported comparisons.
- [ ] Forecasts are not described as orders.
- [ ] Historical purchases are not called live competing quotes.
- [ ] No unsupported margin assurances or supplier-cost claims.
- [ ] Bundle scope does not promise unauthorised volume.
- [ ] Same-message duplicates and cross-thread shared-index handling are tested.
- [ ] Supplier attachments are treated as untrusted data.

### Test and code risks requiring explicit resolution

- [ ] Test real `Thread` snapshots, not simplified mocks. The shown `__deepcopy__` shares `io_lock` but still deep-copies frozen `MappingProxyType` opening fields; ordinary `deepcopy` cannot handle those without additional support. Successful logs imply a bypass, omitted support, or revision difference—resolve it on the actual final objects.
- [ ] Constructor failure after session creation cannot leak an untracked session.
- [ ] Worker restart cannot become an infinite crash/restart loop.
- [ ] Full response bodies are available for diagnosis; the 600-character log excerpt is not the only retained evidence.
- [ ] Claim counts exclude duplicated reporting of the same original evaluation where appropriate.
- [ ] Final runtime cannot access prohibited event, screen, leaderboard, or result feeds.
- [ ] Historical board/report tooling is isolated from the live agent.
- [ ] Credentials remain outside Git and logs; deployment machine stays awake.

---

## 8. Prioritised roadmap

### Step 1 — Freeze and identify the actual production baseline

**Action:** commit/push G8s and produce one effective-config manifest. Verify final runner wiring, data version, deadline injection, and resume entry point.

**Test:** import/configuration checks, 19-case smoke, then current sandbox baseline.

**Stop criterion:** no further candidate work until another machine can reproduce the same code/configuration. Do not label an unpushed local tree “final.”

### Step 2 — Reconcile visible contradictions without changing policy

**Action:** run S5-2’s payload audit and S5-3’s shadow accounting. Inspect full versions of the trimmed conversations where necessary.

**Test:** recorded-state fixtures for:
- same-message forecast duplication;
- unsupported case-only comparisons;
- horizon/bundle wording;
- P05 opening eligibility;
- mutable floor cap;
- P01 relationship-cost discrepancy.

**Stop criterion:** classify each issue as definite bug, uncertain model input, or intentional policy. Do not bundle these categories into one “better target” change.

### Step 3 — Fix exceptional execution paths

**Action:** implement the smallest S5-1 patch. Do not enable all A11/U4 flags.

**Test:** differential replay on healthy paths plus fault injection for every changed branch. Assert no network wait under shared RFQ lock.

**Stop criterion:** reject any patch that changes healthy opening order, price path, or acceptance timing without an explicit separate strategy experiment.

### Step 4 — Rehearse final load and recovery

**Action:** exercise ten parallel cases locally with multiple suppliers, delayed/lost responses, attachment failures, and restart.

**Test:** then sandbox under controlled shared-key concurrency, respecting teammates’ session allocation.

**Stop criterion:** any leaked session, duplicate action, silent worker death, unconfirmed closure, or unnecessary walk blocks release. Average score cannot compensate for protocol failures.

### Step 5 — Confirm one low-risk evidence candidate

**Action:** prioritise G10a, not another concession experiment.

**Test:** offline trigger/claim audit; sandbox regression; then ask the lead for an interleaved practice comparison on the affected RFQ. Use at least the existing three-run screening protocol if approved.

**Stop criterion:** do not promote on one 0.688 result. Require evidence of correct triggering, fewer genuine duplicates, no loss of rival evidence, and no credible score/deal-rate regression.

### Step 6 — Test at most one new bargaining mechanism

**Action:** choose S5-5 or S5-6 only after proving it changes an actual missed opportunity in a recorded open-thread state.

**Test:** one flag, unchanged core curve, sandbox first; targeted practice only with explicit approval and a fixed session budget.

**Stop criterion:** stop if it duplicates an existing hook, never triggers, requires an extra unsupported commitment, or worsens the affected practice path. Do not rescue it with a bundle of unrelated changes.

### Step 7 — Release, document, and stop tuning

**Action:** freeze the final build, retain the known-good G8s rollback, publish launch/resume instructions, and perform an unattended rehearsal of the actual entry point.

**Test:** confirm active flags, endpoint restrictions, logging, credentials, resource limits, and deadlines.

**Stop criterion:** after freeze, only correctness fixes with a reproduced failure and a regression test. No new architecture, global anchor change, or optional LLM dependency.

---

## 9. Machine-readable recommendations

```json
{
  "improvements": [
    {
      "id": "S5-1",
      "title": "Exception-only transactional recovery and truthful session ownership",
      "section": 5,
      "targets": ["P05", "P10", "hidden RFQs", "hidden no-alternative cases"],
      "expected_gain": "Unmeasured tail-loss prevention; healthy-path score change should be zero. No defensible expected score estimate without a failure-rate measurement.",
      "effort": "M",
      "risk": "Recovery may accidentally serialise RFQs, close early, or dispatch conflicting actions.",
      "test": "Healthy-path differential replay and fault injection, then D01/D02 sandbox. Practice only with the lead's explicit approval.",
      "spec": "Persist ownership immediately after session creation; journal ambiguous sends; retry identical requests with the same move ID; refresh before a different action; validate the actual primary after alternative promotion; never infer withdrawal from read failure; mark closed only on authoritative terminal confirmation. Reserve state locally under the RFQ lock and perform all network work outside it. Preserve successful G8s scheduling and decisions."
    },
    {
      "id": "S5-2",
      "title": "Source-backed payload audit without broad evidence reordering",
      "section": 5,
      "targets": ["P01", "P02", "P03", "P05", "P07", "P11", "hidden cases"],
      "expected_gain": "Unmeasured score effect; primarily integrity and robustness. Removing unsupported persuasive claims may not improve immediate score.",
      "effort": "M",
      "risk": "Overbroad filtering could remove useful verified evidence or weaken the early RFQ argument sequence.",
      "test": "Recorded-state payload fixtures with source pointers for factual sentences, followed by sandbox regression. Practice only with explicit approval.",
      "spec": "Deduplicate identical IDs within a message; distinguish claims from IDs; substantiate factual comparisons; use neutral descriptions for unknown case-only values; derive volume and horizon language from authorised case scope; distinguish historical purchases, forecasts, commitments and executable offers; retain breakdown arithmetic without asserting unknown profit; audit bundle authorisation. Keep valid evidence order and rival citations unchanged."
    },
    {
      "id": "S5-3",
      "title": "Shadow cost and input reconciliation before target changes",
      "section": 5,
      "targets": ["P01", "P02", "P03", "P05", "hidden multi-part and price-unit cases"],
      "expected_gain": "Zero behavioural gain in shadow mode; downstream benefit unmeasured and not yet quantifiable.",
      "effort": "M",
      "risk": "Confusing hidden supplier-cost uncertainty with a deterministic calculator error and changing a successful policy.",
      "test": "Recompute historical accepted-package cost components and compare with official breakdowns; require identical sandbox actions in shadow mode.",
      "spec": "Record resolved terms, standard and fixed-term sources, unit normalisation, cost components, relationship estimates, opening feasibility and immutable versus current quote inputs. Separate definite normalisation bugs from uncertain economic assumptions. Any decision-changing target correction must be a separate generic flag and experiment."
    },
    {
      "id": "S5-4",
      "title": "Confirm narrow RFQ shared-index handling",
      "section": 5,
      "targets": ["P05", "hidden RFQs"],
      "expected_gain": "Duplicate reduction is measured in E60; score gain remains unmeasured. Tentative upside envelope is 0 to 0.04 per triggered case, not a confidence interval.",
      "effort": "S",
      "risk": "Skipping repeated evidence may reduce useful persuasion or simply reduce verified claims without improving offers.",
      "test": "Offline trigger and claim-count audit, sandbox regression, then lead-approved interleaved G8s versus G10a practice screening.",
      "spec": "Use the existing shared_index_skip mechanism only for index facts across RFQ suppliers. Preserve rival IDs, breakdown arguments and other fact types. Reserve evidence locally at dispatch without network waits under the RFQ lock. Count original claim evaluations consistently rather than repeated confirmation echoes."
    },
    {
      "id": "S5-5",
      "title": "Request-specific proof inside the existing counter before finality",
      "section": 5,
      "targets": ["P08", "P18", "P11", "P04", "P07"],
      "expected_gain": "Unmeasured; tentative 0 to 0.04 per triggered case, with negative outcomes possible.",
      "effort": "M",
      "risk": "Treating boilerplate as a causal gate or adding irrelevant proof without changing supplier behaviour.",
      "test": "First demonstrate a missed open-thread proof request in recorded states. Stop if the existing proof hook already handles it. Then sandbox and explicitly approved targeted practice.",
      "spec": "Match a current open-thread request to actual available evidence: executable quote, historical purchase record, forecast, order or calculation. Explain evidence limitations. Attach proof alongside the normal G8s counter, without an extra discovery round, invented volume, broad fact reordering or final-offer override."
    },
    {
      "id": "S5-6",
      "title": "Supplier-introduced clause trade priced jointly",
      "section": 5,
      "targets": ["P08", "P18", "P16"],
      "expected_gain": "Unmeasured; tentative 0 to 0.04 per triggered case, not a measured forecast.",
      "effort": "M",
      "risk": "Giving away clause value without sufficient price compensation or relying on uncertain relationship-cost equivalence.",
      "test": "Offline replay must produce a distinct valid candidate not already generated by conditional repair. Then sandbox regression and lead-approved practice.",
      "spec": "Only after an open supplier introduces an allowed clause-price relationship, preserve the normal primary and evaluate one secondary package using that clause variant. Compute price compensation with code and the official cost helper. Preserve coverage, fixed terms, must-haves, option legality and price cap. Do not introduce unsolicited leverage clauses or blindly persist adopted lanes."
    },
    {
      "id": "S5-7",
      "title": "Optional supplier-quoted cost-neutral schedule relaxation",
      "section": 5,
      "targets": ["D02", "hidden RFQs with unnecessary requested speed"],
      "expected_gain": "Unmeasured; likely small or zero. No supported numeric gain estimate.",
      "effort": "S",
      "risk": "A quoted schedule establishes feasibility, not acceptance of the proposed lower price.",
      "test": "Synthetic exact-match and immutability fixtures, then G8s sandbox comparison. Stop if it never triggers or duplicates an existing package. Practice only with explicit approval.",
      "spec": "Reuse the narrow A_hybrid mechanism: open RFQ, negotiable non-fixed lead time, explicitly supplier-quoted longer allowed schedule within need, all other non-price terms equal after resolution, finite complete costs within the documented EUR 0.01 tolerance, at most one changed package. Present it as a counteroffer, not acceptance."
    }
  ],
  "approaches": [
    {
      "id": "S6-1",
      "title": "Event-sourced pure-decision G8s executor",
      "summary": "Separate immutable observations, pure G8s action selection, validated dispatch transactions and authoritative acknowledgements.",
      "worth_it": "yes",
      "why": "A minimal journal and recovery slice could reduce realised-score losses without replacing the tested bargaining policy. A full rewrite before the final is not justified without differential equivalence tests."
    },
    {
      "id": "S6-2",
      "title": "Robust conditional-trade compiler",
      "summary": "Compile source-linked supplier conditions into code-validated allowed packages while retaining G8s bidding and closing as fallback.",
      "worth_it": "maybe",
      "why": "Different from discovery-first ALT-6: it uses already-received conditions, adds no discovery round and does not let an LLM choose numbers. Benefit on unfamiliar wording is unmeasured."
    },
    {
      "id": "S6-3",
      "title": "Offline adversarial policy portfolio",
      "summary": "Use explicit supplier mechanisms and transport faults to falsify generic policies offline, rather than relying on online LLM digital-twin rollouts.",
      "worth_it": "maybe",
      "why": "Useful for hidden-case robustness and testing diversity, but simulator success cannot establish hosted score gains. Not a justified last-minute live replacement for G8s."
    }
  ],
  "final_risks": [
    "G8s deployment and final-wave adapter are not demonstrated by the supplied material; the handoff says G8s was not yet pushed.",
    "G8s leaves arena_clock_guard, safe_close, safe_single and close_recovery_v2 disabled.",
    "Legacy closing can walk after failed alternative promotion and does not visibly validate the promoted primary against the intended package on every path.",
    "Legacy resync can treat a failed read as supplier withdrawal.",
    "The runner can record unconfirmed closure and a locally fabricated failure score without preserving a clear official-outcome distinction.",
    "Session construction opens a session before the shown ownership logging and exception handler.",
    "No complete five-wave, ten-case parallel-load and restart rehearsal is supplied.",
    "The omitted RFQ coordinator cannot be certified for lock discipline, close arbitration or stale snapshots.",
    "The shown Thread deepcopy logic may still encounter MappingProxyType fields unless omitted support or a different production path handles them.",
    "Internal opening costs and strategic deal valuations disagree with official values in supplied cases.",
    "The supposed opening-based floor cap uses current primary quotes when calibrated_anchor is disabled.",
    "Forecast provenance and no_dup_claims do not provide complete message-wide and case-wide evidence integrity.",
    "Case-only evidence descriptions can assert unsupported comparisons; historical purchases can be mistaken for executable rival quotes.",
    "Volume, horizon and bundle wording require authorisation checks; parts[0] handling is a multi-part generalisation risk.",
    "P05 remains execution-sensitive, while the apparent G8s portfolio gain is concentrated largely in P02.",
    "D01/D02 repeatability and the observed D02 plateau do not prove hidden-supplier generalisation or an absolute reachable-score ceiling.",
    "Historical board records, quota statements and architecture documents are stale or contradictory.",
    "Dormant experimental flags, duplicated Config definitions and a large integrated engine increase accidental-configuration and interaction risk.",
    "Final runtime must be isolated from prohibited live ranking, event, screen and result feeds."
  ]
}
```