/**
 * Restraint checks: two mechanically-catchable "the model over-filled a cell
 * the golden wants empty" preview warnings, the same PREVIEW-TIME shape as
 * lib/agent/axis-check.ts's axisExtensionWarning (see that module's own
 * design-history comment — prescriptive wording over conditional wording,
 * input-only signals over plan-dependent rules — for the reasoning this file
 * inherits rather than re-derives).
 *
 * Forensics on the Template category's held-out failures (see
 * .superpowers/sdd/reports and TODO.md — the harness's own worktree, not
 * this one) found the dominant failure mode is over-fill: the model writes
 * into cells the golden wants left blank. Three distinct mechanisms were
 * identified; only two are mechanically catchable from the input workbook
 * plus the plan alone, with no domain judgment required:
 *
 *   A. UNCORROBORATED COLUMN (task 03_01): the model extends a fill pattern
 *      into a column that nothing else in the workbook claims — no existing
 *      data nearby in that column, no header naming it. 03_01's "Cash Flow
 *      Statement" block (M&A_Consolidation!B34) has no column-header row at
 *      all (a single "100% cash" column, F, already seeded at F38); the
 *      model nonetheless wrote a parallel copy of the F-column formulas into
 *      column C for rows 35-40. Golden keeps only F.
 *
 *   C. HEADER-STYLED ROW (task 15_01): the model wrote into a row whose
 *      LABEL cell carries the sheet's own section-header style (bold white
 *      text on a solid fill — DebtAnalysis!B38 "Loan Balance at Maturity" is
 *      styled byte-for-byte like the sheet's real section titles "Loan
 *      Sizing Analysis"/"Debt Service Payments"/"DSCR Coverage Analysis",
 *      B24/B32/B42) while the true target row (B40 "Outstanding Principal")
 *      sits two rows below with plain data-row styling. Golden leaves the
 *      header-styled row empty.
 *
 * The third mechanism — which row is the real subtotal/plug line when two
 * candidates both "look" plausible (03_01's row17 Shareholders' Equity vs.
 * row18 Balance) — is a domain-judgment call about accounting semantics, not
 * a structural signal in the input. It is deliberately NOT addressed here;
 * see the calibration notes in test/agent-restraint-check.test.ts for the
 * evidence that 03_01 has over-fill instances beyond what Lever 1 catches,
 * and that this is expected, not a gap to close.
 *
 * Both checks share the same shape as axisExtensionWarning: pure functions
 * of (workbook, plan) — never the simulated/applied output — called once on
 * the first valid submit, appended to that turn's preview feedback. Purely
 * additive text: never is_error, never consumes a submit, never blocks
 * finalize.
 */
import { colToIndex, formatCell, indexToCol, parseRange } from "@/lib/a1";
import { dominantAxisCluster, findOrphanColumns } from "@/lib/agent/axis-check";
import { canonicalSheet, type CellEditPlan } from "@/lib/plan/edits";
import { cellKey, MAX_COLS, MAX_ROWS, type ParsedSheet, type ParsedWorkbook } from "@/lib/workbook";
import type { ResolvedStyle } from "@/lib/workbook-styles";

const EDIT_BOUNDS = { rows: MAX_ROWS, cols: MAX_COLS };

// ---------------------------------------------------------------------------
// Shared: what the plan actually WRITES (never `clear` — clearing is the
// opposite of over-fill, and both levers exist to catch content landing
// where it shouldn't, not content being removed).
// ---------------------------------------------------------------------------

interface WrittenCell {
  sheet: string;
  row: number; // 0-based
  col: number; // 0-based
}

/** Every cell a non-clear edit in `plan` targets, expanded from ranges,
 *  sheet names resolved against the input workbook (case-insensitively,
 *  matching every other plan-reading pass in this codebase — see
 *  canonicalSheet). Cheap: plans are capped at MAX_EDIT_CELLS (50k) and this
 *  runs once per task. */
function writtenCells(workbook: ParsedWorkbook, plan: CellEditPlan): WrittenCell[] {
  const out: WrittenCell[] = [];
  for (const edit of plan.edits) {
    if (edit.clear) continue;
    const sheet = canonicalSheet(workbook, plan.newSheets, edit.sheet);
    const box = parseRange(edit.range, EDIT_BOUNDS);
    if (!box) continue;
    for (let r = box.startRow; r <= box.endRow; r++) {
      for (let c = box.startCol; c <= box.endCol; c++) out.push({ sheet, row: r, col: c });
    }
  }
  return out;
}

function isPopulated(sheet: ParsedSheet, row: number, col: number): boolean {
  const cell = sheet.cells.get(cellKey(row, col));
  if (!cell) return false;
  return cell.formula !== undefined || cell.type !== "empty";
}

// ---------------------------------------------------------------------------
// LEVER 1: uncorroborated column — a column the plan writes into that
// nothing else in its local block claims (no existing data nearby, no
// header naming it).
// ---------------------------------------------------------------------------

const UNCORROBORATED_RADIUS = 5;
/** Flagged groups shown per lever in its warning text, capped the same way
 *  axis-check.ts caps its own flagged-sheet list — shared by both levers
 *  below (uncorroboratedColumnWarning and headerStyledRowWarning). */
const MAX_FLAGGED_GROUPS = 4;

export interface UncorroboratedColumnGroup {
  sheet: string;
  col: number; // 0-based
  colLetter: string;
  /** 1-based, the actual written rows' own span (not the search window). */
  firstRow: number;
  lastRow: number;
}

/** Rows with no populated cell at all — the workbook's own block separators.
 *  Precomputed once per sheet as a Set (sparse: only rows that DO have
 *  content are worth tracking) rather than re-scanning sheet.cols per row,
 *  since the cells Map is already sparse and this only needs to know which
 *  rows are touched at all. */
function nonBlankRows(sheet: ParsedSheet): Set<number> {
  const rows = new Set<number>();
  for (const key of sheet.cells.keys()) {
    const sep = key.indexOf(":");
    rows.add(Number(key.slice(0, sep)));
  }
  return rows;
}

/**
 * Whether `r` sits just past a DOUBLE-blank run relative to the direction
 * being scanned — i.e. whether `r` and its immediate predecessor (in scan
 * order) are BOTH blank. Two consecutive blank rows is this codebase's own
 * major-section separator convention (confirmed against both calibration
 * fixtures: 03_01's M&A_Consolidation uses a 2-row gap between every major
 * section — rows 19-20, 32-33, 41-42 — while single blank rows show up
 * WITHIN a section as plain spacing, e.g. 12_01's NOL_Carryforward row 11
 * between "Cash Taxes Payable" and the "Balance Sheet" sub-heading, which
 * still shares the sheet's one column header several rows further up). A
 * single blank is safe to cross; two in a row is treated as a hard
 * boundary neither the data-corroboration window nor the header search may
 * read across.
 */
function isDoubleBlankBoundary(blanks: Set<number>, r: number, prevWasBlank: boolean): boolean {
  return prevWasBlank && !blanks.has(r);
}

/**
 * The "local block" containing rows `[minRow, maxRow]`: extends outward up
 * to UNCORROBORATED_RADIUS rows in each direction, stopping early at the
 * nearest DOUBLE-blank-row run (a major section separator — see
 * isDoubleBlankBoundary) if one is closer. This is what keeps "nearby"
 * honest — without the boundary stop, a ±5 window drawn around a short
 * block bleeds into whatever unrelated section sits just across the
 * separator (verified against 03_01: Dividends (C31, Income Statement
 * block) sits only 4 rows above the Cash Flow Statement block's first
 * written row (35), well inside a naive ±5 window, and would incorrectly
 * "corroborate" column C there if the blank rows 32-33 between the two
 * blocks weren't respected as a hard boundary).
 */
function blockWindow(
  sheet: ParsedSheet,
  blanks: Set<number>,
  minRow: number,
  maxRow: number,
): { top: number; bottom: number } {
  let top = minRow;
  let prevBlank = false;
  for (let r = minRow - 1, steps = 0; r >= 0 && steps < UNCORROBORATED_RADIUS; r--, steps++) {
    if (isDoubleBlankBoundary(blanks, r, prevBlank)) break;
    top = r;
    prevBlank = !blanks.has(r);
  }
  let bottom = maxRow;
  prevBlank = false;
  for (let r = maxRow + 1, steps = 0; r < sheet.rows && steps < UNCORROBORATED_RADIUS; r++, steps++) {
    if (isDoubleBlankBoundary(blanks, r, prevBlank)) break;
    bottom = r;
    prevBlank = !blanks.has(r);
  }
  return { top, bottom };
}

/** How far above the nearest double-blank boundary (or the sheet top) the
 *  header search may look — effectively "unbounded" for any real workbook
 *  (MAX_ROWS is 5000; a section header living more than 500 rows above its
 *  own data would be a different problem entirely), kept finite only as a
 *  safety cap on pathological input. Deliberately NOT the same small radius
 *  as the data-corroboration window: a shared column header can legitimately
 *  sit many rows above a sub-section that inherits it (12_01's
 *  NOL_Carryforward has ONE "FY2020.."FY2023" header at row 6 serving three
 *  separate sub-blocks below), so the header search's reach is governed by
 *  the same double-blank boundary the data window uses, not by
 *  UNCORROBORATED_RADIUS. */
const HEADER_SEARCH_CAP = 500;

/** Whether `values` (in column order) form a strict arithmetic sequence —
 *  each step equal to the first, within floating-point tolerance. Requires
 *  at least 3 points: two numbers always have "a difference" trivially, so
 *  only three or more establishes a genuine constant-step pattern rather
 *  than a coincidence. */
function isArithmeticSequence(values: number[]): boolean {
  if (values.length < 3) return false;
  const step = values[1] - values[0];
  if (step === 0) return false;
  for (let i = 2; i < values.length; i++) {
    if (Math.abs(values[i] - values[i - 1] - step) > 1e-9) return false;
  }
  return true;
}

/**
 * Score matching lib/digest.ts's detectHeaderRow (>=2 populated cells, >=60%
 * "labelish"), applied to a single row rather than picking "the" header for
 * a whole sheet — this file needs "is THIS row header-shaped", scanned
 * outward from a written block, not detectHeaderRow's whole-sheet top-10
 * best-row search (which would miss any header below row 10, and has no
 * concept of "nearest to here" at all).
 *
 * "Labelish" is intentionally broader than detectHeaderRow's plain
 * text-type check: TEXT cells obviously qualify, but so do DATE cells (an
 * actual period-end date used as a column header) and NUMBER cells that
 * look like a bare year (an integer 1900-2100) — 05_01's DeferredTax uses
 * literal `2020`/`2021`/`2022`/`2023` NUMBER cells as its year header row,
 * with no text anywhere in it; a text-only rule would never recognize it as
 * a header at all, and every column below it would then read as
 * "uncorroborated". The year-range bound keeps this from misreading an
 * ordinary large numeric data row (a NOL loss of -350, a purchase price of
 * 112,000,000) as a header.
 *
 * A second, narrower fallback catches a bare PERIOD-INDEX header (09_01's
 * DebtSchedule: `B6="Year"`, `C6..M6 = 0,1,2,...,10` — a strict arithmetic
 * run of small integers, nothing year-like about them) that the ratio rule
 * alone would miss: a text/date label cell present AND the row's numeric
 * cells form a strict arithmetic sequence (see isArithmeticSequence). The
 * arithmetic-sequence requirement is what keeps this from misreading a real
 * data row that happens to trend upward (an EBITDA row growing 62.5, 68.8,
 * 77, 81.5, 85, 88 across the years — increasing, but never by a constant
 * step) as a header.
 */
function rowIsHeaderShaped(sheet: ParsedSheet, row: number): boolean {
  let nonEmpty = 0;
  let labelish = 0;
  let hasTextOrDate = false;
  const numValues: number[] = [];
  for (let c = 0; c < sheet.cols; c++) {
    const cell = sheet.cells.get(cellKey(row, c));
    if (!cell || cell.text === "") continue;
    nonEmpty++;
    if (cell.type === "text" || cell.type === "date") {
      labelish++;
      hasTextOrDate = true;
    } else if (cell.type === "number" && typeof cell.value === "number") {
      numValues.push(cell.value);
      if (Number.isInteger(cell.value) && cell.value >= 1900 && cell.value <= 2100) labelish++;
    }
  }
  if (nonEmpty < 2) return false;
  if (labelish / nonEmpty >= 0.6) return true;
  return hasTextOrDate && isArithmeticSequence(numValues);
}

/** The nearest header-shaped row strictly above `belowRow`, never crossing a
 *  double-blank section boundary (see isDoubleBlankBoundary) or the sheet
 *  top. Returns null when no such row exists within reach. */
function headerRowAbove(sheet: ParsedSheet, blanks: Set<number>, belowRow: number): number | null {
  let prevBlank = false;
  for (let r = belowRow - 1, steps = 0; r >= 0 && steps < HEADER_SEARCH_CAP; r--, steps++) {
    if (isDoubleBlankBoundary(blanks, r, prevBlank)) break;
    if (rowIsHeaderShaped(sheet, r)) return r;
    prevBlank = !blanks.has(r);
  }
  return null;
}

/** Sheet -> set of "col" indices excluded because axis-check.ts already owns
 *  them (see this module's own doc comment: "don't warn on columns that
 *  continue an axis"). Recomputed here rather than threaded in as a
 *  parameter — dominantAxisCluster/findOrphanColumns are cheap, pure
 *  functions of the workbook alone, and axis-check.ts's own
 *  axisExtensionWarning already recomputes dominantAxisCluster internally
 *  for the same reason (see findLabelEvidence's call site there): keeping
 *  this module's exported signature independent of loop.ts's own
 *  bookkeeping. */
function axisOwnedColumns(workbook: ParsedWorkbook): Map<string, Set<number>> {
  const orphans = findOrphanColumns(dominantAxisCluster(workbook), workbook);
  const out = new Map<string, Set<number>>();
  for (const o of orphans) {
    const m = /^([A-Za-z]+)\d+$/.exec(o.headerCell);
    if (!m) continue;
    const col = colToIndex(m[1]);
    let set = out.get(o.axis.sheet);
    if (!set) {
      set = new Set();
      out.set(o.axis.sheet, set);
    }
    set.add(col);
  }
  return out;
}

/** Whether `plan` itself writes into (sheet, row, col) — used to skip a
 *  column once the plan has already filled in the header row cell that
 *  would otherwise resolve the ambiguity (see this module's doc: "or where
 *  the plan itself also writes a header-row cell for that column"). */
function planWritesCell(written: WrittenCell[], sheet: string, row: number, col: number): boolean {
  return written.some((w) => w.sheet === sheet && w.row === row && w.col === col);
}

/**
 * Column groups the plan writes into that have no corroboration anywhere in
 * their local block: no already-populated (unedited) cell in that column
 * nearby, and no header-shaped row above naming that column. A property of
 * (workbook, plan) together — unlike axis-check.ts's findOrphanColumns, this
 * genuinely needs the plan to know which columns were written at all, so it
 * cannot be split into a workbook-only precompute reused across submits the
 * same way. Cheap enough to run once per task regardless (bounded by the
 * plan's own edit count).
 */
export function findUncorroboratedColumns(
  workbook: ParsedWorkbook,
  plan: CellEditPlan,
): UncorroboratedColumnGroup[] {
  const written = writtenCells(workbook, plan);
  if (written.length === 0) return [];

  const excluded = axisOwnedColumns(workbook);

  // Group by (sheet, col, block) — "block" determined AFTER we know each
  // row's own blank-separated segment, so two writes in the same column but
  // different sections of the sheet (e.g. row 14 in a headered block, row 38
  // in a headerless one) are never merged into one group and don't let one
  // section's corroboration paper over the other's.
  const bySheet = new Map<string, WrittenCell[]>();
  for (const w of written) {
    let list = bySheet.get(w.sheet);
    if (!list) {
      list = [];
      bySheet.set(w.sheet, list);
    }
    list.push(w);
  }

  const out: UncorroboratedColumnGroup[] = [];
  for (const [sheetName, cells] of bySheet) {
    const sheet = workbook.sheets.find((s) => s.name === sheetName);
    if (!sheet) continue;
    const blanks = nonBlankRows(sheet);
    const excludedCols = excluded.get(sheetName);

    // (col, segment top) -> rows written, where "segment top" is computed
    // lazily below via blockWindow on that column's own min/max so far. We
    // build per-column row lists first, then split each into blank-bounded
    // runs.
    const byCol = new Map<number, number[]>();
    for (const w of cells) {
      let rows = byCol.get(w.col);
      if (!rows) {
        rows = [];
        byCol.set(w.col, rows);
      }
      rows.push(w.row);
    }

    for (const [col, rows] of byCol) {
      if (excludedCols?.has(col)) continue;
      rows.sort((a, b) => a - b);
      // Split into runs separated by a fully-blank row so a distant part of
      // the same column-write doesn't get merged with a run in a different
      // section (mirrors blockWindow's own "stop at the nearest blank row"
      // reasoning, one level up: this is about not merging WRITTEN rows
      // across a separator, blockWindow is about not reading corroboration
      // across one).
      let runStart = 0;
      for (let i = 1; i <= rows.length; i++) {
        const atBoundary =
          i === rows.length ||
          (() => {
            // A boundary exists between rows[i-1] and rows[i] iff some row
            // strictly between them is fully blank.
            for (let r = rows[i - 1] + 1; r < rows[i]; r++) if (!blanks.has(r)) return true;
            return false;
          })();
        if (!atBoundary) continue;
        const runRows = rows.slice(runStart, i);
        runStart = i;
        const minRow = runRows[0];
        const maxRow = runRows[runRows.length - 1];
        const window = blockWindow(sheet, blanks, minRow, maxRow);
        const writtenRowSet = new Set(runRows);

        let corroborated = false;
        for (let r = window.top; r <= window.bottom && !corroborated; r++) {
          if (writtenRowSet.has(r)) continue;
          if (isPopulated(sheet, r, col)) corroborated = true;
        }

        if (!corroborated) {
          const headerRow = headerRowAbove(sheet, blanks, minRow);
          if (headerRow !== null) {
            if (isPopulated(sheet, headerRow, col)) corroborated = true;
            else if (planWritesCell(written, sheetName, headerRow, col)) corroborated = true;
          }
        }

        if (!corroborated) {
          out.push({
            sheet: sheetName,
            col,
            colLetter: indexToCol(col),
            firstRow: minRow + 1,
            lastRow: maxRow + 1,
          });
        }
      }
    }
  }
  return out;
}

function columnGroupClause(g: UncorroboratedColumnGroup): string {
  const rows = g.firstRow === g.lastRow ? `row ${g.firstRow}` : `rows ${g.firstRow}-${g.lastRow}`;
  return (
    `${g.sheet} column ${g.colLetter} ${rows}: no existing content or header names this column near your ` +
    `edits — verify the task actually asks for it; if not, remove those edits.`
  );
}

/**
 * A warning for the first-submit preview (see loop.ts): every uncorroborated
 * column group the plan writes into, capped the same way axis-check.ts caps
 * its own flagged-sheet list. Deterministic ordering (by sheet, then column)
 * so the capped-vs-shown split is stable across calls on the same input.
 */
export function uncorroboratedColumnWarning(workbook: ParsedWorkbook, plan: CellEditPlan): string | null {
  const groups = findUncorroboratedColumns(workbook, plan)
    .sort((a, b) => a.sheet.localeCompare(b.sheet) || a.col - b.col || a.firstRow - b.firstRow);
  if (groups.length === 0) return null;

  const shown = groups.slice(0, MAX_FLAGGED_GROUPS);
  const more = groups.length - shown.length;
  const clauses = shown.map(columnGroupClause).join(" ");
  const moreSuffix = more > 0 ? ` (+${more} more column${more === 1 ? "" : "s"} with the same issue)` : "";

  return `Restraint check (uncorroborated column): ${clauses}${moreSuffix}`;
}

// ---------------------------------------------------------------------------
// LEVER 2: header-styled row — the plan writes values/formulas into a row
// whose label cell carries the sheet's own section-header style.
// ---------------------------------------------------------------------------

/** How far below a flagged row to look for a plainly-styled candidate to
 *  suggest instead (see the 15_01 shape: the real target sits 2 rows below
 *  the header-styled one, past one blank separator row). */
const SUGGESTED_ROW_SEARCH = 5;

/** The (fill, bold, font-color) triple the task spec calls the "signature" —
 *  deliberately coarser than styleIdx: two cellXfs that differ only in
 *  border/alignment but agree on fill+bold+color are the same VISUAL
 *  signature to a reader of the sheet, and the real DebtAnalysis fixture
 *  carries exactly that split (the sheet's main title B2 and its section
 *  titles B24/B32/B38/B42 use two different cellXfs that resolve to the same
 *  fill/bold/color, differing only in border). */
function styleSignature(style: ResolvedStyle): string {
  return `${style.fill ?? ""}|${style.bold ? 1 : 0}|${style.color ?? ""}`;
}

/** A style counts as a possible header signature only if it carries at least
 *  one of fill/bold/color — an alignment- or border-only style is never
 *  "bold white text on a solid fill", so it can never be this mechanism's
 *  signature regardless of how many title-shaped rows happen to share it. */
function hasVisualSignature(style: ResolvedStyle): boolean {
  return !!(style.fill || style.bold || style.color);
}

/** A "title bar" row: 1-2 populated cells, all of them text. The shape every
 *  real section-title row in the calibration fixtures has (a single label
 *  cell spanning no other column). */
function isTitleBarRow(sheet: ParsedSheet, row: number): boolean {
  let count = 0;
  for (let c = 0; c < sheet.cols; c++) {
    const cell = sheet.cells.get(cellKey(row, c));
    if (!cell) continue;
    if (cell.type !== "text") return false;
    count++;
    if (count > 2) return false;
  }
  return count >= 1;
}

/**
 * The sheet's own section-header style signature(s): a (fill, bold, color)
 * combo that appears on >= 2 title-bar rows (see isTitleBarRow) AND is never
 * seen on any row holding non-text data anywhere in the sheet — the
 * discriminating check the task spec calls for, verified separately from
 * the "found on >= 2 title rows" count so a style that happens to also dress
 * up a real data row never gets treated as a heading-only signal.
 *
 * A property of the input workbook alone (no plan involved) — pure and cheap
 * enough to recompute per call; sheets are small and this is at most one
 * scan of sheet.cells per call, run once per task.
 */
function detectHeaderStyleSignatures(sheet: ParsedSheet): Set<string> {
  if (!sheet.styles) return new Set();
  const titleRowsBySignature = new Map<string, Set<number>>();

  for (let r = 0; r < sheet.rows; r++) {
    if (!isTitleBarRow(sheet, r)) continue;
    for (let c = 0; c < sheet.cols; c++) {
      const cell = sheet.cells.get(cellKey(r, c));
      if (!cell || cell.styleIdx === undefined) continue;
      const style = sheet.styles[cell.styleIdx];
      if (!style || !hasVisualSignature(style)) continue;
      const sig = styleSignature(style);
      let rows = titleRowsBySignature.get(sig);
      if (!rows) {
        rows = new Set();
        titleRowsBySignature.set(sig, rows);
      }
      rows.add(r);
    }
  }

  const candidates = new Set<string>();
  for (const [sig, rows] of titleRowsBySignature) if (rows.size >= 2) candidates.add(sig);
  if (candidates.size === 0) return candidates;

  // Discriminating check: drop any candidate signature that also shows up on
  // a row holding non-text data anywhere in the sheet.
  for (let r = 0; r < sheet.rows; r++) {
    let hasNonText = false;
    const sigsInRow = new Set<string>();
    for (let c = 0; c < sheet.cols; c++) {
      const cell = sheet.cells.get(cellKey(r, c));
      if (!cell) continue;
      if (cell.type !== "text") hasNonText = true;
      if (cell.styleIdx === undefined) continue;
      const style = sheet.styles[cell.styleIdx];
      if (style && hasVisualSignature(style)) sigsInRow.add(styleSignature(style));
    }
    if (!hasNonText) continue;
    for (const sig of sigsInRow) candidates.delete(sig);
  }
  return candidates;
}

/** The leftmost populated cell in `row` — what the mechanism calls the
 *  "label cell" (a row's own identifying text, always the first thing a
 *  reader's eye lands on). */
function leftmostPopulatedCol(sheet: ParsedSheet, row: number): number | null {
  for (let c = 0; c < sheet.cols; c++) {
    if (sheet.cells.get(cellKey(row, c))) return c;
  }
  return null;
}

export interface HeaderStyledRowHit {
  sheet: string;
  row: number; // 1-based
  labelCell: string;
  /** A nearby (within SUGGESTED_ROW_SEARCH rows below) plainly-styled row
   *  with its own populated label — omitted when none is found that close. */
  suggestedRow?: number; // 1-based
}

/**
 * Rows the plan writes values/formulas into whose INPUT label cell carries
 * the sheet's own section-header style signature (see
 * detectHeaderStyleSignatures). A property of (workbook, plan) together, for
 * the same reason findUncorroboratedColumns is: which rows the plan touches
 * is plan-dependent, even though the style signature itself is not.
 */
export function findHeaderStyledRowWrites(workbook: ParsedWorkbook, plan: CellEditPlan): HeaderStyledRowHit[] {
  const written = writtenCells(workbook, plan);
  if (written.length === 0) return [];

  const bySheet = new Map<string, Set<number>>();
  for (const w of written) {
    let rows = bySheet.get(w.sheet);
    if (!rows) {
      rows = new Set();
      bySheet.set(w.sheet, rows);
    }
    rows.add(w.row);
  }

  const out: HeaderStyledRowHit[] = [];
  for (const [sheetName, rows] of bySheet) {
    const sheet = workbook.sheets.find((s) => s.name === sheetName);
    if (!sheet || !sheet.styles) continue;
    const signatures = detectHeaderStyleSignatures(sheet);
    if (signatures.size === 0) continue;

    for (const row of [...rows].sort((a, b) => a - b)) {
      const labelCol = leftmostPopulatedCol(sheet, row);
      if (labelCol === null) continue;
      const labelCell = sheet.cells.get(cellKey(row, labelCol));
      if (!labelCell || labelCell.styleIdx === undefined) continue;
      const style = sheet.styles[labelCell.styleIdx];
      if (!style || !hasVisualSignature(style) || !signatures.has(styleSignature(style))) continue;

      let suggestedRow: number | undefined;
      for (let r = row + 1; r <= row + SUGGESTED_ROW_SEARCH && r < sheet.rows; r++) {
        const candidateCol = leftmostPopulatedCol(sheet, r);
        if (candidateCol === null) continue;
        const candidateCell = sheet.cells.get(cellKey(r, candidateCol));
        const candidateStyle =
          candidateCell?.styleIdx !== undefined ? sheet.styles[candidateCell.styleIdx] : undefined;
        const candidateIsHeaderStyled =
          !!candidateStyle && hasVisualSignature(candidateStyle) && signatures.has(styleSignature(candidateStyle));
        if (!candidateIsHeaderStyled) {
          suggestedRow = r + 1;
          break;
        }
      }

      out.push({
        sheet: sheetName,
        row: row + 1,
        labelCell: formatCell(row, labelCol),
        ...(suggestedRow !== undefined ? { suggestedRow } : {}),
      });
    }
  }
  return out;
}

function headerStyledRowClause(hit: HeaderStyledRowHit): string {
  const suggestion =
    hit.suggestedRow !== undefined
      ? ` check whether the intended target is a nearby plainly-styled row (e.g. row ${hit.suggestedRow}).`
      : ` check whether the intended target is a nearby plainly-styled row instead.`;
  return (
    `${hit.sheet} row ${hit.row}'s label (${hit.labelCell}) has this sheet's section-title styling — such rows ` +
    `are headings, not data rows;${suggestion}`
  );
}

/** A warning for the first-submit preview — see uncorroboratedColumnWarning's
 *  twin doc above for the shape this mirrors. */
export function headerStyledRowWarning(workbook: ParsedWorkbook, plan: CellEditPlan): string | null {
  const hits = findHeaderStyledRowWrites(workbook, plan).sort(
    (a, b) => a.sheet.localeCompare(b.sheet) || a.row - b.row,
  );
  if (hits.length === 0) return null;

  const shown = hits.slice(0, MAX_FLAGGED_GROUPS);
  const more = hits.length - shown.length;
  const clauses = shown.map(headerStyledRowClause).join(" ");
  const moreSuffix = more > 0 ? ` (+${more} more row${more === 1 ? "" : "s"} with the same issue)` : "";

  return `Restraint check (header-styled row): ${clauses}${moreSuffix}`;
}

// ---------------------------------------------------------------------------
// Combined entry point — what loop.ts actually calls.
// ---------------------------------------------------------------------------

/**
 * Both restraint levers, joined into the single string loop.ts appends to
 * the first-submit preview — mirrors how that call site already combines the
 * value preview with axisExtensionWarning's output. Returns null iff NEITHER
 * lever found anything, so a caller can `if (restraintWarning) ...` exactly
 * like it already does for axisWarning.
 */
export function restraintWarnings(workbook: ParsedWorkbook, plan: CellEditPlan): string | null {
  const parts = [uncorroboratedColumnWarning(workbook, plan), headerStyledRowWarning(workbook, plan)].filter(
    (p): p is string => p !== null,
  );
  return parts.length > 0 ? parts.join(" ") : null;
}
