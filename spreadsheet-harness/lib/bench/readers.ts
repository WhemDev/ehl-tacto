/**
 * CellReader adapters: how the scorer sees a workbook.
 *
 * The official evaluator reads every file twice with openpyxl — once with
 * data_only=True (cached values) and once with data_only=False (formulas).
 * A single SheetJS parse carries both: GridCell.value is the cached value
 * and GridCell.formula the formula text, so one ParsedWorkbook backs both
 * views of the CellReader contract.
 */

import { colToIndex } from "@/lib/a1";
import { isExcelError, type CellValue } from "@/lib/formula/ast";
import { cellKey, type GridCell, type ParsedWorkbook } from "@/lib/workbook";
import type { BenchCellValue, CellReader } from "./compare";

function gridValue(cell: GridCell | undefined): BenchCellValue {
  if (!cell) return null;
  // openpyxl reads an error cell's cached value as its display string
  // ("#REF!"); SheetJS stores a numeric error code in `value` with the
  // display string in `text`, so the text is the faithful equivalent.
  if (cell.type === "error") return cell.text || null;
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (v instanceof Date) return v;
  return cell.text;
}

/** Exported so callers that need the raw GridCell itself — not just a
 *  CellReader's value/formula view of it — can look one up the same way
 *  (see lib/bench/edits.ts's cellIsUncalculated). */
export function cellAt(workbook: ParsedWorkbook, sheet: string, ref: string): GridCell | undefined {
  const s = workbook.sheets.find((x) => x.name === sheet);
  if (!s) return undefined;
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!m) return undefined;
  return s.cells.get(cellKey(Number(m[2]) - 1, colToIndex(m[1])));
}

/** The scorer's view of a parsed .xlsx file (input, golden, or a saved output). */
export function workbookReader(workbook: ParsedWorkbook): CellReader {
  return {
    sheetNames: () => workbook.sheets.map((s) => s.name),
    value: (sheet, cell) => gridValue(cellAt(workbook, sheet, cell)),
    formulaOrValue: (sheet, cell) => {
      const c = cellAt(workbook, sheet, cell);
      if (c?.formula) return "=" + c.formula;
      return gridValue(c);
    },
  };
}

/** Engine CellValue → comparison value. Error objects become their codes. */
export function benchValueFrom(v: CellValue): BenchCellValue {
  if (v === null || v === undefined) return null;
  if (isExcelError(v)) return v.code;
  if (Array.isArray(v)) return benchValueFrom(v[0]?.[0] ?? null);
  return v;
}
