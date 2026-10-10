/**
 * Prompts for the benchmark path.
 *
 * The model sees exactly what the official SpreadsheetBench 2 harness shows
 * its agents — the task instruction and the workbook — and nothing more. In
 * particular `answer_position` (the scored ranges) never appears here; it is
 * evaluation state, and leaking it would turn the benchmark into a
 * different, easier task than the one on the leaderboard.
 *
 * The workbook reaches the model two ways, both built from Cellwise's own
 * machinery: the structural digest (lib/digest.ts — headers, column shapes,
 * formula patterns), and a grid appendix with actual cell contents, playing
 * the role the official harness's `view_xlsx` tool plays for its agents.
 * The appendix is budgeted: formulas and values render row by row until the
 * character budget runs out, and what was cut is said out loud rather than
 * silently dropped.
 */

import type { FileDigest } from "@/lib/digest";
import { digestBlock } from "@/lib/anthropic/prompts";
import {
  findIncompleteAreas,
  isCompletionScope,
  type FindIncompleteAreasResult,
} from "@/lib/analysis/completeness";
import {
  findCandidateBugs,
  isDebuggingAuditScope,
  type FindCandidateBugsResult,
} from "@/lib/analysis/formula-outliers";
import { FUNCTION_REGISTRY } from "@/lib/formula/functions";
import { CANDIDATE_BUGS_HEADER, INCOMPLETE_AREAS_HEADER } from "@/lib/agent/constants";
import { gridAppendix, GRID_APPENDIX_BUDGET } from "@/lib/agent/grid-appendix";
import type { ParsedWorkbook } from "@/lib/workbook";

// Re-exported: both moved to lib/agent in Phase A1 of the Work rework (app
// adoption — neither has a benchmark-only dependency), but this file's own
// existing importers (test/bench-dataset.test.ts, test/bench-prompts-budget.test.ts,
// lib/bench/agent-loop.ts) still reach them through "./prompts".
export { INCOMPLETE_AREAS_HEADER, gridAppendix, GRID_APPENDIX_BUDGET };

const PLAN_SHAPE = `{
  "edits": [
    {
      "sheet": string,                  // a sheet name from the file, exactly as listed
      "range": string,                  // bounded A1 range: "C2", "C2:C40", "B2:D10" — never "C:C"
      // EXACTLY ONE of the following four keys per edit:
      "formula": string,                // formula for the TOP-LEFT cell of the range, e.g. "=A2*B2".
                                        // It is filled across the whole range the way Excel's fill
                                        // handle would: relative references shift row by row and
                                        // column by column, absolute ones ($B$2) stay put.
      "value": string | number | boolean | null,   // one literal written to every cell in the range
      "values": [[...], [...]],         // explicit row-major grid, dimensions must match the range
      "clear": true                     // blank out the range
    }
  ],
  "newSheets": [string],                // OPTIONAL: sheets to create; required before editing them
  "notes": string                       // one or two sentences on your approach (for the report)
}`;

export function benchSystemPrompt(): string {
  const functions = Object.keys(FUNCTION_REGISTRY).sort().join(", ");
  return `You are the spreadsheet-editing engine of Cellwise, given one manipulation task on one workbook.

You will receive a structural digest of the workbook, a grid listing of its actual cell contents, and the task instruction. Respond with an EDIT PLAN — the exact cell changes that complete the task — as a single JSON object of this shape:

${PLAN_SHAPE}

RULES

- Modify ONLY the cells the task requires. Every other cell must keep its current content: the task is scored both on producing the right new values AND on not disturbing anything else. Never "tidy up" surrounding data, never rewrite a formula that already works.
- When your edits extend a time series or a table into new rows or columns, also write the header/label cells that name the new periods or items — a forecast column without its period header is incomplete.
- Prefer "formula" edits over precomputed "values" wherever the sheet's own logic can produce the result — formulas are checked by actually evaluating them against the workbook. When a range continues an existing filled-down pattern, give the top-left formula and let the fill do the rest.
- The formulas you write are evaluated by an engine that supports exactly these functions:
  ${functions}.
  A function outside this list evaluates to #NAME? and scores zero. When the natural choice is unsupported (e.g. XLOOKUP), express the same logic with supported ones (e.g. INDEX/MATCH).
- Ranges must be bounded rectangles that exist on the sheet ("C2:C40"), never whole columns ("C:C") or prose. Use the digest's used-range and the grid listing to find where data actually ends.
- Write dates as Excel serial numbers (days since 1899-12-30) or with DATE(y,m,d) inside a formula — never as "2023-01-15" text, which will not compare equal to a real date.
- Percentages and currency are plain numbers; the cell's number format handles display. Write 0.15, not "15%".
- To put content on a sheet that does not exist yet, declare its name in "newSheets" first, then edit it like any other sheet.
- A formula in a cell is replaced by whatever your edit puts there; "clear" empties cells. Later edits in the list override earlier ones on the same cell.
- Think through the workbook's existing formulas before editing: the digest's formula patterns tell you the conventions the file already follows. Match them.

OUTPUT FORMAT

Return ONLY the JSON object. No prose before it, no prose after it, no markdown code fences. Your entire response must parse as JSON.`;
}

export function benchUserMessage(
  digests: FileDigest[],
  workbook: ParsedWorkbook,
  instruction: string,
): string {
  return [
    digestBlock(digests),
    `FULL GRID CONTENT\n\n${gridAppendix(workbook)}`,
    `THE TASK\n\n${instruction}`,
  ].join("\n\n----------------------------------------\n\n");
}

// ---------------------------------------------------------------------------
// Incomplete areas / scope (tools mode only — see lib/analysis/completeness.ts)
// ---------------------------------------------------------------------------

/**
 * Compact, one-line-per-area rendering of the completeness scan, appended to
 * the first user message whenever isCompletionScope(category, instruction)
 * is true (phrase AND category — see that function's doc; a Template task
 * that merely reuses Financial_Model's boilerplate opener does not qualify).
 * Rendered even when the scan found nothing, deliberately: agent-loop.ts's
 * submit-time coverage check is gated on hasCompletionTrigger (re-checked
 * against the assembled user message, which embeds the instruction
 * verbatim) AND the header's presence — keeping "the map was injected" and
 * "the header is in the message" the same condition means an empty scan
 * still needs a `coverage: []` on every submit (a schema-level requirement —
 * see agent-tools.ts), consistent with what actually gets enforced, rather
 * than a second, silently different notion of "injected" for the model to
 * infer.
 */
function incompleteAreasSection(scan: FindIncompleteAreasResult): string {
  const intro =
    "A structural scan for cells that look unfinished relative to their own immediate row/column neighbors " +
    "(blank where the rows or columns around them are not) — candidates the instruction below may not name " +
    "explicitly. This is a heuristic, not a certainty: treat every id as something to account for, not " +
    'necessarily something to change. List every id in submit_edit_plan\'s "coverage" field: action "edited" ' +
    'for one your edits cover, action "skipped" with a concrete reason for one that should legitimately stay as is.';

  if (scan.areas.length === 0) {
    return `${INCOMPLETE_AREAS_HEADER}\n\n${intro}\n\nFound none beyond what the instruction already itemizes. "coverage" should be [].`;
  }
  const lines = scan.areas.map((a) => `${a.id}: ${a.sheet}!${a.range} [${a.kind}] ${a.evidence}`);
  if (scan.omitted > 0) {
    lines.push(`(+${scan.omitted} more area(s) omitted — the ${scan.areas.length} above are the highest-priority)`);
  }
  return [`${INCOMPLETE_AREAS_HEADER} (${scan.areas.length})`, "", intro, "", ...lines].join("\n");
}

/**
 * The section header for the restraint reminder injected on the OPPOSITE
 * tasks from incompleteAreasSection — whenever isCompletionScope is false.
 * Exported for the same "single source of truth" reason as
 * INCOMPLETE_AREAS_HEADER, though nothing outside this file checks for it
 * today: unlike the INCOMPLETE AREAS list, SCOPE has no submit-time
 * enforcement counterpart in agent-loop.ts — restraint is asked for here,
 * not mechanically verified (see benchAgentSystemPrompt's exact-cells-scope
 * rule).
 */
export const SCOPE_HEADER = "SCOPE";

/**
 * Static counterpart to incompleteAreasSection: appended instead of it
 * whenever isCompletionScope(category, instruction) is false, i.e. on every
 * task that is NOT a whole-workbook completion task by both phrase and
 * category. There is no scan to report — non-completion tasks default to
 * restraint-graded, so the reminder is the same regardless of what the
 * workbook looks like.
 *
 * NOT shown on a Debugging audit task, though those are ALSO not a
 * whole-workbook "completion" task in isCompletionScope's sense: see
 * candidateBugsSection below, which replaces this section instead — an
 * "audit and fix this file thoroughly" instruction is the one other
 * legitimate whole-file-edit case (no named cells to restrain to), so the
 * restraint reminder would be actively wrong there.
 */
const SCOPE_SECTION =
  `${SCOPE_HEADER}\n\n` +
  "Edit ONLY the cells this instruction names. Write no helper or intermediate values elsewhere — inline any " +
  "needed intermediate into a required cell's own formula. Don't fill scenarios, periods, or sections it doesn't " +
  "name; every untouched cell is graded on staying exactly as given.";

/**
 * The section header for the Visualization-category task section — see
 * CHARTS_SECTION below and benchAgentUserMessage's doc for where it sits in
 * the section-selection priority order. Exported for the same "single
 * source of truth" reason as SCOPE_HEADER; like SCOPE, this has no
 * submit-time enforcement counterpart in agent-loop.ts (a chart is judged
 * externally by the official evaluator's VLM, not by anything this harness
 * can mechanically check beyond the range-size sanity buildChartsPreviewSection
 * already runs at submit time — see lib/agent/loop.ts).
 */
export const CHARTS_HEADER = "CHARTS";

/**
 * Static, category-gated counterpart to SCOPE_SECTION: appended instead of
 * it whenever category === "Visualization" (see benchAgentUserMessage).
 * A Visualization task's graded deliverable is the chart(s) it describes,
 * not a set of named cells — SCOPE's "edit only the cells this instruction
 * names" framing does not even apply, so it is replaced outright rather than
 * supplemented. `edits` stays available and is called out explicitly: some
 * Visualization tasks need genuine data-prep first (a summary table to chart
 * from) before the chart itself makes sense.
 *
 * Deliberately compact — not a restatement of chartSpecSchema's full shape.
 * This section only needs to establish the concept, the JSON-STRING encoding
 * each array entry actually uses (see lib/agent/tools.ts's EDIT_PLAN_SCHEMA
 * header doc: the tool's own `charts` property is `string[]`, not a nested
 * object, since the live API rejected the earlier structured encoding — a
 * "400 ... too many parameters with union types" — and the real shape only
 * exists Zod-side now, at lib/plan/edits.ts's chartEntrySchema), and the
 * handful of fields a real Visualization task turns on (type/title/series
 * refs/axes/colors/anchor), the same way PLAN_SHAPE above illustrates
 * "edits" without restating cellEditSchema in full.
 */
const CHARTS_SECTION =
  `${CHARTS_HEADER}\n\n` +
  "This is a Visualization task: your job is to produce the chart(s) the instruction describes, not to edit " +
  'cell values. Add a "charts" array to submit_edit_plan — one entry per chart, and each entry is a JSON OBJECT ' +
  'serialized as a STRING: submit_edit_plan\'s "charts" property holds an array of strings, not nested objects — ' +
  'build the object shown below, then JSON.stringify it into its slot in the array (so the array itself looks ' +
  'like ["{\\"chartType\\":\\"column\\",...}"], one string per chart). "edits" stays available for genuine ' +
  "data-prep the chart needs (e.g. building a summary table to chart from); leave it empty otherwise, and do not " +
  "otherwise touch the workbook's existing cells. One compact example object — this is what you stringify, not " +
  "the array itself:\n\n" +
  `{
  "chartType": "line" | "column" | "bar" | "pie" | "doughnut" | "scatter" | "bubble" | "area" | "combo",
  "title": "...",
  "sheet": "...",                        // the sheet this chart is anchored on
  "anchor": { "cell": "F2", "widthCols": 8, "heightRows": 15 },   // top-left cell + size in grid cells
  "series": [
    {
      "name": "...",                     // legend entry text
      "categories": { "ref": "A2:A10" } | { "values": [...] },   // non-XY chart types
      "xValues":    { "ref": "B2:B10" } | { "values": [...] },   // scatter/bubble only
      "values":     { "ref": "C2:C10" } | { "values": [...] },   // REQUIRED: the series' own data
      "bubbleSizes":{ "ref": "D2:D10" } | { "values": [...] },   // bubble only
      "color": "FF0000" | "none",        // 6-digit hex, no "#", or "none" for invisible
      "pointColors": { "0": "00B050", "3": "FF0000" },           // optional per-point/per-slice color overrides, keyed by 0-based index
      "type": "column" | "bar" | "line" | "area"                 // REQUIRED when chartType is "combo"
    }
  ],
  "grouping": "clustered" | "stacked" | "percentStacked",        // bar/column/area/combo only
  "categoryAxis": { "title": "...", "numberFormat": "0%" },
  "valueAxis": { "title": "...", "numberFormat": "$#,##0" },
  "legend": { "show": true, "position": "b" },
  "dataLabels": { "show": true, "showValue": true }
}` +
  '\n\nUse "ref" (a live A1 range), not "values" (a literal array), whenever the plotted data already lives on ' +
  'the sheet — the chart re-reads the live cells. A bare ref like "A2:A10" resolves against the chart\'s own ' +
  '"sheet"; qualify it ("Sheet2!A2:A10") to pull from elsewhere. Match colors, series names, axis titles, and ' +
  "chart type to exactly what the instruction names — do not invent data or series it never mentions.";

/**
 * Compact, one-line-per-candidate rendering of findCandidateBugs' output,
 * appended (in place of SCOPE_SECTION — see its doc) whenever
 * isDebuggingAuditScope(category, instruction) is true. Mirrors
 * incompleteAreasSection's shape (a heuristic scan the model must weigh, not
 * a verdict), but deliberately does NOT ask for a submit-time "coverage"
 * accounting the way that section does: the calibration required before
 * wiring up an enforcement counterpart in lib/agent/loop.ts did not clear
 * the bar (see CANDIDATE_BUGS_HEADER's doc) — this section is injected on
 * its own, unenforced.
 */
function candidateBugsSection(result: FindCandidateBugsResult): string {
  const intro =
    "A mechanical scan for formulas that break an otherwise-uniform pattern in their own row/column, and for " +
    "literal numbers that exactly duplicate another cell's already-computed value — candidates the instruction " +
    "below does not name explicitly. Verify each against its neighbors; fix the ones that are real. A candidate " +
    "is not necessarily a bug — and the real bug set is not limited to this list. After fixing any bug, search " +
    "for other instances of the same shape elsewhere in the file before you consider the audit done.";

  if (result.bugs.length === 0) {
    return `${CANDIDATE_BUGS_HEADER}\n\n${intro}\n\nFound none. Audit the file on your own judgment.`;
  }
  const lines = result.bugs.map((b) => `${b.id}: ${b.evidence}`);
  if (result.omitted > 0) {
    lines.push(`(+${result.omitted} more candidate(s) omitted — the ${result.bugs.length} above are the highest-priority)`);
  }
  return [`${CANDIDATE_BUGS_HEADER} (${result.bugs.length})`, "", intro, "", ...lines].join("\n");
}

/**
 * The tools-mode first user message: identical digest + grid content to
 * benchUserMessage, plus exactly one of FOUR mutually exclusive sections
 * ahead of the task text, in priority order: INCOMPLETE AREAS when
 * isCompletionScope(category, instruction) is true; otherwise CANDIDATE
 * BUGS when isDebuggingAuditScope(category, instruction) is true; otherwise
 * CHARTS when category === "Visualization"; SCOPE otherwise. The first three
 * conditions cannot both hold in practice (a task's category is a single
 * dataset value — never "Financial_Model"/"Debugging" and "Visualization" at
 * once), but the priority order is written explicitly so that stays true
 * even if a future caller's category is wrong or missing. `category` is the
 * dataset's own taxonomy ("Financial_Model", "Template", ...) — task
 * metadata, not a graded value — threaded in by the caller (run-task.ts)
 * rather than inferred here; `undefined` is a legitimate value for a caller
 * that doesn't have it yet (see isCompletionScope's doc for the fallback
 * this implies; isDebuggingAuditScope follows the same rule; CHARTS, unlike
 * the other two, has no phrase-based fallback at all — there is no reliable
 * "this instruction reads like a chart request" heuristic the way "complete
 * the financial model" or "audit and fix" are, so an unspecified category
 * simply never triggers it, falling through to SCOPE like any other
 * unclassified task). Kept as a separate function rather than a parameter on
 * benchUserMessage so single-shot mode (which still calls benchUserMessage
 * directly from run-task.ts) can never be affected by any of the four
 * sections, byte for byte, regardless of trigger or category.
 */
export function benchAgentUserMessage(
  digests: FileDigest[],
  workbook: ParsedWorkbook,
  instruction: string,
  category?: string,
): string {
  const parts = [digestBlock(digests), `FULL GRID CONTENT\n\n${gridAppendix(workbook)}`];
  if (isCompletionScope(category, instruction)) {
    parts.push(incompleteAreasSection(findIncompleteAreas(workbook)));
  } else if (isDebuggingAuditScope(category, instruction)) {
    parts.push(candidateBugsSection(findCandidateBugs(workbook)));
  } else if (category === "Visualization") {
    parts.push(CHARTS_SECTION);
  } else {
    parts.push(SCOPE_SECTION);
  }
  parts.push(`THE TASK\n\n${instruction}`);
  return parts.join("\n\n----------------------------------------\n\n");
}

/**
 * Chart guidance appended to benchAgentSystemPrompt's output ONLY when
 * category === "Visualization" — see that function's `category` parameter
 * doc. Kept short and pointed at the CHARTS section (rendered per-task by
 * benchAgentUserMessage) rather than re-explaining the whole "charts" field
 * shape here a second time.
 */
const CHART_GUIDANCE = `

CHART GUIDANCE (Visualization tasks)

This task asks you to create a chart, not to edit cell values — read the instruction for chart type, which series/ranges to plot, and any axis titles or colors it names explicitly, then call submit_edit_plan with a "charts" array (see the first user message's CHARTS section for the field shape). "edits" stays available only for genuine data-prep the chart needs (e.g. building a summary table to chart from); leave it empty otherwise, and never touch the workbook's existing cells beyond that. Prefer a live "ref" over literal "values" whenever the chart's data already lives on the sheet, and don't invent series or data the instruction never names.`;

/**
 * `category` gates a single addition — CHART_GUIDANCE, appended only when
 * category === "Visualization" — everything above it is unchanged from
 * before this parameter existed. Optional and defaulting to the pre-existing
 * behavior (no chart guidance) for the same reason `category` is optional
 * throughout this file: callers that haven't threaded task metadata through
 * yet (or genuinely don't have it) must never silently lose behavior, only
 * ever fail to gain the Visualization-specific addition. Threaded from
 * run-task.ts's `opts.category`, itself threaded from scripts/benchmark.ts's
 * per-category `runBenchTask` call. Every other category's prompt — and the
 * no-argument call every existing caller/test made before this parameter was
 * added — is byte-identical to what benchAgentSystemPrompt() always
 * returned; pinned in test/bench-prompts-visualization.test.ts.
 */
export function benchAgentSystemPrompt(category?: string): string {
  const functions = Object.keys(FUNCTION_REGISTRY).sort().join(", ");
  return `You are the spreadsheet-editing engine of Cellwise, given one manipulation task on one workbook.

You will receive a structural digest of the workbook, a grid listing of its actual cell contents, and the task instruction. You also have TOOLS to inspect anything the digest or listing compressed: read_range for exact cells, search_cells to locate labels or formulas, trace_cell for what feeds or consumes a cell, lookup_defined_names for names the digest omitted. When a digest note says something was omitted or truncated, that is your cue to retrieve it — stated facts in the digest are authoritative; fetch what is missing rather than guessing.

When you know the exact cell changes that complete the task, call submit_edit_plan with them. That ends the task. The harness validates your plan and evaluates every formula you wrote through the engine; problems come back to you once, with details, and you may submit a corrected plan.

RULES

- Modify ONLY the cells the task requires. Every other cell must keep its current content: the task is scored both on producing the right new values AND on not disturbing anything else. Never "tidy up" surrounding data, never rewrite a formula that already works.
- When your edits extend a time series or a table into new rows or columns, also write the header/label cells that name the new periods or items — a forecast column without its period header is incomplete.
- Prefer "formula" edits over precomputed "values" wherever the sheet's own logic can produce the result. When a range continues an existing filled-down pattern, give the top-left formula and let the fill do the rest.
- The formulas you write are evaluated by an engine that supports exactly these functions:
  ${functions}.
  A function outside this list evaluates to #NAME? and scores zero. When the natural choice is unsupported (e.g. XLOOKUP), express the same logic with supported ones (e.g. INDEX/MATCH).
- Ranges must be bounded rectangles that exist on the sheet ("C2:C40"), never whole columns ("C:C").
- Write dates as Excel serial numbers (days since 1899-12-30) or with DATE(y,m,d) inside a formula — never as "2023-01-15" text.
- Percentages and currency are plain numbers; the cell's number format handles display. Write 0.15, not "15%".
- To put content on a sheet that does not exist yet, declare its name in "newSheets" first.
- The instruction usually packs several distinct requirements into one paragraph. Before calling submit_edit_plan, split it into individual requirements and check your edits cover every single one — an unaddressed requirement scores zero even if everything else is perfect. List the requirements and their covering edits in "notes".
- When a task asks for values "for the forecast period" on a schedule, check the workbook's other statements for how far the forecast horizon runs; if this schedule's period-header axis stops short of it, extend the axis by continuing its own header pattern (e.g. a date header row continues with EOMONTH(prev,12)) so every forecast year has its labeled column — in whole-workbook scope only; in exact-cells scope, extend it no further than the periods the instruction itself names.
- A task that says to "complete the [financial] model" is not fully described by the sentences that follow it — those itemize a few requirements for emphasis, not the whole scope. The graded deliverable is the entire completed workbook. When the first user message includes an "INCOMPLETE AREAS" list, it is a structural scan for cells that look unfinished; account for every id it lists in submit_edit_plan's "coverage" field — action "edited" for one your edits cover, action "skipped" with a concrete reason for one that should legitimately stay as is. An id left off "coverage" is rejected and sent back to you. When no such list is shown, leave "coverage" as [].
- A task that says to "audit and fix this file thoroughly" is also whole-file scope, not exact-cells: real bugs can be anywhere, not only where the instruction's own examples hint. When the first user message includes a "CANDIDATE BUGS" list, it is a mechanical scan for formulas that break their own row/column pattern and literals that duplicate another cell's computed value — verify each against its neighbors before touching it, since a candidate is not a verdict, and after fixing a real one, search the file for other instances of the same shape rather than assuming it was the only one. This list has no "coverage" field to fill in.
- Any other instruction is exact-cells scope: only the cells it names are graded — the first user message's SCOPE section spells out the restraint, and writing beyond it loses points.
- Inspect before you edit: a couple of precise read_range or trace_cell calls beat a wrong guess, but do not re-read what the grid listing already shows.
- The loop enforces a hard turn budget, shown to you at the end of every turn's tool results. Aim to submit a first finished plan by roughly turn 8 of 12 — the preview exists for refinement, so an imperfect early submit beats a perfect plan that never arrives; finished means every required cell is filled, not padded with extras. Batch independent read_range/search_cells calls into a single turn rather than one call per turn.${category === "Visualization" ? CHART_GUIDANCE : ""}`;
}
