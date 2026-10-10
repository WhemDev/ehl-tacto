/**
 * Walks an AST against an EngineState, dispatching function calls through a
 * caller-supplied registry. Ports engine.py's evaluation methods (see the
 * plan task this was written from for the exact line ranges of each), minus
 * everything about loading a workbook from disk — workbook-model.ts owns
 * that — and minus find_optimal_value, which is not part of this plan.
 */

import { excelError, isExcelError, type AstNode, type CellValue } from "./ast";
import { compareValues, toDisplayString, toNumberForArithmetic } from "./coerce";
import { colToIndex, indexToCol } from "@/lib/a1";
import { makeKey, type CellKey, type DependencyGraph } from "./graph";
import type { ExcelFunction, FunctionEvaluator } from "./evaluator-types";

export interface EngineState {
  formulas: Map<CellKey, AstNode>;
  values: Map<CellKey, CellValue>;
  graph: DependencyGraph;
  /**
   * Per-sheet used extent (1-based row count, 0-based-exclusive col count —
   * i.e. `cols` cells span index 0..cols-1), keyed by upper-cased sheet
   * name. This is how a whole-column (`C:C`) or whole-row (`3:3`) reference
   * gets bounded to real cells instead of Excel's theoretical 1,048,576-row
   * grid — see resolveRange/walkRefs below. buildWorkbookModel
   * (workbook-model.ts) populates this from ParsedSheet.rows/.cols, which
   * are already clamped to lib/workbook.ts's MAX_ROWS/MAX_COLS, so an open
   * reference resolved through this map can never approach that real
   * ceiling. Optional, with DEFAULT_SHEET_BOUNDS as the fallback for an
   * unlisted sheet, so the many hand-rolled EngineState literals across the
   * test suite (test/formula-evaluate.test.ts's emptyState, for instance)
   * don't need updating for a feature they don't exercise.
   */
  sheetBounds?: Map<string, { rows: number; cols: number }>;
}

export type FunctionRegistry = Record<string, ExcelFunction>;

/** Fallback used whenever a sheet has no entry in EngineState.sheetBounds —
 *  the same envelope lib/a1.ts's parseRange defaults to (and lib/workbook.ts's
 *  own MAX_ROWS/MAX_COLS), so an open reference against an unknown sheet is
 *  bounded exactly as generously as everywhere else in the app, never more. */
const DEFAULT_SHEET_BOUNDS = { rows: 5000, cols: 100 };

function sheetBoundsFor(sheet: string, state: EngineState): { rows: number; cols: number } {
  return state.sheetBounds?.get(sheet) ?? DEFAULT_SHEET_BOUNDS;
}

/** The cell whose formula is currently being evaluated — travels through
 *  every recursive call so a nested ROW()/COLUMN() still answers correctly. */
export interface CellOrigin {
  readonly sheet: string;
  readonly col: string;
  readonly row: number;
}

export function evalNode(
  node: AstNode,
  origin: CellOrigin,
  state: EngineState,
  functions: FunctionRegistry,
): CellValue {
  switch (node.type) {
    case "number":
      return node.value;
    case "string":
      return node.value;
    case "bool":
      return node.value;
    case "errorLiteral":
      return excelError(node.code);
    case "cellRef": {
      const sheet = (node.sheet ?? origin.sheet).toUpperCase();
      return state.values.get(makeKey(sheet, node.col, node.row)) ?? null;
    }
    case "rangeRef":
      return resolveRange(node, origin.sheet, state);
    case "binOp":
      return evalBinOp(node, origin, state, functions);
    case "unaryOp": {
      const val = evalNode(node.operand, origin, state, functions);
      if (isExcelError(val)) return val;
      const n = toNumberForArithmetic(val);
      return isExcelError(n) ? n : -n;
    }
    case "percent": {
      const val = evalNode(node.operand, origin, state, functions);
      if (isExcelError(val)) return val;
      const n = toNumberForArithmetic(val);
      return isExcelError(n) ? n : n / 100;
    }
    case "funcCall":
      return evalFuncCall(node, origin, state, functions);
    default: {
      const exhaustive: never = node;
      throw new Error(`unhandled AST node: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function evalBinOp(
  node: Extract<AstNode, { type: "binOp" }>,
  origin: CellOrigin,
  state: EngineState,
  functions: FunctionRegistry,
): CellValue {
  const left = evalNode(node.left, origin, state, functions);
  if (isExcelError(left)) return left;
  // Evaluated only when the left side didn't already error. evalNode has no
  // side effects, so this can never change the final value versus always
  // evaluating both — it only skips work whose result would be discarded.
  const right = evalNode(node.right, origin, state, functions);
  if (isExcelError(right)) return right;

  if (node.op === "&") return toDisplayString(left) + toDisplayString(right);

  if (
    node.op === "=" || node.op === "<>" ||
    node.op === "<" || node.op === ">" ||
    node.op === "<=" || node.op === ">="
  ) {
    return compareValues(left, right, node.op);
  }

  const l = toNumberForArithmetic(left);
  if (isExcelError(l)) return l;
  const r = toNumberForArithmetic(right);
  if (isExcelError(r)) return r;

  switch (node.op) {
    case "+": return l + r;
    case "-": return l - r;
    case "*": return l * r;
    case "/": return r === 0 ? excelError("#DIV/0!") : l / r;
    case "^": {
      const result = l ** r;
      return Number.isFinite(result) ? result : excelError("#NUM!");
    }
  }
}

/** A range's resolved bounds — column indices (0-based, via colToIndex) and
 *  1-based rows, with the open-axis placeholder already substituted for a
 *  whole-column/whole-row range. Shared by resolveRange (which walks these
 *  bounds into an actual CellValue[][]) and applyImplicitIntersection below
 *  (which needs the bounds themselves — not the resolved array's shape — to
 *  tell "single column" and "does the origin's row fall inside it" apart
 *  from a function result that merely happens to be that shape). */
interface RangeBounds {
  sheet: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

function rangeBounds(
  node: Extract<AstNode, { type: "rangeRef" }>,
  defaultSheet: string,
  state: EngineState,
): RangeBounds {
  const { start, end } = node;
  const sheet = (start.sheet ?? defaultSheet).toUpperCase();
  let startRow = start.row;
  let endRow = end.row;
  let startCol = colToIndex(start.col);
  let endCol = colToIndex(end.col);

  // Open forms (C:C, 3:3) carry placeholder rows/cols on the axis they
  // don't specify (see ast.ts's RangeRef doc) — substitute the target
  // sheet's real used extent for that axis here, bounded (never Excel's
  // theoretical 1,048,576-row grid) by sheetBoundsFor's fallback.
  if (node.wholeColumn || node.wholeRow) {
    const bounds = sheetBoundsFor(sheet, state);
    if (node.wholeColumn) {
      startRow = 1;
      endRow = Math.max(1, bounds.rows);
    }
    if (node.wholeRow) {
      startCol = 0;
      endCol = Math.max(0, bounds.cols - 1);
    }
  }

  return { sheet, startRow, endRow, startCol, endCol };
}

function resolveRange(
  node: Extract<AstNode, { type: "rangeRef" }>,
  defaultSheet: string,
  state: EngineState,
): CellValue[][] {
  const { sheet, startRow, endRow, startCol, endCol } = rangeBounds(node, defaultSheet, state);

  const result: CellValue[][] = [];
  for (let r = startRow; r <= endRow; r++) {
    const row: CellValue[] = [];
    for (let c = startCol; c <= endCol; c++) {
      row.push(state.values.get(makeKey(sheet, indexToCol(c), r)) ?? null);
    }
    result.push(row);
  }
  return result;
}

/**
 * Excel's implicit intersection rule, applied ONLY to a formula's TOP-LEVEL
 * result — never to a range nested inside a larger expression (see
 * commitValue's doc for why this matters and where it's actually called).
 *
 * Real Excel: a bare range reference used as an ordinary (non-array) cell's
 * whole formula doesn't hand the cell the whole array — it intersects the
 * range against the formula cell's own position. A single-column range
 * intersected against the origin's ROW picks that row's cell; a single-row
 * range intersected against the origin's COLUMN picks that column's cell (a
 * range on a different sheet than the origin still intersects this way — the
 * row/column numbers are compared, not the sheets); anything else that isn't
 * a plain 1x1 range is #VALUE!. A 1x1 range always has exactly one candidate
 * cell regardless of where the origin sits, so it's returned unconditionally
 * rather than only when the origin happens to coincide with it.
 */
function applyImplicitIntersection(
  node: Extract<AstNode, { type: "rangeRef" }>,
  origin: CellOrigin,
  state: EngineState,
  arr: CellValue[][],
): CellValue {
  const bounds = rangeBounds(node, origin.sheet, state);
  const singleColumn = bounds.startCol === bounds.endCol;
  const singleRow = bounds.startRow === bounds.endRow;

  if (singleColumn && origin.row >= bounds.startRow && origin.row <= bounds.endRow) {
    return arr[origin.row - bounds.startRow]?.[0] ?? null;
  }
  const originColIdx = colToIndex(origin.col);
  if (singleRow && originColIdx >= bounds.startCol && originColIdx <= bounds.endCol) {
    return arr[0]?.[originColIdx - bounds.startCol] ?? null;
  }
  if (singleColumn && singleRow) {
    return arr[0]?.[0] ?? null;
  }
  return excelError("#VALUE!");
}

/**
 * What recalculate() (and resolveCyclesIteratively) actually store into
 * state.values for a formula cell — evalNode's own return value, with one
 * post-processing step applied ONLY at this top level: an array result gets
 * collapsed to a single CellValue, since an ordinary (non-array-formula)
 * cell can never actually hold a CellValue[][] — Excel doesn't let it, and
 * this engine storing one anyway is exactly the bug this function exists to
 * close (a raw array landing in state.values then poisons every downstream
 * consumer that reads the cell expecting a scalar — e.g. SUMIF's criteria
 * argument, which just gets evaluator.resolveArg'd straight off
 * state.values).
 *
 * A NESTED occurrence of the very same range or function call is completely
 * unaffected: `SUM('a'!C5:C6)` still gets the full array handed to it,
 * because SUM's own evaluator.resolveArg call goes through evalNode
 * directly, never through this function — commitValue is called only at the
 * two places a formula cell's value is actually committed, both in this
 * file's recalculate/resolveCyclesIteratively, not from anywhere evalNode
 * itself recurses.
 *
 * Two different array-returning shapes reach here, handled differently:
 *
 *  - The formula's ROOT AST NODE is itself a rangeRef (a bare range used
 *    directly as a formula, e.g. `='Other'!C5:C6`) — this is a genuine
 *    Excel implicit-intersection case, handled by applyImplicitIntersection
 *    above. This needs the range's exact bounds, which only the AST node
 *    can give — the resolved array's own shape can't distinguish "3 rows
 *    because the range IS 3 rows" from "3 rows because some function
 *    happened to return a 3-row block" — hence switching on the AST root
 *    rather than inspecting `raw`'s shape.
 *
 *  - Any OTHER array-returning root (a bare function call like
 *    `=OFFSET(A1,0,0,3,1)` used directly as a formula, height/width both
 *    >1) — real Excel's implicit intersection is a REFERENCE-only rule; it
 *    does not apply to a value a function merely computed, even if that
 *    function happens to have resolved a reference internally. This engine
 *    already has an established convention for what a bare array-typed
 *    CellValue collapses to for a single-value consumer: take [0][0] — see
 *    lib/bench/readers.ts's benchValueFrom and lib/agent/loop.ts's
 *    formatPreviewValue, both pre-existing and both already doing exactly
 *    this whenever they encounter an array CellValue. Matching that
 *    convention here (rather than inventing a second, #VALUE!-based rule
 *    just for this case) is the least-surprising choice available: every
 *    other place in the codebase that ever collapses an array CellValue
 *    already agrees on [0][0], and it also happens to fix the analogous
 *    bare-OFFSET-as-a-whole-formula case the same way.
 */
function commitValue(
  node: AstNode,
  origin: CellOrigin,
  state: EngineState,
  functions: FunctionRegistry,
): CellValue {
  const raw = evalNode(node, origin, state, functions);
  if (!Array.isArray(raw)) return raw;
  if (node.type === "rangeRef") return applyImplicitIntersection(node, origin, state, raw);
  return raw[0]?.[0] ?? null;
}

function evalFuncCall(
  node: Extract<AstNode, { type: "funcCall" }>,
  origin: CellOrigin,
  state: EngineState,
  functions: FunctionRegistry,
): CellValue {
  const fn = functions[node.name];
  if (!fn) return excelError("#NAME?");

  const evaluator: FunctionEvaluator = {
    resolveArg: (arg) => evalNode(arg, origin, state, functions),
    getCellValue: (sheet, col, row) => state.values.get(makeKey(sheet, col, row)) ?? null,
    currentSheet: origin.sheet,
    currentRow: origin.row,
    currentColIndex: colToIndex(origin.col) + 1,
    // origin never changes across a cell's own evaluation (see CellOrigin's
    // doc) — including nested calls, so the graph edge lands on the actual
    // top-level formula cell being (re)evaluated, not any inner call frame.
    // DependencyGraph.addDynamicRefs is itself a no-op when originKey isn't
    // a known formula cell (evalNode called outside recalculate(), e.g. a
    // bare unit-test evalFormula helper), so this never needs its own guard.
    reportResolvedRange: (sheet, startRow, endRow, startColIndex, endColIndex) => {
      const originKey = makeKey(origin.sheet, origin.col, origin.row);
      const upperSheet = sheet.toUpperCase();
      const refs: CellKey[] = [];
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startColIndex; c <= endColIndex; c++) {
          refs.push(makeKey(upperSheet, indexToCol(c), r));
        }
      }
      state.graph.addDynamicRefs(originKey, refs);
    },
  };

  try {
    return fn(evaluator, node.args);
  } catch {
    // A bug in one function degrades that cell to an error, not a crash of
    // the whole recalculation. Matches engine.py::_eval_func exactly.
    return excelError("#VALUE!");
  }
}

/**
 * Every cell an AST references, expanding ranges to every cell inside them —
 * including a whole-column/whole-row range's open axis, bounded against
 * `sheetBounds` (falling back to DEFAULT_SHEET_BOUNDS when omitted or the
 * range's sheet isn't in it) exactly like resolveRange above. This is what
 * makes an edit inside a `C:C` formula's column actually dirty that formula:
 * without a bounded edge to every cell in the column, markDirty's BFS would
 * never reach it. `sheetBounds` is optional so the many callers that only
 * ever pass ordinary bounded ranges (most of the test suite) don't need it.
 */
export function extractRefs(
  node: AstNode,
  defaultSheet: string,
  sheetBounds?: Map<string, { rows: number; cols: number }>,
): Set<CellKey> {
  const refs = new Set<CellKey>();
  walkRefs(node, defaultSheet, refs, sheetBounds);
  return refs;
}

function walkRefs(
  node: AstNode,
  defaultSheet: string,
  refs: Set<CellKey>,
  sheetBounds?: Map<string, { rows: number; cols: number }>,
): void {
  switch (node.type) {
    case "cellRef": {
      const sheet = (node.sheet ?? defaultSheet).toUpperCase();
      refs.add(makeKey(sheet, node.col, node.row));
      return;
    }
    case "rangeRef": {
      const sheet = (node.start.sheet ?? defaultSheet).toUpperCase();
      let startCol = colToIndex(node.start.col);
      let endCol = colToIndex(node.end.col);
      let startRow = node.start.row;
      let endRow = node.end.row;
      if (node.wholeColumn || node.wholeRow) {
        const bounds = sheetBounds?.get(sheet) ?? DEFAULT_SHEET_BOUNDS;
        if (node.wholeColumn) {
          startRow = 1;
          endRow = Math.max(1, bounds.rows);
        }
        if (node.wholeRow) {
          startCol = 0;
          endCol = Math.max(0, bounds.cols - 1);
        }
      }
      for (let c = startCol; c <= endCol; c++) {
        for (let r = startRow; r <= endRow; r++) {
          refs.add(makeKey(sheet, indexToCol(c), r));
        }
      }
      return;
    }
    case "binOp":
      walkRefs(node.left, defaultSheet, refs, sheetBounds);
      walkRefs(node.right, defaultSheet, refs, sheetBounds);
      return;
    case "unaryOp":
      walkRefs(node.operand, defaultSheet, refs, sheetBounds);
      return;
    case "percent":
      walkRefs(node.operand, defaultSheet, refs, sheetBounds);
      return;
    case "funcCall":
      for (const arg of node.args) walkRefs(arg, defaultSheet, refs, sheetBounds);
      return;
    case "number":
    case "string":
    case "bool":
    case "errorLiteral":
      return;
  }
}

function originFromKey(key: CellKey): CellOrigin {
  const bang = key.indexOf("!");
  const sheet = key.slice(0, bang);
  const rest = key.slice(bang + 1);
  const colEnd = rest.search(/\d/);
  return { sheet, col: rest.slice(0, colEnd), row: Number(rest.slice(colEnd)) };
}

/**
 * Excel-style iterative calculation options for resolving a deliberate
 * circular reference (e.g. interest expense on average debt, which itself
 * depends on interest expense) instead of stamping #CIRCULAR!. Opt-in only —
 * see recalculate's `cycles` parameter.
 */
export interface IterativeCycleOptions {
  /** Stop after this many Gauss-Seidel passes even if not yet converged —
   *  the non-convergent-guard: a diverging or oscillating cycle must still
   *  terminate. */
  maxIterations: number;
  /** A pass where every cell moved less than this counts as converged. */
  maxChange: number;
}

/**
 * Recalculates every dirty formula cell in dependency order. Cells caught in
 * a cycle (or downstream of one) get #CIRCULAR! instead of the crash Python
 * has no way to avoid — see graph.ts — UNLESS the caller opts into iterative
 * calculation via `cycles`, in which case those cells are resolved by
 * Gauss-Seidel relaxation instead (see `resolveCyclesIteratively`). Omitting
 * `cycles` reproduces the exact previous behavior byte-for-byte; this is a
 * caller opt-in, never an honor-the-file's-own-`iterate`-flag — see
 * workbook.ts's `ParsedWorkbook.calcPr` doc for why.
 */
export function recalculate(
  state: EngineState,
  functions: FunctionRegistry,
  cycles?: IterativeCycleOptions,
): void {
  const { order, unresolved } = state.graph.topologicalOrder();

  for (const key of order) {
    const formula = state.formulas.get(key);
    if (formula) {
      // Dynamic edges (OFFSET's resolved target, etc.) are rebuilt fresh on
      // every evaluation — see FunctionEvaluator.reportResolvedRange and
      // graph.ts's resetDynamicRefs doc — so a target that moved since the
      // last recalc never leaves a stale edge to the range it used to read.
      state.graph.resetDynamicRefs(key);
      try {
        state.values.set(key, commitValue(formula, originFromKey(key), state, functions));
      } catch {
        // A cell whose evaluation itself throws (not just a function call —
        // evalFuncCall above already guards that case) degrades to #VALUE!
        // instead of taking down the whole recalculation. Matches
        // engine.py::_recalculate's own `try/except Exception: val =
        // VALUE_ERROR` exactly.
        state.values.set(key, excelError("#VALUE!"));
      }
    }
    state.graph.clearDirty(key);
  }

  if (unresolved.length > 0 && cycles) {
    resolveCyclesIteratively(state, functions, unresolved, cycles);
  } else {
    for (const key of unresolved) {
      state.values.set(key, excelError("#CIRCULAR!"));
    }
  }
  for (const key of unresolved) {
    state.graph.clearDirty(key);
  }
}

/**
 * Gauss-Seidel relaxation over `unresolved` (a cycle, plus anything
 * downstream of one — graph.ts's `topologicalOrder` already computed this
 * exact set). Each pass re-evaluates every cell in `unresolved`, in order,
 * exactly like the main loop above (same try/catch → #VALUE! degradation),
 * writing straight into `state.values` — so the very next cell in the same
 * pass, and every cell in the next pass, already sees the update (this is
 * what makes it Gauss-Seidel rather than Jacobi: updates are visible
 * immediately, not only after a full pass).
 *
 * Starting values are whatever `state.values` already holds for these keys
 * going in — nothing is reset to zero first. On a simulator that has already
 * converged once (the common case: an edit's incremental recalculate() call
 * after `createSimulator`'s own initial full recalculate), that seed is the
 * previous fixpoint, so a small edit typically reconverges in only a few
 * passes. On a cell with no formula reachable here (shouldn't occur — see
 * graph.ts's doc on how a cycle forms — but handled defensively), the value
 * is simply left untouched rather than assumed to be a formula cell.
 *
 * Stops as soon as a whole pass moves every cell by less than
 * `cycles.maxChange`, or after `cycles.maxIterations` passes, whichever
 * comes first — the latter is what guarantees termination for a cycle that
 * diverges or oscillates instead of converging (e.g. `A1: =A1+1`). Whatever
 * values stand at the end are the answer; no #CIRCULAR! is ever stamped once
 * this path is taken.
 */
function resolveCyclesIteratively(
  state: EngineState,
  functions: FunctionRegistry,
  unresolved: CellKey[],
  cycles: IterativeCycleOptions,
): void {
  for (let pass = 0; pass < cycles.maxIterations; pass++) {
    let maxDelta = 0;

    for (const key of unresolved) {
      const formula = state.formulas.get(key);
      if (!formula) continue;

      state.graph.resetDynamicRefs(key); // see the main loop above for why
      const prev = state.values.get(key) ?? null;
      let next: CellValue;
      try {
        next = commitValue(formula, originFromKey(key), state, functions);
      } catch {
        next = excelError("#VALUE!");
      }
      state.values.set(key, next);

      const delta = cellDelta(prev, next);
      if (delta > maxDelta) maxDelta = delta;
    }

    if (maxDelta < cycles.maxChange) break;
  }
}

/** |next - prev| when both are numbers; 0 for an identical non-numeric value
 *  (including two errors with the same code); Infinity otherwise — a value
 *  that just changed kind (e.g. #VALUE! -> a number) never reads as
 *  "converged" by coincidence. */
function cellDelta(prev: CellValue, next: CellValue): number {
  if (typeof prev === "number" && typeof next === "number") {
    return Math.abs(next - prev);
  }
  if (isExcelError(prev) && isExcelError(next)) {
    return prev.code === next.code ? 0 : Infinity;
  }
  return prev === next ? 0 : Infinity;
}
