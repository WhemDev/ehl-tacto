## Recommendation

**Keep G8u deployed. Change the unit of experimentation from “negotiation strategy” to “one supplier response.”**

The most promising unexplored question is:

> **For an identical negotiation history, which change to the next evidence–package combination makes the supplier return a cheaper executable deal?**

You have extensively searched concession curves and whole negotiators. You have not, in the supplied record, systematically mapped that local response function.

My shortlist is:

1. **Make evidence economically actionable on its first use.**
2. **Experimentally locate the boundary where suppliers accept our packages.**
3. **Test whether verification and settlement compete within a single reply.**

The remaining ideas concern revealed exchange rates, information timing, and the coordinate the bots actually mirror.

### What the evidence establishes—and what it does not

I can check these conclusions against the supplied excerpts, not independently replay the approximately 700 sessions.

- **Verification is not economic influence.** P02’s first response verifies price history and delivery data but says neither changes its calculation. P11’s second response says quality and forecast data *do* enter its calculation. P08 distinguishes a hedged material index from another index it incorporates.
- **Deduplication is not an economic objective.** E64 decisively rejects shared-index skipping on that tested path. However, it changed the evidence sequence and verified-claim count too; it does not isolate the causal value of a duplicate sentence.
- **Acceptance and counteroffering are different response modes.** P02 accepts our clause package substantially below its preceding no-clause quotes. E65’s slower path misses that agreement and reaches a worse final. That does not prove the acceptance threshold, but it makes that threshold worth investigating.
- **Reply count is a scarce budget, not a universal constant.** E65 supports short, path-dependent finality. P10 can go final after its first counter; P01/P02 can agree without going final.
- **The three-claim budget is not three IDs.** E62 confirms that a legitimate claim can require several source IDs. Attachments do not create a separate allowance.

All rules below are generic. Case labels identify evidence or tests, never runtime selectors. All offer numbers and derived factual quantities come from code.

## Ranked ideas

Ranking is a judgement of **potential value × plausibility ÷ effort**, not a measured expected-value calculation.

| Rank | Idea | Effort | Why investigate |
|---|---|---:|---|
| 1 | **I1 — Bind Before You Burn** | M | Attacks the strongest demonstrated lever without changing prices or reply count |
| 2 | **I2 — Acceptance-Edge Microscope** | M | Measures an important response boundary instead of guessing supplier floors |
| 3 | **I3 — Verify, Then Settle** | S | Very cheap test of within-message processing, distinct from warmer prose |
| 4 | **I4 — Quote-Implied Exchange Rates** | M | Replaces assumed supplier trade values with observable quoted tradeoffs |
| 5 | **I5 — Spend Seconds, Not Replies** | M | Tests whether some RFQ latency loss is an information-ordering loss |
| 6 | **I6 — Same-Cost Concession Carriers** | M | Separates the movement bots perceive from the economic cost we incur |

**Gains are unmeasured throughout.** I would not attach invented score forecasts to these mechanisms. Each could produce zero or negative gain; their gains would also overlap.

---

## I1 — Bind Before You Burn

### Mechanic and evidence

A fact can be correct but useless to the current decision:

- **P04, response 1:** price history verified, “does not change our calculation.”
- **P04, response 2:** delivery and forecast information reviewed, still no calculation change.
- **P07, response 2:** verified forecast enables an adjustment alongside a contract/payment package.
- **P11, response 2:** quality record and forecast both incorporated.
- **P08, responses 1–2:** one index is hedged out of current costs; another is incorporated.

**Hypothesis:** some evidence credit depends on the proposition being checked and its connection to the proposed contract—not merely its source ID or persuasive wording.

### Exact mechanism and trigger

Represent each available factual assertion as:

**source → supported proposition → economic issue → applicability conditions → relevant package field.**

Examples:

- A purchase order may substantiate **historical quantity over a documented period**, not only historical price.
- A forecast substantiates forecast demand; the attached sheet separately establishes the **authorized commitment**.
- A quality scorecard may support a quality remedy, rather than a generic request for a discount.
- An index movement may be applicable to an exposed cost component, but not to a component the supplier explicitly says is fixed over the relevant period.

Before a source’s first use:

1. Enumerate only propositions actually supported by accessible records.
2. Identify whether the current complete package makes a proposition commercially actionable.
3. Prefer an actionable proposition over an otherwise inert historical comparison.
4. Place the evidence and corresponding commitment/remedy in the **same normal counter**.
5. Preserve G8u’s bid, package count and reply schedule in the first experiment.

For example, code may generate:

> “These orders total **[computed quantity]** during **[documented period]**. They substantiate past demand. Separately, the attached package commits **[authorized quantity]** for **[authorized duration]**.”

It must **not** turn past orders into guaranteed future demand.

Maintain separate states for:

- checker treatment: verified/duplicate/etc.;
- recipient exposure and reported economic application.

Do not suppress shared evidence merely because its ID was checked elsewhere. Do not re-label an already-used ID to pretend it earns fresh verification.

Only after the first experiment succeeds should selection expand into a small dependency-aware scheduler: up to three real claims, prioritizing combinations that support distinct active issues. **Do not simply change `facts=1` to `facts=3`.**

### Why this is different

Closest failures:

- **A10map:** reordered facts by objection topic.
- **G9c:** supplied figures after a request that often arrived too late.
- **G2-12:** put a cost fact first.
- **G10a/G8w:** removed shared-index repeats.

This changes **which supported proposition a source establishes, and whether the proposed contract activates it on first exposure**. It is not broad reordering, more proof, or global deduplication.

### Expected gain, risk, cheapest test

- **Gain:** unmeasured. Potentially useful where good sources are currently spent on economically inert assertions. Zero if claim type/effect is rigidly determined by source metadata.
- **Risk:** the checker may classify a PO only as price history; changing the proposition could be ignored or rejected. Premature forecast use may also consume useful evidence before its best package.
- **Cheapest test:** offline, find records supporting multiple genuine propositions and audit their quantities, periods and authorization. Inspect existing matched histories for different uses of the same source type.
- **Sandbox:** test a first-use proposition change with identical sheets and other claims. If the necessary source values are unavailable in sandbox, it is a no-op regression test—not effectiveness evidence.
- **Kill condition:** no supported alternative proposition, or invariant checker/economic treatment across controlled probes.
- **Practice:** only with the lead’s approval after a real trigger is demonstrated.

---

## I2 — Acceptance-Edge Microscope

### Mechanic and evidence

- **P02, message 6 → response 3:** the supplier agrees exactly to our clause package.
- **P01, message 6 → response 3:** it agrees to our own payment/date package.
- **E20:** a sandbox RFQ supplier also agrees to our own sheet.
- **E65:** changing the path can replace agreement with a much worse final.

These are observations of an **acceptance decision boundary**, not evidence that our preceding supplier-floor estimate was correct.

### Exact mechanism and trigger

Use deterministic sandbox sessions as controlled experiments:

1. Reproduce a negotiation prefix.
2. Verify that the supplier replies match, allowing only necessary substitution of arena-issued IDs.
3. Change **one field in the next ordinary proposed package**, initially price on an otherwise identical package.
4. Keep facts, wording, package order and all other terms fixed, except mechanical updates needed for consistency.
5. Record exact-package agreement, counteroffer, finality, and resulting complete cost.

Start with two local probes. Use bisection **only if a monotone acceptance bracket is actually observed**. Otherwise use a small local grid or stop.

Important distinctions:

- “Did not agree” is an observation of the bot’s response policy, **not proof of economic infeasibility**.
- A threshold measured after one history is not valid after a different history.
- Lower price is not automatically lower total C in relationship-cost cases.
- This uses new sandbox sessions; it assumes no cloning or branching API.

The eventual runtime rule would be small:

> On an ordinary open-thread counter, if a generic, well-supported acceptance rule identifies a cheaper valid candidate near the current package, propose it; otherwise use G8u.

Learn only normalized features such as package changes, gap to a comparable current quote, evidence application and reply phase. **Never ship a table of supplier-specific thresholds or historical winning prices.**

### Why this is different

Closest failures:

- **G4-1/G5-2 reservation-band inference:** guessed a floor from the concession sequence and replaced the goal.
- **ALT-2 digital twins:** predicted imagined supplier responses.
- **ALT-3:** introduced experimental selection and stopping that closed too early.

This directly measures **actual responses to matched-history interventions**, then considers a narrowly supported rule. It does not replace stopping or the concession curve, and it consumes no additional replies in final negotiations.

### Expected gain, risk, cheapest test

- **Gain:** unmeasured; potentially meaningful on own-package agreements. The accepted package may already sit near the useful boundary.
- **Risk:** overfitting procedural quirks, non-monotonic responses, relationship-cost errors, and false transfer from a few suppliers.
- **Cheapest test:** mine existing logs for identical prefixes followed by one-field differences. Ordinary logs cannot answer an unobserved counterfactual.
- **Sandbox:** reproduce one prefix, perform local probes, and close every owned session normally. D01’s saturated score makes it a response-identification test, not an improvement benchmark.
- **Promotion requirement:** supplier/case-held-out support and an abstaining fallback. Two sandbox suppliers cannot establish generalization.
- **Practice:** only approved tests of a generic rule—not case-specific threshold hunting.

---

## I3 — Verify, Then Settle

### Mechanic and evidence

P01/P02 demonstrate that a reply can both discuss evidence and accept a package. Other replies verify facts but leave the calculation unchanged.

**Unproven hypothesis:** package selection can become settled before all applicable evidence influences the returned counter. The interface gives us one reply, but that reply may involve several internal decisions.

### Exact mechanism and trigger

Keep the entire commercial content fixed. Change only its organization and one normal business request:

1. A short evidence block: source, factual statement, economic relevance.
2. The existing package explanation.
3. A request such as:

> “Please verify these inputs, then assess the attached complete package. If you counter, please reflect any applicable adjustments in the primary term sheet.”

An optional attachment contains the same source-backed ledger—not additional claims, invented calculations, or more packages.

Trigger when a normal counter contains both checkable evidence and a complete proposal. Do not add a discovery turn, fake intermediate agreement, or request several simulated negotiation rounds.

Test **layout** and **the instruction** separately. Keep the claim order and count fixed initially.

### Why this is different

Closest failures:

- **A10w/E37:** broad stylistic rewriting.
- **G1-14:** a residual-cost bridge.
- **E50:** moving arguments between replies.
- **G9c:** responding to a later request.

This tests **processing order within the same reply**, with unchanged facts and economics. It is deliberately smaller than “better emails.”

### Expected gain, risk, cheapest test

- **Gain:** unmeasured; likely zero or small. If the arena mechanically processes claims before generation, wording cannot change that.
- **Risk:** a longer packet dilutes attention or encourages premature acceptance of an inferior secondary package.
- **Cheapest test:** offline equality checks on every factual atom, source and term.
- **Sandbox:** matched-prefix baseline/layout-only/instruction-only probes; compare structured replies, not just the phrase “took into account.”
- **Kill condition:** unchanged responses across the relevant probes. Do not launch another tone search.
- **Practice:** approval required; an inactive sandbox test is insufficient evidence.

---

## I4 — Quote-Implied Exchange Rates

### Mechanic and evidence

Suppliers sometimes quote clean alternatives in a single reply:

- **P01, response 1:** different payment terms at the same effective date.
- **P02, responses 1–2:** different payment terms with corresponding prices.
- **E21–E22:** chargeback avoidance reveals a much larger supplier valuation than expected-cost arithmetic suggests.
- **E47:** nominal price improvements can disappear completely after freight.

The existing package optimizer uses estimated supplier economics. **E52’s conclusion that it already finds the best win–win package is conditional on those estimates.**

### Exact mechanism and trigger

Extract **simultaneously quoted, fully resolved alternatives**.

If two sheets differ only in price and one non-price issue, their price difference is an observed **quoted exchange**, not a hidden-cost estimate:

\[
\Delta p_{\text{quoted}} = p_B-p_A.
\]

For bundled differences, do not assign the whole premium to one field. Require enough independent comparisons to identify an exchange, or abstain.

Use these exchanges to generate a candidate transformation of G8u’s planned package:

- change an allowed term along a quoted trade;
- adjust its proposed price using the observed exchange, with uncertainty;
- retain it only if code shows lower buyer C and it survives existing constraints and price caps.

Initially restrict this to well-understood cost components and no uncertain relationship-cost equivalence. With single suppliers, use the existing secondary slot; RFQs retain one sheet.

For multiple issues, search for combinations where the supplier’s **observed quoted compensation** is cheaper than our benefit. Do not assume every quoted pair lies on one exact indifference curve.

### Why this is different

Closest failures:

- **G10b:** persisted an adopted lane without measuring its exchange rate.
- **G1-10:** tried one equal-cost payment experiment.
- **G7sw:** reframed packages already selected by the existing model.
- **U1:** trusted estimated buyer-cost rankings more aggressively.

The new input is a **recipient-specific posted tradeoff from comparable offers**, with an identifiability check. It is neither lane loyalty nor a newly guessed supplier utility function.

### Expected gain, risk, cheapest test

- **Gain:** unmeasured; probably localized. Potential exists where assumed cash, freight or penalty valuations are wrong.
- **Risk:** alternatives may reflect anchoring rather than stable trade rates; interactions can invalidate composition.
- **Cheapest test:** extract clean quote pairs offline and check whether they generate any distinct, robustly cheaper candidate. Stop if not.
- **Sandbox:** test one identified exchange, holding evidence and concession phase fixed.
- **Practice:** only approved, triggered cases. No removal of mandatory clauses or introduction of unlisted terms.

---

## I5 — Spend Seconds, Not Replies

### Mechanic and evidence

- **E18:** a fresh rival reply can be worth substantially more than an opening quote.
- **E63:** injected latency loses roughly 0.06 on D02 without protocol failures.
- **P05:** a supplier explicitly uses a rival quote as evidence that it need not go lower.
- **E14/E38/E39:** broad synchronization and delayed openings lose badly.

**Hypothesis:** a fast thread sometimes spends its last useful reply citing stale-but-current leverage just before a better rival reply arrives.

### Exact mechanism and trigger

Introduce one narrowly bounded **mid-negotiation dispatch deferral**:

- Initial stagger remains unchanged.
- The supplier is still open.
- A rival response is already in flight.
- The planned disclosure is economically weak—for example, the rival currently does not beat this supplier.
- There is sufficient authoritative thread and wave slack.
- No agreed/final offer or closing action is delayed.

Wait only until the first of:

1. the pending rival reply arrives;
2. the locally computed deferral budget expires;
3. a safety/closing condition fires.

Then send the normal counter, using whatever genuine rival evidence is available.

Allow at most one deferred worker at a time; all other workers continue. No holding email, no mutual waiting, no full-round barrier, no goal rewind. The deferral budget comes from available slack and measured latency—not case identity.

### Why this is different

Closest failures:

- **T1/U2:** delayed opening or closing and effectively serialized bargaining.
- **CS SAFEZONE:** spent messages keeping offers alive.
- **R3-6:** refreshed only evidence already received at dispatch.

This deliberately exchanges **a bounded amount of wall-clock time for information before spending a reply**, only in the middle of an open thread.

### Expected gain, risk, cheapest test

- **Gain:** unmeasured. Recovering part of latency-associated loss is plausible; E63’s approximately 0.06 loss is context, not a promised gain.
- **Risk:** the rival does not improve; the wait changes the useful sequence; latency estimates fail. This is the highest operational-risk idea here.
- **Cheapest test:** offline event replay to count genuinely missed information opportunities and test deadlines. That replay cannot predict new prices.
- **Sandbox:** controlled-latency D02 comparisons with identical initial stagger and no close delay.
- **Kill condition:** no useful evidence arrives within the safe deferrals, or any late-message/close regression.
- **Practice:** only approved paired RFQ tests.

---

## I6 — Same-Cost Concession Carriers

### Mechanic and evidence

E65 supports pace mirroring, but **which coordinate is mirrored?**

Possibilities include:

- unit-price movement;
- buyer total-cost movement;
- supplier cash-equivalent movement;
- number or salience of changed terms.

E8 showed that structural changes can contaminate inferred concessions. E47 showed that nominal price and landed cost are not interchangeable.

### Exact mechanism and trigger

For an ordinary G8u counter \(q_t\), search allowed packages for another package \(q'_t\) satisfying:

\[
C(q'_t)\approx C(q_t),
\]

but with a different visible price step or distribution of non-price concessions.

For example, a higher nominal price may be offset by an allowed buyer-favorable payment or delivery change. Every change must be explicit. Do not call an offsetting trade a larger net sacrifice.

Conduct controlled tests of:

- same buyer C, different price movement;
- where feasible, same price movement, different economic movement.

If a stable response coordinate is identified, generate the ordinary concession trajectory through the cheaper effective **carrier** of that movement. Preserve legal options, must-haves, the price cap, and the existing number of sheets.

Start outside relationship-cost cases. If the feasible grid contains no useful matched packages, do nothing.

### Why this is different

Closest failures:

- **G9a mirror jump:** paid a larger economic concession to induce reciprocity.
- **E8 reciprocal:** copied supplier movement.
- **G7sw:** described sweeteners without changing the response variable being tested.
- **G1-10:** a payment probe, not identification of the mirroring coordinate.

Here the first experiment holds **our economic concession budget constant**. It asks whether the supplier responds differently to its representation across real contractual issues.

### Expected gain, risk, cheapest test

- **Gain:** unmeasured; potentially useful only if the bot mirrors a coordinate that can be moved cheaply.
- **Risk:** the supplier evaluates the whole package correctly, sees an unattractive trade, or prices the offset more heavily than expected. Total-C estimation error can also create a false “same-cost” pair.
- **Cheapest test:** offline enumeration of matched-cost packages and historical normalization of price versus term movement.
- **Sandbox:** one matched-prefix package substitution; unchanged evidence.
- **Kill condition:** no feasible contrasts, or response tracks economic value rather than the hypothesized coordinate.
- **Practice:** only after sandbox identification and explicit approval.

---

## Test discipline: make the next experiments informative

These experiments should not become another six-variant tournament.

1. **Find a trigger offline.** A feature that cannot produce a distinct valid packet is finished.
2. **Check the counterfactual boundary.** Offline replay verifies construction and timing, not the supplier’s response to unseen text.
3. **Intervene once.** Match the prefix; change one mechanism at the selected counter.
4. **Measure both the immediate response and the final deal.** Earlier movement can merely bring forward a discount that would have happened anyway.
5. **For RFQs, interleave controls and record message arrival order.** Identical configurations are not sufficient controls.
6. **Distinguish evidence receipt from economic application.** Supplier wording is diagnostic; structured terms and complete C determine success.
7. **Do not promote on sandbox-only generalization claims.** D01 is saturated; D02 has narrow economic coverage.
8. **No practice runs without the lead’s explicit OK.**

**My first work order:** offline I1 and I2 audits, then the cheap I3 sandbox probes. Park I4–I6 until those results identify a real opportunity. Keep G8u as the fallback throughout.

## Two different approaches

### X1 — Empirically Compiled Supplier Response Model

Replace “an LLM imagines the opponent” with a small model learned from **actual matched-prefix interventions**.

It predicts separate outputs:

- which propositions are recognized;
- which appear economically applicable;
- whether our exact package is accepted;
- how the returned package changes;
- whether the thread becomes terminal.

Use generic normalized features, supplier-held-out evaluation, uncertainty and abstention. Initially it advises only packet selection around G8u; eventually it could replace the scalar curve with a short-horizon controller.

**Closest failed approach:** ALT-2 digital twins. The difference is measured intervention data rather than generated supplier rollouts.

**Verdict: maybe.** Worth building the offline identification dataset. Not enough evidence to replace G8u before the final. Determinism reduces experimental noise; it does not solve transfer to unseen suppliers.

### X2 — Joint Evidence–Contract Planner

Treat an action as a complete tuple:

**package + supported claims + proof organization + dispatch opportunity.**

Plan over the small number of likely remaining replies. Evidence has applicability conditions and first-use timing; terms have known buyer costs and uncertain supplier exchange values; acceptance is a separate possible outcome.

This is different from optimizing a package first and selecting arguments afterward. It also differs from ALT-6: no discovery-only turns, and no requirement to discover every supplier constraint before bidding.

**Verdict: maybe later; not a full rewrite now.** This is the strongest conceptual redesign, but its response model is currently underidentified. Build it only after I1/I2/I4 establish useful local mechanisms. Otherwise it is another elegant optimizer of incorrect assumptions.

```json
{
  "ideas": [
    {
      "id": "I1",
      "title": "Bind Before You Burn",
      "mechanic": "Verification and economic application differ: P04 verifies history and forecast without changing calculation; P07 and P11 incorporate forecast or quality evidence; P08 distinguishes hedged from applicable indices. E64 shows that checker duplication alone is not a reason to remove evidence.",
      "spec": "Compile each accessible source into supported propositions with scope, period, economic issue and package prerequisites. On first exposure, prefer a proposition made actionable by the current complete package, such as documented historical quantities paired with a separately authorized commitment. Preserve G8u bids, package counts and reply timing in the first ablation. Maintain separate checker and recipient-application states. Never relabel used IDs for fresh credit, invent source values, conflate forecasts with orders, or globally suppress shared evidence. Respect the three-claim budget across the whole payload.",
      "targets": [
        "Evidence-rich short negotiations",
        "Volume-sensitive packages",
        "Quality negotiations",
        "Cost-driver disputes"
      ],
      "expected_gain": "Unmeasured. Potentially useful where first-use evidence is currently economically inert; zero if checker effects are rigidly determined by source metadata.",
      "effort": "M",
      "risk": "Alternative truthful propositions may be ignored or classified differently by the checker; premature exposure can consume useful evidence.",
      "test": "Offline source-facet and authorization audit, then identical-sheet sandbox probes where accessible records support the mechanism. Inactive sandbox paths establish only non-regression. Practice requires the lead's explicit approval.",
      "closest_failed": "A10map reordered by objection; G9c answered late requests; G2-12 prioritized cost; G10a removed duplicates. This instead changes supported proposition selection and first-use package applicability."
    },
    {
      "id": "I2",
      "title": "Acceptance-Edge Microscope",
      "mechanic": "P01 and P02 agree exactly to buyer packages; E20 reports own-package agreement in sandbox; E65 shows a slower path can miss agreement and reach a worse final.",
      "spec": "Mine or create matched negotiation prefixes, then perturb one field in the next ordinary package while fixing evidence, wording and other terms. Observe exact agreement, counteroffer, finality and complete cost. Use bisection only after establishing a monotone acceptance bracket. Treat non-agreement as a procedural observation, not proof of economic infeasibility. Learn only generic normalized rules with held-out validation and abstention; never deploy case-specific thresholds. Add no runtime probing rounds and preserve G8u closing.",
      "targets": [
        "Open threads near own-package agreement",
        "Deterministic single-supplier response paths",
        "Allowed packages with uncertain acceptance boundaries"
      ],
      "expected_gain": "Unmeasured; potentially meaningful on own-package agreements, but the current accepted package may already be near the useful boundary.",
      "effort": "M",
      "risk": "History-dependent or non-monotone acceptance, relationship-cost errors, and overfitting a small supplier population.",
      "test": "First mine existing matched-prefix interventions offline. Then reproduce sandbox prefixes and perform local one-field probes, closing all owned sessions. Require generic held-out support before requesting any practice evaluation from the lead.",
      "closest_failed": "G4-1 inferred reservation bands from concessions; ALT-2 imagined supplier responses; ALT-3 changed stopping. This measures actual matched-history responses without replacing the curve or stopping policy."
    },
    {
      "id": "I3",
      "title": "Verify, Then Settle",
      "mechanic": "Replies can both verify evidence and accept a package, as in P01 and P02. Whether internal package selection precedes economic application of evidence is unmeasured.",
      "spec": "Keep factual atoms, references, sheets and claim count unchanged. Organize the body as evidence with applicability, then package explanation, and separately test a request to verify inputs before assessing the package and reflect applicable adjustments in the primary counteroffer. Attachments repeat supported material only and provide no extra claim budget. Add no discovery turn or simulated negotiation sequence.",
      "targets": [
        "Counters containing evidence and complete packages",
        "Replies that acknowledge evidence without an economic change"
      ],
      "expected_gain": "Unmeasured; likely zero or small. No gain is expected if arena processing order is fixed independently of wording.",
      "effort": "S",
      "risk": "Attention dilution or earlier acceptance of an inferior secondary package.",
      "test": "Offline factual and numerical equality checks, then sandbox baseline, layout-only and instruction-only matched-prefix probes. Stop on invariant structured responses. Practice only with explicit lead approval.",
      "closest_failed": "A10w changed style broadly; G1-14 supplied a cost bridge; E50 moved arguments between replies; G9c reacted to requests. This isolates within-message processing organization."
    },
    {
      "id": "I4",
      "title": "Quote-Implied Exchange Rates",
      "mechanic": "P01 and P02 provide simultaneous payment-price alternatives; E21-E22 reveal strong chargeback aversion; E47 demonstrates that nominal-price gains can be offset by freight.",
      "spec": "Extract fully resolved simultaneous quote pairs differing in price and one non-price issue. Use their price difference as an observed quoted exchange, not a hidden-cost fact or exact indifference condition. Abstain on unidentified bundled differences. Transform a normal G8u candidate along supported exchanges and retain only robustly lower-C packages satisfying all existing constraints and price caps. Keep current sheet counts and initially exclude uncertain relationship-cost equivalence.",
      "targets": [
        "Suppliers returning comparable alternative sheets",
        "Payment, freight, lead-time and quality tradeoffs",
        "Cases where estimated supplier term valuations may be wrong"
      ],
      "expected_gain": "Unmeasured and probably localized; useful only when revealed quoted exchanges improve on existing model assumptions.",
      "effort": "M",
      "risk": "Quoted alternatives may reflect anchoring, unstable preferences or non-additive interactions.",
      "test": "Offline extraction and identifiability audit; stop unless a distinct robustly cheaper candidate exists. Then a single-exchange sandbox ablation. Practice requires explicit lead approval.",
      "closest_failed": "G10b preserved a lane; G1-10 tried an equal-cost payment experiment; G7sw reframed existing model choices; U1 trusted estimated rankings. This uses comparable supplier-quoted compensation to update trade selection."
    },
    {
      "id": "I5",
      "title": "Spend Seconds, Not Replies",
      "mechanic": "E18 demonstrates fresh-rival leverage; E63 reports latency-associated RFQ score loss without protocol failures; P05 includes rival quotes supporting a plateau.",
      "spec": "Preserve the initial stagger and all close behavior. On an open mid-negotiation thread with weak current rival leverage, an already-in-flight rival reply and sufficient authoritative clock slack, defer one counter until that reply arrives or a code-computed safe budget expires. Permit at most one deferred worker; others continue. Send no holding message, create no barrier, rewind no goal, and never defer an agreed/final offer or closing action.",
      "targets": [
        "Asynchronous RFQs",
        "Fast threads spending scarce replies before pending rival information arrives",
        "Latency-sensitive negotiations"
      ],
      "expected_gain": "Unmeasured. Recovery of some latency-associated loss is plausible; E63's approximately 0.06 loss is context, not a predicted gain.",
      "effort": "M",
      "risk": "Unproductive waiting, changed bargaining sequence, inaccurate latency estimates or reduced closing slack.",
      "test": "Offline event replay for missed-information opportunities and deadline safety, then controlled-latency D02 comparisons. Reject any timing or closing regression. Practice RFQs require explicit lead approval.",
      "closest_failed": "T1/U2 delayed openings or closing and serialized bargaining; SAFEZONE spent holding messages; R3-6 refreshed already-received information. This makes only a bounded mid-turn information wait without spending a reply."
    },
    {
      "id": "I6",
      "title": "Same-Cost Concession Carriers",
      "mechanic": "E65 supports pace mirroring but does not identify its coordinate; E8 shows structural changes contaminate concession estimates; E47 separates nominal price from landed economics.",
      "spec": "Enumerate allowed packages at the same code-computed buyer C as a normal G8u counter but with different unit-price movement or distributions of non-price changes. Explicitly disclose every offsetting trade and make no false claim of larger net sacrifice. Hold evidence and reply phase fixed. Identify whether responses track price, economic value or term movement before considering a generic carrier-selection rule. Preserve caps, must-haves and sheet counts; initially exclude relationship-cost uncertainty.",
      "targets": [
        "Mirroring suppliers",
        "Cases with several negotiable terms",
        "Feasible matched-cost package contrasts"
      ],
      "expected_gain": "Unmeasured. Useful only if the response coordinate can be moved more cheaply than the current package path.",
      "effort": "M",
      "risk": "Supplier evaluation of the full package defeats the hypothesis; offsets are overpriced; cost-model error produces false equivalence.",
      "test": "Offline matched-cost enumeration and movement normalization, then one matched-prefix sandbox substitution with unchanged evidence. Stop if no valid contrast or response effect exists. Practice only after explicit lead approval.",
      "closest_failed": "G9a bought reciprocity with a larger concession; E8 copied supplier movement; G7sw framed sweeteners; G1-10 probed payment. This holds the buyer's economic concession budget fixed while identifying the mirrored coordinate."
    }
  ],
  "approaches": [
    {
      "id": "X1",
      "title": "Empirically Compiled Supplier Response Model",
      "summary": "Build a small uncertainty-aware model from actual matched-prefix interventions, separating claim recognition, economic application, package acceptance, counteroffer changes and terminality. Use generic features and abstain outside supported regions.",
      "worth_it": "maybe",
      "why": "Unlike ALT-2, it uses measured responses rather than imagined supplier rollouts. The offline identification dataset is worthwhile; replacing G8u before held-out validation is not. Determinism helps identification but does not establish transfer."
    },
    {
      "id": "X2",
      "title": "Joint Evidence-Contract Planner",
      "summary": "Plan complete packets consisting of a legal package, supported claims, proof organization and dispatch opportunity over the short remaining reply horizon, with first-use evidence dependencies and uncertain supplier trade values.",
      "worth_it": "maybe",
      "why": "It optimizes evidence and contracts jointly rather than attaching arguments after package selection, and unlike ALT-6 spends no discovery-only rounds. A full rewrite is premature until local experiments identify reliable response mechanisms; otherwise it would optimize unsupported assumptions."
    }
  ]
}
```