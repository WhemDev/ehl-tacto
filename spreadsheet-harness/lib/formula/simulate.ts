/**
 * The public API. Ports engine.py's public surface — get_value, set_value,
 * recalculate, evaluate_with_changes, and the snapshot/restore machinery
 * behind it — minus find_optimal_value (not part of this plan) and minus
 * loading from a file path (Task 7 already replaced that). See the plan
 * task this was written from for why this takes one ParsedWorkbook rather
 * than several, which deliberately differs from the design spec's own
 * sketch of this function's signature.
 *
 * Deliberate divergence — evaluateWithChanges' return type: Python's
 * engine.py::evaluate_with_changes (line ~445) runs every target through
 * `_extract_scalar`, coercing each one to `float | None` before returning
 * it. This port returns the raw `CellValue` for each target instead — the
 * actual value a cell holds, not a lossy numeric approximation of it. That's
 * intentional: a caller that wants the real string, boolean, Date, or
 * ExcelErrorValue a cell produced can now get it, where Python's caller
 * could only ever get a number or None.
 *
 * The trap for a future caller: the design spec's own sketch of a solver
 * (a future find_optimal_value-style caller comparing a target against a
 * numeric [min, max] band, the way Python's does with `min_val <= val <=
 * max_val`) must NOT assume the returned value is a plain number the way
 * Python's caller safely could. It has to check `typeof val === "number"`
 * itself before comparing — the value here could just as easily be a
 * string, a boolean, a Date, or an ExcelErrorValue, and a band comparison
 * against any of those is nonsense.
 */

import type { ParsedWorkbook } from "@/lib/workbook";
import type { AstNode, CellValue } from "./ast";
import { extractRefs, recalculate as recalculateEngine, type EngineState } from "./evaluate";
import { FUNCTION_REGISTRY } from "./functions";
import { DependencyGraph, makeKey, type CellKey } from "./graph";
import { parseFormula } from "./parser";
import { buildWorkbookModel } from "./workbook-model";

export interface Simulator {
  evaluateWithChanges(
    changes: Record<string, Record<string, CellValue>>,
    targets: Record<string, string[]>,
  ): Promise<Record<string, Record<string, CellValue>>>;
  setValue(sheet: string, cell: string, value: CellValue): Promise<void>;
  /**
   * Install `formulaText` (with or without its leading `=`) as the cell's
   * formula, replacing any previous formula or literal. Throws on a formula
   * the parser cannot read — the caller decides whether that is a validation
   * failure to surface or a value to fall back to. Takes effect on the next
   * recalculate(), like setValue.
   */
  setFormula(sheet: string, cell: string, formulaText: string): Promise<void>;
  recalculate(): Promise<void>;
  getValue(sheet: string, cell: string): CellValue;
  /**
   * The cells currently marked dirty: after a run of setValue/setFormula
   * calls this is exactly those cells plus everything downstream of them in
   * the dependency graph — the full blast radius of the edits. Read it
   * BEFORE recalculate(), which computes the dirty cells and clears the
   * marks as it goes.
   */
  dirtyCells(): CellKey[];
  /** Direct precedents of `cell` ("SHEET!B12" keys), for analysis tools. */
  precedentsOf(sheet: string, cell: string): CellKey[];
  /** Direct dependents of `cell` ("SHEET!B12" keys), for analysis tools. */
  dependentsOf(sheet: string, cell: string): CellKey[];
}

function parseCellAddr(addr: string): { col: string; row: number } {
  const s = addr.toUpperCase().replace(/\$/g, "");
  let i = 0;
  while (i < s.length && /[A-Z]/.test(s[i])) i++;
  return { col: s.slice(0, i), row: Number(s.slice(i)) };
}

interface Snapshot {
  values: Map<CellKey, CellValue>;
  formulas: Map<CellKey, AstNode>;
}

export interface SimulatorOptions {
  /**
   * Opt into Excel-style iterative calculation for circular references,
   * Gauss-Seidel style, instead of stamping #CIRCULAR! on a cycle (and
   * everything downstream of it). Off by default — the app's own behavior,
   * and the oracle-pinned #CIRCULAR! tests, must stay byte-identical.
   * Deliberately independent of the workbook's own `calcPr.iterate` flag
   * (see `ParsedWorkbook.calcPr`'s doc): a caller here decides to iterate;
   * the file merely supplies the iterateCount/iterateDelta to iterate *with*
   * once that decision is made.
   */
  iterateCycles?: boolean;
}

export function createSimulator(workbook: ParsedWorkbook, opts?: SimulatorOptions): Simulator {
  return buildSimulator(workbook, opts, "undoLog");
}

/**
 * Test-only twin of createSimulator: identical in every way except that its
 * evaluateWithChanges takes the OLD path — whole-workbook snapshot() of the
 * values+formulas Maps, then restore() throwing the graph away and rebuilding
 * it from zero (re-running extractRefs over every formula in the workbook).
 *
 * Exists solely so test/formula-simulate-determinism.test.ts can run the same
 * randomized change-sets through this and through createSimulator's undo-log
 * path and assert byte-identical results — the correctness guarantee for the
 * fast path. No production code should call this; it is deliberately the
 * slow O(whole workbook) implementation the undo log replaced.
 */
export function createSimulatorWithLegacyRestore(
  workbook: ParsedWorkbook,
  opts?: SimulatorOptions,
): Simulator {
  return buildSimulator(workbook, opts, "legacySnapshot");
}

type RestoreStrategy = "undoLog" | "legacySnapshot";

function buildSimulator(
  workbook: ParsedWorkbook,
  opts: SimulatorOptions | undefined,
  strategy: RestoreStrategy,
): Simulator {
  const state: EngineState = buildWorkbookModel(workbook);
  const cycles = opts?.iterateCycles
    ? {
        maxIterations: workbook.calcPr?.iterateCount ?? 100,
        maxChange: workbook.calcPr?.iterateDelta ?? 0.001,
      }
    : undefined;
  const runRecalculate = () => recalculateEngine(state, FUNCTION_REGISTRY, cycles);

  state.graph.markAllDirty();
  runRecalculate();

  function applyChange(sheet: string, cellAddr: string, value: CellValue): void {
    const { col, row } = parseCellAddr(cellAddr);
    const key = makeKey(sheet, col, row);
    state.values.set(key, value);
    if (state.formulas.has(key)) {
      state.formulas.delete(key);
      state.graph.removeFormula(key);
    }
    state.graph.markDirty(key);
  }

  // ---------------------------------------------------------------------
  // Legacy path — whole-workbook snapshot + graph rebuild. Kept only for
  // createSimulatorWithLegacyRestore (see its doc above); production code
  // takes the undo-log path below instead.
  // ---------------------------------------------------------------------

  function legacySnapshot(): Snapshot {
    return { values: new Map(state.values), formulas: new Map(state.formulas) };
  }

  function legacyRestore(snap: Snapshot): void {
    state.values = snap.values;
    state.formulas = snap.formulas;
    state.graph = new DependencyGraph();
    for (const [key, ast] of state.formulas) {
      const sheet = key.slice(0, key.indexOf("!"));
      state.graph.addFormulaCell(key, extractRefs(ast, sheet, state.sheetBounds));
    }
    state.graph.clearAllDirty();
  }

  async function evaluateWithChangesLegacy(
    changes: Record<string, Record<string, CellValue>>,
    targets: Record<string, string[]>,
  ): Promise<Record<string, Record<string, CellValue>>> {
    const snap = legacySnapshot();
    try {
      for (const [sheet, cells] of Object.entries(changes)) {
        for (const [cellAddr, value] of Object.entries(cells)) {
          applyChange(sheet, cellAddr, value);
        }
      }
      runRecalculate();

      const results: Record<string, Record<string, CellValue>> = {};
      for (const [sheet, cellList] of Object.entries(targets)) {
        results[sheet] = {};
        for (const cellAddr of cellList) {
          const { col, row } = parseCellAddr(cellAddr);
          results[sheet][cellAddr] = state.values.get(makeKey(sheet, col, row)) ?? null;
        }
      }
      return results;
    } finally {
      legacyRestore(snap);
    }
  }

  // ---------------------------------------------------------------------
  // Undo-log path — the fast one, and what createSimulator actually uses.
  //
  // The whole-workbook rebuild above pays for two things evaluateWithChanges
  // never needed: copying every cell's value and formula (snapshot), and
  // re-deriving every formula cell's graph edges from its AST (restore) —
  // both O(workbook size) no matter how small the change-set was. Neither
  // is necessary. recalculate() (via runRecalculate below) only ever writes
  // to state.values, and only for cells already in the dirty set — it never
  // touches state.formulas or the graph's edges. And applyChange only ever
  // changes formula/graph structure for the exact keys the caller's own
  // `changes` argument names (removing a formula a literal is about to
  // overwrite) — every other cell that ends up recomputed is a downstream
  // dependent whose formula and edges never move, only its cached value.
  //
  // So instead of copying the whole workbook, record — per key, the first
  // time this call touches it — exactly what's needed to undo that key's
  // mutation:
  //   - formulaUndo: the removed AST, but ONLY for keys where applyChange
  //     actually deleted a formula. Restoring these re-installs the formula
  //     and calls addFormulaCell to patch just that key's edges back in
  //     (addFormulaCell already replaces any existing edges for the key
  //     first, so this is safe to call unconditionally).
  //   - valueUndo: the prior value (or its absence) for every touched key —
  //     both the directly-edited ones and everything recalculate() is about
  //     to overwrite. The full set of "about to be overwritten" keys is
  //     exactly state.graph.dirtyCells right after every change has been
  //     applied and markDirty's dependents-BFS has finished propagating,
  //     but before runRecalculate() has actually run — capturing it there
  //     costs nothing extra: markDirty already computed that closure.
  //
  // dirtyCells itself needs no bookkeeping at all: recalculate() always
  // clears every key it read out of the dirty set at call time (both the
  // ones it could order and, in the cycle branch, the unresolved ones too —
  // see evaluate.ts's recalculate), so the dirty set is provably empty the
  // instant runRecalculate() returns, for both this path and the legacy
  // one. There is nothing left to re-dirty or re-clear afterward.
  async function evaluateWithChangesUndoLog(
    changes: Record<string, Record<string, CellValue>>,
    targets: Record<string, string[]>,
  ): Promise<Record<string, Record<string, CellValue>>> {
    const valueUndo = new Map<CellKey, { hadValue: boolean; value: CellValue | undefined }>();
    const formulaUndo = new Map<CellKey, AstNode>();

    const recordValue = (key: CellKey): void => {
      if (valueUndo.has(key)) return;
      valueUndo.set(key, { hadValue: state.values.has(key), value: state.values.get(key) });
    };

    try {
      for (const [sheet, cells] of Object.entries(changes)) {
        for (const [cellAddr, value] of Object.entries(cells)) {
          const { col, row } = parseCellAddr(cellAddr);
          const key = makeKey(sheet, col, row);
          recordValue(key);
          const existingFormula = state.formulas.get(key);
          if (existingFormula !== undefined && !formulaUndo.has(key)) {
            formulaUndo.set(key, existingFormula);
          }
          applyChange(sheet, cellAddr, value);
        }
      }

      // Every key recalculate() is about to overwrite is already dirty at
      // this point — snapshot their pre-recalculate values now.
      for (const key of state.graph.dirtyCells) {
        recordValue(key);
      }

      runRecalculate();

      const results: Record<string, Record<string, CellValue>> = {};
      for (const [sheet, cellList] of Object.entries(targets)) {
        results[sheet] = {};
        for (const cellAddr of cellList) {
          const { col, row } = parseCellAddr(cellAddr);
          results[sheet][cellAddr] = state.values.get(makeKey(sheet, col, row)) ?? null;
        }
      }
      return results;
    } finally {
      // Formula/graph edges only ever moved for keys in formulaUndo — patch
      // just those back in, then restore every touched key's value.
      for (const [key, formula] of formulaUndo) {
        const sheet = key.slice(0, key.indexOf("!"));
        state.formulas.set(key, formula);
        state.graph.addFormulaCell(key, extractRefs(formula, sheet, state.sheetBounds));
      }
      for (const [key, { hadValue, value }] of valueUndo) {
        // hadValue is only true when the earlier state.values.get(key) that
        // produced `value` actually found an entry, so `value` is a real
        // CellValue here, never the `undefined` its type admits for the
        // "key was absent" case (handled by the delete branch instead).
        if (hadValue) state.values.set(key, value as CellValue);
        else state.values.delete(key);
      }
    }
  }

  return {
    async setValue(sheet, cell, value) {
      applyChange(sheet, cell, value);
    },

    async setFormula(sheet, cell, formulaText) {
      const { col, row } = parseCellAddr(cell);
      const key = makeKey(sheet, col, row);
      const ast = parseFormula(formulaText);
      state.formulas.set(key, ast);
      // addFormulaCell replaces any existing edges for the key, so a cell
      // that already carried a formula is rewired rather than doubled up.
      state.graph.addFormulaCell(key, extractRefs(ast, sheet, state.sheetBounds));
      // Any stale literal disappears now: if recalculation cannot produce a
      // value (an unresolvable cycle, say), the cell must read as blank or
      // as the cycle error — never as the number the formula replaced.
      state.values.delete(key);
      state.graph.markDirty(key);
    },

    async recalculate() {
      runRecalculate();
    },

    getValue(sheet, cell) {
      const { col, row } = parseCellAddr(cell);
      return state.values.get(makeKey(sheet, col, row)) ?? null;
    },

    dirtyCells() {
      return [...state.graph.dirtyCells];
    },

    precedentsOf(sheet, cell) {
      const { col, row } = parseCellAddr(cell);
      return state.graph.precedentsOf(makeKey(sheet, col, row));
    },
    dependentsOf(sheet, cell) {
      const { col, row } = parseCellAddr(cell);
      return state.graph.dependentsOf(makeKey(sheet, col, row));
    },

    evaluateWithChanges:
      strategy === "legacySnapshot" ? evaluateWithChangesLegacy : evaluateWithChangesUndoLog,
  };
}
