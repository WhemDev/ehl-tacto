/**
 * Bridges an already-parsed workbook (SheetJS, via lib/workbook.ts) into the
 * formulas/values/graph shape evaluate.ts operates on. Not a port of
 * engine.py::_load — that method reads a file off disk with openpyxl, which
 * has no equivalent here; this module's only job starts from a workbook
 * this app has already parsed.
 */

import { indexToCol } from "@/lib/a1";
import type { GridCell, ParsedWorkbook } from "@/lib/workbook";
import type { CellValue } from "./ast";
import { extractRefs, type EngineState } from "./evaluate";
import { DependencyGraph, makeKey } from "./graph";
import { parseFormula } from "./parser";

/**
 * KNOWN LIMITATION — silently inherits lib/workbook.ts's row/column cap.
 *
 * `parseWorkbook` (lib/workbook.ts) clamps every sheet to `MAX_ROWS` (5000)
 * / `MAX_COLS` (100) and sets `sheet.truncated = true` when the real sheet
 * was larger — a cap the Python reference engine has no equivalent of, since
 * it reads the whole workbook with openpyxl. This function does not check
 * `sheet.truncated` at all: a formula that references a cell beyond that
 * boundary (e.g. row 5001, or column CW) simply never finds an entry for
 * that key in `state.values`, so `evalNode`'s cellRef/rangeRef cases read it
 * as blank (`null`) — a plausible-looking but silently wrong number, not an
 * error and not a warning.
 *
 * `sheet.truncated` is available right here on the input and is deliberately
 * left unchecked. Surfacing this to the user (a banner, a warning cell, a
 * thrown error — something visible) is out of scope for this module, which
 * has no UI of its own; it's deferred to whichever future plan adds
 * presentation for the formula engine's output. Anyone touching this
 * function next should know the gap exists rather than rediscover it via a
 * silently-wrong number in a real workbook.
 */
export function buildWorkbookModel(workbook: ParsedWorkbook): EngineState {
  // Populated in its own pass, before any formula is parsed, so a whole-
  // column/whole-row reference (lib/formula/ast.ts's RangeRef.wholeColumn/
  // wholeRow) resolves against every sheet's real bounds regardless of scan
  // order — a formula on sheet 1 referencing sheet 2's C:C must see sheet
  // 2's extent even though sheet 2's own cells haven't been visited yet.
  const sheetBounds = new Map<string, { rows: number; cols: number }>();
  for (const sheet of workbook.sheets) {
    sheetBounds.set(sheet.name.toUpperCase(), { rows: sheet.rows, cols: sheet.cols });
  }

  const state: EngineState = {
    formulas: new Map(),
    values: new Map(),
    graph: new DependencyGraph(),
    sheetBounds,
  };

  for (const sheet of workbook.sheets) {
    for (const cell of sheet.cells.values()) {
      // ParsedSheet coordinates are 0-based; every CellKey is 1-based, Excel-address style.
      const col = indexToCol(cell.col);
      const row = cell.row + 1;
      const key = makeKey(sheet.name, col, row);

      if (cell.formula) {
        try {
          const ast = parseFormula(cell.formula);
          state.formulas.set(key, ast);
          state.graph.addFormulaCell(key, extractRefs(ast, sheet.name, sheetBounds));
          continue;
        } catch {
          // Falls through to the cached value below — matches
          // engine.py::_load's own except-and-keep-cached fallback.
        }
      }

      state.values.set(key, cellValueFrom(cell));
    }
  }

  return state;
}

function cellValueFrom(cell: GridCell): CellValue {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  // A literal (non-formula) cell whose stored value is the empty string is
  // indistinguishable, for evaluation purposes, from a blank cell: openpyxl
  // — the oracle's own reader — resolves this exact shape (an explicit but
  // empty <v> on a non-formula cell) to None rather than "", so treat it the
  // same way here for parity with what the reference engine sees.
  if (v === "") return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (v instanceof Date) return v;
  // Any other raw shape (shouldn't occur from SheetJS) falls back to the
  // cell's own display text rather than corrupting the model.
  return cell.text;
}
