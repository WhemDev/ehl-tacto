/**
 * The scorer's view of an applied edit plan.
 *
 * The edit-plan schema and its application logic moved to lib/plan/edits.ts
 * in Phase A1 of the Work rework (app adoption — those are workbook-editing
 * primitives, not benchmark-only ones); this shim keeps historical imports
 * of "./edits" working by re-exporting everything from there, and keeps the
 * one genuinely benchmark-only piece — appliedPlanReader, the CellReader
 * adapter scoreTask() compares against — right here, alongside its ./compare
 * and ./readers dependencies.
 */

import type { BenchCellValue, CellReader } from "./compare";
import { benchValueFrom, workbookReader } from "./readers";
import { cellIsAffected, cellIsUncalculated, type AppliedPlan } from "@/lib/plan/edits";

export * from "@/lib/plan/edits";

/**
 * A CellReader over the post-edit workbook state: cells inside the edits'
 * blast radius (edited, or downstream of an edit) read the engine's
 * recalculated value; everything else keeps the file's own cached value —
 * UNLESS the input never cached a value for that cell in the first place
 * (GridCell.uncalculated), in which case there is no Excel-computed answer
 * to defer to, and the engine's value is the only honest one to score. A
 * formula cell WITH a cached input value, outside the blast radius, still
 * always scores by that cache, never the engine — this is what keeps an
 * engine/Excel disagreement elsewhere in the workbook from reading as
 * damage the plan did (see fix3-uncached-recalc.md for the measurements
 * that motivated the "OR uncalculated" branch specifically).
 *
 * Formulas are the original file's except where the plan overwrote or
 * cleared them. This is what gets scored against the golden file — and what
 * an agent editing the file in openpyxl would have produced, where untouched
 * cells keep whatever Excel last computed.
 */
export function appliedPlanReader(state: AppliedPlan): CellReader {
  const original = workbookReader(state.workbook);
  const names = [
    ...state.workbook.sheets.map((s) => s.name),
    ...state.newSheets.filter(
      (n) => !state.workbook.sheets.some((s) => s.name.trim().toLowerCase() === n.trim().toLowerCase()),
    ),
  ];

  const editedAt = (sheet: string, cell: string) => ({
    formula: state.editedFormulas.get(sheet)?.get(cell),
    hasValue: state.editedValues.get(sheet)?.has(cell) ?? false,
  });

  return {
    sheetNames: () => names,
    value: (sheet, cell): BenchCellValue => {
      if (cellIsAffected(state, sheet, cell) || cellIsUncalculated(state, sheet, cell)) {
        return benchValueFrom(state.sim.getValue(sheet, cell));
      }
      return original.value(sheet, cell);
    },
    // Deliberately NOT given the same "or uncalculated" branch as value()
    // above. formulaOrValue never routes a formula cell through its cached
    // value in the first place — `original.formulaOrValue` (readers.ts)
    // returns "=" + the formula TEXT for any cell that has one, cached or
    // not, so the "0 for an uncached formula" bug value() has to work
    // around never reaches here. The only cells this function reads a
    // cached *value* for are non-formula cells (literals), which are never
    // "uncalculated" (GridCell.uncalculated is formula-only by
    // definition). Pinned by a regression test in test/bench-edits.test.ts.
    formulaOrValue: (sheet, cell): BenchCellValue => {
      const edited = editedAt(sheet, cell);
      if (edited.formula !== undefined) return "=" + edited.formula;
      if (edited.hasValue) return benchValueFrom(state.sim.getValue(sheet, cell));
      return original.formulaOrValue(sheet, cell);
    },
  };
}
