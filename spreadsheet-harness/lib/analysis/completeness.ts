/**
 * Structural completeness scan: areas of a workbook that look unfinished
 * relative to their own immediate surroundings, found without touching the
 * formula graph or the simulator — pure shape analysis over a ParsedWorkbook.
 *
 * Why this exists: a Financial_Model task instruction typically opens with
 * "Complete the financial model based on the provided assumptions." and then
 * itemizes a handful of specific asks, but the grading compares the ENTIRE
 * workbook against a fully-completed golden file. A model that does exactly
 * the itemized asks and stops can leave many other cells wrong. The itemized
 * cells are usually genuinely blank (nothing written at all), which means
 * they have zero inbound formula references — nothing in the formula graph
 * points a dependency-driven search at them. Only the sheet's own row/column
 * shape can: a row that stops three columns short of where every row above
 * and below it stops is a strong, purely visual signal that a human editor
 * would notice immediately.
 *
 * Heuristics, in priority order (used when areas must be capped):
 *   - row-gap: a row with several populated cells elsewhere but a blank
 *     stretch where neighboring rows (within 3 rows) have content.
 *   - sequence-gap: a run of consecutive numbers (step exactly 1, e.g. a
 *     year header) or a constant-step date series that stops partway across
 *     a row, while sibling rows in the same block reach further right.
 *   - labeled-empty-row: a lone text label with (almost) nothing else in
 *     the row, sitting where neighboring rows carry real data in the same
 *     columns.
 *
 * These are deliberately shape-only — no reference to `Simulator`, no
 * dependency-graph walk. That is a real limitation, not just a design
 * preference: a cell that already carries the right formula but whose
 * *cached* value is stale looks, at the ParsedSheet level, identical to a
 * cell holding a correct, already-computed formula (SheetJS does not
 * distinguish "never recalculated" from "genuinely evaluates to zero" once a
 * file is parsed — both come back as a formula with a text/value of "0").
 * That specific failure mode is out of reach for a structural scan; see the
 * design report (.superpowers/sdd/reports/fix2-completeness.md) for the
 * measurements that pinned this down.
 */
import { formatCell, formatRange, indexToCol } from "@/lib/a1";
import { cellKey, type ParsedSheet, type ParsedWorkbook } from "@/lib/workbook";
import { renderCellContent } from "./render";

export type IncompleteAreaKind = "row-gap" | "sequence-gap" | "labeled-empty-row";

export interface IncompleteArea {
  /** Stable within one findIncompleteAreas() call, in priority order: "A1".."A40". */
  id: string;
  sheet: string;
  /** A1-style range, e.g. "H34:K34". */
  range: string;
  kind: IncompleteAreaKind;
  /** One short line a model can act on — what's filled, what's blank, and a
   *  neighboring formula pattern when one is available. */
  evidence: string;
}

export interface FindIncompleteAreasResult {
  areas: IncompleteArea[];
  /** Areas found beyond the 40-area cap, dropped lowest-priority first. */
  omitted: number;
}

/**
 * The phrase half of the completion gate. agent-loop.ts's submit-time
 * coverage enforcement calls this function directly, against the assembled
 * first user message (which embeds the instruction verbatim), and stays
 * correct without ever knowing category exists — see isCompletionScope's
 * doc for why. The prompt-injection decision (prompts.ts) no longer calls
 * this alone; it calls isCompletionScope, which ANDs this with the task's
 * category. Kept text-only and unchanged here: agent-loop.ts's own use is
 * deliberately category-blind (it has no category to check), and other
 * future callers may want the same text-only semantics.
 */
export function hasCompletionTrigger(text: string): boolean {
  return text.toLowerCase().includes("complete the financial model");
}

/**
 * The full completion-mode gate used at the prompt-injection site
 * (benchAgentUserMessage): true only when both the phrase AND the category
 * agree this is a whole-workbook completion task. hasCompletionTrigger
 * alone over-fires on Template tasks that reuse Financial_Model's
 * boilerplate opener ("Complete the financial model based on the provided
 * assumptions...") without Template's grading actually being whole-workbook
 * — measured Template golden/input diffs are tens of cells inside a single
 * answer_position, against Financial_Model's whole-workbook diffs over a
 * thousand cells (exact counts: .superpowers/sdd/reports/fix6-scope-modes.md).
 *
 * `category` is `string | undefined`, not the `Category` union
 * (lib/bench/dataset.ts), deliberately: this module has no dependency on
 * lib/bench/ today and shouldn't gain one just for a type — every caller's
 * Category value already satisfies `string` structurally.
 *
 * `undefined` category — a caller that has not threaded task metadata
 * through yet — falls back to the PRE-existing, category-blind behavior
 * (phrase alone), not to "never complete": a caller that doesn't know the
 * category silently downgrading a genuine Financial_Model task to
 * restraint mode would be a far more damaging failure than an unmigrated
 * caller keeping its old (over-firing on Template, but not regressing FM)
 * behavior a little longer. See run-task.ts's `category` option.
 *
 * agent-loop.ts needs no matching update for this: its enforceCoverage
 * already requires BOTH hasCompletionTrigger(message) AND the literal
 * INCOMPLETE_AREAS_HEADER string to be present in the assembled message.
 * Tightening this function's category conjunct only ever REMOVES cases
 * where prompts.ts injects the header, never adds one, so the header-
 * presence half of that AND continues to track "was the list actually
 * shown" exactly, with no need for agent-loop.ts to know category exists.
 */
export function isCompletionScope(category: string | undefined, instruction: string): boolean {
  return hasCompletionTrigger(instruction) && (category === undefined || category === "Financial_Model");
}

const MAX_AREAS = 40;

// Row-gap tuning.
const ROW_GAP_MIN_POPULATED = 3;
const ROW_GAP_MIN_WIDTH = 2;

/**
 * A row-gap candidate is dropped when its exact blank span (identical
 * startCol..endCol, both edges) also appears as a blank run in at least this
 * many OTHER populated rows of the same sheet — the same "repetition = deliberate
 * structure" insight columnTextFrequency's doc comment (labeled-empty-row,
 * below) uses for repeated row labels, applied here to repeated blank spans
 * instead of repeated text.
 *
 * Real evidence: FM task 06_02's "Assumption sheet" has an identical
 * 2-column blank span recurring at rows 13, 17, 21, 25, 29, 33, 37, 41,
 * 48, 52... across dozens of otherwise-populated metric rows — deliberate
 * sheet structure (spot-verified blank in the golden too), not
 * incompleteness. Unfiltered, that one sheet alone produced 196 raw row-gap
 * candidates (other tasks in the same run: 32-86), flooding the 40-area cap
 * and burning the model's entire turn budget on the mandatory coverage
 * accounting before it ever got to submit a plan.
 *
 * 4 was chosen so a small amount of genuine coincidence — two or three
 * unrelated rows that happen to share a gap shape, the kind of thing
 * findIncompleteAreas: merging's adjacent-row case already collapses into
 * one area — still gets reported, while a span repeating in 4+ OTHER rows
 * reads as the sheet's own repeating layout rather than an omission.
 */
const RECURRENCE_THRESHOLD = 4;

// Labeled-empty-row tuning. Kept disjoint from row-gap's ">= 3 populated"
// floor (<= 2 here) so a row is never a plausible candidate for both kinds.
const LABEL_ROW_MAX_POPULATED = 2;
const LABEL_NEIGHBOR_WINDOW = 2;

// Sequence-gap tuning.
const SEQUENCE_MIN_RUN = 2;

// Shared "how many nearby rows corroborate this" window for row-gap and
// sequence-gap. A row 3 away is still "this block" in most financial models;
// beyond that it is more often a different section.
const NEIGHBOR_WINDOW = 3;

// Performance ceiling: bail out politely on a pathologically large used
// block rather than scanning it cell by cell. The benchmark's own widest
// sheets run to tens of thousands of formula cells across a few hundred
// columns at most (see the design report's survey) — these bounds are
// generous relative to that and still bound the worst case (a workbook with
// 100+ sheets, each parsed at Excel's own row/column maxima).
const MAX_SCAN_ROWS = 5000;
const MAX_SCAN_COLS = 400;

// ---------------------------------------------------------------------------
// Sheet scanning: the used block and a per-row column index within it.
// ---------------------------------------------------------------------------

interface Box {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

interface SheetScan {
  box: Box;
  /** Populated columns per row, sorted ascending, within `box`. A row with
   *  nothing populated is simply absent. "Populated" means renderCellContent
   *  would show something (the same notion of content the grid appendix and
   *  read_range use, so this scan sees exactly what the model sees) OR the
   *  cell is a non-anchor member of a merge whose anchor has content — see
   *  mergeCoverage below. */
  rowCols: Map<number, number[]>;
}

/**
 * Cells covered by a merge whose top-left anchor carries content, excluding
 * the anchor itself (which renderCellContent already treats as populated).
 * SheetJS's sparse cell map has no entry at all for a merge's non-anchor
 * cells, so without this a merged header ("EV/ EBITDA" spanning Q3:W3) reads
 * as one populated cell in a sea of "blank" ones — precisely the row-gap and
 * labeled-empty-row shape this module looks for, and pure noise: R3:W3 were
 * never "incomplete," they were never separate cells to begin with. Real
 * merge counts run to dozens on a sheet, not thousands, so building the full
 * coverage set up front is cheap relative to the cell scan itself.
 */
function mergeCoverage(sheet: ParsedSheet): Set<string> {
  const covered = new Set<string>();
  for (const m of sheet.merges) {
    if (renderCellContent(sheet, m.startRow, m.startCol) === null) continue;
    for (let r = m.startRow; r <= m.endRow; r++) {
      for (let c = m.startCol; c <= m.endCol; c++) {
        if (r === m.startRow && c === m.startCol) continue;
        covered.add(cellKey(r, c));
      }
    }
  }
  return covered;
}

/** Tight bounding box of populated cells, then a per-row column index within
 *  it. Both passes are O(populated cells + merge area), never O(sheet.rows x
 *  sheet.cols) — load-bearing since bench parses run to Excel's own maxima
 *  (1,048,576 x 16,384) on sheets that may only have a few thousand real
 *  cells. */
function scanSheet(sheet: ParsedSheet): SheetScan | null {
  const merged = mergeCoverage(sheet);
  const isPopulated = (row: number, col: number) =>
    renderCellContent(sheet, row, col) !== null || merged.has(cellKey(row, col));

  let minRow = Infinity;
  let maxRow = -1;
  let minCol = Infinity;
  let maxCol = -1;
  for (const cell of sheet.cells.values()) {
    if (!isPopulated(cell.row, cell.col)) continue;
    if (cell.row < minRow) minRow = cell.row;
    if (cell.row > maxRow) maxRow = cell.row;
    if (cell.col < minCol) minCol = cell.col;
    if (cell.col > maxCol) maxCol = cell.col;
  }
  for (const key of merged) {
    const [r, c] = key.split(":").map(Number);
    if (r < minRow) minRow = r;
    if (r > maxRow) maxRow = r;
    if (c < minCol) minCol = c;
    if (c > maxCol) maxCol = c;
  }
  if (maxRow === -1) return null; // nothing rendered on this sheet at all

  const box: Box = {
    minRow,
    maxRow: Math.min(maxRow, minRow + MAX_SCAN_ROWS - 1),
    minCol,
    maxCol: Math.min(maxCol, minCol + MAX_SCAN_COLS - 1),
  };

  const rowCols = new Map<number, number[]>();
  const addPopulated = (row: number, col: number) => {
    if (row < box.minRow || row > box.maxRow) return;
    if (col < box.minCol || col > box.maxCol) return;
    let cols = rowCols.get(row);
    if (!cols) {
      cols = [];
      rowCols.set(row, cols);
    }
    cols.push(col);
  };
  for (const cell of sheet.cells.values()) {
    if (isPopulated(cell.row, cell.col)) addPopulated(cell.row, cell.col);
  }
  for (const key of merged) {
    const [r, c] = key.split(":").map(Number);
    addPopulated(r, c);
  }
  for (const cols of rowCols.values()) {
    cols.sort((a, b) => a - b);
  }
  // Merge coverage can add the same column twice for a cell that was already
  // in sheet.cells (harmless for the sort above, but dedupe so downstream
  // counts — e.g. row-gap's ">= 3 populated" floor — see distinct cells).
  for (const [row, cols] of rowCols) {
    rowCols.set(row, [...new Set(cols)]);
  }
  return { box, rowCols };
}

/** Maximal blank runs within [minCol, maxCol] for a row's sorted populated
 *  columns. `cols` is small (a row's own populated cells), so a Set lookup
 *  per column in the box is the whole cost — bounded by MAX_SCAN_COLS. */
function blankRuns(cols: number[], minCol: number, maxCol: number): [number, number][] {
  const populated = new Set(cols);
  const runs: [number, number][] = [];
  let start: number | null = null;
  for (let c = minCol; c <= maxCol; c++) {
    if (populated.has(c)) {
      if (start !== null) {
        runs.push([start, c - 1]);
        start = null;
      }
    } else if (start === null) {
      start = c;
    }
  }
  if (start !== null) runs.push([start, maxCol]);
  return runs;
}

function countInRange(cols: number[], c1: number, c2: number): number {
  let n = 0;
  for (const c of cols) {
    if (c >= c1 && c <= c2) n++;
  }
  return n;
}

function rowsWithin(row: number, box: Box, window: number, rowCols: Map<number, number[]>): number[] {
  const out: number[] = [];
  for (let r = row - window; r <= row + window; r++) {
    if (r === row || r < box.minRow || r > box.maxRow) continue;
    if (rowCols.has(r)) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Raw hits: one per heuristic firing, before merge/dedupe/cap.
// ---------------------------------------------------------------------------

interface RawHit {
  kind: IncompleteAreaKind;
  sheet: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  evidence: string;
}

function colRangeText(c1: number, c2: number): string {
  return c1 === c2 ? indexToCol(c1) : `${indexToCol(c1)}:${indexToCol(c2)}`;
}

/** A short description of what's filled around a gap, plus a neighboring
 *  cell's formula as a "continue this pattern" hint when one exists — the
 *  house style used by readRange/gridAppendix for showing formulas. */
function neighborPatternHint(sheet: ParsedSheet, neighborRow: number | undefined, col: number): string {
  if (neighborRow === undefined) return "";
  const cell = sheet.cells.get(cellKey(neighborRow, col));
  if (!cell?.formula) return "";
  return ` (neighbor pattern: ${formatCell(neighborRow, col)}={=${cell.formula}})`;
}

/**
 * For every populated row in `scan`, indexes which OTHER rows have the exact
 * same blank run (identical [startCol, endCol], both edges) — one pass over
 * every row's own blankRuns(), O(rows x runs-per-row), never O(rows^2): each
 * row is inserted into the index once per run it has, and rowGapCandidates
 * below does an O(1) Set lookup per candidate rather than re-scanning other
 * rows. Built once per sheet and reused across every row-gap candidate on
 * it — see RECURRENCE_THRESHOLD's doc for why this exists.
 */
function blankSpanRowCounts(scan: SheetScan): Map<string, Set<number>> {
  const { box, rowCols } = scan;
  const bySpan = new Map<string, Set<number>>();
  for (const [row, cols] of rowCols) {
    for (const [c1, c2] of blankRuns(cols, box.minCol, box.maxCol)) {
      const key = `${c1}:${c2}`;
      let rows = bySpan.get(key);
      if (!rows) {
        rows = new Set();
        bySpan.set(key, rows);
      }
      rows.add(row);
    }
  }
  return bySpan;
}

function rowGapCandidates(sheet: ParsedSheet, scan: SheetScan): RawHit[] {
  const { box, rowCols } = scan;
  const hits: RawHit[] = [];
  const spanRowCounts = blankSpanRowCounts(scan);
  for (const [row, cols] of rowCols) {
    if (cols.length < ROW_GAP_MIN_POPULATED) continue;
    for (const [c1, c2] of blankRuns(cols, box.minCol, box.maxCol)) {
      const width = c2 - c1 + 1;
      if (width < ROW_GAP_MIN_WIDTH) continue;

      // The same blank span recurring across many OTHER rows is this
      // sheet's own layout (a deliberately-blank sub-column under every
      // metric row, say), not an omission — see RECURRENCE_THRESHOLD's doc.
      const rowsWithSpan = spanRowCounts.get(`${c1}:${c2}`);
      const otherRowsWithSpan = (rowsWithSpan?.size ?? 1) - 1;
      if (otherRowsWithSpan >= RECURRENCE_THRESHOLD) continue;

      const neighbors = rowsWithin(row, box, NEIGHBOR_WINDOW, rowCols);
      if (neighbors.length === 0) continue;
      const half = Math.ceil(width / 2);
      const corroborating = neighbors.filter((r) => countInRange(rowCols.get(r)!, c1, c2) >= half);
      if (corroborating.length * 2 <= neighbors.length) continue; // need a strict majority

      const before = cols.filter((c) => c < c1);
      const after = cols.filter((c) => c > c2);
      const filled = [
        before.length ? `filled ${colRangeText(before[0], before[before.length - 1])}` : null,
        after.length ? `filled ${colRangeText(after[0], after[after.length - 1])}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      const pattern = neighborPatternHint(sheet, corroborating[0], c1);
      hits.push({
        kind: "row-gap",
        sheet: sheet.name,
        startRow: row,
        endRow: row,
        startCol: c1,
        endCol: c2,
        evidence: `row ${filled}${pattern}, blank ${colRangeText(c1, c2)}`,
      });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// sequence-gap
// ---------------------------------------------------------------------------

function numberAt(sheet: ParsedSheet, row: number, col: number): number | null {
  const cell = sheet.cells.get(cellKey(row, col));
  if (!cell || cell.type !== "number" || typeof cell.value !== "number") return null;
  return cell.value;
}

function dateMsAt(sheet: ParsedSheet, row: number, col: number): number | null {
  const cell = sheet.cells.get(cellKey(row, col));
  if (!cell || cell.type !== "date" || !(cell.value instanceof Date)) return null;
  return cell.value.getTime();
}

/** Longest trailing sub-run of `blockCols` (physically adjacent columns)
 *  whose values, read via `at`, differ by exactly `step` from one cell to
 *  the next. Used once for numbers (step fixed at 1) and once for dates
 *  (step is whatever the last pair's delta is — "a consistent step", not
 *  necessarily one day). */
function trailingConstantStepRun(
  blockCols: number[],
  at: (col: number) => number | null,
  step: number | null,
): number[] {
  const values = blockCols.map(at);
  let end = values.length - 1;
  if (end < 1 || values[end] === null || values[end - 1] === null) return [];
  const useStep = step ?? values[end]! - values[end - 1]!;
  if (useStep === 0) return [];
  let start = end;
  while (start > 0 && values[start - 1] !== null && values[start]! - values[start - 1]! === useStep) {
    start--;
  }
  return blockCols.slice(start, end + 1);
}

function trailingSequence(sheet: ParsedSheet, row: number, blockCols: number[]): number[] | null {
  const numeric = trailingConstantStepRun(blockCols, (c) => numberAt(sheet, row, c), 1);
  if (numeric.length >= SEQUENCE_MIN_RUN) return numeric;
  const dated = trailingConstantStepRun(blockCols, (c) => dateMsAt(sheet, row, c), null);
  if (dated.length >= SEQUENCE_MIN_RUN) return dated;
  return null;
}

function sequenceGapCandidates(sheet: ParsedSheet, scan: SheetScan): RawHit[] {
  const { box, rowCols } = scan;
  const hits: RawHit[] = [];
  for (const [row, cols] of rowCols) {
    let i = 0;
    while (i < cols.length) {
      let j = i;
      while (j + 1 < cols.length && cols[j + 1] === cols[j] + 1) j++;
      const blockCols = cols.slice(i, j + 1); // physically contiguous columns
      i = j + 1;

      const seq = trailingSequence(sheet, row, blockCols);
      if (!seq) continue;
      const blockEnd = blockCols[blockCols.length - 1];
      const nextCol = blockEnd + 1;
      if (nextCol > box.maxCol) continue; // sequence already reaches the sheet's used edge

      const siblings = rowsWithin(row, box, NEIGHBOR_WINDOW, rowCols).filter(
        (r) => Math.max(...rowCols.get(r)!) > blockEnd,
      );
      if (siblings.length < 2) continue;

      const maxExtension = Math.min(
        box.maxCol,
        Math.max(...siblings.map((r) => Math.max(...rowCols.get(r)!.filter((c) => c <= box.maxCol)))),
      );
      const stepDesc =
        numberAt(sheet, row, blockEnd) !== null
          ? `step-1 numeric sequence ending ${formatCell(row, blockEnd)}=${numberAt(sheet, row, blockEnd)}`
          : `constant-step date sequence ending ${formatCell(row, blockEnd)}`;
      hits.push({
        kind: "sequence-gap",
        sheet: sheet.name,
        startRow: row,
        endRow: row,
        startCol: nextCol,
        endCol: Math.max(nextCol, maxExtension),
        evidence: `${stepDesc}, ${siblings.length} sibling row(s) extend to ${indexToCol(maxExtension)}`,
      });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// labeled-empty-row
// ---------------------------------------------------------------------------

/**
 * How many times each trimmed text value appears in `col` across the sheet's
 * used rows. The one signal that reliably separates a genuine gap ("Current
 * Ratio" blank between "Quick Ratio" and "Debt Ratio", all three unique,
 * independent metric names) from a stacked-blocks section heading
 * ("Accounts receivable" blank above "Beginning of period" / "Increases /
 * (decreases)" / "End of period" — a roll-forward schedule that recurs,
 * those exact three labels, under every other such section on the sheet):
 * the child rows of a real section repeat their labels across sections,
 * where two truly independent metrics never share a name. This is the same
 * repetition test lib/digest.ts's detectSections uses for the same reason,
 * computed independently here rather than imported — a plain column scan,
 * still no formula-graph or simulator dependency.
 */
function columnTextFrequency(sheet: ParsedSheet, box: Box, col: number): Map<string, number> {
  const freq = new Map<string, number>();
  for (let r = box.minRow; r <= box.maxRow; r++) {
    const cell = sheet.cells.get(cellKey(r, col));
    const text = cell?.type === "text" ? cell.text.trim() : "";
    if (text) freq.set(text, (freq.get(text) ?? 0) + 1);
  }
  return freq;
}

function labeledEmptyRowCandidates(sheet: ParsedSheet, scan: SheetScan): RawHit[] {
  const { box, rowCols } = scan;
  const hits: RawHit[] = [];
  const freqByCol = new Map<number, Map<string, number>>();
  const freqFor = (col: number) => {
    let f = freqByCol.get(col);
    if (!f) {
      f = columnTextFrequency(sheet, box, col);
      freqByCol.set(col, f);
    }
    return f;
  };

  for (const [row, cols] of rowCols) {
    if (cols.length === 0 || cols.length > LABEL_ROW_MAX_POPULATED) continue;
    for (const [c1, c2] of blankRuns(cols, box.minCol, box.maxCol)) {
      const labelCol = c1 - 1;
      if (labelCol < box.minCol || !cols.includes(labelCol)) continue;
      const labelCell = sheet.cells.get(cellKey(row, labelCol));
      if (!labelCell || labelCell.type !== "text") continue;

      let bestNeighbor: number | null = null;
      let bestWidth = 0;
      for (const r of rowsWithin(row, box, LABEL_NEIGHBOR_WINDOW, rowCols)) {
        const inRange = rowCols.get(r)!.filter((c) => c >= c1 && c <= c2);
        if (inRange.length >= 2 && inRange.length > bestWidth) {
          bestNeighbor = r;
          bestWidth = inRange.length;
        }
      }
      if (bestNeighbor === null) continue;

      // The neighbor that corroborates this row is itself introduced by a
      // label in the same column — if that label recurs elsewhere on the
      // sheet, the neighbor is a repeating sub-item, and `row` is very
      // likely the section heading above it rather than a peer with a
      // missing value. See columnTextFrequency's doc for why.
      const neighborLabel = sheet.cells.get(cellKey(bestNeighbor, labelCol));
      if (neighborLabel?.type === "text") {
        const text = neighborLabel.text.trim();
        if (text && (freqFor(labelCol).get(text) ?? 0) > 1) continue;
      }

      const neighborCols = rowCols.get(bestNeighbor)!.filter((c) => c >= c1 && c <= c2);
      const endCol = Math.min(c2, neighborCols[neighborCols.length - 1]);
      hits.push({
        kind: "labeled-empty-row",
        sheet: sheet.name,
        startRow: row,
        endRow: row,
        startCol: c1,
        endCol,
        evidence:
          `row labeled ${JSON.stringify(labelCell.text)} (${formatCell(row, labelCol)}) has no data; ` +
          `row ${bestNeighbor + 1} has data in ${colRangeText(c1, endCol)}`,
      });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Merge, dedupe, cap.
// ---------------------------------------------------------------------------

/** Row-adjacent-or-overlapping AND column-overlapping, on the same sheet —
 *  the two conditions "merge overlapping/adjacent areas" asks for. */
function boxesMeld(a: RawHit, b: RawHit): boolean {
  return (
    a.sheet === b.sheet &&
    a.startRow <= b.endRow + 1 &&
    b.startRow <= a.endRow + 1 &&
    a.startCol <= b.endCol &&
    b.startCol <= a.endCol
  );
}

/** Merge same-kind hits into their union box, repeatedly, until no two
 *  remaining hits in a kind meld — e.g. five consecutive rows independently
 *  flagged with the same blank column span collapse into one 5-row area
 *  instead of spending five of the 40 slots on what a person would call one
 *  gap. */
function mergeSameKind(hits: RawHit[]): RawHit[] {
  const byKind = new Map<IncompleteAreaKind, RawHit[]>();
  for (const h of hits) {
    const arr = byKind.get(h.kind) ?? [];
    arr.push(h);
    byKind.set(h.kind, arr);
  }

  const merged: RawHit[] = [];
  for (const group of byKind.values()) {
    const remaining = [...group];
    while (remaining.length) {
      let cur = remaining.shift()!;
      let again = true;
      while (again) {
        again = false;
        for (let i = remaining.length - 1; i >= 0; i--) {
          if (!boxesMeld(cur, remaining[i])) continue;
          const o = remaining[i];
          cur = {
            ...cur,
            startRow: Math.min(cur.startRow, o.startRow),
            endRow: Math.max(cur.endRow, o.endRow),
            startCol: Math.min(cur.startCol, o.startCol),
            endCol: Math.max(cur.endCol, o.endCol),
          };
          remaining.splice(i, 1);
          again = true;
        }
      }
      merged.push(cur);
    }
  }
  return merged;
}

const KIND_PRIORITY: Record<IncompleteAreaKind, number> = {
  "row-gap": 0,
  "sequence-gap": 1,
  "labeled-empty-row": 2,
};

function boxContains(outer: RawHit, inner: RawHit): boolean {
  return (
    outer.sheet === inner.sheet &&
    outer.startRow <= inner.startRow &&
    outer.endRow >= inner.endRow &&
    outer.startCol <= inner.startCol &&
    outer.endCol >= inner.endCol
  );
}

/** After same-kind merging, drop any hit fully contained in a
 *  higher-priority hit — e.g. a labeled-empty-row candidate that a
 *  higher-priority row-gap hit already covers. Hits that only partially
 *  overlap are kept side by side; they usually reflect genuinely different
 *  causes and the "your call" latitude in the brief favors not discarding a
 *  real finding over a tidier-looking list. */
function dedupeAcrossKinds(hits: RawHit[]): RawHit[] {
  const ordered = [...hits].sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
  const kept: RawHit[] = [];
  for (const h of ordered) {
    if (!kept.some((k) => boxContains(k, h))) kept.push(h);
  }
  return kept;
}

/**
 * Structural incompleteness map for one workbook: cells that look
 * unfinished relative to their own immediate neighbors, found with no
 * formula-graph or simulator dependency. See the module doc for the
 * heuristics and their known blind spot.
 */
export function findIncompleteAreas(workbook: ParsedWorkbook): FindIncompleteAreasResult {
  const raw: RawHit[] = [];
  for (const sheet of workbook.sheets) {
    const scan = scanSheet(sheet);
    if (!scan) continue;
    raw.push(...rowGapCandidates(sheet, scan));
    raw.push(...sequenceGapCandidates(sheet, scan));
    raw.push(...labeledEmptyRowCandidates(sheet, scan));
  }

  const deduped = dedupeAcrossKinds(mergeSameKind(raw));
  deduped.sort(
    (a, b) =>
      KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] ||
      a.sheet.localeCompare(b.sheet) ||
      a.startRow - b.startRow ||
      a.startCol - b.startCol,
  );

  const omitted = Math.max(0, deduped.length - MAX_AREAS);
  const areas: IncompleteArea[] = deduped.slice(0, MAX_AREAS).map((h, i) => ({
    id: `A${i + 1}`,
    sheet: h.sheet,
    range: formatRange({ startRow: h.startRow, startCol: h.startCol, endRow: h.endRow, endCol: h.endCol }),
    kind: h.kind,
    evidence: h.evidence,
  }));
  return { areas, omitted };
}
