/**
 * Small shared constants for the agent loop and its prompts.
 *
 * Split out in Phase A1 of the Work rework: lib/agent/loop.ts (moved from
 * lib/bench/agent-loop.ts) needs INCOMPLETE_AREAS_HEADER, but the section
 * text it labels is still rendered by lib/bench/prompts.ts (a benchmark-only
 * concern, not yet moved) — this tiny file lets both sides depend on the
 * same constant without lib/agent depending on lib/bench. prompts.ts
 * re-exports it so its own existing importers are unaffected.
 */

/**
 * The section header this feature injects, exported as the single source of
 * truth for "was the INCOMPLETE AREAS list actually shown to the model" —
 * used both to render the section (lib/bench/prompts.ts) and by
 * lib/agent/loop.ts's `enforceCoverage` check (see the doc there for why the
 * trigger phrase alone is not a reliable enough signal on its own).
 */
export const INCOMPLETE_AREAS_HEADER = "INCOMPLETE AREAS";

/**
 * The section header lib/bench/prompts.ts injects on Debugging-category
 * audit tasks — see candidateBugsSection there and
 * lib/analysis/formula-outliers.ts's isDebuggingAuditScope for the gate.
 * Exported here for the same reason as INCOMPLETE_AREAS_HEADER (a single
 * "was this actually shown" constant both a render site and a future
 * enforcement site could check), even though no enforcement reads it yet:
 * the calibration required before wiring up submit-time enforcement
 * (mean precision >= 40%, >= 5/8 tasks with a real hit) did not clear the
 * bar (measured: mean precision 0.150, 4/8 tasks) — see the calibration
 * report. This header exists so a future attempt, after further tuning,
 * doesn't have to invent the "was it shown" signal from scratch.
 */
export const CANDIDATE_BUGS_HEADER = "CANDIDATE BUGS";
