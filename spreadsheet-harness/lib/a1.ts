/**
 * A1 notation helpers. Shared by the digest builder (which emits ranges) and
 * the grid (which resolves them to pixel rectangles), so both agree on exactly
 * what `D:D` or `Sheet1!$B$2:$F$250` means.
 *
 * All row/column indices in the returned objects are 0-based and inclusive.
 */

export interface RangeBox {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  /** true when the source was `D:D` — the row bounds are open and were clamped. */
  wholeColumn: boolean;
  /** true when the source was `3:3` — the column bounds are open and were clamped. */
  wholeRow: boolean;
}

export interface ClampBounds {
  rows: number;
  cols: number;
}

const CELL_RE = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;
const COL_RE = /^\$?([A-Za-z]{1,3})$/;
const ROW_RE = /^\$?(\d{1,7})$/;

export function colToIndex(col: string): number {
  let n = 0;
  const upper = col.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    n = n * 26 + (upper.charCodeAt(i) - 64);
  }
  return n - 1;
}

export function indexToCol(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** `Sheet1!B2:F250` → `{ sheet: "Sheet1", range: "B2:F250" }`. Quotes are stripped. */
export function splitSheetRef(ref: string): { sheet?: string; range: string } {
  const trimmed = ref.trim();
  const bang = trimmed.lastIndexOf("!");
  if (bang === -1) return { range: trimmed };
  let sheet = trimmed.slice(0, bang).trim();
  if (sheet.startsWith("'") && sheet.endsWith("'")) {
    sheet = sheet.slice(1, -1).replace(/''/g, "'");
  }
  return { sheet: sheet || undefined, range: trimmed.slice(bang + 1).trim() };
}

/**
 * Parse an A1 range into an inclusive 0-based box.
 *
 * Open ranges (`D:D`, `3:3`) are clamped to `bounds` when supplied, and to a
 * defensive default otherwise. Returns null for anything unparseable so callers
 * can decide whether that is a validation failure or just a skipped highlight.
 */
export function parseRange(
  ref: string,
  bounds: ClampBounds = { rows: 5000, cols: 100 },
): RangeBox | null {
  const { range } = splitSheetRef(ref);
  if (!range) return null;

  const [rawStart, rawEnd = rawStart] = range.split(":");
  if (!rawStart) return null;

  const start = rawStart.trim();
  const end = rawEnd.trim();

  const startCell = CELL_RE.exec(start);
  const endCell = CELL_RE.exec(end);
  if (startCell && endCell) {
    const r1 = Number(startCell[2]) - 1;
    const r2 = Number(endCell[2]) - 1;
    const c1 = colToIndex(startCell[1]);
    const c2 = colToIndex(endCell[1]);
    return {
      startRow: Math.min(r1, r2),
      endRow: Math.max(r1, r2),
      startCol: Math.min(c1, c2),
      endCol: Math.max(c1, c2),
      wholeColumn: false,
      wholeRow: false,
    };
  }

  const startCol = COL_RE.exec(start);
  const endCol = COL_RE.exec(end);
  if (startCol && endCol) {
    const c1 = colToIndex(startCol[1]);
    const c2 = colToIndex(endCol[1]);
    return {
      startRow: 0,
      endRow: Math.max(0, bounds.rows - 1),
      startCol: Math.min(c1, c2),
      endCol: Math.max(c1, c2),
      wholeColumn: true,
      wholeRow: false,
    };
  }

  const startRow = ROW_RE.exec(start);
  const endRow = ROW_RE.exec(end);
  if (startRow && endRow) {
    const r1 = Number(startRow[1]) - 1;
    const r2 = Number(endRow[1]) - 1;
    return {
      startRow: Math.min(r1, r2),
      endRow: Math.max(r1, r2),
      startCol: 0,
      endCol: Math.max(0, bounds.cols - 1),
      wholeColumn: false,
      wholeRow: true,
    };
  }

  return null;
}

export function formatCell(row: number, col: number): string {
  return `${indexToCol(col)}${row + 1}`;
}

export function formatRange(box: {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}): string {
  const a = formatCell(box.startRow, box.startCol);
  const b = formatCell(box.endRow, box.endCol);
  return a === b ? a : `${a}:${b}`;
}

/** Clamp a box to the grid so an over-wide model range still highlights something sane. */
export function clampBox(box: RangeBox, bounds: ClampBounds): RangeBox {
  return {
    ...box,
    startRow: Math.max(0, Math.min(box.startRow, bounds.rows - 1)),
    endRow: Math.max(0, Math.min(box.endRow, bounds.rows - 1)),
    startCol: Math.max(0, Math.min(box.startCol, bounds.cols - 1)),
    endCol: Math.max(0, Math.min(box.endCol, bounds.cols - 1)),
  };
}

export function boxCellCount(box: RangeBox): number {
  return (box.endRow - box.startRow + 1) * (box.endCol - box.startCol + 1);
}

/** Same envelope parseRange itself defaults to when no bounds are supplied —
 *  shiftRangeRef intentionally has no bounds parameter (lib/rematch/retarget.ts
 *  calls it with a bare `(range, dRow, dCol)`), so it needs its own constant
 *  rather than a caller-supplied one. Equal to lib/workbook.ts's
 *  MAX_ROWS/MAX_COLS, which this module cannot import without a cycle
 *  (workbook.ts already imports from here). */
const SHIFT_BOUNDS: ClampBounds = { rows: 5000, cols: 100 };

/**
 * Translates an A1 range by (dRow, dCol) — a plain rectangular move, not
 * Excel's fill-handle semantics (that is lib/formula/shift.ts's
 * `shiftFormula`, which operates on cell references *inside* formula text
 * and treats `$`-anchors specially). This is for moving the reference
 * itself: an edit's `range`, a solve op's single-cell refs, a check's
 * `range`, a binding's `idCell`/`blockRange` — see lib/rematch/retarget.ts.
 *
 * Returns null when either edge of the shifted box would land negative or
 * past the grid's outer bound — callers (retargetWork) treat a null as a
 * hard refusal for whatever op owns that range, rather than silently
 * clamping into a cell that was never the intended target.
 *
 * Open forms (`D:D`, `3:3`) shift only the axis they actually specify: a row
 * delta has nothing to move on a whole-column reference, and vice versa.
 * `$` anchors are not preserved — formatCell/formatRange never round-trip
 * them (see their own docs), consistent with every other range this codebase
 * produces (lib/work/bindings.ts's idCell/blockRange, for instance).
 */
export function shiftRangeRef(range: string, dRow: number, dCol: number): string | null {
  const box = parseRange(range, SHIFT_BOUNDS);
  if (!box) return null;

  if (box.wholeColumn) {
    const startCol = box.startCol + dCol;
    const endCol = box.endCol + dCol;
    if (startCol < 0 || endCol < 0 || startCol >= SHIFT_BOUNDS.cols || endCol >= SHIFT_BOUNDS.cols) return null;
    const a = indexToCol(startCol);
    const b = indexToCol(endCol);
    return a === b ? `${a}:${a}` : `${a}:${b}`;
  }

  if (box.wholeRow) {
    const startRow = box.startRow + dRow;
    const endRow = box.endRow + dRow;
    if (startRow < 0 || endRow < 0 || startRow >= SHIFT_BOUNDS.rows || endRow >= SHIFT_BOUNDS.rows) return null;
    return startRow === endRow ? `${startRow + 1}` : `${startRow + 1}:${endRow + 1}`;
  }

  const startRow = box.startRow + dRow;
  const endRow = box.endRow + dRow;
  const startCol = box.startCol + dCol;
  const endCol = box.endCol + dCol;
  if (
    startRow < 0 ||
    startCol < 0 ||
    endRow < 0 ||
    endCol < 0 ||
    startRow >= SHIFT_BOUNDS.rows ||
    endRow >= SHIFT_BOUNDS.rows ||
    startCol >= SHIFT_BOUNDS.cols ||
    endCol >= SHIFT_BOUNDS.cols
  ) {
    return null;
  }
  return formatRange({ startRow, endRow, startCol, endCol });
}
