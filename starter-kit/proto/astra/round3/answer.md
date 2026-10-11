## Recommendation

**Keep G8s unchanged.** I would start with **R3-1 and R3-2**, separately, then consider the package experiments. These are proposals only; **no hosted runs without the lead’s explicit approval**.

The remaining opportunity looks more like **better use of existing evidence and supplier-requested trades before finality** than a better concession curve.

## 1. Diagnosis — where the weak cases stop improving

The observations below identify the lock-in point and plausible missed mechanisms—not proof that the entire board gap was recoverable.

- **P18 — last useful counter is message 6; message 7 is already final.** The supplier says, “In recognition of the confirmed volume … lower our price to €5.40 … for the 24-month agreement with 90 days payment terms.”
  We obtained a real volume concession, but the remaining negotiation ended there. Earlier, “Please send us the competing offer you mentioned” received purchase-history/index arguments, not clarification that our comparison was a **historical purchase, not a standing quote**. The clause was supplier-introduced; supplying it unasked already lost in E54.
- **P05 — leverage weakens before the winning supplier’s message 7 final.** Its first index citation already returns `duplicate`; later: “the index data you sent was already counted.” Meanwhile, another supplier explicitly says, “Your own rival quote is at €29.50 … so there is no reason to drop further.”
  Thus shared evidence is being spent repeatedly and rival evidence eventually supports the plateau. The stagger leader also reprices delivery: “35 days lead time is super tight and would actually make the parts more expensive.” We cannot tell from these excerpts whether 52 days was admissible.
- **P11 — the actionable request is message 7; message 8 does not supply documentary support.** “You need to show us the firm data or orders for it” is answered with another volume assertion and the same packages.
  The final then says, “since you cannot improve the 60 days payment terms, we are completely stuck.” Payment really is fixed; inventing faster payment is not an option. The quality improvement to 300 ppm has already been obtained. “We see your figures, but we cannot give up margin” is a refusal, not a data gate.
- **P07 — the final counter changes the trade the supplier had just rewarded.** Message 7: “Accepting the improved payment terms of 45 days for the 36-month contract allows us … €5.45.” Message 8 instead offers 60 days/24 months and 90 days/36 months.
  The final follows the first package. Its total C is **better** than the preceding offer, so this is not a lost cheaper historical offer. The untested opportunity is continuing the rewarded trade. Separately, the opening bundle claim disappears when subsequent volume answers describe only the focal part as our “entire need.”
- **P04 — no price movement after the first response; the third response closes the negotiation.** “Without verifiable data to substantiate these claims … Which figures is that based on?” occurs in the same message as “This is our final offer.”
  The preceding counter introduced an unreferenced settlement average. Evidence delivery before that response is testable; a magical post-final gate is not established. The €4.88 alternative was **not cheaper in total C**. Only about €441 separates the actual deal from C_best, making the score unusually sensitive to small cost differences.
- **P08 — unlike P04, the fourth response is still `open` when we accept.** It says, “we can reduce our price to €5.41,” followed by “Which figures is that based on?”
  The engine accepts because its **next goal reaches the standing offer**, not because it reaches `c_target`. One hold has already occurred. This identifies the closing mechanism, but does not justify repeating E56’s losing velocity-hold policy.

**Gate correction:** P04’s request is inside a final offer; P11’s quoted phrase is not a request. P08 and one P05 thread do contain open-state requests. In P05 we already attached data afterward and still reached a plateau. None establishes an automatic discount-unlock gate.

---

## 2. Ranked improvement ideas

**Interpretation of gains:** The ranges below are subjective experiment-sizing hypotheses, in **absolute per-case score**, not measurements or supplier facts. Zero is plausible throughout; gains overlap and must not be added.

**Common test discipline**

- One flag at a time; keep G8s pricing, closing and RFQ scheduling unchanged unless explicitly specified.
- Offline replay establishes legality, provenance and whether the trigger fires—not how a supplier would respond.
- Sandbox first: retain D01’s 1.000; compare D02 against interleaved G8s runs in the same batches, checking landed-cost distribution, timeouts, citations and freight retention—not just one noisy mean.
- An inactive sandbox trigger proves only non-regression. Practice tests below are **requests for approval**, not authorization.
- Case labels below are evaluation targets only. Runtime rules use case fields, allowed options, evidence and observed replies.

### R3-1 — Deliver the right proof before finality
**Effort: small–medium · Gain validation: PRACTICE-ONLY for the target mechanisms**

**Mechanism and generic trigger:** While the supplier is `open`, distinguish requests for:
1. evidence of the proposed volume;
2. a competing executable quote;
3. support for a historical settlement claim.

Answer within the **already scheduled counter** using a typed, source-backed explanation:
- Forecast evidence remains a forecast; our authorized commitment is stated separately. Never call forecasts firm orders.
- A historical purchase comparison is explicitly identified as historical—not presented as an executable rival offer.
- Omit an optional settlement-average claim if we cannot give suitable supporting evidence.
- Re-present already verified evidence through the existing plain-proof path where appropriate; do not manufacture a new ID or pretend it is a new fact.
- Generate commitment quantities and durations from the actual case/package, avoiding wording such as P11’s opening “full 24 months” when its later commitment and deal are for 12 months.

**Targets / expected gain:** P04, P11, P18; potentially P08. **0–0.02** per affected case is a reasonable small-test hypothesis.

**Risk:** Documentary repetition may still be treated as duplicate; truthful historical evidence may remain irrelevant to the checker; changing a working sentence can change a deterministic supplier response.

**Why not a measured failure:** This is not E57’s reactive “figures answer” after a closing line. It changes **request classification and evidence delivery before the final response**, without adding a round. It also avoids E39’s wholesale provenance rewrite and cross-supplier scorecard citations.

**Cheapest test:** Offline fixtures must recognize P11’s “firm data or orders,” distinguish historical purchases from quotes, and add no unsupported claims. D01/D02 must preserve their useful arguments and claim limits. With approval: **P04, P11, P18**; success means both the intended message change and a better outcome, not merely a verified attachment.

---

### R3-2 — Stop re-spending acknowledged shared indices across RFQ threads
**Effort: small–medium · Sandbox can validate the mechanism; P05 gain requires practice**

**Mechanism and generic trigger:** Maintain a narrow, case-wide cache of **shared index evidence already acknowledged in completed replies**. Before sending another supplier the same index evidence, replace that slot with an unused, valid supplier-specific fact if available.

Crucial limits:
- Cache shared index evidence only—not every claim category.
- Keep rival-offer citations exempt.
- Preserve the supplier’s own cost breakdown and its early full argument.
- No waiting for another thread, no citation-reservation barrier, and no “the enquiry lists this reference” filler.
- Treat index endpoint references as their existing evidence group; do not relabel them to obtain novelty.

**Targets / expected gain:** P05; **0–0.03**, with substantial uncertainty because its outcomes vary.

**Risk:** Removing even a duplicate sentence may remove useful reinforcement. Concurrent sends can still duplicate evidence; avoiding those races must not serialize negotiation.

**Why not a measured failure:** E38’s T4 was a broad case-wide claim ledger; E49 initially removed repeated rival leverage. This is a **completed-response, shared-index-only filter**, preserving rival disclosure, source ownership, breakdown timing and asynchronous sends. Its advantage is narrower scope, not an assumption that global deduplication is inherently beneficial.

**Cheapest test:** Replay P05 and count avoided **non-rival** duplicates and valid replacements. D02 must retain the full breakdown argument and repeated rival citations, with no scheduling delay or landed-cost regression. With approval: **P05**, using paired runs rather than attributing one high score to the change.

---

### R3-3 — Keep one supplier-adopted trade lane intact
**Effort: medium · PRACTICE-ONLY**

**Mechanism and generic trigger:** In a non-stabilise single-supplier negotiation, the supplier adopts or explicitly rewards our secondary package’s payment/contract combination, but the next generated secondary package reverses that combination.

For the next ordinary counter:
- Keep G8s’s primary package unchanged.
- Keep the adopted non-price combination in the existing secondary slot.
- Calculate its price with the existing package-pricing code at the existing goal.
- Do not freeze its old price, extend the runway or recall it after finality.

This tests whether we should stop repeatedly taking back the consideration we just used to obtain a discount.

**Targets / expected gain:** P07, P08, P18; **0–0.03** per affected case, probably smaller on some.

**Risk:** The supplier may anchor on the secondary package; existing C estimates can still misvalue a longer commitment. Continuing a trade is not guaranteed to beat G8s’s later term improvement.

**Why not a measured failure:** E39’s frontier rewrite changed package rankings and discarded valuable dates/structures. Here the **primary stays untouched**, and only a currently negotiated secondary lane is stabilized. This is neither final-offer memory nor a slow/mirror concession rule.

**Cheapest test:** Offline show the exact field reversal prevented, with unchanged primary, goal, package count and must-haves. D01/D02 should be unchanged by scope. With approval: **P07, P08, P18**.

---

### R3-4 — Trade a supplier-offered clause variant, only after it is introduced
**Effort: medium · PRACTICE-ONLY**

**Mechanism and generic trigger:** The supplier has itself offered distinct, allowed index-clause variants, while `meet_cheapest` causes all our subsequent packages to use one variant.

In the existing secondary package only:
- Preserve its payment and duration.
- Try the other supplier-offered, admissible clause variant.
- Price the difference using the code’s marginal clause/risk cost, keeping the ordinary goal.
- Leave the primary package and opening sequence unchanged.

For example, this investigates a deadband exchange—not a new index series, invented hedge, or assumed cost pass-through. Do not infer a clause premium from two offers that also differ in payment or duration.

**Targets / expected gain:** P18 and P08. Hypothesis: **0–0.04 on P18; 0–0.02 on P08**.

**Risk:** Clause-risk valuation may be wrong; the supplier may raise its base price or ignore the exchange. The unchanged primary is a control, not a guarantee against worse replies.

**Why not a measured failure:** E54 introduced clauses **unasked in the opening** and displaced the useful long-contract/payment package. This experiment starts only after the supplier introduces the clause, preserves that package’s other fields, and changes no first ask. It is not a three-sheet menu or the standard/partnership sweetener experiment.

**Cheapest test:** Offline verify allowed variants, must-haves and the price/risk calculation; reconcile available observed clause cost components before trusting marginal calculations. D01/D02 should be unchanged. With approval: **P18, P08**, and **P02** as a clause-path regression guard.

---

### R3-5 — Resolve bundle scope when the supplier asks for volume
**Effort: small after an authorization audit · PRACTICE-ONLY**

**Mechanism and generic trigger:** The case explicitly authorizes a sourcing bundle, we have mentioned it, and the supplier subsequently requests volume confirmation.

Respond with a sourced scope breakdown:
- focal-part annual requirement;
- separately identified authorized bundle quantities and coverage;
- what is committed versus merely forecast.

Keep the focal part’s `volume_per_year` unchanged. Do not sum unlike items into that field or promise purchases outside the authorized case scope. **If the data supports only historical spend, not an authorized bundle commitment, this proposal is a no-op.**

**Targets / expected gain:** P07; **0–0.03**, conditional on genuine bundle authority and supplier responsiveness.

**Risk:** Highest factual risk if “we buy these items” is confused with “we may award these items.” The bot may price only the focal part and ignore bundle evidence entirely.

**Why not a measured failure:** E58 changed exclusivity wording for the same demand. This would document **additional case-authorized economic scope**, not describe the same volume more emphatically. It is not permission to invent additional demand.

**Cheapest test:** First audit the source of the existing bundle sentence and the case’s authorization. Kill the idea if authority is absent. D01/D02 should be unchanged; fixtures must reject unauthorized bundles. With approval: **P07**.

---

### R3-6 — Refresh stale-known rival evidence at dispatch, without waiting
**Effort: small audit, medium implementation · Sandbox can validate the mechanism**

**Mechanism and generic trigger:** At dispatch time, our authoritative local state already contains a newer, admissible, better rival primary offer than the one embedded in the outgoing draft.

Atomically replace the rival offer’s ID, terms, body figures and attachment from that same recorded revision. Otherwise leave the draft alone.

No new HTTP read, barrier, rebid, suppressed tie quote, altered acceptance rule or changed stagger.

**Targets / expected gain:** P05; **zero unless the audit finds stale-known opportunities**, then a **0–0.02** test hypothesis.

**Risk:** Mixing an ID from one revision with terms from another creates a false claim. Also, transcript ordering alone does **not** establish that a newer quote was already available when the message was sent.

**Why not a measured failure:** This is not E40/E41’s selective/actionable rival policy: it does not decide to hide unfavorable rivals or change the challenge price. It fixes only **known state freshness**. It is not T1/U2’s wait-for-rivals coordination.

**Cheapest test:** Instrument draft revision versus latest locally received revision first. If there are no stale-known opportunities, stop. Use delayed-reply sandbox fixtures and D02 to verify consistent IDs/attachments and unchanged send timing. With approval: **P05**, paired if the trigger occurs.

---

### R3-7 — Qualify the stagger leader before using its quote as leverage
**Effort: small audit, medium implementation · Target benefit likely PRACTICE-ONLY**

**Mechanism and generic trigger:** The currently selected RFQ lead has an opening package that fails a must-have, while another supplier has a compliant opening package.

Keep the existing stagger, but select its lead from compliant, completed opening packages, ranked by the existing C calculation. If none qualifies—or the current code already does this—retain G8s.

Do not treat a soft lead-time preference as a must-have or invent an expedite premium.

**Targets / expected gain:** P05; **zero if the eligibility audit finds no defect**. Conditional hypothesis: **0–0.03**.

**Risk:** A cheap supplier needing repair may still be the strongest opening negotiator. Changing the lead changes the whole RFQ message sequence.

**Why not a measured failure:** This neither opens suppliers simultaneously nor adds a barrier or longer runway. It changes only **which executable opening starts the existing stagger**. The hypothesis is that the first fresh comparison should not become more expensive merely to repair a known hard constraint.

**Cheapest test:** Audit the real case’s lead-time and coverage constraints against the recorded leader selection. The transcript’s “52 days” is not enough to declare a violation. D02 should retain its lead whenever that lead is compliant; use an offline noncompliant-opening fixture to test the branch. With approval: **P05**.

---

## 3. What not to do next

- **Do not retune the concession curve or extend the conversation.** Slow/firm curves, longer runway, stance holds and mirror jumps already have adverse evidence.
- **Do not use C_best or board prices as runtime targets or inferred supplier floors.** In particular, D02’s benchmark is not evidence of an attainable zero-margin deal.
- **Do not “fix” `accept: goal` by globally overriding acceptance.** The label can mean the curve reached the standing offer. That is diagnostic, not evidence that another unsupported push pays.
- **Do not revive post-final offer memory for P04.** The remembered alternative was dearer in total C.
- **Do not answer supposed gates with invented manufacturing, quality or cost data.** Nor disguise historical purchases as executable quotations.
- **Do not offer faster payment in P11, relax must-haves, or introduce unlisted terms.**
- **Do not enable broad claim, clock, close or RFQ coordination rewrites as a bundle.** The integration failures and premature-close regressions were expensive.
- **Do not spend quota repeating unchanged deterministic single-supplier sequences.** A changed sequence needs one initial outcome test; P05 needs replication because its outcomes vary.
- **Do not combine R3-3 and R3-4 initially.** Both change the secondary package; combining them would obscure attribution.

### Is the remaining ~0.05 reachable?

**Possible, but not currently supported as an expectation.**

The listed per-case board maxima average about **0.781**, versus G8s’s **0.731**. Those maxima are an envelope assembled across cases, not necessarily one competing agent’s mean.

Matching all six weak-case records while preserving our existing strengths would add about **0.056** to our mean. Thus gaining 0.05 requires recovering **most** of those six deficits—not one small repair.

There is evidence that different sequences can improve individual endpoints: G7 reached 0.860 on P04, and P05 has reached 0.710. There is **no evidence yet** that one generic rule can recover the much larger P18/P05 gaps while preserving P01/P02/P03.

My position: **generic incremental gains are credible; the full remaining gap is a stretch objective.** We should expect to reject several of these ideas after the cheap audits or sandbox tests.

## 4. Implementation shortlist

```json
{
  "ideas": [
    {
      "id": "R3-1",
      "title": "Deliver request-specific proof before finality",
      "flag": "proof_scope_before_final",
      "targets": ["P04", "P11", "P18", "P08"],
      "expected_gain": "Unmeasured hypothesis: 0-0.02 absolute score per affected case.",
      "risk": "Duplicate evidence, checker-irrelevant historical sources, or regression from changing a successful message sequence.",
      "test": "Offline request/provenance fixtures; D01 and interleaved D02 non-regression. Target gain is practice-only: request approval for P04, P11 and P18.",
      "functions": [
        "PracticeNegotiator.write",
        "PracticeNegotiator.facts_for",
        "PracticeNegotiator.claim_source",
        "Negotiator.write"
      ],
      "spec": "On an open-state evidence request, distinguish forecast, authorized commitment, historical purchase and executable quote. Supply supported proof within the existing counter; omit optional unsubstantiable settlement claims. Derive deal-scope figures from case/package data. Never invent IDs, relabel forecasts as orders, or add a post-final round."
    },
    {
      "id": "R3-2",
      "title": "Filter acknowledged shared-index duplicates across RFQ threads",
      "flag": "shared_index_ack_filter",
      "targets": ["P05"],
      "expected_gain": "Unmeasured hypothesis: 0-0.03 absolute score; noisy RFQ outcome requires paired evaluation.",
      "risk": "Removing useful reinforcement or accidentally suppressing rival and cost-breakdown leverage.",
      "test": "Replay non-rival duplicate counts and replacement validity; D02 must preserve breakdown timing, rival citations and asynchronous sends. Request approval for paired P05 tests.",
      "functions": [
        "Negotiator.send",
        "Negotiator.apply_thread_update",
        "PracticeNegotiator.facts_for",
        "PracticeNegotiator.write"
      ],
      "spec": "Cache completed-reply acknowledgements for shared index evidence only. Replace already acknowledged index groups with valid unused recipient-specific facts where available. Exempt rival offers and own breakdowns. No network wait, global claim reservation, or filler references."
    },
    {
      "id": "R3-3",
      "title": "Preserve one supplier-adopted secondary trade lane",
      "flag": "adopted_secondary_lane",
      "targets": ["P07", "P08", "P18"],
      "expected_gain": "Unmeasured hypothesis: 0-0.03 absolute score per affected case.",
      "risk": "Secondary-package anchoring and existing total-cost model error.",
      "test": "Offline field-lineage and unchanged-primary assertions; D01/D02 scope non-regression. Practice-only benefit: request approval for P07, P08 and P18.",
      "functions": [
        "Negotiator.meso",
        "Negotiator.write"
      ],
      "spec": "For an open non-stabilise single-supplier thread, detect when the next secondary package reverses a payment/contract combination the supplier adopted or rewarded. Preserve that combination in the existing secondary slot, priced by normal code at the unchanged goal. Do not alter primary, pacing, acceptance or final-offer handling."
    },
    {
      "id": "R3-4",
      "title": "Exchange supplier-offered clause variants after introduction",
      "flag": "requested_clause_lane",
      "targets": ["P18", "P08"],
      "expected_gain": "Unmeasured hypothesis: 0-0.04 on P18 and 0-0.02 on P08.",
      "risk": "Misvalued index risk, higher supplier base prices, or displacement of a useful secondary clause choice.",
      "test": "Offline option, must-have and marginal-cost checks; D01/D02 unchanged. Practice-only benefit: request approval for P18, P08 and a P02 regression guard.",
      "functions": [
        "Negotiator.meso",
        "Negotiator.clause_candidate",
        "Negotiator.C"
      ],
      "spec": "Only after the supplier offers distinct admissible clause variants, permit the existing secondary package to use the other variant. Preserve its payment and duration and the baseline primary. Derive the price adjustment from code-calculated clause/risk cost. Do not introduce a clause in the opening or infer premiums from non-comparable packages."
    },
    {
      "id": "R3-5",
      "title": "Document authorized bundle scope in volume answers",
      "flag": "authorized_bundle_proof",
      "targets": ["P07"],
      "expected_gain": "Unmeasured conditional hypothesis: 0-0.03; zero if bundle authority is absent.",
      "risk": "Confusing historical purchases or forecasts with authority to commit a wider award.",
      "test": "Audit bundle source and authorization first; reject unauthorized-bundle fixtures; D01/D02 unchanged. Practice-only benefit: request approval for P07.",
      "functions": [
        "PracticeNegotiator.write",
        "PracticeNegotiator.claim_source",
        "Negotiator.write"
      ],
      "spec": "When a supplier asks for volume after an authorized case-defined bundle was mentioned, separate focal-part demand from sourced bundle scope and distinguish commitments from forecasts. Keep focal-part volume fields unchanged. No-op without explicit scope authority; create no unsupported term-sheet fields."
    },
    {
      "id": "R3-6",
      "title": "Refresh stale-known rival evidence at dispatch",
      "flag": "dispatch_rival_refresh",
      "targets": ["P05"],
      "expected_gain": "Zero without detected stale-known opportunities; otherwise an unmeasured 0-0.02 hypothesis.",
      "risk": "Mismatched offer IDs, figures and attachments, or accidental scheduling changes.",
      "test": "Audit draft versus locally available offer revisions first. Test delayed replies and consistent rival attachments on D02. Request approval for paired P05 tests only if the trigger occurs.",
      "functions": [
        "Negotiator.run_rfq",
        "Negotiator.write",
        "Negotiator.send",
        "Negotiator.apply_thread_update"
      ],
      "spec": "Before dispatch, substitute a newer already-received admissible better rival primary offer for a stale draft reference. Update ID, terms, text and attachment atomically from one revision. Use authoritative history order, not ID syntax. No HTTP refresh, wait, barrier, disclosure suppression or close-policy change."
    },
    {
      "id": "R3-7",
      "title": "Use a compliant opening package to select the stagger leader",
      "flag": "feasible_stagger_lead",
      "targets": ["P05"],
      "expected_gain": "Zero unless the selection audit finds a noncompliant leader with a compliant alternative; conditional 0-0.03 hypothesis.",
      "risk": "Losing a productive cheap-first negotiation sequence or mistaking a soft preference for a must-have.",
      "test": "Audit actual case constraints and current selection first; offline noncompliant-opening fixture; D02 retains its leader when compliant. Target benefit likely practice-only: request approval for P05.",
      "functions": [
        "Negotiator.run_rfq",
        "Negotiator.C"
      ],
      "spec": "Before the existing RFQ stagger, rank completed compliant opening primary packages using existing total cost. Change the lead only when the current choice violates a hard requirement and a compliant opening exists. Otherwise retain G8s. Add no barriers, floor assumptions, or speculative repair premiums."
    }
  ]
}
```