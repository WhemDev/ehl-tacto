/**
 * The agentic loop. Hand-rolled rather than the SDK's beta toolRunner,
 * deliberately: the tests script every model turn through the `callTurn`
 * seam, the submit pipeline needs preview-then-finalize control (the first
 * valid submit always gets one turn back showing what its edits actually
 * computed; only a second submit is accepted as final), and Task 12 places
 * cache breakpoints per turn — all of which require owning the loop.
 *
 * Contract with callTurn: the loop builds the messages array (first user
 * message = digest + grid + instruction; then alternating assistant echoes
 * and tool_result user turns) and callTurn returns one assistant turn. The
 * loop never talks to the network — production wiring lives in Task 12's
 * makeAgentCallTurn.
 *
 * Moved from lib/bench/agent-loop.ts in Phase A1 of the Work rework: the
 * loop itself has no benchmark-only dependency — app adoption needs it
 * outside lib/bench. lib/bench/agent-loop.ts is now a shim re-exporting
 * everything from here.
 *
 * Generalized in Phase A5 (Work generation) with a `submit` option: when a
 * caller supplies `{toolName, schema, verify}`, the loop's submit handling
 * is driven by that (schema.safeParse → verify() → preview/finalize) instead
 * of the built-in submit_edit_plan pipeline below. When `submit` is absent —
 * every bench call site, today — every line below this comment runs exactly
 * as it did before the generalization; see test/bench-agent-loop.test.ts,
 * unmodified, for the byte-identical proof. Tool execution (the non-submit
 * branch) gained the same optional-injection treatment via `toolExec`, for
 * the same reason: lib/work/generate.ts's tool calls run through a Web
 * Worker (lib/work/worker-client.ts's `tool()`), not the in-process
 * executeReadTool this file otherwise falls back to.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import type { Usage } from "@/lib/anthropic/client";
import { boxCellCount, formatCell, parseRange } from "@/lib/a1";
import { findIncompleteAreas, hasCompletionTrigger, type IncompleteArea } from "@/lib/analysis/completeness";
import type { CategoryDataRef, ChartSpec, NumericDataRef } from "@/lib/charts/spec";
import { isExcelError, type CellValue } from "@/lib/formula/ast";
import { makeKey } from "@/lib/formula/graph";
import { formatZodIssues } from "@/lib/ir/schema";
import { MAX_COLS, MAX_ROWS, type ParsedWorkbook } from "@/lib/workbook";
import { axisExtensionWarning, dominantAxisCluster, findOrphanColumns } from "@/lib/agent/axis-check";
import { restraintWarnings } from "@/lib/agent/restraint-check";
import {
  applyEditPlan,
  canonicalSheet,
  cellIsUncalculated,
  makeEditPlanSchema,
  originalCellSnapshot,
  type AppliedPlan,
  type CellEditPlan,
  type CoverageItem,
} from "@/lib/plan/edits";
import { executeReadTool, makeToolContext, SUBMIT_TOOL } from "@/lib/agent/tools";
import { INCOMPLETE_AREAS_HEADER } from "@/lib/agent/constants";

export interface AgentTurn {
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
  usage: Usage;
}

export type CallTurnFn = (messages: Anthropic.MessageParam[]) => Promise<AgentTurn>;

export interface AgentLoopDiagnostics {
  turns: number;
  toolCalls: Record<string, number>;
  submitOutcome: "clean" | "warned" | "capped" | "planError";
  usage: Usage;
}

export interface AgentLoopResult<T = unknown> {
  plan: CellEditPlan | null;
  /** The accepted plan already applied through the engine — run-task reuses
   *  this instead of applying a second time. */
  applied: AppliedPlan | null;
  planError?: string;
  diagnostics: AgentLoopDiagnostics;
  /**
   * The final accepted payload from a custom `submit` pipeline (see the
   * `submit` option below) — whatever `verify()` was called with on the
   * submit that finalized the loop. Always `null` on the default
   * (submit_edit_plan) path; bench consumers keep reading `plan`/`applied`
   * and never look at this field, which is why it's safe to add alongside
   * them rather than replace them.
   */
  result: T | null;
  /**
   * The loop's own `messages` array, exactly as it stood at the moment this
   * result was produced: the first user message (digest + grid +
   * instruction), then every assistant turn (tool_use/thinking blocks
   * included, verbatim from the model), then every tool_result user turn.
   * This is the complete "model inputs, outputs, and necessary intermediate
   * steps" record a submission-grade inference log needs — see
   * scripts/benchmark.ts's per-task JSONL writer. Never fed back into
   * `callTurn`; it is read only after the loop has already decided to
   * return, so exposing it changes nothing about what the model sees.
   */
  messages: Anthropic.MessageParam[];
}

export const MAX_AGENT_TURNS = 12;
export const MAX_AGENT_TOOL_CALLS = 40;

/** A non-submit tool call, executed and reported back as a tool_result.
 *  Defaults to the in-process executeReadTool/makeToolContext pair below;
 *  lib/work/generate.ts overrides this to route through a Web Worker
 *  instead, since the workbook there lives in worker-held state, not (only)
 *  in the `ParsedWorkbook` this loop was given. */
export type ToolExecFn = (name: string, input: unknown) => Promise<{ content: string; isError: boolean }>;

/** What a custom `verify()` reports back about one submit attempt. */
export interface SubmitVerifyResult {
  /** Shown to the model verbatim (plus the loop's own call-to-action
   *  sentence) as the tool_result content — the full account of what the
   *  submission computed/checked, not just a pass/fail flag. */
  feedbackText: string;
  /** Non-empty iff this submit should be rejected outright — schema-parseable
   *  but not accepted. */
  errors: string[];
  /** true iff this submit is eligible to finalize the loop. Semantically
   *  `errors.length === 0`, but kept as its own field rather than derived so
   *  a caller's `verify()` is never tempted to fudge the connection. */
  accept: boolean;
}

/**
 * Replaces the built-in submit_edit_plan handling entirely when supplied.
 * `schema` validates the raw tool-call input (mirroring makeEditPlanSchema's
 * role for the default path); `verify` runs whatever domain-specific check
 * the caller needs (lib/work/generate.ts's is "run these ops/checks through
 * the engine") and reports back a `SubmitVerifyResult`.
 *
 * State machine, mirroring the default path's preview-then-finalize shape
 * but generalized to "accepted" rather than merely "schema-valid": a submit
 * that fails schema.safeParse OR comes back with `accept: false` is
 * rejected — shown corrective feedback, no state change, no preview slot
 * spent, exactly like a default-path schema/coverage failure. The first
 * `accept: true` submit becomes the pending preview; the SECOND `accept:
 * true` submit — not merely the second submit, unlike the default path,
 * since a Work whose checks still fail must never finalize — ends the loop
 * with that submit's own parsed value.
 */
export interface SubmitOption<T = unknown> {
  toolName: string;
  schema: ZodType<T>;
  verify: (parsed: T) => Promise<SubmitVerifyResult>;
}

/** Evaluation errors on the plan's own edited cells, capped for the prompt. */
function evaluationErrors(applied: AppliedPlan): string[] {
  const errs: string[] = [];
  for (const f of applied.formulaParseFailures) {
    errs.push(`${f.sheet}!${f.cell}: formula did not parse (${f.error}) — it was written as literal text`);
  }
  for (const [sheet, cells] of applied.editedFormulas) {
    for (const [ref] of cells) {
      const v = applied.sim.getValue(sheet, ref);
      if (isExcelError(v)) errs.push(`${sheet}!${ref} evaluates to ${v.code}`);
    }
  }
  return errs.slice(0, 30);
}

// ---------------------------------------------------------------------------
// Incomplete-areas coverage
// ---------------------------------------------------------------------------

/**
 * Every area id from the completeness map must appear in `coverage` exactly
 * once, unknown ids are rejected, and a "skipped" entry must carry a real
 * reason. Returns one problem string per issue found, or [] when coverage is
 * complete — called only when hasCompletionTrigger(opts.userMessage) is
 * true, so a task without the map never reaches here (see runAgentLoop).
 */
function coverageProblems(areas: IncompleteArea[], coverage: CoverageItem[]): string[] {
  const problems: string[] = [];
  const areaIds = new Set(areas.map((a) => a.id));
  const seen = new Map<string, number>();

  for (const c of coverage) {
    seen.set(c.area_id, (seen.get(c.area_id) ?? 0) + 1);
    if (!areaIds.has(c.area_id)) {
      problems.push(`"${c.area_id}" is not an id from the INCOMPLETE AREAS list`);
    }
    if (c.action === "skipped" && !c.reason.trim()) {
      problems.push(`"${c.area_id}" is marked "skipped" but "reason" is empty`);
    }
  }

  const missing = areas.filter((a) => !seen.has(a.id));
  if (missing.length) {
    problems.push(`missing coverage for: ${missing.map((a) => a.id).join(", ")}`);
  }
  const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  if (duplicated.length) {
    problems.push(`listed more than once: ${duplicated.join(", ")}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The first-submit value preview
// ---------------------------------------------------------------------------

/** Same generous bounds the edit-plan schema validated ranges against, so a
 *  plan that parsed once parses identically here. */
const PREVIEW_BOUNDS = { rows: MAX_ROWS, cols: MAX_COLS };
const MAX_PREVIEW_EDITS = 8;
const MAX_PREVIEW_CELLS_PER_EDIT = 5;
const MAX_PREVIEW_CHARS = 2000;

function formatPreviewValue(v: CellValue): string {
  if (v === null || v === undefined) return "(empty)";
  if (isExcelError(v)) return v.code;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return formatPreviewValue(v[0]?.[0] ?? null);
  return String(v);
}

function isZeroOrEmpty(v: CellValue): boolean {
  return v === null || v === undefined || v === "" || v === 0;
}

// ---------------------------------------------------------------------------
// Blast-radius: collateral damage OUTSIDE the plan's own edited cells.
// ---------------------------------------------------------------------------

/** Up to this many "likely damage" cells get their own was/now line — see
 *  buildBlastRadiusSection. */
const MAX_BLAST_RADIUS_CANDIDATES = 6;
/** Keeps this section's own contribution modest regardless of how large
 *  applied.affectedKeys is (a 479-cell blast radius, say) — independent of
 *  MAX_PREVIEW_CHARS, which still bounds the assembled text as a whole. */
const MAX_BLAST_RADIUS_CHARS = 600;

/** Reverses makeKey's `${SHEET}!${COL}${ROW}` format. Sheet names can never
 *  contain "!" (Excel forbids it), so the first "!" is always the split
 *  point — no need for the greedier lookaheads a general A1-ref parser uses
 *  elsewhere in this file. Returns the sheet half UPPERCASED, exactly as
 *  makeKey left it (see canonicalSheet's call site below for how that gets
 *  resolved back to the workbook's real casing). */
function splitCellKey(key: string): { sheetUpper: string; ref: string } | null {
  const bang = key.indexOf("!");
  if (bang === -1) return null;
  const m = /^([A-Z]+)(\d+)$/.exec(key.slice(bang + 1));
  if (!m) return null;
  return { sheetUpper: key.slice(0, bang), ref: `${m[1]}${m[2]}` };
}

/** Engine keys for every cell the plan itself wrote — built from
 *  editedFormulas/editedValues the same way applyEditPlan built
 *  affectedKeys (see makeKey), so it can be subtracted from affectedKeys to
 *  get the edits' pure downstream closure, excluding the edits themselves. */
function editedKeySet(applied: AppliedPlan): Set<string> {
  const keys = new Set<string>();
  for (const cells of [applied.editedFormulas, applied.editedValues]) {
    for (const [sheet, refs] of cells) {
      for (const ref of refs.keys()) {
        const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref.trim());
        if (m) keys.add(makeKey(sheet, m[1], Number(m[2])));
      }
    }
  }
  return keys;
}

interface BlastCandidate {
  sheet: string;
  ref: string;
  wasText: string;
  newValue: CellValue;
  /** Sort key: how much a numeric original was worth, so the top slots go
   *  to the biggest losses (a 1,207,046 -> 0 outranks a 12 -> 0). Non-numeric
   *  originals (text/dates) still qualify, they just never outrank a real
   *  number for one of the capped slots. */
  severity: number;
}

/**
 * The collateral-damage section of the first-submit preview: cells the plan
 * never wrote directly but that the engine recomputed anyway because they
 * sit downstream of an edit in the dependency graph (applied.affectedKeys —
 * see lib/plan/edits.ts's doc on that field). The model must see this BEFORE
 * finalizing: the real failure that motivated this section (bench task
 * 20_02) had an edit ripple through a SUMIF into an equity-plug formula and
 * silently rewrite 479 untouched cells, including Summary!C62 from
 * 1,207,046 to 0 — invisible to the old preview, which only ever iterated
 * the plan's OWN edited cells.
 *
 * Two different counts, deliberately: `downstream.length` (the "N downstream
 * cells recomputed" line) is every such cell, alarming or not — a plan with
 * heavy but harmless ripple (recalculating a column of dates a day later,
 * say) still produces a nonzero count. The `candidates` list is the much
 * narrower "likely damage" subset: a downstream cell whose ORIGINAL cached
 * value — read off the pre-edit input via originalCellSnapshot, never the
 * engine's own recomputed state — was genuinely non-empty/non-zero but is
 * now 0, empty, or an Excel error. An uncalculated original (see
 * cellIsUncalculated) is skipped outright: there is no honest "was" value to
 * report for a formula the input file never cached in the first place.
 *
 * Returns "" — not even the count line — when no candidate qualifies. Almost
 * any edit produces SOME downstream recompute (a shared date axis, a totals
 * row two cells over), so a bare "N cells recomputed" with nothing concrete
 * backing it up would fire on nearly every preview and cost tokens without
 * telling the model anything actionable — exactly what this section exists
 * to avoid.
 */
function buildBlastRadiusSection(applied: AppliedPlan): string {
  const edited = editedKeySet(applied);
  const downstream: string[] = [];
  for (const key of applied.affectedKeys) {
    if (!edited.has(key)) downstream.push(key);
  }
  if (downstream.length === 0) return "";

  const candidates: BlastCandidate[] = [];
  for (const key of downstream) {
    const split = splitCellKey(key);
    if (!split) continue;
    const sheet = canonicalSheet(applied.workbook, applied.newSheets, split.sheetUpper);
    const { ref } = split;
    if (cellIsUncalculated(applied, sheet, ref)) continue;
    const original = originalCellSnapshot(applied, sheet, ref);
    if (!original || isZeroOrEmpty(original.value)) continue;
    const newValue = applied.sim.getValue(sheet, ref);
    if (!(isZeroOrEmpty(newValue) || isExcelError(newValue))) continue;
    candidates.push({
      sheet,
      ref,
      wasText: original.text || "(empty)",
      newValue,
      severity: typeof original.value === "number" ? Math.abs(original.value) : 0,
    });
  }
  if (candidates.length === 0) return "";

  candidates.sort((a, b) => b.severity - a.severity);
  const lines = [`Beyond your edits, ${downstream.length} downstream cells recomputed.`];
  for (const c of candidates.slice(0, MAX_BLAST_RADIUS_CANDIDATES)) {
    lines.push(`${c.sheet}!${c.ref}: was ${c.wasText} -> now ${formatPreviewValue(c.newValue)}`);
  }
  const text = lines.join("\n");
  return text.length > MAX_BLAST_RADIUS_CHARS ? `${text.slice(0, MAX_BLAST_RADIUS_CHARS - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// Charts: mechanical verification of the plan's `charts` field (Visualization
// tasks), same "keep the edit localized" pattern as buildBlastRadiusSection.
// ---------------------------------------------------------------------------

/** Up to this many series get their own resolved-range line per chart —
 *  keeps a chart with an unusually long series list from dominating the
 *  preview; the rest are still counted in the chart's own header line. */
const MAX_PREVIEW_SERIES_PER_CHART = 8;
/** Independent of MAX_PREVIEW_CHARS, same role MAX_BLAST_RADIUS_CHARS plays
 *  for that section — keeps this section's own contribution modest
 *  regardless of how many charts or series a plan submits. */
const MAX_CHARTS_PREVIEW_CHARS = 900;

/** Cell count backing one categories/xValues/values/bubbleSizes ref: the
 *  literal array's length for `{values}`, or the resolved A1 range's cell
 *  count for `{ref}` (parseRange already strips a sheet qualifier when one
 *  is present — see lib/a1.ts's splitSheetRef). `null` for an absent field
 *  or a `ref` that fails to parse (surfaced as its own line rather than
 *  silently treated as zero, so a malformed ref cannot masquerade as a
 *  0-cell mismatch). */
function chartRangeCellCount(dataRef: NumericDataRef | CategoryDataRef | undefined): number | null {
  if (!dataRef) return null;
  if ("values" in dataRef) return dataRef.values.length;
  const box = parseRange(dataRef.ref, PREVIEW_BOUNDS);
  return box ? boxCellCount(box) : null;
}

/**
 * Mechanical, deterministic verification of every chart in the plan — type,
 * title, series count, target sheet+anchor, and each series' resolved range
 * sizes with a mismatch flagged inline (e.g. 12 category labels against 8
 * plotted values, the single most common way a model-authored chart spec is
 * silently wrong: Excel still renders it, just against the shorter of the
 * two, quietly dropping data). This never re-implements compileChart's own
 * OOXML-building logic — it only counts cells, the same arithmetic
 * lib/charts/compile.ts's builders do internally, cheap enough to run on
 * every first submit.
 */
function buildChartsPreviewSection(charts: ChartSpec[]): string {
  const lines = [`${charts.length} chart(s) in this plan:`];

  charts.forEach((chart, i) => {
    const widthCols = chart.anchor.widthCols ?? 8;
    const heightRows = chart.anchor.heightRows ?? 15;
    lines.push(
      `${i + 1}. ${chart.chartType} "${chart.title ?? "(untitled)"}" — ${chart.series.length} series, ` +
        `on ${chart.sheet}!${chart.anchor.cell} (${widthCols}x${heightRows} cells)`,
    );

    chart.series.slice(0, MAX_PREVIEW_SERIES_PER_CHART).forEach((s, si) => {
      const catCount = chartRangeCellCount(s.categories);
      const xCount = chartRangeCellCount(s.xValues);
      const valCount = chartRangeCellCount(s.values);
      const bubCount = chartRangeCellCount(s.bubbleSizes);

      const parts: string[] = [];
      if (catCount !== null) parts.push(`categories ${catCount} cells`);
      if (xCount !== null) parts.push(`xValues ${xCount} cells`);
      parts.push(valCount !== null ? `values ${valCount} cells` : "values (unparseable ref)");
      if (bubCount !== null) parts.push(`bubbleSizes ${bubCount} cells`);

      // The axis a value series must line up with: categories for every
      // non-XY chart type, xValues for scatter/bubble — chartSpecSchema
      // guarantees at most one of the two is ever present on a given series
      // (see lib/charts/spec.ts's superRefine), so there is no ambiguity
      // about which one "the" mismatch below refers to.
      const mismatches: string[] = [];
      const axisLabel = catCount !== null ? "categories" : xCount !== null ? "xValues" : null;
      const axisCount = catCount ?? xCount;
      if (axisLabel && axisCount !== null && valCount !== null && axisCount !== valCount) {
        mismatches.push(`${axisLabel} ${axisCount} vs values ${valCount}`);
      }
      if (bubCount !== null && valCount !== null && bubCount !== valCount) {
        mismatches.push(`bubbleSizes ${bubCount} vs values ${valCount}`);
      }

      const label = s.name ?? s.nameRef ?? `series ${si + 1}`;
      const mismatchSuffix = mismatches.length > 0 ? ` [MISMATCH: ${mismatches.join("; ")}]` : "";
      lines.push(`   - "${label}": ${parts.join(", ")}${mismatchSuffix}`);
    });
    if (chart.series.length > MAX_PREVIEW_SERIES_PER_CHART) {
      lines.push(`   (+${chart.series.length - MAX_PREVIEW_SERIES_PER_CHART} more series not shown)`);
    }
  });

  const text = lines.join("\n");
  return text.length > MAX_CHARTS_PREVIEW_CHARS ? `${text.slice(0, MAX_CHARTS_PREVIEW_CHARS - 1)}…` : text;
}

/**
 * What the plan's edits actually computed: up to 5 sampled cells from each
 * of up to 8 edits as `SHEET!A1 = value`, then one summary line counting
 * every edited cell (not just the sampled ones) — the whole point being to
 * catch a clean-looking plan whose formulas quietly resolve to 0 or blank
 * because a linkage row was never written. Followed by the blast-radius
 * section (buildBlastRadiusSection) for damage OUTSIDE the edited cells
 * themselves, when there is any worth flagging.
 */
function buildValuePreview(plan: CellEditPlan, applied: AppliedPlan): string {
  const lines: string[] = [];

  for (const edit of plan.edits.slice(0, MAX_PREVIEW_EDITS)) {
    const sheet = canonicalSheet(applied.workbook, applied.newSheets, edit.sheet);
    const box = parseRange(edit.range, PREVIEW_BOUNDS);
    if (!box) continue;
    let shown = 0;
    for (let r = box.startRow; r <= box.endRow && shown < MAX_PREVIEW_CELLS_PER_EDIT; r++) {
      for (let c = box.startCol; c <= box.endCol && shown < MAX_PREVIEW_CELLS_PER_EDIT; c++) {
        const ref = formatCell(r, c);
        const value = applied.sim.getValue(sheet, ref);
        lines.push(`${sheet}!${ref} = ${formatPreviewValue(value)}`);
        shown++;
      }
    }
  }

  let cellCount = 0;
  let zeroOrEmptyCount = 0;
  let errorCount = 0;
  const tally = (sheet: string, ref: string) => {
    cellCount++;
    const value = applied.sim.getValue(sheet, ref);
    if (isExcelError(value)) errorCount++;
    else if (isZeroOrEmpty(value)) zeroOrEmptyCount++;
  };
  for (const [sheet, cells] of applied.editedFormulas) {
    for (const ref of cells.keys()) tally(sheet, ref);
  }
  for (const [sheet, cells] of applied.editedValues) {
    for (const ref of cells.keys()) tally(sheet, ref);
  }
  lines.push(
    `${cellCount} cells edited; ${zeroOrEmptyCount} evaluate to 0 or empty; ${errorCount} evaluate to errors.`,
  );

  const blastRadius = buildBlastRadiusSection(applied);
  // Charts (Visualization tasks): a compiled-chart summary per chart, when
  // the plan has any — see buildChartsPreviewSection. Kept out of every
  // other task's preview entirely (plan.charts is [] there), so this can
  // only ever ADD a section, never change one.
  const chartsSection = plan.charts && plan.charts.length > 0 ? buildChartsPreviewSection(plan.charts) : "";
  const text = [lines.join("\n"), blastRadius, chartsSection].filter(Boolean).join("\n\n");
  // MAX_PREVIEW_CHARS (2000) is not raised for these sections: the sampled +
  // tally lines above cap out around ~1,100 chars in the worst case (8
  // edits x 5 cells x ~25 chars/line, plus one tally line), the blast radius
  // section is separately capped at MAX_BLAST_RADIUS_CHARS (600), and the
  // charts section at MAX_CHARTS_PREVIEW_CHARS (900) — comfortably under
  // 2000 together in the realistic case (a Visualization plan has edits, if
  // any, limited to genuine data-prep, so the sampled-edit lines above stay
  // short when charts are present), so the shared ceiling never needed to
  // grow to accommodate them.
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// Per-turn budget notice
// ---------------------------------------------------------------------------

/**
 * Appended to the last tool_result of every non-final turn — the loop
 * otherwise never tells the model how much runway is left. A 20-task
 * Financial_Model expansion run (.superpowers/sdd/fm-expand.json) showed 7
 * tasks die at the cap with submitOutcome "planError" and ZERO
 * submit_edit_plan calls anywhere in their toolCalls breakdown (e.g. 15_01:
 * {read_range:19, search_cells:4}; 05_01: {search_cells:4, read_range:15}):
 * the model explored serially, one or two calls a turn, until the turn
 * budget silently ran out. Contrast the solved 06_01
 * ({read_range:21, search_cells:3, submit_edit_plan:2}, 11 turns) — batched
 * reads, first submit with room left to finalize.
 *
 * Wording switches once a first valid submit has produced a pending preview
 * (the caller's `feedback !== null`, passed in as `previewPending`): the
 * leave-room-for-preview-then-finalize reminder no longer applies once that
 * preview has already happened, and what the model needs instead is "your
 * next submit ends the task."
 */
function turnBudgetNotice(
  turn: number,
  maxTurns: number,
  toolCallsUsed: number,
  maxToolCalls: number,
  previewPending: boolean,
  submitToolName: string = SUBMIT_TOOL,
): string {
  const budget = `Turn ${turn}/${maxTurns}, ${toolCallsUsed}/${maxToolCalls} tool calls used.`;
  if (previewPending) {
    return `[${budget} A previewed plan is pending — your next ${submitToolName} call is final.]`;
  }
  return (
    `[${budget} No plan submitted yet — your first submit returns a values preview and your ` +
    `second finalizes, so leave at least 2 turns for that. Batch independent read_range/` +
    `search_cells calls into one turn.]`
  );
}

export async function runAgentLoop<T = unknown>(opts: {
  workbook: ParsedWorkbook;
  userMessage: string;
  callTurn: CallTurnFn;
  maxTurns?: number;
  maxToolCalls?: number;
  /** Replaces the built-in submit_edit_plan pipeline — see SubmitOption's
   *  doc. Absent (the default) reproduces today's behavior byte for byte. */
  submit?: SubmitOption<T>;
  /** Overrides how a non-submit tool call is executed. Defaults to the
   *  in-process executeReadTool/makeToolContext pair below (wrapped as
   *  async for a uniform await site — see ToolExecFn's doc). */
  toolExec?: ToolExecFn;
}): Promise<AgentLoopResult<T>> {
  const maxTurns = opts.maxTurns ?? MAX_AGENT_TURNS;
  const maxToolCalls = opts.maxToolCalls ?? MAX_AGENT_TOOL_CALLS;
  const submitToolName = opts.submit?.toolName ?? SUBMIT_TOOL;
  // Computed unconditionally, exactly as before the `submit` option existed
  // (even though the custom-submit path never uses most of this) — the
  // point is that the default path's behavior can never drift depending on
  // whether some other caller happens to pass `submit`.
  const schema = makeEditPlanSchema(opts.workbook);
  const ctx = makeToolContext(opts.workbook);
  const toolExec: ToolExecFn = opts.toolExec ?? (async (name, input) => executeReadTool(ctx, name, input));
  // Computed once, from the input workbook, the same way findIncompleteAreas
  // below is — orphanColumns is a static property of the INPUT (see
  // axis-check.ts's design comment: which columns already have orphaned
  // data never changes as a task's submits come in), so this never needs
  // recomputing per submit. Empty on the (large majority of) files with no
  // >= 2-sheet shared period axis or no orphaned column within one, in
  // which case axisExtensionWarning is a guaranteed no-op.
  const orphanColumns = findOrphanColumns(dominantAxisCluster(opts.workbook), opts.workbook);

  // The first user message embeds the task instruction verbatim (see
  // benchAgentUserMessage), so checking it here is exactly equivalent to
  // checking the instruction itself — the same deterministic gate
  // prompts.ts uses to decide whether to inject the INCOMPLETE AREAS list,
  // without threading a separate flag through run-task.ts's agent closure.
  // Computed once: findIncompleteAreas is pure over `workbook`, and the id
  // set must stay fixed for the whole task so every submit is validated
  // against the same list the model was shown.
  //
  // hasCompletionTrigger alone is not enough, though: it only checks for a
  // phrase, and that phrase could appear anywhere in the assembled message —
  // including inside the grid appendix, if some future non-Financial_Model
  // task happened to have a cell literally containing it. That would enforce
  // coverage against an area list prompts.ts never actually injected (single
  // source: benchAgentUserMessage only injects the section when
  // hasCompletionTrigger(instruction) is true, gating on the raw instruction,
  // not the assembled message). Requiring the section header too — the same
  // constant incompleteAreasSection renders it with — ties this check to
  // "the list was actually shown", not just "the phrase appears somewhere".
  const enforceCoverage =
    hasCompletionTrigger(opts.userMessage) && opts.userMessage.includes(INCOMPLETE_AREAS_HEADER);
  const incompleteAreas = enforceCoverage ? findIncompleteAreas(opts.workbook).areas : [];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: [{ type: "text", text: opts.userMessage }] },
  ];
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const toolCalls: Record<string, number> = {};
  let turns = 0;
  let totalToolCalls = 0;
  let nudged = false;
  /** Set on the first valid (schema-passing) submit. A second valid submit
   *  is always final, whether or not it matches this one. Default-path
   *  state only — see `customPending` for the `submit`-option counterpart. */
  let feedback: { plan: CellEditPlan; applied: AppliedPlan } | null = null;
  /** Set on the first ACCEPTED (schema-passing AND verify()-accepted)
   *  custom submit. Unlike `feedback`, a rejected submit in between two
   *  accepted ones never touches this — see SubmitOption's doc. */
  let customPending: { parsed: T; verify: SubmitVerifyResult } | null = null;

  const done = (
    outcome: AgentLoopDiagnostics["submitOutcome"],
    result: { plan?: CellEditPlan; applied?: AppliedPlan; planError?: string; result?: T },
  ): AgentLoopResult<T> => ({
    plan: result.plan ?? null,
    applied: result.applied ?? null,
    planError: result.planError,
    result: result.result ?? null,
    diagnostics: { turns, toolCalls, submitOutcome: outcome, usage },
    // `messages` is read here, at return time — every `return done(...)`
    // site below is the last statement of its branch, so this always
    // captures the array in its final state for that path (see the
    // double-nudge branch just below for the one place that needed an
    // explicit push first to make that true).
    messages,
  });

  while (turns < maxTurns && totalToolCalls < maxToolCalls) {
    const turn = await opts.callTurn(messages);
    turns++;
    usage.input += turn.usage.input;
    usage.output += turn.usage.output;
    usage.cacheRead += turn.usage.cacheRead;
    usage.cacheCreation += turn.usage.cacheCreation;

    const toolUses = turn.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      // The model stopped talking instead of submitting. One nudge, then out.
      if (nudged) {
        // Unlike every other return site, this one is reached without the
        // current turn's assistant content ever having been pushed (that
        // push, below, only happens on the NOT-yet-nudged branch) — push it
        // now so `messages` (and the log built from it) ends on the actual
        // final assistant turn instead of silently dropping it.
        messages.push({ role: "assistant", content: turn.content as unknown as Anthropic.ContentBlockParam[] });
        return done("planError", {
          planError: "the model ended the conversation twice without submitting a plan",
        });
      }
      nudged = true;
      messages.push({ role: "assistant", content: turn.content as unknown as Anthropic.ContentBlockParam[] });
      messages.push({
        role: "user",
        content: [{
          type: "text",
          text: opts.submit
            ? `You have not called ${submitToolName} yet. Call it now with your final submission — the task is scored on it.`
            : `You have not submitted an edit plan. Call ${SUBMIT_TOOL} now with your final plan — the task is scored on it.`,
        }],
      });
      continue;
    }

    messages.push({ role: "assistant", content: turn.content as unknown as Anthropic.ContentBlockParam[] });
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const call of toolUses) {
      totalToolCalls++;
      toolCalls[call.name] = (toolCalls[call.name] ?? 0) + 1;

      if (call.name !== submitToolName) {
        const res = await toolExec(call.name, call.input);
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: res.content,
          is_error: res.isError || undefined,
        });
        continue;
      }

      if (opts.submit) {
        // --- The custom submit pipeline (SubmitOption) --------------------
        const parsed = opts.submit.schema.safeParse(call.input);
        if (!parsed.success) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content:
              `The submission failed validation:\n${formatZodIssues(parsed.error)}\n` +
              `Fix these and call ${submitToolName} again.`,
            is_error: true,
          });
          continue;
        }

        const verifyResult = await opts.submit.verify(parsed.data);
        if (!verifyResult.accept) {
          // Rejected without consuming customPending — a failing verify (or
          // a schema failure above) never advances or resets the state
          // machine, so a later accepted submit still only needs ONE more
          // acceptance to finalize, whether or not one had already happened.
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: `${verifyResult.feedbackText}\n\nFix these and call ${submitToolName} again.`,
            is_error: true,
          });
          continue;
        }

        if (customPending) {
          // Second ACCEPTED submit — final on its own merits, exactly like
          // the default path's second-submit rule, just gated on `accept`
          // rather than mere schema validity.
          return done("clean", { result: parsed.data });
        }
        customPending = { parsed: parsed.data, verify: verifyResult };
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content:
            `${verifyResult.feedbackText}\n\nReview these. If they match your intent, call ${submitToolName} ` +
            `again (same submission) to finalize; otherwise submit a corrected version. Your next accepted ` +
            `submit is final.`,
        });
        continue;
      }

      // --- The default submit_edit_plan pipeline ---------------------------
      // 1. Semantic validation gates every submit, including the last.
      const parsed = schema.safeParse(call.input);
      if (!parsed.success) {
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content:
            `The plan failed validation:\n${formatZodIssues(parsed.error)}\n` +
            `Fix these and call ${SUBMIT_TOOL} again.`,
          is_error: true,
        });
        continue;
      }
      // 1b. Coverage of the incomplete-areas map, when one was shown for
      // this task — same gate as every submit above: it must pass before a
      // preview slot is spent, and a failure here does not consume one
      // either (the plan may otherwise be fine; only the accounting is
      // incomplete).
      if (enforceCoverage) {
        const problems = coverageProblems(incompleteAreas, parsed.data.coverage ?? []);
        if (problems.length > 0) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content:
              `Your "coverage" of the INCOMPLETE AREAS list has problems:\n- ${problems.join("\n- ")}\n` +
              `List every area id from that message exactly once (action "edited" or "skipped", with a ` +
              `non-empty reason for any "skipped"), then call ${SUBMIT_TOOL} again.`,
            is_error: true,
          });
          continue;
        }
      }
      // 2. Engine verification: apply and inspect what the formulas produce.
      const applied = await applyEditPlan(opts.workbook, parsed.data);
      const errors = evaluationErrors(applied);

      if (feedback) {
        // A second valid submit is always final, on its own merits — it
        // need not match the first one.
        return done(errors.length === 0 ? "clean" : "warned", { plan: parsed.data, applied });
      }

      // First valid submit: one feedback turn showing what it computed,
      // then the loop continues. This is the change the whole feature is
      // for — a plan that validates AND evaluates cleanly can still be a
      // clean-looking wrong answer (a whole cascade resolving to 0 because
      // one linkage row was never written), so "no errors" no longer
      // finalizes on its own.
      feedback = { plan: parsed.data, applied };
      const preview = buildValuePreview(parsed.data, applied);
      // Axis check: the input already had a column with real data below an
      // axis-sharing sheet's header row but no header of its own, and this
      // plan hasn't filled that header in — see axis-check.ts. Purely
      // additive: it never changes is_error or consumes anything, it only
      // gives the model something to fix before its final (second) submit.
      // Restraint checks (see restraint-check.ts) are the same shape, for
      // the opposite failure: content the plan wrote where the input gives
      // no corroboration (an uncorroborated column) or where the label cell
      // carries the sheet's own section-header style (a header-styled row).
      const axisWarning = axisExtensionWarning(orphanColumns, parsed.data, applied);
      const restraintWarning = restraintWarnings(opts.workbook, parsed.data);
      const extraWarnings = [axisWarning, restraintWarning].filter((w): w is string => w !== null).join("\n\n");
      if (errors.length > 0) {
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content:
            `The plan validates, but evaluating it surfaced problems:\n- ${errors.join("\n- ")}\n` +
            `You may submit a corrected plan; your next ${SUBMIT_TOOL} call is accepted as final either way.\n\n` +
            preview +
            (extraWarnings ? `\n\n${extraWarnings}` : ""),
          is_error: true,
        });
      } else {
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content:
            `The plan validates and evaluates. Computed results of your edits:\n${preview}\n\n` +
            (extraWarnings ? `${extraWarnings}\n\n` : "") +
            `Review these. If they match your intent, call ${SUBMIT_TOOL} again (same plan) to finalize; ` +
            `otherwise submit a corrected plan. Your next submit is final.`,
        });
      }
    }

    // Make the budget visible before the model's next turn (see
    // turnBudgetNotice's doc comment for the evidence behind this). Mutates
    // only the last tool_result's content string — never `is_error`, never
    // a new message part, so the per-turn cache breakpoints riding the
    // message structure are untouched. `results` is always non-empty here:
    // toolUses.length > 0 guaranteed every iteration of the loop above to
    // either push exactly one result or return the whole function outright
    // (the final-acceptance submit path), so this line never runs on the
    // turn that returns a final acceptance.
    const lastResult = results[results.length - 1];
    if (lastResult) {
      const prefix = typeof lastResult.content === "string" ? lastResult.content : "";
      const previewPending = opts.submit ? customPending !== null : feedback !== null;
      lastResult.content =
        `${prefix}\n\n${turnBudgetNotice(turns, maxTurns, totalToolCalls, maxToolCalls, previewPending, submitToolName)}`;
    }

    messages.push({ role: "user", content: results });
  }

  if (opts.submit) {
    if (customPending) return done("capped", { result: customPending.parsed });
    return done("planError", {
      planError: `the loop hit its cap (${maxTurns} turns / ${maxToolCalls} tool calls) without an accepted submission`,
    });
  }
  if (feedback) return done("capped", { plan: feedback.plan, applied: feedback.applied });
  return done("planError", {
    planError: `the loop hit its cap (${maxTurns} turns / ${maxToolCalls} tool calls) without an accepted plan`,
  });
}
