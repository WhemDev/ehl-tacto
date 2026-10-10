/**
 * Lookup and reference functions. Ports simulation/functions/lookup_funcs.py
 * in full — see the plan task this was written from for the exact Python
 * line ranges each export below corresponds to.
 */

import { excelError, isExcelError, type CellValue } from "../ast";
import { coerceNumber } from "../coerce";
import type { ExcelFunction } from "../evaluator-types";
import { colToIndex, indexToCol } from "@/lib/a1";

// lookup_funcs.py:12-20 — normalizes any resolved argument (scalar, 1D row,
// or 2D range) into a 2D list of rows, so VLOOKUP/HLOOKUP/INDEX/MATCH/ROWS/
// COLUMNS can all share one table shape.
function to2D(val: CellValue | CellValue[]): CellValue[][] {
  if (!Array.isArray(val)) return [[val]];
  if (val.length === 0) return [[]];
  return Array.isArray(val[0]) ? (val as CellValue[][]) : [val as CellValue[]];
}

// lookup_funcs.py:23-29 — always exact-match semantics. Python's own
// _match_value takes a match_type parameter but only implements its
// match_type===0 branch (every other value falls through to `return
// False`); every call site in this file that wants exact matching passes 0
// explicitly, so this port just is that one branch.
function matchValue(lookup: CellValue, cell: CellValue): boolean {
  if (typeof lookup === "string" && typeof cell === "string") {
    return lookup.toUpperCase() === cell.toUpperCase();
  }
  return lookup === cell;
}

// lookup_funcs.py:32-80 — approximate match requires the table sorted
// ascending by its first column and walks it linearly, taking the last row
// whose key is <= the lookup value (a linear scan, not a binary search,
// matching the reference implementation exactly, since that's what the
// oracle checks against).
export const vlookup: ExcelFunction = (evaluator, args) => {
  const lookupVal = evaluator.resolveArg(args[0]);
  const table = to2D(evaluator.resolveArg(args[1]));
  const colIndexRaw = coerceNumber(evaluator.resolveArg(args[2]));
  if (isExcelError(colIndexRaw)) return colIndexRaw;
  const colIndex = Math.trunc(colIndexRaw);

  let rangeLookup = true;
  if (args.length > 3) {
    const rl = evaluator.resolveArg(args[3]);
    if (typeof rl === "boolean") rangeLookup = rl;
    else if (typeof rl === "number") rangeLookup = rl !== 0;
  }

  if (colIndex < 1 || table.length === 0 || colIndex > table[0].length) {
    return excelError("#REF!");
  }

  if (rangeLookup) {
    let best: CellValue[] | null = null;
    for (const row of table) {
      if (row.length === 0) continue;
      const cell = row[0];
      if (cell === null) continue;
      if (typeof lookupVal === "number" && typeof cell === "number") {
        if (cell <= lookupVal) best = row; else break;
      } else if (typeof lookupVal === "string" && typeof cell === "string") {
        if (cell.toUpperCase() <= lookupVal.toUpperCase()) best = row; else break;
      }
    }
    if (best === null) return excelError("#N/A");
    return colIndex - 1 < best.length ? best[colIndex - 1] : excelError("#N/A");
  }

  for (const row of table) {
    if (row.length === 0) continue;
    if (matchValue(lookupVal, row[0])) {
      return colIndex - 1 < row.length ? row[colIndex - 1] : excelError("#N/A");
    }
  }
  return excelError("#N/A");
};

// lookup_funcs.py:83-128 — mirrors VLOOKUP transposed: the lookup row is the
// table's first row, and the match locates a column index (into the target
// row) rather than a row index.
export const hlookup: ExcelFunction = (evaluator, args) => {
  const lookupVal = evaluator.resolveArg(args[0]);
  const table = to2D(evaluator.resolveArg(args[1]));
  const rowIndexRaw = coerceNumber(evaluator.resolveArg(args[2]));
  if (isExcelError(rowIndexRaw)) return rowIndexRaw;
  const rowIndex = Math.trunc(rowIndexRaw);

  let rangeLookup = true;
  if (args.length > 3) {
    const rl = evaluator.resolveArg(args[3]);
    if (typeof rl === "boolean") rangeLookup = rl;
    else if (typeof rl === "number") rangeLookup = rl !== 0;
  }

  if (rowIndex < 1 || table.length === 0 || rowIndex > table.length) {
    return excelError("#REF!");
  }

  const firstRow = table.length > 0 ? table[0] : [];

  if (rangeLookup) {
    let bestCol: number | null = null;
    for (let ci = 0; ci < firstRow.length; ci++) {
      const cell = firstRow[ci];
      if (cell === null) continue;
      if (typeof lookupVal === "number" && typeof cell === "number") {
        if (cell <= lookupVal) bestCol = ci; else break;
      } else if (typeof lookupVal === "string" && typeof cell === "string") {
        if (cell.toUpperCase() <= lookupVal.toUpperCase()) bestCol = ci; else break;
      }
    }
    if (bestCol === null) return excelError("#N/A");
    const targetRow = table[rowIndex - 1];
    return bestCol < targetRow.length ? targetRow[bestCol] : excelError("#N/A");
  }

  for (let ci = 0; ci < firstRow.length; ci++) {
    if (matchValue(lookupVal, firstRow[ci])) {
      const targetRow = table[rowIndex - 1];
      return ci < targetRow.length ? targetRow[ci] : excelError("#N/A");
    }
  }
  return excelError("#N/A");
};

// lookup_funcs.py:131-170 — row=0 with a positive col returns the entire
// column; col=0 with a positive row returns the entire row; otherwise a
// normal (row, col) cell lookup, each 1-based and defaulting to 1 when
// omitted or given as 0.
//
// Both "whole column"/"whole row" branches are wrapped in an explicit
// CellValue[][] shape here (Nx1 for a column, 1xN for a row) rather than
// returned as a flat 1D list the way _index's Python `result` is: CellValue
// only ever represents an array as 2D (see ast.ts), matching how every
// other range value in this engine is shaped, so a bare 1D array isn't a
// representable CellValue at all — the row/column vector has to be a
// single-row or single-column 2D grid instead. Observably the same data.
export const indexFn: ExcelFunction = (evaluator, args) => {
  const array = to2D(evaluator.resolveArg(args[0]));
  let rowNum: number | null = null;
  let colNum: number | null = null;
  if (args.length > 1) {
    const r = coerceNumber(evaluator.resolveArg(args[1]));
    if (isExcelError(r)) return r;
    rowNum = Math.trunc(r);
  }
  if (args.length > 2) {
    const c = coerceNumber(evaluator.resolveArg(args[2]));
    if (isExcelError(c)) return c;
    colNum = Math.trunc(c);
  }

  if (array.length === 0) return excelError("#REF!");

  if (rowNum === 0 && colNum !== null && colNum > 0) {
    return array.map((r) => [colNum! - 1 < r.length ? r[colNum! - 1] : null]);
  }
  if (colNum === 0 && rowNum !== null && rowNum > 0) {
    return rowNum - 1 < array.length ? [array[rowNum - 1]] : excelError("#REF!");
  }

  const r = rowNum === null || rowNum === 0 ? 1 : rowNum;
  const c = colNum === null || colNum === 0 ? 1 : colNum;
  if (r < 1 || r > array.length) return excelError("#REF!");
  const row = array[r - 1];
  if (c < 1 || c > row.length) return excelError("#REF!");
  return row[c - 1];
};
// Registered as "INDEX" — named indexFn because `index` shadows nothing
// reserved, but matches this file's ifFn naming convention for consistency.

// lookup_funcs.py:173-238 — three match-type branches: 0 is exact (via
// matchValue), 1 is ascending approximate (largest value <= lookup, array
// sorted ascending), -1 is descending approximate (smallest value >= lookup,
// array sorted descending) — the latter two mirror VLOOKUP's own
// approximate scan. The lookup array is flattened one level (rows then
// cells) before matching; a scalar becomes a 1-element array.
export const match: ExcelFunction = (evaluator, args) => {
  const lookupVal = evaluator.resolveArg(args[0]);
  const arrayRaw = evaluator.resolveArg(args[1]);
  let matchType = 1;
  if (args.length > 2) {
    const mt = coerceNumber(evaluator.resolveArg(args[2]));
    if (isExcelError(mt)) return mt;
    matchType = Math.trunc(mt);
  }

  const flat: CellValue[] = [];
  if (Array.isArray(arrayRaw)) {
    for (const item of arrayRaw) {
      if (Array.isArray(item)) flat.push(...item);
      else flat.push(item);
    }
  } else {
    flat.push(arrayRaw);
  }

  if (matchType === 0) {
    for (let i = 0; i < flat.length; i++) {
      if (matchValue(lookupVal, flat[i])) return i + 1;
    }
    return excelError("#N/A");
  }

  if (matchType === 1) {
    let best: number | null = null;
    for (let i = 0; i < flat.length; i++) {
      const cell = flat[i];
      if (cell === null) continue;
      if (typeof lookupVal === "number" && typeof cell === "number") {
        if (cell <= lookupVal) best = i; else break;
      } else if (typeof lookupVal === "string" && typeof cell === "string") {
        if (cell.toUpperCase() <= lookupVal.toUpperCase()) best = i; else break;
      }
    }
    return best !== null ? best + 1 : excelError("#N/A");
  }

  if (matchType === -1) {
    let best: number | null = null;
    for (let i = 0; i < flat.length; i++) {
      const cell = flat[i];
      if (cell === null) continue;
      if (typeof lookupVal === "number" && typeof cell === "number") {
        if (cell >= lookupVal) best = i; else break;
      } else if (typeof lookupVal === "string" && typeof cell === "string") {
        if (cell.toUpperCase() >= lookupVal.toUpperCase()) best = i; else break;
      }
    }
    return best !== null ? best + 1 : excelError("#N/A");
  }

  return excelError("#N/A");
};

// lookup_funcs.py:241-246 — 1-based index into args[1..]; out of range
// (including 0, or an index at or beyond args.length, i.e. past the last
// choice) is #VALUE!.
export const choose: ExcelFunction = (evaluator, args) => {
  const idxRaw = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(idxRaw)) return idxRaw;
  const idx = Math.trunc(idxRaw);
  if (idx < 1 || idx >= args.length) return excelError("#VALUE!");
  return evaluator.resolveArg(args[idx]);
};

// lookup_funcs.py:249-259, 262-273 — inspect the RAW AST node of the sole
// argument rather than resolving it, so ROW(A5) reports A5's own row (5)
// instead of whatever value is stored there. With no argument, both report
// the cell whose formula is currently being evaluated.
export const row: ExcelFunction = (evaluator, args) => {
  if (args.length === 0) return evaluator.currentRow;
  const node = args[0];
  if (node.type === "cellRef") return node.row;
  if (node.type === "rangeRef") return node.start.row;
  return evaluator.currentRow;
};

export const column: ExcelFunction = (evaluator, args) => {
  if (args.length === 0) return evaluator.currentColIndex;
  const node = args[0];
  if (node.type === "cellRef") return colToIndex(node.col) + 1;
  if (node.type === "rangeRef") return colToIndex(node.start.col) + 1;
  return evaluator.currentColIndex;
};

// lookup_funcs.py:276-287
export const rows: ExcelFunction = (evaluator, args) => {
  const data = to2D(evaluator.resolveArg(args[0]));
  return data.length;
};

export const columns: ExcelFunction = (evaluator, args) => {
  const data = to2D(evaluator.resolveArg(args[0]));
  return data.length > 0 && data[0].length > 0 ? data[0].length : 0;
};

// lookup_funcs.py:290-329 — reads the RAW CellRef AST node of the reference
// argument (like ROW/COLUMN above, for the same reason: OFFSET shifts the
// *reference*, not any resolved value) and shifts it by the given row/col
// offsets. #REF! if the base isn't a CellRef at all, or the shifted position
// goes negative. height/width > 1 return a 2D block of the shifted cells
// instead of a single value.
export const offset: ExcelFunction = (evaluator, args) => {
  const base = args[0];
  const rowOffRaw = coerceNumber(evaluator.resolveArg(args[1]));
  if (isExcelError(rowOffRaw)) return rowOffRaw;
  const rowOff = Math.trunc(rowOffRaw);
  const colOffRaw = coerceNumber(evaluator.resolveArg(args[2]));
  if (isExcelError(colOffRaw)) return colOffRaw;
  const colOff = Math.trunc(colOffRaw);

  let height = 1;
  if (args.length > 3) {
    const h = coerceNumber(evaluator.resolveArg(args[3]));
    if (isExcelError(h)) return h;
    height = Math.trunc(h);
  }
  let width = 1;
  if (args.length > 4) {
    const w = coerceNumber(evaluator.resolveArg(args[4]));
    if (isExcelError(w)) return w;
    width = Math.trunc(w);
  }

  if (base.type !== "cellRef") return excelError("#REF!");

  const sheet = base.sheet ?? evaluator.currentSheet;
  const baseColIdx = colToIndex(base.col);
  const newRow = base.row + rowOff;
  const newColIdx = baseColIdx + colOff;

  if (newRow < 1 || newColIdx < 0) return excelError("#REF!");

  // Tell the dependency graph what this call actually resolved to — a
  // target no static walk of `args` could ever see, since it only exists
  // once rowOff/colOff/height/width are evaluated. See evaluate.ts's
  // FunctionEvaluator.reportResolvedRange doc for why this is what lets an
  // edit inside the resolved range dirty this OFFSET's own consumer.
  // min/max rather than assuming height/width are positive: a negative
  // height or width (Excel allows both, extending up/left instead of
  // down/right) must still report a normalized [lo, hi] box.
  evaluator.reportResolvedRange?.(
    sheet,
    Math.min(newRow, newRow + height - 1),
    Math.max(newRow, newRow + height - 1),
    Math.min(newColIdx, newColIdx + width - 1),
    Math.max(newColIdx, newColIdx + width - 1),
  );

  if (height === 1 && width === 1) {
    const newCol = indexToCol(newColIdx);
    return evaluator.getCellValue(sheet, newCol, newRow);
  }

  const result: CellValue[][] = [];
  for (let r = 0; r < height; r++) {
    const rowData: CellValue[] = [];
    for (let c = 0; c < width; c++) {
      const colLetter = indexToCol(newColIdx + c);
      rowData.push(evaluator.getCellValue(sheet, colLetter, newRow + r));
    }
    result.push(rowData);
  }
  return result;
};
