# A12 improvements page — Astra’s engineering plan

## Recommendation

**Keep A10 as the production fallback. Build four isolated improvements, not another “enable everything” integration.**

The next release should improve:

1. **Which economic packages we offer**, especially clauses and effective dates.
2. **Whether an RFQ gets a fair, bounded opportunity to produce a better rival quote.**
3. **Citation provenance without T4’s RFQ-damaging evidence suppression.**
4. **Closing reliability without importing T2/T3/T5’s strategy changes.**

Do **not** spend this iteration on stronger anchors, a different concession curve, or writer prompts.

**A12 is a candidate, not a measured improvement.** Its proposed composition is:

> **A10 + `package_frontier_v2` + `bounded_rfq_race` + `claim_provenance_only` + `close_recovery_v2` + existing `clause_explore`.**

All new flags default off. The other A11 flags and the LLM writer remain off.

---

## 1. Per-case diagnosis

### P01 — Protect the effective-date concession; do not assume model-equal packages are economically interchangeable

**Observed:** A10 **0.956**; A10w **0.881**.

**Where the loss occurs**

- In the first response, the supplier accepts **1 April 2027**.
- Our next message nevertheless offers packages starting **November** and **January**.
- A10w gets immediate agreement to the January package: **€133.10, 30 days**.
- A10 continues and closes **€133.40, 14 days, April**.
- The latter costs **€4,256 less in the arena**, despite its higher unit price.

The writer did not invent the bad package. It made an existing package easier to accept.

**Source mechanism**

- `meso()` optimizes against estimated relationship economics.
- It does not preserve an already-earned favorable effective date.
- Its approximate equal-C filter and supplier-value ranking can expose materially different buyer outcomes.
- Even the displayed estimated costs of the second-round packages differ by about **€983**.
- Estimated closing C differs from arena C by approximately **€19,229** for A10 and **€15,226** for A10w. Equality under this estimator is not equality under hidden supplier economics.

**Generic rule that would change the path**

For a price increase, preserve a supplier-confirmed delayed effective date when it remains beneficial under the proposed prices. Allow an earlier date only for an explicit, conservatively costed compensating trade.

For ordinary relationship-sensitive MESOs, require the second package to be no worse under a small, documented sensitivity envelope—or offer one package.

**Priority:** High, but primarily **protection**, not a claim that A10’s already excellent 0.956 can improve substantially.

---

### P02 — A missing clause lever, not an insufficiently aggressive price anchor

**Observed:** A10 **0.360**; A10w **0.335**; A11c **0.397**; historical A5 approximately **0.68**.

**Where the loss occurs**

1. We open at **€360.44/90 days**, already beyond the reported true-best room.
2. The supplier rejects the relevance of delivery/history evidence and refuses a breakdown:  
   > “Our calculation is our property.”
3. Our second message changes price/payment, but introduces no new economic lever.
4. The verified **6,110-unit commitment** finally moves the supplier.
5. We accept **€373.12/90 days** while the supplier is still `open`, because the concession rule’s next goal has reached its standing C.

Continuing with the same price-only mechanism is not supported as a route back to 0.68.

**Source mechanism**

- `supplier_value()` explicitly assigns **no cash value to contract length or index-clause security**.
- Equal-C selection can therefore discard a clause that the supplier values behaviorally.
- Existing `clause_candidate()` is unusually restrictive:
  - requires relationship goals;
  - requires **two already-existing picks**, although round two here has only one;
  - requires evidence of a supplier-compatible clause family;
  - treats a supplier-specific should-cost basis as strong even when that estimate was capped;
  - uses `isinstance(..., dict)` for options that may be read-only mappings.

**Important measurement qualification**

A11c’s displayed P02 messages contain **no clause package**. Its +0.037 is an observed path improvement, **not proof that T6 actually exercised the intended clause mechanism**. We must inspect `clause_explore` selection logs before attributing the gain.

**Generic rule that would change the path**

Reserve the second slot for a **bounded, allowed clause trade** when:

- the clause family is grounded in case data or supplier evidence;
- the buyer has an index path to evaluate;
- the clause improves cash economics or offers an economically justified price/security exchange;
- normal equal-C selection would otherwise exclude it.

Keep the normal first package. Preserve the standing-price cap and outside-option guards.

**Priority:** Highest deterministic commercial upside.

---

### P03 — Already strong; do not dismantle the successful terms path

**Observed:** approximately **0.923–0.924** throughout.

**Where the remaining loss occurs**

- The supplier quickly reaches **€432.15, 90 days, 24 months**.
- It explicitly says management has frozen further price reductions and invites terms adjustments.
- Our last counter does not move it.

The A10 60-day/36-month alternative is cheaper in unit price but **more expensive in total C**. Taking it would not improve the score.

**Source mechanism**

The floor estimate and the supplier’s price-freeze policy do not match perfectly. However, the engine already has `frozen_packages()`, and the residual opportunity is small relative to the risk of changing a winning path.

**Generic rule**

Keep exact-cost ranking of payment/duration trades. Preserve good primary offers and avoid introducing relationship-model uncertainty through a supposedly equal second package.

**Priority:** Regression sentinel, not a dedicated strategy task.

---

### P04 — Tiny room; an earlier alternative is lost, and the recall threshold is too coarse

**Observed:** **0.810** in all displayed runs.

**Where the loss occurs**

- Our first ask is approximately **15 times the actual available room**. More aggression is plainly not the missing ingredient.
- The supplier holds **€4.91, 60 days, 36 months** from its first reply through `final_offer`.
- It says the existing **20,000-unit volume** is already in its calculation.
- We re-cite the forecast and receive `duplicate`.

**An additional transcript finding**

A10w’s first reply includes:

- Primary C: **€196,970**
- Alternative C: **€196,853**, at **€4.94/90 days/24 months**

That alternative was about **€117 better**, worth roughly **0.05 score** on this narrow-room case. It disappears later.

`recalled()` requires an improvement exceeding **0.3% of total C**—about €591 here—so it does not notice this economically meaningful small regression.

**Generic rule**

Record historical alternatives and evaluate differences relative to available negotiation room, not only total spend. However, an old alternative is not an executable offer: it needs reconfirmation.

**This iteration’s decision**

Do **not** add a final-offer historical-recall experiment to the core release. It could turn a modest gain into a walk-away. Record the opportunity and test it separately later, before final status and without manufacturing a higher-price counter.

**Priority:** Useful follow-up experiment; not a core A12 task.

---

### P05 — The first fast final offer wins the race before competition has finished

**Observed:** A10 **0–0.659** across the reported runs; A10w **0.710**.

**Exact loss points**

**Latest A10:**

- At 1 s, supplier 70210 has already received a rival quote and responds.
- It reaches **€29.50** after two messages.
- At 2 s, it returns `final_offer`.
- We immediately accept while another supplier’s opening response is still outstanding.
- That other worker subsequently receives “session has ended: accepted.”

**A11c:**

- We accept 70210’s **€29.50** just as 70250 returns another **€29.50** package with a slightly lower total C.
- More importantly, the rival has barely had a chance to respond to the new competitive bar.

**A10w:**

- A fresh rival quote reaches 70210 before closure.
- The supplier says:  
  > “Since it’s real, I’ll beat it.”
- It closes at **€29.00**.

This is direct evidence that **fresh competitive information**, not simply warmer wording, is valuable.

**Separate trust loss**

Both A10 and A10w send:

> `fc:320070@2026-09`

The supplier explicitly says the ID does not exist and that this costs trust. The source is `PracticeNegotiator.write()`, which cites the latest SQL forecast without checking `facts.json`.

**Source mechanism**

- A10’s `hold_close` protection applies only to a best supplier whose status is `open`.
- A fast `final_offer` can bypass the rival-opportunity protection.
- Closing and pushing happen under the RFQ lock.
- The legacy idle allowance is **90 seconds**, longer than a thread’s 60-second turn.
- T1 is not a solution: its measured scheduling and premature-agreement behavior are worse.

**Generic rule**

Before a discretionary RFQ close, allow **one short, clock-safe rival opportunity** if a meaningful rival response is pending. Never wait merely because a supplier exists, and never wait past the winner’s safe closing boundary.

**Priority:** Highest variance/reliability upside.

---

### P07 — Terms move this supplier; generic volume repetition does not

**Observed:** A10 **0.710**; A10w **0.697**; A11c **0.691**.

**Where gains actually occur**

- Delivery/history evidence does not change the calculation.
- Verified volume plus **36 months/60 days** moves the offer to **€5.49**.
- Later alternatives move to **€5.45**, then **€5.43**.
- A10 correctly mirrors the final alternative and obtains `agreed`.

**Where points remain**

Our target is below the final deal, but the supplier is already responding to the genuine levers. Repeating the same full-need commitment does not create additional volume.

The A10 hold contributes to the last movement. Broadly deleting holds risks giving this up.

**Generic rule**

Preserve useful payment/duration diversity where costs are known. Do not globally force one package or globally remove holds.

**Priority:** Regression sentinel for package design and closing.

---

### P08 — Clause structure works; blanket “safety” caused the largest new regression

**Observed:** A10 **0.603**; A10w **0.618**; A11c **0.361**. An earlier A10 run scored zero, but its failure transcript is not supplied.

**A10 path**

- First index evidence is rejected because material is fixed-price covered until March.
- Supplier introduces the clause.
- We move to the **5% deadband**.
- Other index evidence and verified volume improve the offer.
- We finish at **€5.42/90 days/24 months**, with the clause.

The useful lesson is **series-specific**. Rejection of one covered material index does not justify suppressing all index evidence: the next index claim is accepted and affects pricing.

**A10w additional loss**

Round three offers C **€1,026,229**. Round four closes C **€1,027,315**—slightly worse. The 0.3%-of-total-C recall threshold again misses the regression.

**A11c regression: exact source correction**

The first response takes 54 seconds. Shortly afterward, the engine closes for “budget/clock.”

The relevant source is in **`_run_safe_single()`**:

> `seconds <= max(15, self.slowest + 15)`

A slow previous response can make that threshold exceed the entire 60-second next turn. This is not evidence that the newly received offer is already expiring.

The report labels this a T2 issue, but the displayed **early-close predicate belongs to T5’s loop**. Both flags should remain off in A12.

**Generic rules**

- Explore a legal clause earlier when evidence supports it.
- Keep the economically cheapest compatible clause once required.
- Do not infer turn urgency from the duration of the previous supplier response.
- Do not claim that A12 solves the earlier zero until that missing failure path is reproduced.

**Priority:** High for clause packaging and regression protection.

---

### P10 — Preserve the working alternative promotion; do not push the final offer

**Observed:** A10/A10w **0.671**; A11c **0.570**.

**Exact mechanism**

The first response is already final:

- Primary: **€33.60 / 42 days**, C **€1,588,298**
- Alternative: **€31.70 / 54 days**, C **€1,527,586**

The alternative saves approximately **€60,713**, even after its late-delivery cost.

A10 mirrors it, gets `agreed`, and accepts the new primary.

A11c repeatedly attempts closing without successfully promoting that alternative, then accepts the worse primary. The transcript shows seven repeated attempts before budget fallback.

**Generic rule**

Alternative promotion is a small transaction:

1. Mirror the exact selected allowed terms.
2. Obtain a new primary with `agreed`.
3. Verify the confirmed terms.
4. Accept that primary ID.
5. On ambiguity, inspect authoritative state before another action.

Instrument the individual rejection/promotion guards; the truncated logs are insufficient to identify which T2 guard first rejected this promotion.

**Do not do**

- No final-offer push.
- No claim that fixing A11c gives A12 +0.101 over A10; A10 already gets the better alternative.
- No global lead-cap removal in this iteration.

**Priority:** Mandatory closing regression test.

---

### P11 — The supplier’s favorite lever is fixed; do not promise it anyway

**Observed:** **0.710** throughout.

**Where the path stops**

- Index/history evidence has little effect.
- Quality evidence and on-time-payment commitment move the supplier to **€46.00**.
- Volume/continued concessions move it to **€45.50**.
- A further hold does not improve the result.

The supplier repeatedly asks for faster payment. A11c explicitly records:

> “Since payment terms are fixed…”

Payment is not among the displayed negotiable fields. It is not a legal new lever.

**Remaining legal opportunity**

Only the allowed quality/chargeback packages provide a genuinely different mechanism. Current supplier-value ranking and penalty aversion heavily favor the **300 ppm / zero chargeback** package.

There is not enough evidence here to justify a production change to that ranking. A separate quality/chargeback experiment is reasonable after higher-value tasks pass.

**Generic rule**

Answer fixed-term requests accurately; never offer faster payment or excess volume in prose when the case does not permit it.

**Priority:** Regression sentinel; defer dedicated exploration.

---

### P18 — Clause/contract selection matters more than another target boost

**Observed:** A10 **0.532**; A10w **0.467**; A11c **0.497**.

**Where the loss occurs**

- The first supplier reply introduces the clause.
- The second reply includes a better **€5.40 / 60 days / 36 months** alternative, C **€258,264**.
- A10 subsequently obtains **€5.40 / 90 days / 24 months**, C **€256,557**.
- A10w instead gets a final primary at **€5.50**, C **€261,308**, after the supplier says the volume was already assumed.

A10w loses both the extra volume-driven concession and the earlier better alternative.

**Source mechanism**

- The target is relatively timid, but the failed ×1.3 boost and T7 results argue against another indiscriminate anchor change.
- `recalled()` can only help when the loop reaches package generation. Acceptance of a final offer happens first.
- The earlier alternative is no longer automatically acceptable once absent from the current reply.

**Generic rule**

Give the supplier a useful clause/security package earlier, retain the cheapest compatible clause, and preserve payment/duration trade-offs. Do not assume another volume statement will unlock a concession.

**Priority:** High for package exploration; historical-offer reconfirmation remains a separate risk-managed experiment.

---

## 2. Cross-case patterns and measurement corrections

### A. We confuse model equality with offer safety

Two distinct problems need different treatment:

- **Ordinary MESO:** We tell the supplier either choice is equally good for us, although relationship estimates can reverse the ranking.
- **Deliberate clause exploration:** A modest model-regret exception may be worthwhile because the supplier values a security term that `supplier_value()` does not model.

Do not fix the first problem by banning the second. Label exploratory packages as trades, not equal bargains.

### B. Verified does not mean economically relevant

Examples:

- P02/P04: delivery and history verified, no calculation change.
- P08: one index rejected because of coverage, another accepted.
- P05: a genuinely fresh rival quote changes the offer.

This does **not** justify reviving the failed global objection-ordering experiment. First remove invalid claims and preserve the useful sequence.

### C. Response latency is not the age of the next turn

A 54-second supplier response does not imply only six seconds remain after receiving it.

Use authoritative `seconds_left` when a timing-sensitive decision needs it. Do not globally turn every slow response into an emergency close.

### D. Closing must not become a new concession policy

T2/T5 mixed transport recovery, deadline decisions, alternative selection and repeated-attempt budgets. The resulting “safety” changes cost substantial score.

A12’s closer must execute an approved economic decision. Any downgrade to a different package requires a **new, logged decision**.

### E. Global evidence deduplication has a measured commercial cost

T4’s full path loses **0.125 on deterministic low-latency D02** in the combined comparison.

A12 will retain provenance checks, not the global suppression policy. Duplicate claims are undesirable, but their removal is not free if it also removes the commercial information that drives a rival.

### F. Three reporting traps must be corrected in evaluation

1. **P05’s C_open is inconsistent across report sections.**  
   The latest A10 score 0.659 is consistent with authoritative C_open **€305,544.96**, not €270,199.12. Do not calibrate its room or first-ask fraction from the inconsistent summary row.

2. **A11c’s missing C_deal/C_best fields are not evidence of no deal.**  
   Its result logging differs. Use the authoritative session result and retain all score components.

3. **A10 is a named variant, not `Config()`.**  
   Default `Config()` uses different concession, push and MESO settings. Every test must start from `VARIANTS["A10"][1]`.

---

## 3. Ranked improvement list

Gain estimates below are **engineering hypotheses**, expressed as changes in the ten-case mean. They are not measured forecasts and must not be added mechanically.

### 1. U1 — Bounded package frontier and relationship-safe MESOs

**Flag:** `package_frontier_v2`

**Expected gain:** approximately **+0.005 to +0.025** in the ten-case mean, primarily P02/P08/P18; P01 protection. Historical P02 upside is larger, but not yet reproducible.

**Mechanism**

- Preserve earned favorable effective dates for qualifying price increases.
- Screen ordinary relationship-sensitive second packages against nominal, cash-only and bounded supplier-estimate sensitivities.
- Extend clause exploration so it can:
  - fill a second slot even when normal selection produced only one sheet;
  - operate on leverage cases, not only relationship goals;
  - recognize read-only mapping options;
  - recognize capped supplier-specific estimates as uncertain;
  - use a family grounded in supplier evidence or structured case cost-driver data.
- Preserve the normal primary package, except for the earned-date safeguard.
- Keep clause regret tightly bounded and logged.
- Evaluate clause deadband using the published index path and risk formula—not “widest is always best.”

**Trigger**

Allowed clause options plus grounded family/path evidence; or relationship-sensitive MESOs with uncertain ranking; or an already-confirmed beneficial delayed date.

No case IDs, supplier IDs, stored winning prices or hidden C_best.

**Risk:** Medium. A second clause sheet can displace a useful payment/duration package. Sensitivity screening can become too conservative.

**Tests**

- P02: prove an actual clause sheet is sent; do not credit a score change without the trigger.
- P08/P18: test early clause timing and preservation of required clauses.
- P01: no unpriced surrender of the April concession.
- P03/P07/P10: preserve successful trade and promotion paths.
- D01/D02: protect baseline outcomes; RFQ remains one-sheet.

---

### 2. U2 — Bounded RFQ opportunity window on the A10 scheduler

**Flag:** `bounded_rfq_race`

**Expected gain:** approximately **+0.003 to +0.025** in the ten-case mean, with the largest benefit in P05’s lower tail. The zero-prevention contribution is unquantified.

**Mechanism**

Keep A10’s staggered opening and per-thread workers. Before a discretionary close:

- identify a meaningful outstanding rival opportunity;
- permit at most one short opportunity window;
- service rivals concurrently;
- close as soon as the window expires or the winner’s safe closing boundary approaches.

Move closing/pushing network calls outside the case lock. Reserve ownership under the lock; reconcile results afterward.

**Clock bound**

The window is at most **12 seconds**, and shorter if the authoritative winner clock or wave reserve requires it. A stale or unavailable clock is **not permission to wait**.

No 90-second final-offer idle. No all-supplier barrier. No requirement to finish every negotiation.

**Trigger**

Multiple live suppliers, a valid close candidate, and a pending rival first response or one genuinely new response to the competitive bar.

**Why this is not T1 again**

- No snapshot coordinator.
- No per-iteration refresh dependency before first offers.
- No serial opening/negotiation.
- No immediate “agreed means close” exception bypassing the opportunity rule.
- No deepcopy of live threads.

**Risk:** Medium. Even a short wait can lose a standing offer if its clock is stale. Fail closed to A10-style immediate execution when timing is uncertain.

**Tests**

D02 and P05, with fast, asymmetric and 20–95-second response schedules. Measure offer quality **and** dispatch timing.

---

### 3. U3 — Provenance-only claim hygiene, retaining A10’s evidence strategy

**Flag:** `claim_provenance_only`

**Expected gain:** approximately **0 to +0.010** in the ten-case mean, plus reduced hidden-case trust risk.

**Mechanism**

- Validate canonical fact records, not SQL existence alone.
- Suppress the unsupported forecast sentence as a whole—not merely its ID.
- Deduplicate a forecast already used in the same message or already offered as the same thread’s volume proof.
- Validate numeric units, parts, suppliers and index endpoints.
- Keep A10’s useful fact order and wording wherever valid.
- Keep true, relevant RFQ information available to each supplier.
- Enforce the arena’s **three checked-claim limit**, not an invented three-raw-ID limit.

A notice assertion may use two IDs; a history assertion may use several order IDs. T4’s `len(ids) <= 3` is not the right abstraction for these grouped claims.

**Trigger**

Any data-backed assertion on the generic practice/final path.

**Why this is not T4 again**

No case-wide evidence-consumption ledger. No rebuilding all messages into the T4 template. No blanket suppression of all indices after one rejected series.

**Risk:** Low to medium. Provenance filtering can still alter evidence timing. Retest D02 rather than assuming cleaner messages score better.

**Tests**

- P05: zero nonexistent-forecast contradictions.
- P03/P04: no duplicate forecast added by `answer_plus`.
- P01: notice and should-cost assertions preserved.
- D01: retain useful numerical evidence.
- D02: no repeat of the deterministic −0.125 ledger regression.

---

### 4. U4 — Minimal transactional closing and timeout-offer recovery

**Flag:** `close_recovery_v2`

**Expected gain:** approximately **0 to +0.010** in the ten-case mean under normal latency; potentially more under failure conditions. Expect **zero healthy-path commercial gain over A10**.

**Mechanism**

- Preserve A10’s direct acceptance of a valid current primary.
- Promote alternatives only through exact-term confirmation.
- Check terminal results before retrying ambiguous accepts.
- Reconstruct timeout-generated current offers from authoritative thread state.
- Bound attempts per unchanged offer/revision.
- Return recoverable failure to the RFQ decision loop instead of declaring a fabricated result.
- In single-supplier cleanup, explicitly re-evaluate the latest candidate rather than walking reflexively.
- Preserve full result logging and leave unresolved sessions marked unresolved.

**Trigger**

Closing an alternative, ambiguous/rejected acceptance, stale offer identity, or cleanup after an exception.

**Why this is not T2/T3/T5 again**

- No new concession loop.
- No unchanged-goal hold policy change.
- No “previous response duration means current turn is due” predicate.
- No global emergency close because another thread is urgent.
- No network I/O under the RFQ case lock.

**Risk:** Medium implementation risk, low intended strategy risk.

**Tests**

P10 exact alternative promotion; P07/P18 alternative confirmation; P08 long response without premature acceptance; timeout-generated IDs; lost acceptance responses; failed-close recovery on D02/P05.

---

## 4. What not to do

### Do not re-enable these A11 paths

| Path | Decision |
|---|---|
| T1 `resilient_rfq` | Off: measured RFQ scheduling regression |
| T2 `safe_close` | Off: replace narrowly, do not activate the existing path |
| T3 `arena_clock_guard` | Off: reuse the clock source, not its global urgency policy |
| T4 `safe_claims` | Off: retain provenance under a new flag, not the ledger |
| T5 `safe_single` | Off: measured D01 cost and incorrect urgency predicate |
| T7 anchor calibration/probe | Off: worse D02; consumes time and exchanges |
| T6 `clause_explore` | Retain, with explicit activation diagnostics and U1 extensions |

T5’s safety motivation is reasonable. Its broad policy is not supported strongly enough to ship. The earlier P08 zero must be reproduced before designing a narrower hold safeguard.

### Do not repeat failed strategy changes

- No Boulware or reciprocal concession retest without a new mechanism.
- No simultaneous RFQ opening.
- No opening-percentage anchor replacement.
- No removal of the standing-price cap.
- No global objection-based fact ordering.
- No blanket leverage-room boost.
- No single-supplier final-offer push.
- No third term sheet.
- No global “longest contract” or “one MESO only” rule.
- No faster-payment or higher-volume promises outside allowed terms.
- No speculative post-final recovery of withdrawn historical alternatives.

### Do not spend this iteration on the writer

The measured mean is slightly worse, latency is nonzero, and it can accelerate agreement to a bad package. Fix package economics first.

### Do not refactor unrelated code

Duplicate Config declarations, import cleanup, unrelated target solvers and writer validation improvements are not release-blocking tasks here. Avoid expanding the integration surface.

---

## 5. Parallel implementation contract

Four feature coders may work concurrently, with **exclusive function ownership**.

| Coder | Exclusive production ownership |
|---|---|
| U1 | `Config` declarations; `Negotiator.meso`; `Negotiator.clause_candidate`; `Negotiator.write`; new package helpers |
| U2 | `Negotiator.run_rfq`; new RFQ helpers |
| U3 | `PracticeNegotiator.facts_for`; `PracticeNegotiator.write`; new canonical/provenance helpers |
| U4 | `Negotiator.close`; `Negotiator.resync`; `play`; new closing/recovery helpers |
| Integration | Only the A12 module-level entry in `proto/variants.py` |

**U1 adds all four new Config fields in one small initial commit.** No other coder edits Config. Other work can proceed using the declared interface.

**Do not name a new flag `rfq_*`.** `Negotiator.__init__()` automatically interprets most fields with that prefix as RFQ overrides and strips the prefix. An innocent new boolean could otherwise break every RFQ.

Additional requirements:

- Existing method signatures remain unchanged.
- No private keys on arena messages or terms.
- Plain copies of message data only; no deepcopy of live threads, clients or locks.
- Worker exceptions must be logged and futures observed.
- New behavior off means existing variants retain their behavior.
- U2 must work with either legacy `close()` or U4’s recoverable `None`.
- U3 preserves U1’s package explanation when it appends verified evidence.
- Each coder owns a separate test file.

---

## 6. Test protocol

### Stage 0 — Freeze the baseline and improve observation

Record:

- commit and exact `Config.key()`;
- canonical result, score components and closing terms;
- local estimated C separately from arena C;
- every package-selection reason;
- first-dispatch times by supplier;
- close decision, promotion, authoritative clock sample and retry reason;
- claim groups and claim results;
- open/unresolved sessions.

Never use C_best or observed winning terms as runtime strategy inputs.

### Stage 1 — Free offline tests on all 19 case files

Use actual case structures and representative opening/reply fixtures. The current `dry()` helper is not a complete engine integration test; construct a fully initialized negotiator.

Required tests:

1. A10 with all new flags false matches the frozen baseline.
2. Each new flag alone.
3. `clause_explore` alone.
4. Package flag plus `clause_explore`.
5. RFQ flag plus closing flag.
6. Full proposed A12.
7. Flags on non-triggering cases are behaviorally inert.

Property checks:

- every negotiable field present;
- only allowed options;
- fixed terms and must-haves preserved;
- no synthetic above-standing-price counter;
- no more than two single-supplier sheets or one RFQ sheet;
- no internal metadata in wire payloads;
- `ref: null` safe;
- read-only nested clause options safe;
- grouped claims within the checked-claim budget;
- response loss does not cause a second unexamined acceptance;
- an alternative ID is never directly accepted.

Use a stateful transport fixture that enforces actual arena rules, not a mock that accepts arbitrary actions.

### Stage 2 — Free sandbox, generic data path

Use `PracticeNegotiator`, as in the final. Handwritten sandbox facts are a reproduction tool, not the promotion benchmark.

For each isolated flag:

- D01: **3 paired baseline/candidate blocks**.
- D02: **at least 10 paired blocks**, interleaved by time.
- Separate ordinary and elevated-latency observations.
- Stop immediately on a reproducible strategy regression or protocol failure.

Then test key pairs and full A12.

Required failure injections:

- 20/60/95-second supplier responses;
- one slow rival and one fast final offer;
- acceptance committed but response lost;
- stale `offer_id`;
- timeout replacement in `thread["timeouts"]`;
- alternative confirmation with changed terms;
- worker exception;
- all threads ending;
- cleanup while another request is outstanding.

Do not require identical D02 absolute scores across latency batches. Require matched comparisons and correct mechanisms.

### Stage 3 — Hosted isolated tests: budget 64 sessions

| Experiment | Sessions |
|---|---:|
| U1 vs A10: P01/P02/P08/P18, three paired runs each | 24 |
| U3 vs A10: P01/P02/P03/P04/P05/P11, two paired runs each | 24 |
| U2 vs A10: P05, four paired runs | 8 |
| U4 vs A10: P08/P10, two paired runs each | 8 |
| **Total** | **64** |

For deterministic traces, repetitions confirm reproducibility; they do not replace a changed economic mechanism.

Stop weak candidates early. A flag that never triggers does not earn deployment credit.

### Stage 4 — Whole-suite and lower-tail validation

Subject to Stage 3:

- **80 sessions:** four paired full-suite repetitions of A10 versus candidate A12.
- **80 sessions:** P05/P08 reliability emphasis, twenty runs per case per arm.
- **50 sessions:** five ten-case, eight-minute wave rehearsals, with complete waves assigned to A10 or A12 and assignments interleaved.

Do not mix variants inside a wave if that obscures variant-specific load behavior.

Total planned hosted spend: **274 sessions**. Allow **46** for targeted follow-up, keeping at least **80** of the approximately 400 remaining sessions in reserve.

Confirm the actual quota before launch.

### Promotion rule

Promote only if:

- matched whole-suite mean improves;
- the gain remains credible when P05/P08 are analyzed separately;
- no repeatable material loss appears on P01/P03/P04/P07/P10/P11;
- invalid citations, illegal sheets and incorrect accepts are absent;
- zero/unresolved-session rates do not worsen;
- ten-case waves complete with owned sessions accounted for.

A reduction in historical zero rates is valuable, but do not infer its probability from two runs.

**If a flag fails, keep A10. Do not silently change the A12 recipe or “fix” it during final integration. Review a revised manifest and retest.**

---

```json
{
  "tasks": [
    {
      "id": "U1",
      "title": "Bounded clause frontier and relationship-safe MESO packages",
      "priority": 1,
      "expected_gain": "Hypothesis: +0.005 to +0.025 ten-case mean, mainly P02/P08/P18, with P01 downside protection. Historical P02 recovery is an opportunity, not a forecast.",
      "risk": "Medium: exploratory clauses may displace useful payment/duration packages; conservative MESO screening may remove useful choices.",
      "files": [
        "proto/engine.py",
        "proto/test_a12_packages.py"
      ],
      "functions": [
        "Config declarations",
        "Negotiator.meso",
        "Negotiator.clause_candidate",
        "Negotiator.write",
        "Negotiator._package_v2_scenarios (new)",
        "Negotiator._package_v2_earned_date (new)",
        "Negotiator._package_v2_clause_families (new)"
      ],
      "flag": "package_frontier_v2",
      "spec": "One coder owns these functions and all Config additions. First add package_frontier_v2, bounded_rfq_race, claim_provenance_only and close_recovery_v2 as booleans defaulting to False. Do not use an rfq_ prefix, change Config.key, clean unrelated declarations, or change existing signatures. With package_frontier_v2 off, preserve existing package and wording behavior. With it on: (1) for price-increase cases with negotiable effective_date and known current price, identify an explicitly supplier-confirmed later date from existing sheets; preserve it when proposed new prices are increases and the delayed date remains beneficial under the evaluated economics. Do not preserve a delay mechanically for a price decrease. Permit surrender only with a logged compensating trade that passes the conservative cost screen. (2) For ordinary relationship-sensitive second packages, compare completed terms using cash-only C, nominal C, and an internal documented sensitivity grid using full_cost/floor multipliers 0.95, 1.0 and 1.05 and interest-rate multipliers 0.5, 1.0 and 1.5. These are uncertainty tests, not hidden-economics estimates. Keep an alternative only if it is no worse than the primary within one-cent total-cost rounding tolerance throughout the screen, or find a valid repriced candidate that is; otherwise return one package. Do not apply this screen globally to non-relationship cases or remove known-neutral duration alternatives. (3) Extend clause_candidate under the new flag to support leverage cases, mappings including mappingproxy, and one existing primary with an available second slot. Ground clause families in exact supplier evidence or structured part cost-driver data and allowed options; require a known buyer index path. A capped supplier-specific should-cost estimate is uncertain. Retain the normal primary, preserve required clause families and full coverage, and never add a third sheet or an RFQ second sheet. Evaluate all compatible deadbands by published cash/index/risk C. A deliberate clause probe may bypass ordinary equal-C screening only if cash C improves over the normal primary, nominal C remains below the valid standing primary and outside option, and any positive nominal regret is bounded by min(0.005*C_open, 0.25*max(C_open-target_c, 0)). For a positive-regret exception require an uncertain estimate and improvement under the existing lower-cost sensitivity rationale; log the full sensitivity comparison. Preserve the never-above-standing-price cap. Do not silently relax guards when no candidate qualifies. Call this exploration when either the new flag or existing clause_explore enables it, retaining legacy behavior when only the old flag is used. (4) In Negotiator.write, describe new-flag multi-package offers as price/term trade-offs, not as equally good for the buyer. Log candidate inclusion/exclusion, family provenance, date preservation, cash/nominal/sensitivity C and whether an exploratory sheet was actually sent. No hidden C_best, stored practice winners or case-specific rules.",
      "test": "Offline all 19 cases with real nested option structures, including mappingproxy and no valid second slot. Prove unchanged output when new flags are off. Test ordinary MESO screening separately from deliberate bounded-regret clause exploration. Verify all outgoing terms, price caps, full coverage and sheet counts. Generic D01/D02 paired tests, then P01/P02/P08/P18 three paired runs each versus A10. P02 must show an actual clause sheet or be reported as a non-trigger, not a successful clause experiment. P03/P07/P10 are required full-suite regression sentinels."
    },
    {
      "id": "U2",
      "title": "Clock-bounded rival opportunity on the existing A10 RFQ scheduler",
      "priority": 2,
      "expected_gain": "Hypothesis: +0.003 to +0.025 ten-case mean, concentrated in P05 and RFQ lower-tail protection; zero-prevention gain remains unquantified.",
      "risk": "Medium: waiting on a stale winner clock can lose an otherwise good offer; scheduler changes must not reproduce T1 serialization.",
      "files": [
        "proto/engine.py",
        "proto/test_a12_rfq.py"
      ],
      "functions": [
        "Negotiator.run_rfq",
        "Negotiator._race_v2_window (new)",
        "Negotiator._race_v2_clock (new)",
        "Negotiator._race_v2_terminal (new)"
      ],
      "flag": "bounded_rfq_race",
      "spec": "One coder owns run_rfq and its nested functions. Preserve the entire legacy path when the flag is off. Do not enable or rewrite resilient_rfq. Extend the A10 worker path, retaining staggered opening, one sheet per RFQ message and its numerical concession settings. Before a discretionary close to an agreed, final or goal-reaching offer, permit at most one opportunity window per case when another live supplier has a meaningful first priced response pending or can make one new response to the current competitive bar. Do not wait merely for all suppliers to finish or for a rival with no plausible remaining negotiation opportunity. The window is bounded by 12 seconds, by the winner's authoritative turn deadline minus a 15-second action margin, and by the existing wave closing reserve. Read clocks outside the case lock using supported bounded client operations; an unavailable, stale or mismatched sample disallows optional waiting. Charge clock-read latency conservatively and associate samples with the observed offer state. Preserve normal lead-first opening, but never extend the existing release wait when other threads are becoming urgent. Replace the 90-second final-offer idle behavior only on the new path with an explicit safe closing boundary. Reserve close/push ownership under the lock, execute all network operations outside it, then reconcile. Do not deepcopy threads or introduce a snapshot coordinator. Only one closing operation may be reserved at a time. A close returning None or raising a recoverable error is not a terminal result: clear the reservation, refresh/re-evaluate as necessary and keep viable workers running with bounded retries. Accept terminal results only through validated arena result structure. Do not fabricate deal=False/score=0 while the arena remains live. Observe futures and log exceptions. After confirmed terminal completion, do not block result return on unrelated outstanding supplier requests. Use event waits rather than a busy loop. New behavior must work both with legacy close and close_recovery_v2.",
      "test": "Stateful RFQ tests with a fast final offer and a slow rival, one early agreement, a rival that beats the bar, unavailable clock data, expiry during an opportunity window, failed acceptance, worker exception and all threads ended. Assert no network call occurs under the case lock and no all-reply barrier is introduced. Generic D02 at least ten paired baseline/candidate blocks across ordinary and elevated latency. P05 four paired hosted runs initially, followed by the lower-tail phase. Log first-dispatch times, opportunity-window reasons, chosen quote and terminal latency."
    },
    {
      "id": "U3",
      "title": "Canonical citation provenance without case-wide evidence suppression",
      "priority": 3,
      "expected_gain": "Hypothesis: 0 to +0.010 ten-case mean, with reduced trust and hidden-case correctness risk.",
      "risk": "Low to medium: changing evidence availability or order can affect RFQ concessions even when claims become cleaner.",
      "files": [
        "proto/practice.py",
        "proto/test_a12_provenance.py"
      ],
      "functions": [
        "PracticeNegotiator.facts_for",
        "PracticeNegotiator.write",
        "canonical_record_v2 (new)",
        "PracticeNegotiator._provenance_v2_facts (new)",
        "PracticeNegotiator._provenance_v2_forecast (new)",
        "PracticeNegotiator._provenance_v2_proof (new)"
      ],
      "flag": "claim_provenance_only",
      "spec": "One coder owns these practice-path functions. Implement the flag on the generic data-package path used for sandbox, hosted practice and final. Do not activate safe_claims or edit engine write/send. Preserve the old functions' behavior when the flag is off. Add a separate canonical-record loader that reads and caches actual facts.json records, keyed by package path; do not assume canonical_fact's whitelist followed by lookup necessarily proves that returned values are canonical. Support the actual package record formats, fail closed for unknown formats and handle null refs. Build validated facts in A10's existing order and retain the original wording when supported. Validate part/supplier scope, currency, piece-based price units, index endpoints/months and numerical calculations. SQL may discover candidates but SQL existence alone cannot authorize a checked fact. Case-only refs may support only assertions actually grounded in case data, without invented numerical values. In PracticeNegotiator.write, preserve the parent message and U1 package explanation. Add answer_plus forecast proof only when the selected forecast is canonical, supports the stated commitment, is not already in this message or already used as the same thread's forecast proof, and a checked-claim slot remains. Otherwise omit the entire unsupported or redundant forecast sentence. Do not mark fc_cited for a rejected candidate. Maintain a maximum of three logical checked-claim groups across the message and attachments, treating an index pair, notice pair or order-history group as an indivisible assertion rather than treating each raw ID as a separate assertion. Derive bookkeeping locally or in internal state, never in wire keys. Deduplicate refs within a message. Do not introduce a global used-ID ledger or remove useful cross-supplier RFQ information. Validate passed rival IDs and terms against real session offers; distinguish a quoted alternative from an executable standing primary rather than inventing availability. Generate proof attachments only from validated records and avoid reintroducing unsupported IDs or figures. Preserve accurate uncited SQL context only as such; do not relabel it as verified evidence. No broad objection-based reordering or all-index suppression.",
      "test": "Offline fixtures for SQL-only forecast IDs, facts/SQL value conflicts, null alternative refs, kg/lot price units, multi-ID index/notice/history assertions, forecast already in the current fact slice, repeated same-thread volume proof and real rival alternatives. Wire schema must contain no private metadata. Generic D01/D02 paired comparisons must show no T4-style deterministic RFQ loss. Hosted P01/P02/P03/P04/P05/P11 two paired runs each. Require removal of P05's nonexistent forecast contradiction, preservation of P01 notice/should-cost evidence and no new checked-claim overflow."
    },
    {
      "id": "U4",
      "title": "Minimal transactional close and authoritative timeout recovery",
      "priority": 4,
      "expected_gain": "Hypothesis: 0 to +0.010 ten-case mean in normal conditions, potentially more under transport failures. P10 and P08 recovery versus A11c is not counted as gain over A10.",
      "risk": "Medium implementation risk; intended healthy-path strategy change is minimal.",
      "files": [
        "proto/engine.py",
        "proto/test_a12_close.py"
      ],
      "functions": [
        "Negotiator.close",
        "Negotiator.resync",
        "play",
        "Negotiator._close_v2 (new)",
        "Negotiator._close_v2_validate (new)",
        "Negotiator._close_v2_refresh (new)",
        "Negotiator._close_v2_cleanup (new)"
      ],
      "flag": "close_recovery_v2",
      "spec": "One coder owns close, resync, play and new helpers. Do not edit run, run_rfq, send, near_cap, the existing _safe_close helpers or _run_safe_single. Preserve all legacy behavior when the new flag is off. With the flag on, execute an already-approved economic close without adding a concession or urgency policy. A fresh valid current primary can be accepted directly. For a selected current alternative, mirror the exact legal terms, require agreed plus a new primary matching the selected completed terms, and accept only that primary ID. Identify alternatives by current sheet position/identity, never by parsing an '-a' suffix. Do not snap invalid returned terms into acceptable ones. A changed confirmation requires a new economic decision, not automatic acceptance. Use per-thread closing ownership without holding the RFQ case lock. After an ambiguous acceptance, query authoritative terminal state before another action; never blindly resend a rejected unchanged offer. Bound attempts per offer/revision and log every guard that declines promotion or acceptance. Refresh authoritative messages and reconstruct timeout-generated current offers from thread offer_id and timeouts, preserving opaque IDs and verifying actual terms. A changed ID without known terms is not permission to relabel an old sheet. Use seconds_left only for genuinely timing-sensitive closing/recovery, with sample latency charged conservatively; never compare a fresh turn to slowest_response+15 or treat request start as supplier reply time. Preserve the existing wave reserve policy rather than importing T3 urgency. Return None for recoverable failure so U2 can continue; in the single-supplier play cleanup path, perform bounded authoritative recovery and explicitly re-evaluate valid fresh candidates before any fallback decision. Never walk merely because an alternative confirmation or accept failed, especially when no useful outside option exists. Only record confirmed terminal results as closed; unresolved sessions remain explicitly unresolved and owned for cleanup. Log full result fields including c_open, c_deal, c_best, terms and cost_breakdown. Do not claim that a nonterminal HTTP response is a result.",
      "test": "Stateful protocol tests for P10-style exact alternative promotion, confirmation with changed terms, primary expiry, timeout replacement IDs, acceptance committed with response lost, rejected unchanged offer, no outside option and cleanup after exception. Assert bounded attempts and no direct alternative accept. A fresh response after a 54- or 95-second supplier delay must not itself trigger an early close. Generic D01/D02 and paired P08/P10 hosted tests. Verify healthy P10 retains the A10 0.671 path and that failed RFQ closes remain recoverable when combined with U2."
    },
    {
      "id": "U5",
      "title": "Register the exact A12 candidate manifest",
      "priority": 5,
      "expected_gain": "No independent gain; defines the tested composition and prevents accidental enable-all integration.",
      "risk": "Low if manifest-only. Release remains blocked unless isolated, combined and wave-level tests pass.",
      "files": [
        "proto/variants.py"
      ],
      "functions": [],
      "flag": null,
      "spec": "Integration task only, performed after feature branches are merged and evaluated. Add one module-level VARIANTS['A12'] entry using replace(VARIANTS['A10'][1], package_frontier_v2=True, bounded_rfq_race=True, claim_provenance_only=True, close_recovery_v2=True, clause_explore=True). Change nothing else: no engine edits, Config changes, cleanup, tuning, helper changes, test-harness changes, or activation of other A11 flags. The integration task needs no Config flag because it introduces no runtime behavior. The A12 configuration must inherit llm_writer=False, resilient_rfq=False, safe_close=False, arena_clock_guard=False, safe_claims=False, safe_single=False, calibrated_anchor=False and anchor_probe=False from A10. If any approved feature fails its gate, do not silently alter this recipe or promote it; retain A10 and request a revised reviewed manifest.",
      "test": "Compare asdict(A12) against asdict(A10): the only changed fields must be the five true flags listed in the manifest. Confirm all four new Config defaults are False. Register A12 as a candidate, then require the whole-suite, lower-tail and ten-case wave protocol before production promotion."
    }
  ],
  "variant": {
    "name": "A12",
    "base": "A10",
    "flags": {
      "package_frontier_v2": true,
      "bounded_rfq_race": true,
      "claim_provenance_only": true,
      "close_recovery_v2": true,
      "clause_explore": true
    }
  },
  "not_doing": [
    "Enabling all A11 flags or treating sandbox-only ablation as sufficient release evidence",
    "Enabling the existing resilient_rfq, safe_close, arena_clock_guard, safe_claims, safe_single, calibrated_anchor or anchor_probe paths",
    "Changing the concession curve, replacing target anchors with opening percentages, or applying another blanket leverage-room boost",
    "Removing the standing-price cap, adding a third sheet, or globally removing useful payment/duration MESOs",
    "Pushing single-supplier final offers or assuming withdrawn historical alternatives remain executable",
    "Promising faster payment, excess volume or other commitments outside the case's allowed terms",
    "Reintroducing a case-wide claim-consumption ledger or treating three raw IDs as the arena's three-claim limit",
    "Reordering all evidence by supplier objections or suppressing every index after one covered series is rejected",
    "Tuning writer prompts or enabling the LLM writer in A12",
    "Claiming P02's A11c gain proves a clause was sent, or claiming A11c bug recovery is incremental gain over A10",
    "Using hidden C_best, practice case IDs, supplier IDs or stored winning prices in runtime triggers",
    "Editing the same function from two parallel tasks, copying live locks, adding private wire keys or doing network I/O under the RFQ case lock",
    "Unrelated code cleanup or silent strategy changes during final integration"
  ]
}
```