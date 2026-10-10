A10’s main problem is lost deals, not insufficient aggression: recovering P05 and P08 at A9 levels alone adds about **0.125 to the ten-case mean**.
The RFQ loop can mistake a recoverable acceptance failure for a terminal result, while network calls under its shared lock prevent other threads from responding.
Receipt timestamps, stale primary IDs, unchecked alternative promotion, and SQL-only citations compound that risk.
Keep the measured winners: staggered RFQs, e=2, target-based anchors, two packages/one in RFQs, and cheapest compatible insisted clauses.
Do not broaden aggression globally. Improve first asks only after resolving whether better cost evidence is available.
Clause exploration should relax package selection narrowly—not remove price caps, index risk, or must-have checks.
The eight tasks below have disjoint function ownership. T8 alone owns Config declarations and variant registration.
Implement against the specified helper contracts, then validate robustness before spending hosted quota on calibration.

```json
{
  "assessment": "Prioritize eliminating avoidable zeros, then recover excluded clause packages and improve evidence-conditioned first asks. Recovering P05 and P08 at A9 scores would add approximately 0.125 to the ten-case mean; that is an arithmetic opportunity, not a forecast. Do not optimize against best-per-case historical scores. Evaluate a complete A11 run, with repeated RFQ and withdrawal-prone cases, and count crashes, missing results, and unresolved sessions as failures. All decision rules must use case features, supplier messages, allowed terms, data provenance, and live session state—not identifiers or known winning prices.",
  "tasks": [
    {
      "id": "T1",
      "title": "Make RFQ coordination recoverable and remove network operations from the shared lock",
      "priority": 1,
      "expected_gain": "Largest robustness opportunity: recover live RFQs instead of manufacturing a zero after failed accepts; reduce timeouts caused by blocked workers.",
      "risk": "Medium: concurrency changes require deterministic race tests. Preserve staggered opening and existing economic settings.",
      "files": [
        "proto/engine.py",
        "proto/test_a11_rfq.py"
      ],
      "functions": [
        "Negotiator.run_rfq"
      ],
      "spec": "Gate the replacement coordinator behind Config.resilient_rfq, default False; leave the legacy branch unchanged. Own all nested functions in run_rfq. Adopt T2's close/closing_move contract: a terminal arena result ends the case; None means recoverable and workers must continue. Never set done to a fabricated no-deal result while session status is live. Under the shared lock, select and reserve an action, recording supplier, event revision, and in_flight; release the lock before send, push, close, walk, resync, or session HTTP calls. Reconcile results under the lock. Only one operation may be scheduled for a supplier, and only one session-closing attempt may be outstanding, but other suppliers must remain serviceable during that attempt. Do not accept or push a thread whose send is in flight. After failed acceptance, refresh other non-busy live threads and resume their workers; use the refreshed primary, exact-term reconfirmation through close, or a normal counter rather than exiting. Do not retry the same rejected ID without new state. Use T3 turn_remaining(t), not receipt age, for scheduling. Preserve lead-first stagger, but release waiting suppliers at the earlier of the existing 40-second limit and their estimated 15 seconds of remaining turn budget. Do not pause the lead if its own budget is urgent. Remove the 90-second resting-final assumption: an acceptable agreed primary closes immediately; a final closes unless the existing push policy has a distinct, fresh, non-busy, must-have-valid primary backup costing no more than both the opening baseline and the outside alternative. Permit that push only with at least 30 seconds of turn budget and adequate wave reserve. An alternative sheet is never a standing backup or a standing rival quote. Eliminate indefinite wait paths: when packages are unavailable or rounds exhausted, choose a valid close, useful outside alternative, or must-have-restoring counter; if no legal action exists, refresh and obtain the actual session outcome. Use timed waits of up to two seconds, not spinning. Call T7.calibration_probe(t) before the first priced proposal; probe sends count against the arena message limit but not the concession-round index. Refresh estimates after newly received cost evidence, including probe replies; serialize estimate publication, without holding the coordinator lock across document HTTP reads. Propagate terminal results returned by ordinary send calls. On confirmed terminal outcome, signal workers to stop and cancel queued work; do not delay returning the result solely to join unrelated outstanding HTTP calls.",
      "test": "Use a fake client and fake clock to reproduce two rejected accepts followed by a live third supplier; assert a deal or continued negotiation, never a fabricated terminal result. Block one supplier for 120 simulated seconds and assert other threads dispatch within their turn budgets. Test agreed, final, no_bid, in-flight offer replacement, and terminal results returned from send. Run generic D02 A10 versus A11 at least four times before hosted P05; repeat P05 if quota permits."
    },
    {
      "id": "T2",
      "title": "Make closing transactional, primary-only, and recoverable",
      "priority": 1,
      "expected_gain": "Prevents stale-ID failures and unchecked alternative promotion from becoming zeros in both single-supplier and RFQ cases.",
      "risk": "Low to medium: recovery must remain bounded and must not silently accept changed economics.",
      "files": [
        "proto/engine.py",
        "proto/test_a11_close.py"
      ],
      "functions": [
        "Negotiator.close",
        "Negotiator.walk",
        "Negotiator.closing_move",
        "play",
        "Negotiator.terminal_result (new)"
      ],
      "spec": "Gate new behavior behind Config.safe_close, default False. Define terminal_result(response) to extract only an actual arena terminal result, otherwise return None. close(t, sheet) and closing_move() return that result or None for recoverable live-session failure; never call walk merely because an alternative-confirmation send failed. Use T3's per-thread reentrant I/O lock and event revision. Before accepting, establish that the ID belongs to the latest primary and that its terms are allowed, satisfy must-haves, and beat the valid outside alternative. Refresh when the supplied revision/ID is stale or the turn is uncertain; do not add a mandatory fetch to every fresh acceptance. After a 409/422 or ambiguous acceptance response, check actual session status first, then resync the thread. Permit one acceptance of a newly observed valid primary ID; never hammer an unchanged rejected ID. If the thread remains live but still lacks an acceptable standing ID, re-propose its last valid terms exactly once per observed revision, without a price push, if sufficient time remains for confirmation and acceptance. A supplier alternative must be proposed first; accept it as that alternative only after an agreed reply whose primary terms match the proposal. If the reply changes terms or remains open, return control for a new economic decision instead of blindly accepting it. Near the wave cap prefer a safe primary when there is insufficient reserve for alternative promotion. Keep all must-have and price/option validation checks at the final acceptance boundary. walk must first return an already-ended session's real result; ordinary recovery must not walk while a superior valid live offer is still actionable. In play's exception path, first retrieve the session result, then perform one bounded refresh-and-close recovery sweep before considering the outside alternative. Do not write a session as closed merely because an exception was caught; log terminal confirmation or an explicit unresolved cleanup failure. Never invent an arena score.",
      "test": "Fake-client tests: stale primary becomes a fresh primary; stale primary becomes walked_away while another thread stays live; an accept succeeds but its HTTP response is lost; alternative confirmation returns different terms; alternative confirmation returns open; must-have violation appears during refresh. Assert only primary IDs are accepted, changed terms are re-evaluated, retry counts are bounded, and no live-session error creates a synthetic zero."
    },
    {
      "id": "T3",
      "title": "Track arena-clock freshness and preserve authoritative thread state",
      "priority": 1,
      "expected_gain": "Reduces load-dependent timeout zeros and prevents transient read failures or late responses from destroying recoverable offers.",
      "risk": "Medium: timestamp interpretation must follow the actual response schema. Missing timestamps require conservative behavior, not a guessed fresh clock.",
      "files": [
        "proto/engine.py",
        "proto/test_a11_clock.py"
      ],
      "functions": [
        "Thread.__init__",
        "Negotiator.__init__",
        "Negotiator.send",
        "Negotiator.resync",
        "Negotiator._docs",
        "Negotiator.near_cap",
        "Negotiator.turn_remaining (new)",
        "Negotiator.apply_thread_update (new)"
      ],
      "spec": "Gate active behavior behind Config.arena_clock_guard, default False. Add per-thread reentrant I/O lock, event revision, immutable opening terms, supplier-event timestamp, timestamp-confidence marker, and request-start time. Keep replied_at for legacy behavior. Inspect the actual API schema and parse documented event timestamps, including their timezone/unit; do not invent field names. turn_remaining(t) returns the conservative time remaining to the 60-second arena deadline. When a reply lacks a usable timestamp, use request start as a conservative lower bound, mark freshness uncertain, and prioritize refresh/closing rather than granting another 60 seconds from receipt. Refreshing identical events must not restart the clock. apply_thread_update must reject older responses using authoritative event ordering/IDs where available and protect against a late HTTP response overwriting newer resynced state. resync must not append walked_away on a transient HTTP error; retain the last known state and mark it uncertain. Only confirmed terminal/closed state closes a thread. In send, run T4.prepare_message(t, msg) immediately before dispatch, under its claim reservation mechanism; action-only requests bypass claim preparation. Record timing and apply the reply before optional document downloads. Do not fetch nonessential attachments before acting on agreed/final replies or when fewer than 25 estimated turn seconds remain; retain metadata for later parsing. Preserve the existing same-move retry/idempotency behavior rather than issuing duplicate POSTs after HTTP stalls. Surface terminal responses and ambiguous transport failures distinctly to callers. Under this flag, establish a local 480-second deadline before open_session when none was supplied; never extend a supplied wave deadline. near_cap uses at least 150 seconds or slowest exchange plus 25 seconds, whichever is greater, and at least two observed exchange allowances plus 25 seconds when alternative promotion is required. Validate the outside alternative's must-haves before treating it as a safe fallback. Provide opening-term snapshots to T7 so refreshed offers are never mistaken for opening prices. Log arena age, timestamp confidence, operation duration, state revision, and deferred attachments. All legacy variants retain their old timing/state behavior when the flag is off.",
      "test": "Inject a response received now whose supplier event is 75 seconds old; assert it is urgent, not fresh. Test missing timestamps, repeated resync of the same event, transient 503, out-of-order replies, and a slow attachment on an agreed offer. Assert no clock reset on refresh, no fabricated withdrawal, and deadline preservation. Exercise a simulated eight-minute wave with ten concurrent cases and delayed responses."
    },
    {
      "id": "T4",
      "title": "Enforce citation provenance and a session-wide claim budget",
      "priority": 1,
      "expected_gain": "Removes the demonstrated trust penalty from SQL-only forecast IDs and reduces duplicate or over-budget claims across RFQ threads.",
      "risk": "Low if unsupported claims are omitted rather than rewritten as uncited assertions. Some messages will contain less evidence.",
      "files": [
        "proto/engine.py",
        "proto/practice.py",
        "proto/test_a11_claims.py"
      ],
      "functions": [
        "Negotiator.write",
        "Negotiator.our_calculation",
        "Negotiator.prepare_message (new)",
        "PracticeNegotiator.facts_for",
        "PracticeNegotiator.write",
        "PracticeNegotiator.claim_source (new)"
      ],
      "spec": "Gate all changes behind Config.safe_claims, default False. Own both message writers and their fact construction so no later subclass append bypasses validation. Implement prepare_message(t, msg), called by T3.send, which finalizes claim blocks, atomically reserves IDs in a session-wide ledger, strips internal metadata, and returns a valid wire message. Build the authoritative whitelist from facts.json through the package's actual facts interface or file schema—not SQL existence. Permit explicit case refs and observed current-session offer IDs, but case-only refs without canonical figures support only statements justified by the case itself. Numeric claims must match canonical values or reproducible arithmetic over valid inputs, with units and date windows checked. If SQL and canonical facts disagree, omit the claim. A forecast ID found only in forecasts must never enter body, refs, or attachments; answer volume questions from the case requirement and proposed commitment instead. Count distinct evidence IDs across body, refs, and decoded attachments, with a maximum of three per message and one new use per case across all suppliers. Keep the original fact order; do not enable objection-based sorting. Treat multi-ID facts atomically: if both index endpoints or all required sources cannot fit, defer the entire claim. Reserve at dispatch, not while composing; conservatively retain reservations after ambiguous delivery until history proves the message was not sent. Prevent concurrent RFQ writers from spending the same ID. Repeated rival IDs must not be re-cited; use only a current primary as a standing rival offer, and label historical evidence as historical. Do not launder unsupported statements by deleting their IDs. Proof attachments retain plain labels but include only supported values and no recycled raw IDs. Suppress an index argument already explicitly rejected as inapplicable to the supplier's fixed-price coverage; do not otherwise reorder evidence. Replace unconditional 24-month, 14-day, foundry, and no-overtime assertions with case/proposal-derived wording or omit them. Treat the calculation's overhead/margin percentage as our explicit negotiating assumption, not a verified supplier cost. Only state a binding volume/term common to the actual packages or describe the packages separately.",
      "test": "Offline, construct every practice case's outgoing messages, including subclass additions and decoded attachments. Assert every citation is authorized, figures have provenance, the union contains at most three new IDs, and no ID is spent twice across concurrent threads. Explicitly test a SQL forecast absent from facts.json, a two-ID index claim plus a rival, repeated rival quotes, and wrong-unit order prices. Run D01/D02 to check that preserving fact order avoids the measured objection-map regression; inspect P05 hosted claim_results for zero contradicted/duplicate claims."
    },
    {
      "id": "T5",
      "title": "Remove unbacked single-supplier holds and integrate recoverable closing",
      "priority": 2,
      "expected_gain": "Directly addresses the P08 withdrawal path; recovery to roughly A9 performance would add about 0.059 to the ten-case mean.",
      "risk": "Low: may give up a small final concession in exchange for preserving a positive deal.",
      "files": [
        "proto/engine.py",
        "proto/test_a11_single.py"
      ],
      "functions": [
        "Negotiator.run"
      ],
      "spec": "Gate the new single-supplier branch behind Config.safe_single, default False. Preserve e, T, package count, target-based anchoring, and the prohibition on unbacked final-offer pushes. Define a useful outside alternative as an actual must-have-valid alternative with finite cost below the opening baseline; mere existence of an expensive fallback is not backing. When no useful alternative exists, do not enter the unchanged-goal hold branch: if the offer satisfies the existing next-goal acceptance condition, close it immediately. Do not replace the removed hold with a new pressure message. If a proposed counter exactly repeats the previous buyer package and a valid acceptable primary is available, close rather than repeating it. Continue the existing curve where no acceptance condition applies; this is not blanket early acceptance. Integrate T2's None-on-recoverable-close contract: refresh/re-evaluate and continue with the remaining message/time budget rather than returning None or walking automatically. Propagate terminal results from ordinary sends. If every thread has ended, retrieve the actual session result instead of sending walk_away to a dead thread. Call T7.calibration_probe(t) before the first priced proposal; count it against the arena message limit but retain priced round zero for the first numerical ask. Re-estimate immediately after the probe reply before constructing that ask. Use T3's wave/turn guards and reserve acceptance capacity; must-have repair remains available when there is no valid offer. Track total sends across recovery so re-entering the loop cannot reset the arena round budget.",
      "test": "Replay the P08-shaped sequence with a meaningful concession at the existing acceptance threshold and an outside alternative dearer than opening; assert close occurs and no fourth unchanged-goal counter is sent. Test a genuine useful alternative, no valid primary, and a recoverable close failure. Hosted priority: P08 twice, then P10 once to verify secure-supply behavior and no final-offer push."
    },
    {
      "id": "T6",
      "title": "Reserve a bounded clause-exploration package in narrow or uncertain relationship cases",
      "priority": 2,
      "expected_gain": "Targets the excluded copper-clause path and improves raw-material package coverage without increasing the number of sheets.",
      "risk": "Medium: relationship-cost estimates are uncertain, but removing their penalty globally would be unsafe. Exploration must have a bounded regret envelope.",
      "files": [
        "proto/engine.py",
        "proto/test_a11_clauses.py"
      ],
      "functions": [
        "Negotiator.meso",
        "Negotiator.clause_candidate (new)"
      ],
      "spec": "Gate behavior behind Config.clause_explore, default False. Preserve the never-above-supplier-price cap, allowed options, must-haves, lead-time cap, full-coverage preference, and existing insisted-term handling. Do not globally widen MESO tolerance. Trigger only when index_clause is negotiable, a compatible clause family has been offered or explicitly requested by the supplier, and either estimated room/opening cost is at most 4 percent or the relationship estimate lacks supplier-specific cost evidence. Never invent a series or material share. After normal selection, reserve at most the second existing slot for one compatible clause candidate if normal picks contain none. If a clause is already required, keep it in every package; do not add a no-clause escape package. Evaluate all allowed options within the compatible family using actual index paths and index risk, retaining the cheapest compatible option rather than assuming the widest deadband is always cheapest on a falling path. Generate candidates both with the normal price solver and, only for weak relationship estimates, with a cash-cost solver that omits relationship cost for candidate generation while retaining freight, payment, coverage, quality, index movement, and index risk. Re-score every candidate under the nominal estimate and a sensitivity estimate with full_cost and floor reduced by 3 percent; the sensitivity case is an uncertainty test, not a replacement objective. Require price no greater than the current primary, valid/full-coverage terms, and cash cost below the current primary. Prefer candidates whose nominal C is below the current primary even if outside the strict equal-C band. Permit a weak-estimate exception only if nominal C exceeds the current primary by no more than min(0.25 times estimated room, 0.005 times opening C), the lower-cost sensitivity estimate improves on that same primary, and no must-have or outside-alternative guard is violated. If estimated room is zero, allow no nominal-regret exception. This is a bounded exploratory proposal, not authority to accept under the sensitivity estimate. Keep one normal low-cost package alongside it; do not increase meso_n or replace the sole RFQ sheet with this experiment. Log selection/exclusion reasons and both cost estimates. Under safe_claims wording, do not describe unequal-cost exploration packages as exactly equal cost.",
      "test": "Offline P02 package audit: show whether a compatible clause candidate is retained and print its price cap, cash C, nominal C, sensitivity C, and exclusion reason. Synthetic tests cover narrow rooms, positive and negative index paths, strong versus weak cost evidence, and all required-term/must-have guards. Verify P08/P18 still carry the cheapest compatible insisted clause in every package. Hosted: P02 first; compare against A10 without using any historical winning price in the implementation."
    },
    {
      "id": "T7",
      "title": "Calibrate first priced asks only after resolving cost-evidence uncertainty",
      "priority": 3,
      "expected_gain": "Potential improvement in weak-floor leverage cases and less over-anchoring in demonstrably narrow rooms; lower confidence than the robustness tasks.",
      "risk": "Medium: a discovery exchange consumes time, and room expansion is unproven. Require ablations before retaining it in the final deployment.",
      "files": [
        "proto/engine.py",
        "proto/practice.py",
        "proto/test_a11_calibration.py"
      ],
      "functions": [
        "Negotiator._estimate",
        "PracticeNegotiator._estimate",
        "Negotiator.goal",
        "Negotiator.calibration_probe (new)"
      ],
      "spec": "Add Config.calibrated_anchor and Config.anchor_probe, both default False. Keep all legacy calculations unchanged when disabled. Under calibrated_anchor, attach explicit source_kind, confidence, and evidence_resolved metadata to estimates: own numerical breakdown and supplier-specific should-cost are stronger than another supplier's should-cost, inferred material share, current-price drift, or opening-price priors. Use T3's immutable opening snapshot for opening-based caps; never silently relabel the latest negotiated quote as opening. If a numerical source conflicts materially with an observed quote, log the conflict and lower confidence rather than presenting a capped source as certain. calibration_probe(t) returns a no-sheet, no-evidence-ID request or None. It may fire once, only before the first priced ask in a leverage case whose relevant estimate is weak and lacks a usable breakdown, with at least three message slots and max(180 seconds, twice the slowest exchange plus 60 seconds) of wave time remaining. Ask for the material/labour/conversion split and any binding condition needed to price the allowed terms; do not reveal a numerical anchor. The callers reserve probe state at dispatch. A reply, explicit refusal, or unavailable-data response resolves that thread's discovery; do not loop on requests. After discovery, if useful breakdown/should-cost evidence exists, use the normal evidence-based target with no room boost. Only when discovery has completed for all live relevant threads, no breakdown request is pending, and the target remains weak-prior-based may leverage target room expand by 15 percent: start_new = opening_C - 1.15 * (opening_C - existing_target_based_start). Cap the added reduction at 3 percent of opening C, never change secure_supply or stabilise this way, and apply the calibrated start once before that thread's first priced proposal rather than progressively lowering an established anchor. If the helper cannot safely probe, retain A10's anchor rather than applying the boost early. This explicitly differs from the failed x1.3 experiment: it waits for the evidence that previously arrived after the boost and uses a smaller, bounded adjustment. Separately, when supplier-specific evidence implies room at most 4 percent, suppress the generic ROOM_PRIOR override and limit the percentage-anchor addition to 25 percent of that estimated room. Do not infer a narrow room from goal/type alone, and do not boost routine or quality targets merely because their observed score was around 0.71. Log first priced ask, source confidence, probe outcome, target room, and every clamp.",
      "test": "D02 fixture: a breakdown arriving after discovery must prevent any weak-room boost before the first priced proposal. Test explicit no-data replies, partially completed RFQ discovery, insufficient wave time, conflicting should-cost data, and narrow-room strong evidence. Run all 19 offline cases to inspect first asks. Sandbox A11 with these two flags off versus on, especially D02 with at least four repeats. Hosted calibration priorities: P18, P07, P11, and P04 as a narrow-room control; retain expansion only if the aggregate paired evidence improves without new withdrawals."
    },
    {
      "id": "T8",
      "title": "Own Config integration, register A11, and enforce the release gate",
      "priority": 1,
      "expected_gain": "Prevents parallel-edit conflicts and deployment of untested interactions; makes gains measurable rather than inferred from cherry-picked best runs.",
      "risk": "Low. The main risk is spending hosted quota before deterministic failures are eliminated.",
      "files": [
        "proto/engine.py",
        "proto/variants.py",
        "proto/test_a11_integration.py"
      ],
      "functions": [
        "Config (new field declarations only)",
        "proto.variants.VARIANTS (A11 registration only)",
        "new integration tests in proto/test_a11_integration.py"
      ],
      "spec": "Be the sole editor of Config declarations and the A11 variant entry. Add default-False fields resilient_rfq, safe_close, arena_clock_guard, safe_claims, safe_single, clause_explore, calibrated_anchor, and anchor_probe. Do not name new flags with the rfq_ prefix: Negotiator.__init__ currently interprets most such names as stripped overrides. Register A11 using replace(VARIANTS['A10'][1], ...) with exactly the flags in the variant object below. Do not modify A10 or enable objection_map, lev_room_boost, opening-percentage anchors, more sheets, or single-supplier final pushes. Publish the cross-task contracts before coding: close/closing_move return terminal result or None; terminal_result extracts real terminal results; turn_remaining supplies conservative turn budget; prepare_message finalizes/reserves claims at dispatch; calibration_probe returns an optional discovery message; thread revision and opening snapshots are supplied by T3. Each task owns its listed existing functions and its own new helpers/tests; callers integrate these contracts without editing another task's functions. First run syntax/import tests and default-off regression fixtures, then proto/smoke.py across all 19 practice files, then generic sandbox D01/D02. Default-off tests should compare legacy decisions and wire messages, allowing only extra disabled Config keys in logs. Test the combined A11 with simulated stale accepts, delayed replies, terminal send responses, malformed claims, and wave deadlines before any hosted sessions. Hosted order: robustness checks on P05 and P08; clause check on P02; then one complete run of the ten measured cases, with extra repeats allocated to P05/P08 and any regressions. Report arithmetic mean over all attempts, deal rate, zero rate, contradicted/duplicate claims, actual terminal-result coverage, maximum observed turn age, and elapsed time. Use temporary replace-based ablations rather than adding many permanent variants. Treat A11 below as the candidate configuration: if the calibration or clause flags fail their gates, revise the A11 entry and document the rollback before final deployment rather than shipping a known regression.",
      "test": "Run all task unit tests together, the 19-case smoke path, D01 once or twice and D02 at least four times per meaningful comparison. Verify every new flag defaults off, A11 inherits all unchanged A10 settings, and no production decision contains case/supplier IDs or practice winning prices. Release only after the combined fault-injection suite has no fabricated terminal results, invalid acceptances, duplicate in-flight actions, or unsupported citations."
    }
  ],
  "variant": {
    "name": "A11",
    "base": "A10",
    "flags": {
      "resilient_rfq": true,
      "safe_close": true,
      "arena_clock_guard": true,
      "safe_claims": true,
      "safe_single": true,
      "clause_explore": true,
      "calibrated_anchor": true,
      "anchor_probe": true
    }
  },
  "not_doing": [
    "Slow Boulware or reciprocal concession curves: both were measured worse. Retain e=2 and the existing concession curve.",
    "Simultaneous RFQ opening: measured worse. Preserve staggered opening, shortening its wait only when arena-clock safety requires it.",
    "Opening-percentage anchors: measured worse because deals land near the first ask. Retain target-based anchoring.",
    "The existing unconditional weak-floor leverage boost: x1.3 failed before breakdowns arrived. The proposed experiment requires completed discovery, uses x1.15, and bounds the incremental reduction.",
    "Objection-based fact ordering: measured worse on D01. Preserve order; omit only unsupported or explicitly inapplicable claims.",
    "Removing the supplier-price cap, weakening must-haves, or ignoring index risk: these can create zeros or false savings.",
    "Single-supplier pushes after final offers, or unchanged-goal holds without a useful alternative: demonstrated withdrawal risk outweighs the small extra concession.",
    "Three term sheets, or two sheets in RFQs: measured inferior. Clause exploration uses an existing single-supplier slot.",
    "Blanket removal of relationship cost: the estimate can be wrong, but the score can still charge it. Use bounded proposal exploration and sensitivity checks instead.",
    "Using alternative sheets as standing offers or rival backups: protocol-invalid until properly promoted to a confirmed primary.",
    "SQL existence as citation authorization, or stripping IDs to disguise unsupported claims: neither solves trust failures.",
    "A broad numerical-solver, cost-model, or dependency rewrite in this iteration: no measured failure justifies displacing the demonstrated robustness fixes. Record boundary failures found by smoke tests for a separate follow-up.",
    "Case-specific prices, supplier-specific tactics, or tuning against hidden c_best: prohibited and unlikely to generalize."
  ]
}
```