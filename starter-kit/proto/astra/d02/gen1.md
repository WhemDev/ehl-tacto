### Diagnosis
- The main stopping rule is mechanical: once `rnd + 1 >= T`, `next_goal` equals the best standing cost. The goal-accept branch then runs **before** final-offer pushes.
- Acceptance also uses the evaluating worker’s round number, not necessarily the winning supplier’s. A fast, expensive supplier can advance the effective closing threshold.
- Repeatedly showing the leader a worse rival quote advertises its advantage; duplicate citations add little pressure.
- Package ranking explains short payment: `supplier_value` rewards it under the estimated cash rate. That estimate is not an observed price/payment trade.
- Freight switches can exchange almost all nominal price savings for buyer-paid transport.
- Lead time has no value in `supplier_value`; equally costly packages can therefore select unnecessarily fast delivery.
- The first post-breakdown counter gives away much of the newly discovered room immediately.
- Below are **7 parameter experiments and 7 code experiments**. Global parameter changes are explicitly marked for the D01 guard; all new code is RFQ-only.

```json
{
  "analysis": "The priority is the negotiation path, not a lower guessed floor. A10's concession curve eventually makes goal acceptance tautological, before its configured final-offer pushes can run; the legacy RFQ acceptance comparison also borrows the evaluating worker's round number. Independently, weak rival disclosure, unmeasured payment preferences, freight churn, unused lead-time slack and immediate post-discovery concessions can leave value unclaimed. These experiments separate those mechanisms without using supplier identities, benchmark prices or C_best in decisions.",
  "ideas": [
    {
      "id": "G1-1",
      "title": "Explicit concession runway instead of shared holds",
      "type": "params",
      "params": {
        "rfq_T": 6,
        "rfq_holds": 0,
        "rfq_hold": true
      },
      "hypothesis": "Keep A10's early-concession exponent, but postpone exact reference-price saturation. Removing the case-wide holds makes the runway explicit rather than dependent on another worker's timing. The existing hold email can help service a final-offer thread while its rival finishes. This should expose final-offer pushes that are currently bypassed.",
      "risk": "This does not fix cross-worker acceptance ownership or the legacy idle timeout. It may activate several aggressive inherited pushes, or produce an unproductive wait when a rival remains open. RFQ overrides leave D01's negotiation policy unchanged."
    },
    {
      "id": "G1-2",
      "title": "Do not disclose the rival at all",
      "type": "params",
      "params": {
        "rival": false
      },
      "hypothesis": "A clean ablation of competitive disclosure: withholding the expensive rival prevents the leader from calculating how far ahead it already is. Staggering, supplier-specific breakdown arguments and ordinary evidence remain unchanged. Compare with G1-9 to distinguish harmful disclosure from useful fresh competitive pressure.",
      "risk": "Also removes the powerful fresh rival citation from the second supplier's opening. The net effect may be negative even if late disclosure is harmful. Single-supplier messages have no rival argument, so D01 should be unchanged."
    },
    {
      "id": "G1-3",
      "title": "Negotiate near the supplier's actual package",
      "type": "params",
      "params": {
        "pick": "near"
      },
      "hypothesis": "Prefer fewer non-price changes instead of maximizing an estimated supplier cash value. In a one-sheet RFQ, this should reduce incoterm oscillation and make successive price concessions easier to interpret. Unlike the previously tested frontier, this changes package ranking rather than adding screening or exploration.",
      "risk": "May retain an initially unfavorable incoterm and miss valuable payment or freight trades. This is a global parameter and can change D01's packages; it is not eligible for unchanged-single-supplier deployment unless the guard passes."
    },
    {
      "id": "G1-4",
      "title": "Turn repeated volume demands into a concrete planning trade",
      "type": "params",
      "params": {
        "volume_framing": true
      },
      "hypothesis": "Replace repeated statements that we cannot buy more with the existing predictable-call-off framing and request for an exact larger-lot trade-off. The supplier may value production planning rather than genuinely require greater annual demand. All stated quantities and duration come from case data.",
      "risk": "The existing no-overtime wording is only a negotiation assertion, not evidence of the supplier's production economics. Framing may distract from price and changes D01's wording, so the single-supplier guard is mandatory."
    },
    {
      "id": "G1-5",
      "title": "Remove generic fact drips, retain direct commercial arguments",
      "type": "params",
      "params": {
        "rfq_facts": 0
      },
      "hypothesis": "Test whether generic scorecard and should-cost citations consume attention without moving the supplier. The own-breakdown argument, rival disclosure, answers and applicable forecast-answer attachment remain available. This is a zero-fact ablation, not a repeat of the already inferior two-fact configuration.",
      "risk": "Verified ordinary facts may be causal concessions even when the prose sounds dismissive. Zero facts may weaken the opening substantially. D01 retains A10's original fact budget."
    },
    {
      "id": "G1-6",
      "title": "Remove preference and conversational closing signals",
      "type": "params",
      "params": {
        "tone": "brief"
      },
      "hypothesis": "The brief template removes 'We would prefer to give the order to you' and repeated warm closing questions while retaining numeric proposals and substantive arguments. This tests whether the leader interprets our language as an award commitment before it has met the target.",
      "risk": "Less relationship-building may reduce cooperation and cost disclosure. This global setting changes D01's messages; reject it from unchanged-single-supplier rollout if the guard changes."
    },
    {
      "id": "G1-7",
      "title": "Supplier-register writer with a short latency budget",
      "type": "params",
      "params": {
        "llm_writer": true,
        "writer_timeout": 3.0
      },
      "hypothesis": "Test the existing, unmeasured-on-D02 writer for better objection handling and less repetitive closing language, while preserving engine-selected sheets, refs and attachments. A short budget limits the scheduling disturbance relative to the default writer timeout.",
      "risk": "Body quality and latency are stochastic; under-lock messages still skip rewriting. A paraphrase can also weaken an otherwise useful argument. This changes single-supplier wording and must pass the D01 guard before promotion."
    },
    {
      "id": "G1-8",
      "title": "Offer-owned acceptance with one bounded final probe",
      "type": "code",
      "flag": "owned_final_probe",
      "params": {
        "owned_final_probe": true
      },
      "files": [
        "proto/engine.py"
      ],
      "functions": [
        "Negotiator.run_rfq: legacy decide closure, localized changes only",
        "Negotiator._owned_final_probe_terms (new)",
        "Negotiator.push"
      ],
      "spec": "Add owned_final_probe: bool = False. Scope the behavior to multi-supplier cases in the legacy A10 RFQ branch; do not rewrite or enable either alternative coordinator. Under the flag, discretionary goal/hold/final decisions for the best supplier are made only by that supplier's worker, using its own rounds. Other workers continue their normal send/wait paths; cap-driven emergency closing remains global. Before the goal-accept branch, allow exactly one probe per supplier when its current best sheet is its primary, status is final_offer, C exceeds the finite current target, and a different non-busy live supplier has a valid primary below both c_open and c_alt. Neither thread may be closed, uncertain or have an ambiguous pending request. Require at least two remaining message slots for the probed thread, sufficient local turn reserve using observed latency, and wave reserve of at least max(90, 2*slowest+20) when a deadline exists. Skip an explicit withdrawal threat tied to further counters. Compute probe_C = current_C - min(0.01*current_C, 0.25*(current_C-target_C)); solve price on exactly the primary's existing terms, validate and round conservatively, and require a strict C reduction. Reserve the one-shot state under the existing case lock and pass the selected terms to push through a thread-local pending-probe field; push uses those terms only for this reserved action, otherwise retaining its existing implementation. Reuse the existing push dispatch, with no new wait window or network read inside decide. After a refused or repeated final offer, do not invoke additional legacy pushes under this flag: make a fresh best-valid-offer closing decision. An open reply resumes ordinary negotiation; an agreed reply is not pushed again. Log owner rounds, bypassed next_goal, fallback cost, probe cost and outcome.",
      "hypothesis": "Directly removes the two acceptance-order defects: another worker cannot close the leader through its own saturated curve, and a final offer cannot bypass the one permitted last ask merely because the goal has caught up.",
      "risk": "A genuinely final supplier can withdraw, and the fallback can be materially worse. The small probe limits the request, not the loss if it is rejected. Existing push dispatch still holds the legacy case lock during its HTTP call."
    },
    {
      "id": "G1-9",
      "title": "Fresh, favorable rival disclosure with an honest normalized bar",
      "type": "code",
      "flag": "selective_rival_bar",
      "params": {
        "selective_rival_bar": true
      },
      "files": [
        "proto/engine.py"
      ],
      "functions": [
        "Negotiator._selective_rival_context (new)",
        "Negotiator.write"
      ],
      "spec": "Add selective_rival_bar: bool = False. Only alter the rival stanza in RFQ messages; leave facts, ordinary attachments, numerical sheets and the practice fact builder unchanged. Resolve the supplied rival tuple by exact ID and terms against another thread's latest sheets, not ID syntax. Require that thread to be live, non-busy and not uncertain. Cite only if the rival's evaluated C is strictly below the recipient's cheapest current must-have-valid sheet, or if the recipient has no valid sheet. Suppress the rival stanza, its ref and competing-offer attachment when it is worse, stale, or already cited in a buyer event in this recipient's thread. There is no case-wide citation ledger. A latest alternative sheet may be cited, but label it 'quoted alternative requiring confirmation', never an executable standing primary. Attach the actual quoted terms unchanged. For a qualifying citation, use price_for_c with the recipient's proposed non-price terms and its own standard terms to compute the price matching the rival's C. If that normalization is feasible and finite, state it as our evaluated break-even price on this package, explicitly not the rival's quoted unit price. Omit the unconditional preference-for-you sentence. Preserve useful numerical evidence elsewhere. Test that a fresh cheaper rival is cited at opening, a worse rival is suppressed, and the same ref remains usable once for each different recipient.",
      "hypothesis": "Preserves competitive pressure on the laggard and the useful opening citation, but stops informing the leader that it can comfortably refuse. The normalized bar makes EXW/FCA/DAP and payment comparisons economically meaningful without misquoting the competitor.",
      "risk": "Even a worse verified rival citation may trigger a concession in some suppliers. Suppression could lose that effect. Normalization must use the recipient's cost context, including its standard quality terms, rather than compare nominal prices."
    },
    {
      "id": "G1-10",
      "title": "One sequential equal-cost payment experiment",
      "type": "code",
      "flag": "payment_trade_probe",
      "params": {
        "payment_trade_probe": true
      },
      "files": [
        "proto/engine.py"
      ],
      "functions": [
        "Negotiator._payment_trade_package (new)",
        "Negotiator.meso"
      ],
      "spec": "Add payment_trade_probe: bool = False. This is package-task alternative A, mutually exclusive with G1-11 and G1-12 in this generation. Activate only in non-relationship RFQs, with payment_days negotiable, one ordinary selected sheet, at least one completed priced buyer exchange, supplier status open, and at least two message slots reserved after the proposed send. Do not replace conditional repairs, frozen-price packages, recalls or an explicitly required payment term. Once per supplier, replace the normal sheet with a package differing only in payment_days and unit_price: enumerate allowed payment values longer than the normal sheet's, solve each to the normal sheet's actual C, enforce all existing must-have, fixed-term, coverage and standing-price-cap guards, and choose the longest feasible payment value. Round price down if necessary so the buyer's C does not increase. Determine whether the experiment has actually been sent from buyer events, rather than treating meso evaluation as dispatch. Do not send a second package or a discovery-only message. If the supplier rejects the change or keeps the original payment term, stop probing. If it returns the proposed longer payment term in a valid offer whose C does not worsen its preceding valid offer, retain that evidenced payment value in subsequent ordinary equal-C candidates when feasible; an explicit subsequent requirement or infeasibility releases it. Log the proposed and returned payment, price and C. Never assume an estimated cash rate proves willingness to trade.",
      "hypothesis": "A10 always ranks short payment highly using a prior cash rate. A single equal-C experiment can reveal whether longer payment actually buys more value, without repeating the failed multi-package MESO approach.",
      "risk": "Longer payment may provoke a large price increase or consume a valuable price-concession round. Equal proposed C is not evidence that the supplier will quote equal realized C."
    },
    {
      "id": "G1-11",
      "title": "Spend free lead-time slack rather than request unnecessary speed",
      "type": "code",
      "flag": "free_lead_slack",
      "params": {
        "free_lead_slack": true
      },
      "files": [
        "proto/engine.py"
      ],
      "functions": [
        "Negotiator._free_lead_package (new)",
        "Negotiator.meso"
      ],
      "spec": "Add free_lead_slack: bool = False. This is package-task alternative B, mutually exclusive with G1-10 and G1-12 in this generation. Apply only to ordinary RFQ package selection, not conditional repairs, frozen-price responses or mirrored offers. Require negotiable lead_time_days and a documented buyer need date/lead limit. Starting from the selected one-sheet package, enumerate allowed longer lead times no later than the buyer's need and satisfying must-haves and any supplier requirement. Keep every other field, including price, unchanged. Select the longest candidate whose published C is no greater than the original and whose supplier_value is no lower; use monetary rounding tolerance only. If no candidate qualifies, return the original package. Do not promise that this eliminates overtime or quantify supplier savings absent evidence. The attached sheet itself offers the planning flexibility in exchange for the existing requested price. Log original and selected lead, C and the supplier text supporting any stated scheduling preference.",
      "hypothesis": "Lead time is absent from supplier_value, so A10 can choose the first, faster equal-value option arbitrarily. Offering the full zero-cost scheduling allowance may obtain a lower counterprice without conceding buyer economics.",
      "risk": "The supplier may attach no value to the extra time. Later delivery also reduces practical flexibility that the published cost function may not value, so case must-haves and the stated need remain hard guards."
    },
    {
      "id": "G1-12",
      "title": "Keep freight concessions once the supplier has offered them",
      "type": "code",
      "flag": "retain_freight_concession",
      "params": {
        "retain_freight_concession": true
      },
      "files": [
        "proto/engine.py"
      ],
      "functions": [
        "Negotiator._earned_freight_options (new)",
        "Negotiator.meso"
      ],
      "spec": "Add retain_freight_concession: bool = False. This is package-task alternative C, mutually exclusive with G1-10 and G1-11 in this generation. Only affect ordinary RFQ MESO ranking. From this supplier's actual received, must-have-valid sheets, identify the lowest buyer freight charge it has offered, using buyer.freight_eur_per_unit and completed terms. If the normal selected package would increase that freight charge, first choose among already generated equal-C candidates whose incoterm has no greater buyer freight charge than the earned level. Preserve existing ranking inside this subset, and retain all original price caps, required terms, coverage and must-have checks. If no such candidate is feasible, use the unchanged baseline result and log why; do not force an invalid package. An explicit current supplier incoterm requirement takes precedence. Do not change payment or lead policy, reclassify an archived quote as standing, or accept an old offer. This is a constraint on our next request, not a claim that past terms remain executable.",
      "hypothesis": "Prevents the buyer from volunteering away delivered terms merely because a supplier-value tie favors buyer-paid freight. It tests freight-specific persistence, unlike pick='near', which preserves all initially quoted levers and may never obtain the freight concession.",
      "risk": "An earlier delivered offer may have been expensive precisely because of transport. Persisting with it can block a genuinely better ex-works deal or trigger a firm refusal."
    },
    {
      "id": "G1-13",
      "title": "Rebase the concession path once strong cost evidence arrives",
      "type": "code",
      "flag": "evidence_concession_rebase",
      "params": {
        "evidence_concession_rebase": true
      },
      "files": [
        "proto/engine.py"
      ],
      "functions": [
        "Negotiator._evidence_rebase_state (new)",
        "Negotiator.goal"
      ],
      "spec": "Add evidence_concession_rebase: bool = False. RFQ-only; do not alter estimates or target(). Remember the weak-evidence target seen before each supplier's first priced proposal. Permit one rebase only after that supplier supplies its own parseable cost breakdown, or supplier-specific should-cost evidence already classified usable, and the current finite target is lower than that remembered target. Material-share inference from another supplier is insufficient. Locate the last actual buyer sheet before the qualifying evidence and evaluate its C. Set the rebased start to max(current target_c, that prior ask C), but never above the unmodified current goal; do not apply another negative anchor. Set the epoch from the thread's actual rounds at the evidence transition, not from the rnd argument, because goal is called for both the current and hypothetical next round. Subsequent calls use the existing exponent and a horizon bounded by cfg.T and the remaining ordinary message budget after closing reserves. Both actual and look-ahead goals use the same cached epoch. Repeated calls, the same attachment, resyncs and material-share updates must not reset it again. Preserve all cap, max_rounds and final-offer decisions elsewhere. Log old target, new target, evidence kind, prior ask C, ordinary goal and rebased goal.",
      "hypothesis": "When discovery lowers the target, A10 immediately concedes upward from the first ask anyway. One evidence-triggered rebase gives the newly justified price a real negotiation round instead of surrendering the discovery gain immediately.",
      "risk": "Direct cost is not the supplier's full reservation price. A firmer post-discovery request may be interpreted as moving backwards and can harden a supplier. It also delays curve saturation without independently fixing legacy final-offer waiting."
    },
    {
      "id": "G1-14",
      "title": "Attach a proposed-cost bridge, not an asserted profit margin",
      "type": "code",
      "flag": "cost_residual_bridge",
      "params": {
        "cost_residual_bridge": true
      },
      "files": [
        "proto/engine.py"
      ],
      "functions": [
        "Negotiator._cost_residual_message (new)",
        "Negotiator.send"
      ],
      "spec": "Add cost_residual_bridge: bool = False. In send, invoke a pure message-transform helper before optional styling, only for RFQs and ordinary priced counters to an open supplier. Skip actions, closing confirmations, pending ambiguous operations and suppliers without their own parseable breakdown in a supplier-origin attachment. On the first such counter after receiving the breakdown, attach one plain-label markdown table containing the supplied material/labour/conversion entries, their direct-cost sum, the actual proposed unit price and the arithmetic difference. Label that difference 'residual available for unitemized overhead, profit and term-related costs', never verified profit or a proven sustainable margin. If negative, show it honestly and state that this does not establish feasibility. Include payment, incoterm, lead and volume/duration from closing_terms for the actual outgoing sheet, not hard-coded terms. Ask which omitted cost item or allowed contractual trade would bridge the gap. Replace only the known template clause asserting that the proposed price leaves a positive margin with neutral residual wording; retain the sourced breakdown numbers and unrelated arguments. Do not add the existing arbitrary overhead percentage or a 'fair price' floor. Use no rival's breakdown, no new checked-fact IDs and no extra message. Determine prior dispatch from buyer events and prevent duplicate attachment attempts after ambiguous delivery. Keep the flag-off and single-supplier send paths unchanged.",
      "hypothesis": "The supplier explicitly disputes the leap from direct cost to profit. An auditable bridge tied to the actual proposal keeps the strong own-cost argument while removing an unsupported margin claim and inviting a priced countertrade.",
      "risk": "The document may be ignored or encourage the supplier to defend overhead more strongly. Detailed arithmetic can become a counter-anchor; therefore the helper must not invent an overhead allowance or represent direct cost as a binding acceptance floor."
    }
  ],
  "notes": "Apply each idea independently on top of VARIANTS['A10'][1], not cumulatively. All parameter names and types above exist in the supplied Config. Each code flag is one new bool defaulting to false, has no rfq_ prefix, and must be a no-op for single-supplier cases. Shared Config field additions are mechanical; behavioral edits are disjoint except G1-10/G1-11/G1-12, explicitly mutually exclusive variants of one package-selection coder task. Do not combine those three flags in this generation. No code policy may branch on supplier/case identities, benchmark prices or C_best; IDs are used only to resolve observed documents, offers and per-thread history. Run every candidate D02 x2-3 and D01 x1 through the generic PracticeNegotiator path, with interleaved A10 controls where possible. G1-3/G1-4/G1-6/G1-7 are deliberately global parameter experiments: report any D01 change rather than claiming RFQ isolation; a winner that changes D01 requires a separately tested RFQ-only port before unchanged-single-supplier deployment. Record score distribution and deal rate, but also actual push count, acceptance reason, worker versus winner rounds, post-breakdown first-counter C, rival citation usefulness/duplicates, and price/payment/freight/lead components. An untriggered flag is inconclusive, not a failed economic hypothesis. Prioritize inspection of G1-8 and G1-9 traces, while testing all ideas. Do not spend hosted-practice quota until the sandbox winners and their combinations have been selected."
}
```