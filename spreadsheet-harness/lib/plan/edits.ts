/**
 * The edit plan: what the model returns for a SpreadsheetBench task.
 *
 * The workflow IR describes a process; a benchmark task needs a *change* —
 * concrete cells getting concrete formulas or values. An edit plan is the
 * smallest honest encoding of that: a list of range edits, each doing
 * exactly one of
 *
 *   - `formula`: the formula for the range's TOP-LEFT cell, filled across
 *     the rest of the range with relative references shifted exactly as
 *     Excel's fill handle would (`=E2-F2` fills down to `=E3-F3`, …);
 *   - `value`: one literal written to every cell in the range;
 *   - `values`: an explicit row-major grid matching the range's shape;
 *   - `clear: true`: blank the range.
 *
 * The schema is built per workbook so sheet names and ranges are validated
 * against the file the model was shown — a typo'd sheet or an unparseable
 * range comes back as a Zod issue and flows through the existing
 * runValidated retry, the same correction loop the workflow IR gets.
 *
 * Application happens through the formula engine (Simulator), which is the
 * point of the benchmark: the score measures what Cellwise's own parser,
 * dependency graph, and function registry can actually compute, not what a
 * hypothetical Excel would.
 *
 * Moved from lib/bench/edits.ts in Phase A1 of the Work rework: this is the
 * edit-plan schema and its application logic, workbook-editing primitives
 * with nothing benchmark-specific about them — app adoption needs them
 * outside lib/bench, which stays reserved for benchmark-only concerns like
 * the scorer's CellReader adapter (appliedPlanReader), still in
 * lib/bench/edits.ts alongside a shim re-exporting everything below.
 */

import { z } from "zod";
import { colToIndex, parseRange, formatCell, type RangeBox } from "@/lib/a1";
import { chartSpecSchema, type ChartSpec } from "@/lib/charts/spec";
import type { CellValue } from "@/lib/formula/ast";
import { isExcelError } from "@/lib/formula/ast";
import { FUNCTION_REGISTRY } from "@/lib/formula/functions";
import { makeKey } from "@/lib/formula/graph";
import { shiftFormula } from "@/lib/formula/shift";
import { createSimulator, type Simulator } from "@/lib/formula/simulate";
import { cellKey, MAX_COLS, MAX_ROWS, type GridCell, type ParsedWorkbook } from "@/lib/workbook";

/** Ceiling on cells one plan may touch. The benchmark's own average is ~600
 *  modified cells per task; fifty thousand means a runaway plan, not a task. */
export const MAX_EDIT_CELLS = 50_000;

/**
 * Ceiling on the number of edit *entries* (as opposed to cells — see
 * MAX_EDIT_CELLS above). Was 500; a "complete the financial model" plan that
 * accounts for every incomplete area (lib/analysis/completeness.ts, capped
 * at 40 areas) on top of the itemized asks can legitimately need one entry
 * per distinct formula pattern across many sheets — the 02_x Financial_Model
 * family alone spans 9 graded sheets. 500 already cleared the brief's >= 150
 * floor, but 2,000 gives real headroom for that case while staying two
 * orders of magnitude under MAX_EDIT_CELLS even if every entry were a single
 * cell (worst case, no range batching at all).
 */
export const MAX_EDITS = 2_000;

const EDIT_BOUNDS = { rows: MAX_ROWS, cols: MAX_COLS };

const literalSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const cellEditSchema = z.object({
  sheet: z.string().min(1),
  range: z.string().min(1),
  formula: z.string().min(1).optional(),
  value: literalSchema.optional(),
  values: z.array(z.array(literalSchema)).optional(),
  clear: z.literal(true).optional(),
});

export type CellEdit = z.infer<typeof cellEditSchema>;

/**
 * One line of a submit's optional `coverage` accounting — see
 * lib/analysis/completeness.ts's IncompleteArea and lib/agent/tools.ts's
 * coverageItemSchema (the strict JSON-Schema twin the live API sees).
 * Defaulted rather than required here: unlike the API-facing schema, this is
 * the semantic-validation layer, and plenty of legitimate callers (every
 * existing test, single-shot mode, any task without the completeness map)
 * never mention coverage at all.
 */
const coverageItemSchema = z.object({
  area_id: z.string().min(1),
  action: z.enum(["edited", "skipped"]),
  reason: z.string().default(""),
});

export type CoverageItem = z.infer<typeof coverageItemSchema>;

/**
 * Strips every `null` property value, recursively, from a raw value — used
 * only to preprocess a "charts" entry (see chartEntrySchema below) before
 * chartSpecSchema.parse() ever sees it. This exists for the OLD strict-tool
 * shape, still accepted for hand-authored callers: Anthropic's strict mode
 * has no notion of an OPTIONAL property, so every field chartSpecSchema
 * itself marks `.optional()` used to be modeled on the wire as "required,
 * but its value may be null" — a model that wanted to omit a chart's title
 * sent `"title": null`, not an absent key. Zod's `.optional()` only ever
 * means "key absent" (a literal `null` fails it unless also `.nullable()`),
 * so those nulls need converting back to "key absent" before the semantic
 * schema (chartSpecSchema, deliberately left unchanged by this feature — see
 * this module's own header doc on what moved here vs. what stayed in
 * lib/charts/) ever parses the entry.
 *
 * Scoped to chart entries only, never applied to the plan as a whole:
 * `cellEditSchema.value` legitimately uses a literal `null` to mean "write a
 * blank cell", and stripping that would silently turn a real edit into a
 * no-op. Nowhere inside a ChartSpec is `null` ever a meaningful value in its
 * own right, so unconditional stripping is safe there.
 */
function stripNullsDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNullsDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;
      out[k] = stripNullsDeep(v);
    }
    return out;
  }
  return value;
}

/** Ceiling on the number of charts one plan may submit. Generous relative to
 *  the dataset (24 Visualization tasks, most asking for a single chart; a
 *  few multi-panel ones want two or three) — this exists to catch a runaway
 *  plan, not to pinch a real one. */
export const MAX_CHARTS = 20;

/**
 * One "charts" array entry, accepted in either of two forms:
 *
 *  - a JSON-encoded STRING — the live tool's transport (see
 *    lib/agent/tools.ts's EDIT_PLAN_SCHEMA header doc for the incident this
 *    fixes): a prior structured, strict-mode JSON-Schema mirror of
 *    chartSpecSchema turned every one of its many optional fields into a
 *    `{anyOf: [X, {type: "null"}]}` union, and the chart subtree alone blew
 *    past the live API's cap on union-typed tool parameters (`400
 *    invalid_request_error: "... too many parameters with union types"`).
 *    The fix moved the real shape out of the tool schema entirely: the tool
 *    now declares "charts" as `string[]` (zero unions), and this is where
 *    each string actually gets interpreted — `JSON.parse`d first, a syntax
 *    error becoming an ordinary Zod issue at this entry's own path
 *    (`"not valid JSON: <message>"`) rather than a thrown exception, so the
 *    model corrects it through the same retry loop as any other schema
 *    violation;
 *  - a plain OBJECT — a hand-authored ChartSpec (tests, single-shot mode, any
 *    future non-agentic caller), including the old strict-tool shape with
 *    every optional field present as an explicit `null` (still run through
 *    stripNullsDeep for backward compatibility).
 *
 * Either form is then run through chartSpecSchema unmodified — the semantic
 * authority never changed, only how one entry arrives on the wire.
 */
const chartEntrySchema = z.preprocess((raw, ctx) => {
  if (typeof raw === "string") {
    try {
      return stripNullsDeep(JSON.parse(raw));
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      return z.NEVER;
    }
  }
  if (raw !== null && typeof raw === "object") return stripNullsDeep(raw);
  return raw;
}, chartSpecSchema);

/**
 * The "charts" field's schema: an array of chartEntrySchema (string or
 * object, see above), each ultimately validated by chartSpecSchema — every
 * one of its own structural rules (combo series need `type`, scatter/bubble
 * need `xValues`, pie/doughnut are single-series, …) applies exactly as it
 * does to a hand-authored ChartSpec in a test. Defaults to `[]`, the same
 * convention `coverage` uses: the overwhelming majority of plans (every
 * non-Visualization task) never mention charts at all.
 */
const chartsFieldSchema = z.array(chartEntrySchema).max(MAX_CHARTS).default([]);

export interface CellEditPlan {
  edits: CellEdit[];
  newSheets: string[];
  notes: string;
  /** Optional: only meaningful when the task's first user message included
   *  an INCOMPLETE AREAS list. See lib/agent/loop.ts's coverage validation. */
  coverage?: CoverageItem[];
  /**
   * Charts to create (Visualization-category tasks). Output-only: applied to
   * the exported .xlsx bytes via lib/charts/inject.ts's injectCharts, AFTER
   * buildOutputXlsx — charts never touch the Simulator and never affect
   * scoring (see lib/bench/run-task.ts's doc on this). Optional for the same
   * reason `coverage` is: hand-authored plans (tests, single-shot mode,
   * EMPTY_PLAN) are never required to mention it.
   */
  charts?: ChartSpec[];
}

/** A bounded rectangle — open forms like `D:D` are refused for edits: a
 *  plan must say which rows it touches. */
function boundedBox(range: string): RangeBox | null {
  const box = parseRange(range, EDIT_BOUNDS);
  if (!box || box.wholeColumn || box.wholeRow) return null;
  return box;
}

function editCellCount(edit: CellEdit): number {
  const box = boundedBox(edit.range);
  if (!box) return 0;
  return (box.endRow - box.startRow + 1) * (box.endCol - box.startCol + 1);
}

/**
 * The edit-plan schema for one workbook. Sheet names resolve
 * case-insensitively against the file (or against `newSheets`), matching the
 * tolerance the rest of the app extends to model output — but unlike the
 * animation path, an unresolvable name here is an error, not a shrug: a
 * benchmark edit that lands on the wrong sheet scores zero silently, which
 * is exactly the failure a validation loop exists to catch.
 */
export function makeEditPlanSchema(workbook: ParsedWorkbook) {
  const sheetNames = workbook.sheets.map((s) => s.name);
  const lower = new Set(sheetNames.map((s) => s.trim().toLowerCase()));

  return z
    .object({
      edits: z.array(cellEditSchema).max(MAX_EDITS),
      newSheets: z.array(z.string().min(1)).max(20).default([]),
      notes: z.string().default(""),
      coverage: z.array(coverageItemSchema).default([]),
      charts: chartsFieldSchema,
    })
    .superRefine((plan, ctx) => {
      const newLower = new Set(plan.newSheets.map((s) => s.trim().toLowerCase()));
      let totalCells = 0;

      plan.edits.forEach((edit, i) => {
        const key = edit.sheet.trim().toLowerCase();
        if (!lower.has(key) && !newLower.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["edits", i, "sheet"],
            message:
              `unknown sheet "${edit.sheet}" — must be one of: ${sheetNames.join(", ")}` +
              (plan.newSheets.length ? ` (or a declared new sheet: ${plan.newSheets.join(", ")})` : "") +
              `. To add a sheet, declare it in "newSheets".`,
          });
        }

        const box = boundedBox(edit.range);
        if (!box) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["edits", i, "range"],
            message: `"${edit.range}" is not a bounded A1 range — use forms like "B2", "B2:D10" (whole-column and whole-row forms are not allowed in edits)`,
          });
        }

        const actions = [
          edit.formula !== undefined,
          edit.value !== undefined,
          edit.values !== undefined,
          edit.clear === true,
        ].filter(Boolean).length;
        if (actions !== 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["edits", i],
            message: `each edit must have exactly one of "formula", "value", "values", "clear" — this one has ${actions}`,
          });
        }

        if (edit.values !== undefined && box) {
          const height = box.endRow - box.startRow + 1;
          const width = box.endCol - box.startCol + 1;
          const rowsOk = edit.values.length === height;
          const colsOk = edit.values.every((r) => r.length === width);
          if (!rowsOk || !colsOk) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["edits", i, "values"],
              message: `"values" must be a ${height}x${width} grid to match range ${edit.range}, got ${edit.values.length}x${edit.values[0]?.length ?? 0}`,
            });
          }
        }

        totalCells += editCellCount(edit);
      });

      if (totalCells > MAX_EDIT_CELLS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edits"],
          message: `the plan touches ${totalCells} cells, over the ${MAX_EDIT_CELLS} ceiling — a task never needs that many; narrow the ranges`,
        });
      }

      // Same sheet-existence check as edits above, run against each chart's
      // own `sheet` field (its anchor sheet — also the default a bare,
      // unqualified `ref` inside its series resolves against; see
      // lib/charts/spec.ts's header doc). Refs embedded in a chart's own
      // series fields are not cross-checked here, mirroring edits: a
      // formula's own embedded sheet references are not validated at this
      // layer either — lib/charts/inject.ts throws its own clear error at
      // apply time for a sheet chartSpecSchema's structural pass could never
      // have caught (a range that happens to name a real-looking but wrong
      // sheet inside a series ref, say).
      plan.charts.forEach((chart, i) => {
        const key = chart.sheet.trim().toLowerCase();
        if (!lower.has(key) && !newLower.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["charts", i, "sheet"],
            message:
              `unknown sheet "${chart.sheet}" — must be one of: ${sheetNames.join(", ")}` +
              (plan.newSheets.length ? ` (or a declared new sheet: ${plan.newSheets.join(", ")})` : "") +
              `. To add a sheet, declare it in "newSheets".`,
          });
        }
      });
    });
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export interface FormulaParseFailure {
  sheet: string;
  cell: string;
  formula: string;
  error: string;
}

export interface AppliedPlan {
  workbook: ParsedWorkbook;
  sim: Simulator;
  /** Canonical sheet name -> cell ref -> formula text (leading "=" stripped). */
  editedFormulas: Map<string, Map<string, string>>;
  /** Canonical sheet name -> cell ref -> literal written (null for clears). */
  editedValues: Map<string, Map<string, CellValue>>;
  /** Sheets the plan created that the input file did not have. */
  newSheets: string[];
  /**
   * Engine keys ("SHEET!B12") of every cell the plan edited plus everything
   * downstream of one in the dependency graph — the edits' full blast
   * radius. Outside this set the file's own cached values are authoritative:
   * the engine's recalculation of an untouched cell must never override
   * what Excel itself computed, or every engine/Excel disagreement anywhere
   * in the workbook would be scored as damage the plan did.
   */
  affectedKeys: Set<string>;
  /** Formulas the engine's parser rejected; written as literal text instead. */
  formulaParseFailures: FormulaParseFailure[];
  /** Function names that evaluated to #NAME? — outside the engine's registry. */
  unsupportedFunctions: string[];
}

export function canonicalSheet(workbook: ParsedWorkbook, newSheets: string[], name: string): string {
  const target = name.trim().toLowerCase();
  for (const s of workbook.sheets) {
    if (s.name.trim().toLowerCase() === target) return s.name;
  }
  for (const s of newSheets) {
    if (s.trim().toLowerCase() === target) return s;
  }
  return name;
}

function record<V>(map: Map<string, Map<string, V>>, sheet: string, ref: string, v: V): void {
  let inner = map.get(sheet);
  if (!inner) {
    inner = new Map();
    map.set(sheet, inner);
  }
  inner.set(ref, v);
}

const FN_NAME = /([A-Z][A-Z0-9._]*)\s*\(/g;

function unsupportedIn(formula: string, registry: Set<string>): string[] {
  const out: string[] = [];
  for (const m of formula.toUpperCase().matchAll(FN_NAME)) {
    if (!registry.has(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * The three pieces of AppliedPlan state that applyEditsToSim mutates —
 * AppliedPlan itself satisfies this structurally, so applyEditPlan can pass
 * its own `state` straight through as the accumulator.
 */
export interface EditAccumulator {
  editedFormulas: Map<string, Map<string, string>>;
  editedValues: Map<string, Map<string, CellValue>>;
  formulaParseFailures: FormulaParseFailure[];
}

/**
 * How applyEditsToSim reacts to a formula the engine's parser rejects.
 *  - "record": today's applyEditPlan behavior — never throws; the failure is
 *    recorded and the (shifted) formula text is written as a literal so the
 *    output shows what happened. The benchmark exists to surface exactly
 *    that kind of gap, never to stop the run over it.
 *  - "throw": stop applying immediately. The failure is still recorded into
 *    `acc.formulaParseFailures` first (so a caller inspecting the
 *    accumulator after a catch sees the same structured detail), then
 *    `onParseFailure` is invoked if the caller supplied one — expected to
 *    throw itself (lib/work/run.ts's WorkExecutionError is exactly this,
 *    passed in as that callback so this module never has to import
 *    lib/work) — and a plain Error as a fallback if it does not.
 */
export type EditApplyMode = "record" | "throw";

/**
 * Apply `edits` to an already-created Simulator, writing into `acc`. This is
 * the loop applyEditPlan has always run, pulled out so lib/work/run.ts's
 * runWork can share it: a Work's `edits` op is applied cell-by-cell exactly
 * the way a benchmark plan is, the only difference being what happens when a
 * formula fails to parse (see EditApplyMode above). Does not touch
 * affectedKeys, does not recalculate() — those are the caller's job, since a
 * Work runs several ops against one Simulator and only wants one dirty-set
 * capture / recalculate per op, not per edit.
 */
export async function applyEditsToSim(
  sim: Simulator,
  workbook: ParsedWorkbook,
  edits: CellEdit[],
  newSheets: string[],
  acc: EditAccumulator,
  mode: EditApplyMode,
  onParseFailure?: (failure: FormulaParseFailure) => never,
): Promise<void> {
  for (const edit of edits) {
    const sheet = canonicalSheet(workbook, newSheets, edit.sheet);
    const box = boundedBox(edit.range);
    if (!box) continue; // schema already rejected these; belt and braces

    for (let r = box.startRow; r <= box.endRow; r++) {
      for (let c = box.startCol; c <= box.endCol; c++) {
        const ref = formatCell(r, c);

        if (edit.formula !== undefined) {
          const shifted = shiftFormula(edit.formula, r - box.startRow, c - box.startCol);
          const text = shifted.replace(/^=+/, "");
          try {
            await sim.setFormula(sheet, ref, text);
            record(acc.editedFormulas, sheet, ref, text);
            acc.editedValues.get(sheet)?.delete(ref);
          } catch (err) {
            const failure: FormulaParseFailure = {
              sheet,
              cell: ref,
              formula: shifted,
              error: err instanceof Error ? err.message : String(err),
            };
            acc.formulaParseFailures.push(failure);
            if (mode === "throw") {
              if (onParseFailure) onParseFailure(failure);
              throw new Error(`unparseable formula in ${sheet}!${ref}: ${failure.error}`);
            }
            await sim.setValue(sheet, ref, shifted);
            record(acc.editedValues, sheet, ref, shifted);
            acc.editedFormulas.get(sheet)?.delete(ref);
          }
        } else if (edit.values !== undefined) {
          const v = edit.values[r - box.startRow][c - box.startCol];
          await sim.setValue(sheet, ref, v);
          record(acc.editedValues, sheet, ref, v);
          acc.editedFormulas.get(sheet)?.delete(ref);
        } else if (edit.value !== undefined) {
          await sim.setValue(sheet, ref, edit.value);
          record(acc.editedValues, sheet, ref, edit.value);
          acc.editedFormulas.get(sheet)?.delete(ref);
        } else if (edit.clear) {
          await sim.setValue(sheet, ref, null);
          record(acc.editedValues, sheet, ref, null);
          acc.editedFormulas.get(sheet)?.delete(ref);
        }
      }
    }
  }
}

/**
 * Apply a validated plan to a fresh Simulator over `workbook` and
 * recalculate. Never throws for a bad formula: the engine's parser rejecting
 * a formula is a *finding* (recorded, and the text is written as a literal
 * so the output shows what happened) — the benchmark exists to surface
 * exactly that kind of gap.
 */
export async function applyEditPlan(
  workbook: ParsedWorkbook,
  plan: CellEditPlan,
): Promise<AppliedPlan> {
  // Bench-only opt-in: a deliberate circular model (e.g. interest on average
  // debt) that Excel resolves via iterative calculation must not score as
  // #CIRCULAR! here just because our default engine behavior — used
  // everywhere else — refuses to guess at a cycle's fixpoint. See
  // lib/formula/simulate.ts's `SimulatorOptions.iterateCycles` doc.
  const sim = createSimulator(workbook, { iterateCycles: true });
  const state: AppliedPlan = {
    workbook,
    sim,
    editedFormulas: new Map(),
    editedValues: new Map(),
    newSheets: plan.newSheets,
    affectedKeys: new Set(),
    formulaParseFailures: [],
    unsupportedFunctions: [],
  };

  await applyEditsToSim(sim, workbook, plan.edits, plan.newSheets, state, "record");

  // The dirty set right now is the edited cells plus their downstream
  // closure — recalculate() consumes the marks, so capture first.
  state.affectedKeys = new Set(sim.dirtyCells());

  await sim.recalculate();

  // The honest-count pass: an edited formula that evaluated to #NAME? names
  // functions the registry lacks. Silent zeros are the one unforgivable
  // failure mode here.
  const registry = new Set(Object.keys(FUNCTION_REGISTRY));
  const unsupported = new Set<string>();
  for (const [sheet, cells] of state.editedFormulas) {
    for (const [ref, formula] of cells) {
      const value = sim.getValue(sheet, ref);
      if (isExcelError(value) && value.code === "#NAME?") {
        for (const fn of unsupportedIn(formula, registry)) unsupported.add(fn);
      }
    }
  }
  state.unsupportedFunctions = [...unsupported];

  return state;
}

// ---------------------------------------------------------------------------
// Downstream lookups used by the scorer and the axis check
// ---------------------------------------------------------------------------

/** Looks up the raw GridCell for a single-cell ref. Private, ~8-line twin of
 *  lib/bench/readers.ts's exported `cellAt` (which this module must not
 *  import — that file is benchmark-only): this one only needs to answer
 *  cellIsUncalculated below. */
function cellAt(workbook: ParsedWorkbook, sheet: string, ref: string): GridCell | undefined {
  const s = workbook.sheets.find((x) => x.name === sheet);
  if (!s) return undefined;
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!m) return undefined;
  return s.cells.get(cellKey(Number(m[2]) - 1, colToIndex(m[1])));
}

/** Whether `cell` is inside the plan's blast radius (see affectedKeys). */
export function cellIsAffected(state: AppliedPlan, sheet: string, cell: string): boolean {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(cell.trim());
  if (!m) return false;
  return state.affectedKeys.has(makeKey(sheet, m[1], Number(m[2])));
}

/**
 * Whether `cell`'s ORIGINAL (pre-edit, input) GridCell is a formula whose
 * source never cached a value — see GridCell.uncalculated. Looked up on
 * `state.workbook` directly (the parsed input, unaffected by the plan)
 * rather than through a CellReader wrapping it, because a CellReader's
 * `value`/`formulaOrValue` only ever expose the coerced value/formula text,
 * not this raw per-cell flag.
 */
export function cellIsUncalculated(state: AppliedPlan, sheet: string, cell: string): boolean {
  return cellAt(state.workbook, sheet, cell)?.uncalculated === true;
}

/**
 * `cell`'s ORIGINAL (pre-edit, input) value and display text, read the same
 * way cellIsUncalculated does — `undefined` when the input had no cell there
 * at all (a genuinely blank cell was never added to ParsedSheet.cells, see
 * parseWorkbook). Used by lib/agent/loop.ts's first-submit preview to show
 * what a cell the plan never directly touched used to hold, before an edit
 * elsewhere rippled through the dependency graph and recomputed it — the
 * "was X -> now Y" blast-radius line. `value` is GridCell.value narrowed to
 * `CellValue`, which is safe here: a freshly-parsed input cell's raw value is
 * always a plain number/string/boolean/Date/null, never an ExcelErrorValue
 * or a 2D array (those only ever arise from formula evaluation).
 */
export function originalCellSnapshot(
  state: AppliedPlan,
  sheet: string,
  cell: string,
): { value: CellValue; text: string } | undefined {
  const c = cellAt(state.workbook, sheet, cell);
  if (!c) return undefined;
  return { value: (c.value ?? null) as CellValue, text: c.text };
}
