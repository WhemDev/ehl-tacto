import {
  cellKey,
  type GridCell,
  type ParsedSheet,
  type ParsedWorkbook,
} from "./workbook";
import { colToIndex, formatCell, indexToCol, parseRange } from "./a1";

/**
 * Sheet digest: the compact description of a workbook that we send to the model.
 *
 * Whole files are never uploaded. The digest keeps the things that actually
 * encode a planner's rules — headers, column shapes, and above all *formula
 * patterns* — and throws away the bulk data. Target is under ~8,000 tokens per
 * file; whatever gets dropped is recorded in `notes` so the model knows the
 * picture is partial rather than assuming the file is small.
 */

export const TOKEN_BUDGET_PER_FILE = 8000;
const CHARS_PER_TOKEN = 3.6;

const MAX_SAMPLE_ROWS = 30;
const MAX_CELL_CHARS = 200;
const MAX_FORMULA_PATTERNS = 40;
const MAX_SAMPLE_VALUES = 5;
const STATS_ROW_LIMIT = 2000;

export type ColumnType = "number" | "date" | "text" | "bool" | "mixed" | "empty";

export interface ColumnDigest {
  /** Column letter, e.g. "C". */
  column: string;
  header: string | null;
  type: ColumnType;
  /** 0..1, share of scanned data rows that are empty. */
  nullRatio: number;
  /** Distinct non-empty values seen, capped at 200 (reported as `200+`). */
  distinctCount: number;
  distinctCapped: boolean;
  sampleValues: string[];
}

export interface FormulaPattern {
  /** Row numbers of relative refs replaced with `{r}` so fills collapse to one entry. */
  pattern: string;
  /** The formula exactly as authored in the first cell that used this pattern. */
  example: string;
  /** The cell `example` was taken from, e.g. "B7" — lets a `{r}`/`{c}` token be checked against a real instance. */
  exampleCell: string;
  /** Cells this pattern covers, e.g. "E2:E400". */
  range: string;
  count: number;
}

/**
 * A labelled block of rows within a sheet.
 *
 * Plenty of real planning sheets are not one flat table but several stacked
 * blocks — a FORECAST block, a PRODUCTION block, a STOCK block — sharing one
 * set of column headers. Describing such a sheet as a single table is worse
 * than useless: whole-column statistics blend the blocks together, and the
 * block a user actually wants filled in is often far enough down the sheet that
 * it never appears in the sample rows at all.
 */
export interface SectionDigest {
  label: string;
  /** 1-based row of the label itself. */
  labelRow: number;
  /** A1 range covering the block's data rows, excluding the label row. */
  range: string;
  rowCount: number;
  /**
   * Columns that are completely empty within this block. On an output block
   * these are the cells waiting to be filled — the most important signal in
   * the whole digest for a fill-in-the-blanks workflow.
   */
  emptyColumns: string[];
  columns: ColumnDigest[];
  sampleRows: string[][];
}

/**
 * One labelled row inside a repeated block — "Forecast", "Purchase Order".
 *
 * In a row-oriented sheet the field names run down the left and the periods run
 * across the top, so a *row* is what a column is in a normal table.
 */
export interface RowFieldDigest {
  label: string;
  /** 1-based row in the sheet. */
  row: number;
  /** 0..1 across the block's populated width. */
  filledRatio: number;
  type: ColumnType;
  sampleValues: string[];
  formulaCount: number;
}

/**
 * One repetition of a row-block: a product, a site, a cost centre.
 *
 * Planning sheets very often stack the same little table once per item, with
 * the item's name on top. Read as a flat table such a sheet is nonsense — there
 * is no single header row, and whole-column statistics average across every
 * item and every field at once.
 */
export interface RepeatedBlockDigest {
  title: string;
  range: string;
  startRow: number;
  fields: RowFieldDigest[];
  /** Field rows that are entirely empty — what somebody fills in. */
  emptyFields: string[];
  /**
   * Set when this block's field values equal the sum of the same fields
   * across every block before it — a totals block, not an independent input.
   * 1-based indices of the blocks it appears to total, or null.
   */
  derivedFrom: number[] | null;
}

export interface BlockLayout {
  /** Rows per repetition. */
  stride: number;
  /** Row labels that recur in every repetition. */
  fieldLabels: string[];
  count: number;
}

/** One column of a row-oriented sheet's period axis, e.g. `{ column: "B", label: "Jun-25" }`. */
export interface PeriodAxisEntry {
  column: string;
  label: string;
}

/** An absolute ref (`$A$10`) a sheet's formulas already name, with its value and where it's used. */
export interface AnchorCell {
  /** e.g. "A10". */
  cell: string;
  /** Display value of the cell, resolved from the sheet. */
  value: string;
  /** Formula pattern ranges that reference it, e.g. ["B10:AB10"]. */
  usedIn: string[];
}

export interface SheetDigest {
  name: string;
  usedRange: string;
  rows: number;
  cols: number;
  headerRow: number | null;
  columns: ColumnDigest[];
  /** Non-empty only when the sheet is a stack of labelled blocks. */
  sections: SectionDigest[];
  /** Set when the sheet is the same little table repeated down the page. */
  blockLayout: BlockLayout | null;
  repeatedBlocks: RepeatedBlockDigest[];
  /** Column → period, from the block layout's date-typed field row. Null when none is detected. */
  periodAxis: PeriodAxisEntry[] | null;
  sampleRows: string[][];
  formulaPatterns: FormulaPattern[];
  formulaCount: number;
  /** Absolute refs (`$A$10`) named by this sheet's formulas. Empty when none appear. */
  anchors: AnchorCell[];
  merges: string[];
  /** Other sheets/workbooks referenced from this sheet's formulas. */
  crossSheetRefs: string[];
  notes: string[];
}

export interface FileDigest {
  fileName: string;
  sourceIdPrefix: string;
  sheets: SheetDigest[];
  definedNames: { name: string; ref: string; sheet?: string }[];
  /** How many defined names were omitted from `definedNames` to fit the budget. */
  omittedDefinedNames?: number;
  notes: string[];
  approxTokens: number;
}

export function estimateTokens(value: unknown): number {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil((s?.length ?? 0) / CHARS_PER_TOKEN);
}

function truncate(s: string, max = MAX_CELL_CHARS): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/* ------------------------------------------------------------------ *
 * Formula normalisation
 * ------------------------------------------------------------------ */

/** Split a formula into quoted-string and code segments so refs inside literals are left alone. */
function segments(formula: string): { text: string; quoted: boolean }[] {
  const out: { text: string; quoted: boolean }[] = [];
  let buf = "";
  let inQuote = false;
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (ch === '"') {
      if (inQuote && formula[i + 1] === '"') {
        buf += '""';
        i++;
        continue;
      }
      buf += ch;
      if (inQuote) {
        out.push({ text: buf, quoted: true });
        buf = "";
        inQuote = false;
      } else {
        if (buf.length > 1) out.push({ text: buf.slice(0, -1), quoted: false });
        buf = '"';
        inQuote = true;
      }
      continue;
    }
    buf += ch;
  }
  if (buf) out.push({ text: buf, quoted: inQuote });
  return out;
}

const REF_RE = /(?<![A-Za-z0-9_$.])(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(])/g;

/**
 * `SUMIF($B$2:$B$99,A2,$D$2:$D$99)` → `SUMIF($B$2:$B$99,A{r},$D$2:$D$99)`.
 * Only *relative* row parts are replaced: those are the ones that change when a
 * formula is filled down, so absolute anchors stay visible to the model.
 */
export function normalizeFormula(formula: string): string {
  return segments(formula)
    .map((seg) =>
      seg.quoted
        ? seg.text
        : seg.text.replace(REF_RE, (_m, colAbs, col, rowAbs, row) =>
            rowAbs ? `${colAbs}${col}${rowAbs}${row}` : `${colAbs}${col}{r}`,
          ),
    )
    .join("");
}

const REL_COL_RE = /(?<![A-Za-z0-9_$.])([A-Za-z]{1,3})\{r\}/g;

/**
 * Re-express a `{r}` pattern's relative column letters as offsets from the
 * column the formula itself sits in.
 *
 * A column-oriented sheet fills formulas *down*, so the row varies and the
 * literal column letters are worth showing. A row-oriented sheet fills them
 * *across*, so the column varies instead and the literal letters explode one
 * identical rule into thirty patterns. This collapses that case:
 * `B{r}-C{r}+C{r}` in column C and `C{r}-D{r}+D{r}` in column D both become
 * `{c-1}{r}-{c}{r}+{c}{r}` — one rule, its shape finally legible.
 */
function columnRelativeSignature(pattern: string, anchorCol: number): string {
  return pattern.replace(REL_COL_RE, (_m, col: string) => {
    const delta = colLetterToIndex(col) - anchorCol;
    const label = delta === 0 ? "{c}" : `{c${delta > 0 ? "+" : ""}${delta}}`;
    return `${label}{r}`;
  });
}

function colLetterToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const SHEET_REF_RE =
  /(?:\[([^\]]+)\])?(?:'([^']+)'|([A-Za-z0-9_][A-Za-z0-9_ .]*))!/g;

export function extractSheetRefs(formula: string): string[] {
  const found = new Set<string>();
  for (const seg of segments(formula)) {
    if (seg.quoted) continue;
    for (const m of seg.text.matchAll(SHEET_REF_RE)) {
      const file = m[1];
      const sheet = m[2] ?? m[3];
      if (!sheet) continue;
      found.add(file ? `[${file}]${sheet}` : sheet);
    }
  }
  return [...found];
}

/* ------------------------------------------------------------------ *
 * Header + column inference
 * ------------------------------------------------------------------ */

/** Returns a 0-based row index, or null when the sheet has no obvious header. */
export function detectHeaderRow(sheet: ParsedSheet): number | null {
  let best: { row: number; score: number } | null = null;
  const limit = Math.min(10, sheet.rows);
  for (let r = 0; r < limit; r++) {
    let nonEmpty = 0;
    let textCells = 0;
    for (let c = 0; c < sheet.cols; c++) {
      const cell = sheet.cells.get(cellKey(r, c));
      if (!cell || cell.text === "") continue;
      nonEmpty++;
      if (cell.type === "text") textCells++;
    }
    if (nonEmpty < 2) continue;
    const textRatio = textCells / nonEmpty;
    if (textRatio < 0.6) continue;
    const score = nonEmpty * textRatio;
    if (!best || score > best.score) best = { row: r, score };
  }
  return best?.row ?? null;
}

function columnType(types: Set<ColumnType>): ColumnType {
  types.delete("empty");
  if (types.size === 0) return "empty";
  if (types.size === 1) return [...types][0] as ColumnType;
  return "mixed";
}

function buildColumns(
  sheet: ParsedSheet,
  headerRow: number | null,
  /** Restrict the statistics to a row window — used to describe one section. */
  window?: { firstRow: number; lastRow: number },
): ColumnDigest[] {
  const firstData = window ? window.firstRow : headerRow === null ? 0 : headerRow + 1;
  const lastData = window
    ? window.lastRow
    : Math.min(sheet.rows - 1, firstData + STATS_ROW_LIMIT - 1);
  const out: ColumnDigest[] = [];

  for (let c = 0; c < sheet.cols; c++) {
    const headerCell = headerRow === null ? undefined : sheet.cells.get(cellKey(headerRow, c));
    const header = headerCell?.text ? truncate(headerCell.text, 60) : null;

    const distinct = new Set<string>();
    const samples: string[] = [];
    const types = new Set<ColumnType>();
    let empties = 0;
    let scanned = 0;
    let capped = false;

    for (let r = firstData; r <= lastData; r++) {
      scanned++;
      const cell = sheet.cells.get(cellKey(r, c));
      if (!cell || cell.text === "") {
        empties++;
        continue;
      }
      types.add(cell.type === "error" ? "text" : (cell.type as ColumnType));
      const text = truncate(cell.text, 60);
      if (distinct.size < 200) distinct.add(text);
      else capped = true;
      if (samples.length < MAX_SAMPLE_VALUES && !samples.includes(text)) {
        samples.push(text);
      }
    }

    // A column with no header and no data is noise — don't spend tokens on it.
    // Inside a section an empty column is the opposite of noise: it is very
    // likely the block waiting to be filled, so it is always kept.
    if (!window && !header && scanned - empties === 0) continue;

    out.push({
      column: indexToCol(c),
      header,
      type: columnType(types),
      nullRatio: scanned === 0 ? 1 : Number((empties / scanned).toFixed(2)),
      distinctCount: distinct.size,
      distinctCapped: capped,
      sampleValues: samples,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Section detection
 * ------------------------------------------------------------------ */

const MAX_SECTION_LABEL_CHARS = 60;
const SECTION_SAMPLE_ROWS = 4;

function rowCells(sheet: ParsedSheet, row: number): { count: number; firstCol: number; first?: GridCell } {
  let count = 0;
  let firstCol = -1;
  let first: GridCell | undefined;
  for (let c = 0; c < sheet.cols; c++) {
    const cell = sheet.cells.get(cellKey(row, c));
    if (!cell || cell.text === "") continue;
    count++;
    if (firstCol === -1) {
      firstCol = c;
      first = cell;
    }
    if (count > 1) break;
  }
  return { count, firstCol, first };
}

/** A row carrying real data has values in at least two columns. */
function isDataRow(sheet: ParsedSheet, row: number): boolean {
  let n = 0;
  for (let c = 0; c < sheet.cols; c++) {
    const cell = sheet.cells.get(cellKey(row, c));
    if (cell && cell.text !== "") n++;
    if (n >= 2) return true;
  }
  return false;
}

const MAX_SECTIONS = 40;

/** How often each text value occurs in a given column, below the header. */
function columnValueFrequency(
  sheet: ParsedSheet,
  col: number,
  start: number,
): Map<string, number> {
  const freq = new Map<string, number>();
  for (let r = start; r < sheet.rows; r++) {
    const text = sheet.cells.get(cellKey(r, col))?.text?.trim();
    if (!text) continue;
    freq.set(text, (freq.get(text) ?? 0) + 1);
  }
  return freq;
}

/**
 * Find rows that label a block of rows beneath them.
 *
 * The hard case is a block whose data columns are entirely blank — exactly the
 * block someone is about to fill in. Every row in it has only its row-label
 * populated, so "one cell in this row" alone cannot separate the block heading
 * from the items underneath it.
 *
 * Repetition breaks the tie. The same item appears once per block ("SKU-1000"
 * under FORECAST, again under PRODUCTION, again under STOCK), whereas a block
 * heading appears once in the whole column. So a repeated value is never a
 * heading, and a unique value that sits directly above repeated ones is.
 *
 * Requires at least two headings before calling a sheet sectioned — one stray
 * single-cell row is a note, not a structure.
 */
export function detectSections(
  sheet: ParsedSheet,
  headerRow: number | null,
): { label: string; row: number }[] {
  const start = headerRow === null ? 0 : headerRow + 1;
  const freqByCol = new Map<number, Map<string, number>>();
  const freqFor = (col: number) => {
    let f = freqByCol.get(col);
    if (!f) {
      f = columnValueFrequency(sheet, col, start);
      freqByCol.set(col, f);
    }
    return f;
  };

  /** The next row below `r` that has anything in it at all. */
  const nextNonBlank = (r: number): number => {
    for (let k = r + 1; k < sheet.rows; k++) {
      if (rowCells(sheet, k).count > 0) return k;
    }
    return -1;
  };

  const labels: { label: string; row: number }[] = [];

  for (let r = start; r < sheet.rows; r++) {
    const { count, firstCol, first } = rowCells(sheet, r);
    if (count !== 1 || firstCol > 1 || !first || first.type !== "text") continue;

    const text = first.text.trim();
    if (!text || text.length > MAX_SECTION_LABEL_CHARS) continue;

    // A value that recurs in this column is an item identifier, not a heading.
    if ((freqFor(firstCol).get(text) ?? 0) > 1) continue;

    // Either it introduces rows with real data...
    let introducesData = false;
    for (let k = r + 1; k < Math.min(r + 4, sheet.rows); k++) {
      if (isDataRow(sheet, k)) {
        introducesData = true;
        break;
      }
    }

    // ...or it sits directly above rows whose labels repeat elsewhere, which is
    // what an all-blank block looks like.
    let introducesItems = false;
    const next = nextNonBlank(r);
    if (next !== -1) {
      const nextCells = rowCells(sheet, next);
      const nextText = nextCells.first?.text?.trim();
      if (nextText && (freqFor(nextCells.firstCol).get(nextText) ?? 0) > 1) {
        introducesItems = true;
      }
    }

    if (!introducesData && !introducesItems) continue;
    labels.push({ label: text, row: r });
  }

  if (labels.length < 2) return [];
  return labels.slice(0, MAX_SECTIONS);
}

function buildSections(
  sheet: ParsedSheet,
  headerRow: number | null,
  labels: { label: string; row: number }[],
): SectionDigest[] {
  return labels.map((label, i) => {
    const firstRow = label.row + 1;
    const hardEnd = i + 1 < labels.length ? labels[i + 1].row - 1 : sheet.rows - 1;

    // Trim trailing blank rows so the reported range is the block, not the gap
    // after it. "Blank" means genuinely nothing — a row carrying only its item
    // name is still part of the block, and on an unfilled block that is every
    // row it has.
    const hasAnything = (r: number) => rowCells(sheet, r).count > 0;
    let lastRow = hardEnd;
    while (lastRow >= firstRow && !hasAnything(lastRow)) lastRow--;

    const columns =
      lastRow >= firstRow ? buildColumns(sheet, headerRow, { firstRow, lastRow }) : [];

    const sampleRows: string[][] = [];
    for (let r = firstRow; r <= lastRow && sampleRows.length < SECTION_SAMPLE_ROWS; r++) {
      if (!hasAnything(r)) continue;
      sampleRows.push(
        columns.map((c) => truncate(sheet.cells.get(cellKey(r, colIndex(c.column)))?.text ?? "")),
      );
    }

    return {
      label: label.label,
      labelRow: label.row + 1,
      range:
        lastRow >= firstRow
          ? `${formatCell(firstRow, 0)}:${formatCell(lastRow, Math.max(0, sheet.cols - 1))}`
          : "(empty)",
      rowCount: Math.max(0, lastRow - firstRow + 1),
      emptyColumns: columns.filter((c) => c.nullRatio === 1).map((c) => c.column),
      columns,
      sampleRows,
    };
  });
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* ------------------------------------------------------------------ *
 * Repeated row-blocks
 * ------------------------------------------------------------------ */

const MIN_BLOCK_STRIDE = 3;
const MIN_BLOCK_REPEATS = 2;
const MIN_RECURRING_LABELS = 2;
const MAX_BLOCKS_REPORTED = 40;
const FIELD_SAMPLE_VALUES = 3;

/** Last column with anything in it, so a 63-column sheet isn't reported as 63 wide. */
function lastPopulatedCol(sheet: ParsedSheet, firstRow: number, lastRow: number): number {
  let last = 0;
  for (let r = firstRow; r <= lastRow; r++) {
    for (let c = sheet.cols - 1; c > last; c--) {
      if (sheet.cells.get(cellKey(r, c))?.text) {
        last = c;
        break;
      }
    }
  }
  return last;
}

/**
 * Recognise a sheet that is the same small table repeated down the page.
 *
 * The giveaway is repetition in the label column: "Forecast" appearing ten
 * times down column A means the sheet has ten of something, and those repeated
 * labels are the fields.
 *
 * Block *height* is deliberately not assumed to be constant. Real sheets are
 * ragged — a subtotal table with no id, an extra comment row, a missing
 * prior-year line — and on the file that prompted this the heights were 9, 10,
 * 11 and 14 rows, so a fixed stride matched only 42% of the gaps and rejected
 * the whole layout. Instead each block's top is found by walking up from a
 * repeated label until a row appears that is *not* one of the repeated labels:
 * that row is the item's own title.
 *
 * Deliberately blind to what the labels say, so it works in any language.
 */
export function detectRepeatedBlocks(
  sheet: ParsedSheet,
): { starts: number[]; fieldLabels: string[]; medianHeight: number } | null {
  if (sheet.rows < MIN_BLOCK_STRIDE * MIN_BLOCK_REPEATS) return null;

  const occurrences = new Map<string, number[]>();
  for (let r = 0; r < sheet.rows; r++) {
    const text = sheet.cells.get(cellKey(r, 0))?.text?.trim();
    if (!text) continue;
    occurrences.set(text, [...(occurrences.get(text) ?? []), r]);
  }

  const recurring = [...occurrences.entries()].filter(([, rows]) => rows.length >= 3);
  if (recurring.length < MIN_RECURRING_LABELS) return null;

  const recurringLabels = new Set(recurring.map(([label]) => label));

  // Anchor on the label that repeats most reliably; each occurrence is one block.
  const anchor = [...recurring].sort(
    (a, b) => b[1].length - a[1].length || a[1][0] - b[1][0],
  )[0];

  const starts: number[] = [];
  for (const anchorRow of anchor[1]) {
    let top = anchorRow;
    // Climb past the other field rows of this block. The first row that is not
    // a repeated label is the block's own heading.
    for (let r = anchorRow - 1; r >= 0; r--) {
      const text = sheet.cells.get(cellKey(r, 0))?.text?.trim();
      if (!text) {
        if (rowCells(sheet, r).count === 0) break; // blank row: block starts below it
        top = r;
        continue;
      }
      top = r;
      if (!recurringLabels.has(text)) break; // the title row
    }
    if (starts.at(-1) !== top) starts.push(top);
  }

  if (starts.length < MIN_BLOCK_REPEATS) return null;

  const heights = starts
    .map((s, i) => (i + 1 < starts.length ? starts[i + 1] : sheet.rows) - s)
    .sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)];
  if (medianHeight < MIN_BLOCK_STRIDE) return null;

  // Fields shown as "shared" are the ones present in most blocks.
  const fieldLabels = recurring
    .filter(([, rows]) => rows.length >= Math.ceil(starts.length * 0.6))
    .map(([label]) => label);

  return { starts, fieldLabels: [...new Set(fieldLabels)], medianHeight };
}

function buildRepeatedBlocks(
  sheet: ParsedSheet,
  layout: { starts: number[]; fieldLabels: string[] },
): { blocks: RepeatedBlockDigest[]; periodAxis: PeriodAxisEntry[] | null } {
  const recurring = new Set(layout.fieldLabels);
  // Every repetition shares the same columns, so one date-typed field row is
  // enough to name them all — the first block that has one wins.
  let periodAxis: PeriodAxisEntry[] | null = null;

  const blocks = layout.starts.slice(0, MAX_BLOCKS_REPORTED).map((start, i) => {
    // Blocks run to the next block's start; heights vary in real sheets.
    const nextStart = layout.starts[i + 1] ?? sheet.rows;
    const end = Math.min(nextStart - 1, sheet.rows - 1);
    const lastCol = lastPopulatedCol(sheet, start, end);

    const fields: RowFieldDigest[] = [];
    for (let r = start; r <= end; r++) {
      const labelCell = sheet.cells.get(cellKey(r, 0));
      const label = labelCell?.text?.trim() ?? "";
      const types = new Set<ColumnType>();
      const samples: string[] = [];
      // Column letter + display text of each date cell in this row, in case
      // it turns out to be the sheet's period axis — RowFieldDigest.sampleValues
      // is capped and carries no column, so this has to be captured here.
      const axis: PeriodAxisEntry[] = [];
      let filled = 0;
      let scanned = 0;
      let formulaCount = 0;

      for (let c = 1; c <= lastCol; c++) {
        scanned++;
        const cell = sheet.cells.get(cellKey(r, c));
        if (cell?.formula) formulaCount++;
        if (!cell || cell.text === "") continue;
        filled++;
        types.add(cell.type === "error" ? "text" : (cell.type as ColumnType));
        if (samples.length < FIELD_SAMPLE_VALUES) samples.push(truncate(cell.text, 24));
        if (cell.type === "date") axis.push({ column: indexToCol(c), label: cell.text });
      }

      // A row with nothing at all in it is padding, not a field.
      if (!label && filled === 0) continue;

      const fieldType = columnType(types);
      if (fieldType === "date" && !periodAxis && axis.length) periodAxis = axis;

      fields.push({
        label: label || `(row ${r + 1})`,
        row: r + 1,
        filledRatio: scanned === 0 ? 0 : Number((filled / scanned).toFixed(2)),
        type: fieldType,
        sampleValues: samples,
        formulaCount,
      });
    }

    // The title is whatever sits at the top of the block and is *not* one of
    // the repeating field names — the product code, the site, the cost centre.
    const head = fields.find((f) => !recurring.has(f.label));
    const title = head && head.row === start + 1 ? head.label : `Block ${i + 1}`;

    return {
      title,
      range: `${formatCell(start, 0)}:${formatCell(end, lastCol)}`,
      startRow: start + 1,
      fields,
      emptyFields: fields.filter((f) => f.filledRatio === 0).map((f) => f.label),
      derivedFrom: null,
    };
  });

  return { blocks, periodAxis };
}

/* ------------------------------------------------------------------ *
 * Digest assembly
 * ------------------------------------------------------------------ */

function buildFormulaPatterns(sheet: ParsedSheet, limit: number): {
  patterns: FormulaPattern[];
  total: number;
  crossSheetRefs: string[];
} {
  interface Acc {
    example: string;
    /** Cell `example` was taken from — its top-left is not `minRow/minCol` once patterns merge below. */
    exampleCell: string;
    count: number;
    minRow: number;
    maxRow: number;
    minCol: number;
    maxCol: number;
  }
  const byPattern = new Map<string, Acc>();
  const crossRefs = new Set<string>();
  let total = 0;

  const sorted = [...sheet.cells.values()]
    .filter((c): c is GridCell & { formula: string } => Boolean(c.formula))
    .sort((a, b) => a.row - b.row || a.col - b.col);

  for (const cell of sorted) {
    total++;
    for (const ref of extractSheetRefs(cell.formula)) crossRefs.add(ref);
    const pattern = normalizeFormula(cell.formula);
    const acc = byPattern.get(pattern);
    if (acc) {
      acc.count++;
      acc.minRow = Math.min(acc.minRow, cell.row);
      acc.maxRow = Math.max(acc.maxRow, cell.row);
      acc.minCol = Math.min(acc.minCol, cell.col);
      acc.maxCol = Math.max(acc.maxCol, cell.col);
    } else {
      byPattern.set(pattern, {
        example: cell.formula,
        exampleCell: formatCell(cell.row, cell.col),
        count: 1,
        minRow: cell.row,
        maxRow: cell.row,
        minCol: cell.col,
        maxCol: cell.col,
      });
    }
  }

  // Second pass: merge patterns that are the same rule filled sideways. Only
  // when it actually unifies several — for a normal fill-down sheet the literal
  // column letters are more readable than an offset.
  const byColumnSignature = new Map<string, { sig: string; entries: [string, Acc][] }>();
  for (const entry of byPattern.entries()) {
    const sig = columnRelativeSignature(entry[0], entry[1].minCol);
    const hit = byColumnSignature.get(sig);
    if (hit) hit.entries.push(entry);
    else byColumnSignature.set(sig, { sig, entries: [entry] });
  }

  const merged: [string, Acc][] = [];
  for (const { sig, entries } of byColumnSignature.values()) {
    if (entries.length < 3) {
      merged.push(...entries);
      continue;
    }
    const acc: Acc = {
      example: entries[0][1].example,
      exampleCell: entries[0][1].exampleCell,
      count: entries.reduce((n, [, a]) => n + a.count, 0),
      minRow: Math.min(...entries.map(([, a]) => a.minRow)),
      maxRow: Math.max(...entries.map(([, a]) => a.maxRow)),
      minCol: Math.min(...entries.map(([, a]) => a.minCol)),
      maxCol: Math.max(...entries.map(([, a]) => a.maxCol)),
    };
    merged.push([sig, acc]);
  }

  const patterns = merged
    // Widest fills first: they describe the most of the sheet's behaviour.
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([pattern, acc]) => ({
      pattern: `=${pattern}`,
      example: `=${acc.example}`,
      exampleCell: acc.exampleCell,
      range:
        acc.minRow === acc.maxRow && acc.minCol === acc.maxCol
          ? formatCell(acc.minRow, acc.minCol)
          : `${formatCell(acc.minRow, acc.minCol)}:${formatCell(acc.maxRow, acc.maxCol)}`,
      count: acc.count,
    }));

  return { patterns, total, crossSheetRefs: [...crossRefs] };
}

/* ------------------------------------------------------------------ *
 * Anchor cells
 * ------------------------------------------------------------------ */

const MAX_ANCHORS = 8;

// A fully-absolute ref not adjacent to a `:` — that excludes both corners of
// an absolute range like `$B$2:$B$99`, which name a span rather than a
// single parameter cell, while still matching a lone `$A$10` in `B6/$A$10`.
// `!` is excluded from the lookbehind too: it's the sheet-name separator, so
// `Sheet2!$B$1` must not match as a same-sheet ref — resolving it here would
// silently read the wrong sheet's cell and hand the model a confidently
// wrong value instead of skipping an anchor it can't safely resolve.
const ABSOLUTE_REF_RE = /(?<![A-Za-z0-9_$.:!])\$([A-Za-z]{1,3})\$(\d{1,7})(?!:)/g;

/**
 * Absolute refs a sheet's formulas already name, resolved to their value.
 *
 * Purely mechanical: this reads what `example` already contains and what the
 * cell already holds, and does not guess at what the cell means.
 */
function detectAnchors(sheet: ParsedSheet, patterns: FormulaPattern[]): AnchorCell[] {
  const byCell = new Map<string, AnchorCell>();
  for (const p of patterns) {
    for (const m of p.example.matchAll(ABSOLUTE_REF_RE)) {
      const cell = `${m[1].toUpperCase()}${m[2]}`;
      let anchor = byCell.get(cell);
      if (!anchor) {
        const row = Number(m[2]) - 1;
        const col = colToIndex(m[1]);
        const value = sheet.cells.get(cellKey(row, col))?.text ?? "";
        // An anchor that resolves to nothing is a token cost with zero
        // informational content — skip it, and don't let it eat a slot.
        if (!value) continue;
        if (byCell.size >= MAX_ANCHORS) continue;
        anchor = { cell, value, usedIn: [] };
        byCell.set(cell, anchor);
      }
      if (!anchor.usedIn.includes(p.range)) anchor.usedIn.push(p.range);
    }
  }
  return [...byCell.values()];
}

/* ------------------------------------------------------------------ *
 * Derived-block detection
 * ------------------------------------------------------------------ *
 *
 * This is the one detection in this file that infers meaning — "this block
 * is a total, not an input" — rather than reporting a mechanical fact, and
 * the design explicitly flags it as possibly worth cutting. It is kept
 * self-contained on purpose: `detectDerivedBlocks` plus its one call site in
 * `buildSheetDigest` (setting `derivedFrom`) is the whole feature, and both
 * can be deleted without touching anything else.
 *
 * A wrong "DERIVED" label tells the model to ignore a real input block, which
 * is worse than missing a real total — so this stays conservative: numeric
 * tolerance is tight, a block is only compared against ALL blocks before it
 * (never a subset), a single field agreeing is not enough evidence, and any
 * disagreement at all on a field rules it out.
 */

const DERIVED_TOLERANCE = 1e-6;
const MIN_DERIVED_MATCHES = 3;
const MIN_DERIVED_FIELDS = 2;

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= DERIVED_TOLERANCE * Math.max(Math.abs(a), Math.abs(b), 1);
}

/** Numeric values across a block's data columns for one row, or null where a cell isn't numeric. */
function numericRowValues(sheet: ParsedSheet, row: number, lastCol: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let c = 1; c <= lastCol; c++) {
    const cell = sheet.cells.get(cellKey(row - 1, c));
    out.push(cell?.type === "number" ? (cell.value as number) : null);
  }
  return out;
}

/** Flags blocks whose fields equal the sum of the same fields across every block before them. See header comment above. */
function detectDerivedBlocks(
  sheet: ParsedSheet,
  blocks: RepeatedBlockDigest[],
): Map<number, number[]> {
  const flagged = new Map<number, number[]>();

  for (let i = 2; i < blocks.length; i++) {
    const target = blocks[i];
    const preceding = blocks.slice(0, i);
    const box = parseRange(target.range);
    if (!box) continue;
    const lastCol = box.endCol;

    const sharedLabels = target.fields
      .map((f) => f.label)
      .filter((label) => preceding.every((b) => b.fields.some((f) => f.label === label)));

    let fieldsAgreeing = 0;
    for (const label of sharedLabels) {
      const targetRow = target.fields.find((f) => f.label === label)!.row;
      const values = numericRowValues(sheet, targetRow, lastCol);
      const precedingValues = preceding.map((b) =>
        numericRowValues(sheet, b.fields.find((f) => f.label === label)!.row, lastCol),
      );

      let matches = 0;
      let mismatches = 0;
      for (let c = 0; c < lastCol; c++) {
        const targetValue = values[c];
        if (targetValue === null) continue;
        if (precedingValues.some((pv) => pv[c] === null)) continue; // can't verify this column
        const sum = precedingValues.reduce((acc, pv) => acc + (pv[c] as number), 0);
        if (nearlyEqual(targetValue, sum)) matches++;
        else mismatches++;
      }
      if (mismatches === 0 && matches >= MIN_DERIVED_MATCHES) fieldsAgreeing++;
    }

    if (fieldsAgreeing >= MIN_DERIVED_FIELDS) {
      flagged.set(i, preceding.map((_, idx) => idx + 1));
    }
  }

  return flagged;
}

function buildSampleRows(
  sheet: ParsedSheet,
  headerRow: number | null,
  columns: ColumnDigest[],
  limit: number,
): string[][] {
  const colIndexes = columns.map((c) => {
    let n = 0;
    for (const ch of c.column) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  });
  const firstData = headerRow === null ? 0 : headerRow + 1;
  const rows: string[][] = [];
  for (let r = firstData; r < sheet.rows && rows.length < limit; r++) {
    const row = colIndexes.map((c) => truncate(sheet.cells.get(cellKey(r, c))?.text ?? ""));
    if (row.every((v) => v === "")) continue;
    rows.push(row);
  }
  return rows;
}

function buildSheetDigest(
  sheet: ParsedSheet,
  opts: DigestPlan,
): SheetDigest {
  const notes: string[] = [];
  const headerRow = detectHeaderRow(sheet);
  const allColumns = buildColumns(sheet, headerRow);
  const { patterns, total, crossSheetRefs } = buildFormulaPatterns(
    sheet,
    opts.formulaPatterns,
  );
  const anchors = detectAnchors(sheet, patterns);

  // Two different shapes can look alike from a distance, so order matters.
  //
  // Stacked sections and repeated row-blocks both put recurring labels down
  // column A. What separates them is the header row: a FORECAST/PRODUCTION
  // sheet has one real header (the months) shared by every block, so its
  // columns carry meaning and it is column-oriented. A sheet that repeats a
  // whole little table per product has no single header at all, and its rows
  // are the fields. Section detection is therefore tried first and the
  // row-oriented reading is the fallback.
  const sectionLabels = detectSections(sheet, headerRow);
  const sections = sectionLabels.length
    ? buildSections(sheet, headerRow, sectionLabels)
    : [];

  const repeated = sections.length ? null : detectRepeatedBlocks(sheet);
  const built = repeated ? buildRepeatedBlocks(sheet, repeated) : { blocks: [], periodAxis: null };
  const repeatedBlocks = built.blocks;
  const periodAxis = built.periodAxis;
  const blockLayout: BlockLayout | null = repeated
    ? {
        stride: repeated.medianHeight,
        fieldLabels: repeated.fieldLabels,
        count: repeated.starts.length,
      }
    : null;

  // See the comment above detectDerivedBlocks: isolated on purpose.
  for (const [i, from] of detectDerivedBlocks(sheet, repeatedBlocks)) {
    repeatedBlocks[i].derivedFrom = from;
  }

  // A sectioned sheet describes itself block by block. Sampling from the top
  // would show only the first block, and on a long sheet the block the user
  // cares about most is usually not the first one.
  const sampleRows =
    sections.length || repeatedBlocks.length
      ? []
      : buildSampleRows(sheet, headerRow, allColumns, opts.sampleRows);

  // Cap per-column statistics — the digest's second-biggest field on wide
  // real-world sheets. The cap applies to the flat-table columns, each
  // section's columns, and the matching sample-row widths, so rows always
  // line up with the columns actually shown.
  const colCap = opts.sectionColumns;
  let cappedFrom = 0;
  const capList = <T>(list: T[]): T[] => {
    if (list.length > colCap) {
      cappedFrom = Math.max(cappedFrom, list.length);
      return list.slice(0, colCap);
    }
    return list;
  };
  const columnsCapped = capList(allColumns);
  const sectionsCapped = sections.map((sec) => ({
    ...sec,
    columns: capList(sec.columns),
    sampleRows: sec.sampleRows.map((r) => r.slice(0, colCap)),
  }));
  const sampleRowsCapped = sampleRows.map((r) => r.slice(0, colCap));
  if (cappedFrom > 0) {
    notes.push(
      `column statistics shown for the first ${colCap} of ${cappedFrom} populated columns.`,
    );
  }

  if (sheet.truncated) {
    notes.push(
      `Sheet exceeds the ${sheet.rows} x ${sheet.cols} cap; actual size is ${sheet.totalRows} rows x ${sheet.totalCols} columns. Everything below/right of the cap was not read.`,
    );
  }
  const dataRows = Math.max(0, sheet.rows - (headerRow === null ? 0 : headerRow + 1));

  if (blockLayout) {
    notes.push(
      `This sheet is NOT one table. It is the same small table repeated ${blockLayout.count} times down the page, typically ${blockLayout.stride} rows each (heights vary), every repetition headed by its own title row. The rows are the fields (${blockLayout.fieldLabels.join(", ")}) and the columns are the periods. The sheet-level column statistics above average across every repetition and every field at once and are meaningless here — use the blocks below.`,
    );
    // Which of the *shared* fields are consistently under-filled. A per-block
    // label like "107142" is a value, not a field name, so only labels that
    // recur across blocks are considered.
    const shared = new Set(blockLayout.fieldLabels);
    const fill = new Map<string, number[]>();
    for (const b of repeatedBlocks) {
      for (const f of b.fields) {
        if (!shared.has(f.label)) continue;
        fill.set(f.label, [...(fill.get(f.label) ?? []), f.filledRatio]);
      }
    }
    const sparse = [...fill.entries()]
      .map(([label, ratios]) => ({
        label,
        avg: ratios.reduce((a, b) => a + b, 0) / ratios.length,
      }))
      .filter((f) => f.avg < 0.6)
      .sort((a, b) => a.avg - b.avg);
    if (sparse.length) {
      notes.push(
        `Field rows that are only partly filled across the repetitions, and so are the likeliest thing a person fills in by hand: ${sparse
          .map((f) => `"${f.label}" (about ${Math.round(f.avg * 100)}% filled)`)
          .join(", ")}.`,
      );
    }
    if (repeated && repeated.starts.length > repeatedBlocks.length) {
      notes.push(
        `Showing ${repeatedBlocks.length} of ${repeated.starts.length} repetitions.`,
      );
    }
  } else if (sections.length) {
    notes.push(
      `This sheet is ${sections.length} labelled blocks stacked under one header row, not a single table: ${sections
        .map((s) => `"${s.label}" (${s.range}, ${s.rowCount} rows)`)
        .join(", ")}. Each block is described separately below; the sheet-level column statistics blend all of them and should be ignored where a block's own figures are given.`,
    );
    const blank = sections.filter((s) => s.emptyColumns.length > 0);
    if (blank.length) {
      notes.push(
        `Blocks with columns that are entirely empty — candidates for what gets filled in: ${blank
          .map((s) => `"${s.label}" (${s.emptyColumns.join(", ")})`)
          .join("; ")}.`,
      );
    }
  } else if (sampleRows.length < dataRows) {
    notes.push(
      `Showing the first ${sampleRows.length} of ~${dataRows} data rows. Values not shown follow the same column shapes.`,
    );
  }
  const coveredFormulas = patterns.reduce((n, p) => n + p.count, 0);
  if (coveredFormulas < total) {
    notes.push(
      `Showing the ${patterns.length} most-used formula patterns, covering ${coveredFormulas} of ${total} formula cells. Rarer patterns were dropped.`,
    );
  }
  if (headerRow === null) {
    notes.push("No header row detected; column labels are unavailable.");
  }

  return {
    name: sheet.name,
    usedRange:
      sheet.rows === 0
        ? "(empty)"
        : `A1:${formatCell(sheet.rows - 1, Math.max(0, sheet.cols - 1))}`,
    rows: sheet.rows,
    cols: sheet.cols,
    headerRow: headerRow === null ? null : headerRow + 1,
    // Whole-column statistics average across every repetition and every field
    // at once on a row-oriented sheet. Sending them and then telling the model
    // to ignore them wastes roughly a thousand tokens saying nothing.
    columns: blockLayout ? [] : columnsCapped,
    sections: sectionsCapped,
    blockLayout,
    repeatedBlocks,
    periodAxis,
    sampleRows: sampleRowsCapped,
    formulaPatterns: patterns,
    formulaCount: total,
    anchors,
    merges: sheet.merges.map(
      (m) => `${formatCell(m.startRow, m.startCol)}:${formatCell(m.endRow, m.endCol)}`,
    ),
    crossSheetRefs,
    notes,
  };
}

/** Every plan dimension the shrink loop can tighten. Exported for tests. */
export interface DigestPlan {
  sampleRows: number;
  formulaPatterns: number;
  sectionColumns: number;
  definedNames: number;
}

/** Upper-cased identifier-ish tokens across every formula in the workbook —
 *  the cheap way to ask "is this defined name actually used?". */
function formulaIdentifiers(wb: ParsedWorkbook): Set<string> {
  const idents = new Set<string>();
  const IDENT = /[A-Za-z_\\][A-Za-z0-9._\\]*/g;
  for (const sheet of wb.sheets) {
    for (const cell of sheet.cells.values()) {
      if (!cell.formula) continue;
      for (const m of cell.formula.toUpperCase().matchAll(IDENT)) idents.add(m[0]);
    }
  }
  return idents;
}

/** Legacy XLM-macro junk: array-literal refs and error refs. */
function isJunkRef(ref: string): boolean {
  return ref.startsWith("{") || /#(REF|N\/A|NAME\?|VALUE)!?/.test(ref);
}

/** Referenced-in-formulas first, then valid refs, then junk; stable within
 *  each tier. Returns the kept prefix and the omitted count. */
function rankDefinedNames(
  wb: ParsedWorkbook,
  cap: number,
  referenced: Set<string>,
): { kept: { name: string; ref: string; sheet?: string }[]; omitted: number } {
  const tier = (n: { name: string; ref: string }) =>
    referenced.has(n.name.toUpperCase()) ? 0 : isJunkRef(n.ref) ? 2 : 1;
  const kept = wb.definedNames
    .map((n, i) => ({ n, i }))
    .sort((a, b) => tier(a.n) - tier(b.n) || a.i - b.i)
    .slice(0, cap)
    .map((x) => x.n);
  return { kept, omitted: wb.definedNames.length - kept.length };
}

/* ------------------------------------------------------------------ *
 * Cross-sheet period-axis comparison
 * ------------------------------------------------------------------ *
 *
 * Many financial models repeat one calendar axis — FY21 ... FY30, say — as
 * a header row near the top of many sheets, one column per period. When a
 * task extends such a model by another period, every sheet carrying that
 * axis is supposed to move together, but nothing in a per-sheet reading
 * says the sheets are related at all: asked to "extend the model by a
 * year", a model sees eight or nine independent sheets, each with its own
 * unremarkable date row, with nothing hinting they are the same axis
 * repeated. The one sheet that quietly keeps the OLD axis after everything
 * else has been extended is exactly the kind of miss this is meant to
 * catch — but the digest is built once, from the *input* file, before any
 * editing happens, so it can never observe that moment directly. What it
 * can do is state the relationship up front: which sheets currently share
 * one axis (so "extend the model" plainly means all of them), and — for a
 * file where the input itself already has a straggler — which sheet is a
 * lone period short of where the rest ended up.
 */

/** How far apart two consecutive axis dates fall. Real calendars wobble —
 *  28-31 days in a month, 89-92 in a quarter, 365-366 in a year — so these
 *  are bands, not exact counts. */
export type PeriodStep = "monthly" | "quarterly" | "annual";

function classifyStepDays(days: number): PeriodStep | null {
  if (days >= 28 && days <= 31) return "monthly";
  if (days >= 89 && days <= 92) return "quarterly";
  if (days >= 365 && days <= 366) return "annual";
  return null;
}

/** Representative day-count per step, used only to size "N periods behind"
 *  — a rough label, not a date computation (the end dates themselves are
 *  read exactly off the cells, never derived from this). */
const STEP_DAYS: Record<PeriodStep, number> = { monthly: 30, quarterly: 91, annual: 365.25 };

const PERIOD_AXIS_SCAN_ROWS = 6;
const MIN_AXIS_RUN = 3;

export interface SheetPeriodAxis {
  sheet: string;
  /** 1-based row the axis sits on. */
  row: number;
  startCol: string;
  endCol: string;
  lastDate: Date;
  step: PeriodStep;
  /** Number of date cells in the run. */
  length: number;
}

/**
 * A cell counts as a period-axis date only once it is typed `"date"` with a
 * real `Date` value. That is not a narrowing — it is what `parseWorkbook`
 * (via SheetJS's `cellDates: true`) already produces for every date-shaped
 * cell it sees, literal or formula-computed: verified against this
 * dataset's own files and against a synthetic `EOMONTH(...)` formula cell
 * with a cached, date-formatted value, both of which came through as
 * `type: "date"` with a genuine `Date`. A second path that reads a raw
 * numeric serial off a "number"-typed, date-formatted cell would therefore
 * be handling a case that does not occur in practice here — and would need
 * its own serial-to-date conversion to do it safely, since the one already
 * in this codebase (formula/functions/date.ts) is deliberately
 * bug-compatible with the Python reference *simulation* engine rather than
 * real Excel, and would silently mis-date a real file's serials if reused
 * for this.
 */
function axisDate(cell: GridCell | undefined): Date | null {
  return cell && cell.type === "date" && cell.value instanceof Date ? cell.value : null;
}

/** `null` unless every consecutive gap in `dates` classifies to the same step. */
function consistentStep(dates: Date[]): PeriodStep | null {
  let step: PeriodStep | null = null;
  for (let i = 1; i < dates.length; i++) {
    const days = (dates[i].getTime() - dates[i - 1].getTime()) / 86_400_000;
    const s = classifyStepDays(days);
    if (!s || (step && s !== step)) return null;
    step = s;
  }
  return step;
}

/**
 * The longest run of consistently-stepped date cells across a single row,
 * within a sheet's top `PERIOD_AXIS_SCAN_ROWS` rows — where a period-axis
 * header lives in every real example seen so far (further down is a data
 * row, not a header). A run is a maximal span of ADJACENT columns that are
 * all date cells; if its own gaps do not all agree on one step, the row is
 * not a period axis and contributes nothing — a header row reads as a
 * clean axis or it does not, there is no "mostly consistent" here.
 */
export function detectSheetPeriodAxis(sheet: ParsedSheet): SheetPeriodAxis | null {
  let best: SheetPeriodAxis | null = null;
  const scanRows = Math.min(PERIOD_AXIS_SCAN_ROWS, sheet.rows);

  for (let r = 0; r < scanRows; r++) {
    let runStartCol = -1;
    let runDates: Date[] = [];

    const closeRun = (endCol: number) => {
      if (runDates.length >= MIN_AXIS_RUN) {
        const step = consistentStep(runDates);
        if (step && (!best || runDates.length > best.length)) {
          best = {
            sheet: sheet.name,
            row: r + 1,
            startCol: indexToCol(runStartCol),
            endCol: indexToCol(endCol),
            lastDate: runDates[runDates.length - 1],
            step,
            length: runDates.length,
          };
        }
      }
      runStartCol = -1;
      runDates = [];
    };

    for (let c = 0; c < sheet.cols; c++) {
      const date = axisDate(sheet.cells.get(cellKey(r, c)));
      if (date) {
        if (runStartCol === -1) runStartCol = c;
        runDates.push(date);
      } else {
        closeRun(c - 1);
      }
    }
    closeRun(sheet.cols - 1);
  }

  return best;
}

/** Most frequent value; ties go to whichever appears first. Deterministic
 *  as long as callers pass values in a stable order (they do: sheet order). */
function mostCommon<T>(values: T[]): T {
  const counts = new Map<T, number>();
  let bestVal = values[0];
  let bestCount = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestCount) {
      bestCount = n;
      bestVal = v;
    }
  }
  return bestVal;
}

function isoDate(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

const PERIOD_AXIS_LIST_CAP = 6;
/** "About one period" behind — the classic "forgot to extend this one
 *  sheet" gap. Bounded on both sides so a sheet with a genuinely different,
 *  shorter window (a segment table that only ever shows five years next to
 *  a ten-year main model) reads as a different table, not a straggler. */
const STRAGGLER_STEPS_MIN = 0.5;
const STRAGGLER_STEPS_MAX = 1.5;

/** Sheets whose axis in this step ends on the exact same date, sorted by
 *  where they sit in the workbook. */
function clusterByEndDate(axes: SheetPeriodAxis[]): SheetPeriodAxis[][] {
  const clusters = new Map<number, SheetPeriodAxis[]>();
  for (const axis of axes) {
    const key = axis.lastDate.getTime();
    const list = clusters.get(key);
    if (list) list.push(axis);
    else clusters.set(key, [axis]);
  }
  return [...clusters.values()];
}

function inventoryNote(cluster: SheetPeriodAxis[], order: Map<string, number>): string {
  const step = cluster[0].step;
  const commonRow = mostCommon(cluster.map((a) => a.row));
  const commonEndCol = mostCommon(cluster.map((a) => a.endCol));
  const bySheetOrder = (a: SheetPeriodAxis, b: SheetPeriodAxis) =>
    (order.get(a.sheet) ?? 0) - (order.get(b.sheet) ?? 0);
  // Sheets whose axis sits on an unusual row for this cluster are the ones
  // most likely to look unrelated at a glance, so they take the limited
  // visible slots ahead of sheets that look just like their neighbours.
  const sorted = [...cluster].sort(
    (a, b) => Number(a.row === commonRow) - Number(b.row === commonRow) || bySheetOrder(a, b),
  );
  const shown = sorted
    .slice(0, PERIOD_AXIS_LIST_CAP)
    .map((a) => `'${a.sheet}'${a.row !== commonRow ? ` (row ${a.row})` : ""}`);
  const more = cluster.length - shown.length;
  return `Shared period axis (${step}, ends ${isoDate(cluster[0].lastDate)}, col ${commonEndCol}) across ${cluster.length} sheets: ${shown.join(", ")}${more > 0 ? ` +${more} more` : ""}.`;
}

function misalignmentNote(
  dominant: SheetPeriodAxis[],
  stragglers: SheetPeriodAxis[][],
  order: Map<string, number>,
): string {
  const step = dominant[0].step;
  const bySheetOrder = (a: SheetPeriodAxis, b: SheetPeriodAxis) =>
    (order.get(a.sheet) ?? 0) - (order.get(b.sheet) ?? 0);
  const reference = [...dominant].sort(bySheetOrder)[0];
  const commonEndCol = mostCommon(dominant.map((a) => a.endCol));
  const stepDays = STEP_DAYS[step];

  const flat = stragglers.flat().sort(bySheetOrder);
  const shown = flat.slice(0, PERIOD_AXIS_LIST_CAP).map((a) => {
    const behind = Math.round(
      (dominant[0].lastDate.getTime() - a.lastDate.getTime()) / 86_400_000 / stepDays,
    );
    return `'${a.sheet}' ends ${a.endCol}${a.row} (${isoDate(a.lastDate)}), ${behind} period${behind === 1 ? "" : "s"} behind`;
  });
  const more = flat.length - shown.length;
  return `Period axes (${step}): most sheets end col ${commonEndCol} (${isoDate(dominant[0].lastDate)}, e.g. '${reference.sheet}' ${reference.endCol}${reference.row}); shorter: ${shown.join("; ")}${more > 0 ? ` +${more} more` : ""}.`;
}

/**
 * One step's notes: an inventory line for the axis most sheets in this step
 * share, plus a misalignment line for any sheets currently about one period
 * behind it. Neither fires below two sheets sharing an axis — one sheet is
 * not a "shared" anything, and a note that only restates one sheet's own
 * row back at it would cost tokens without telling the model anything new.
 */
function periodAxisNotesForStep(axes: SheetPeriodAxis[], order: Map<string, number>): string[] {
  // Dominant = the end date the most sheets share; ties favour whichever is
  // later, since the sheets someone already extended are the more likely
  // target than the ones left behind.
  const ranked = clusterByEndDate(axes).sort(
    (a, b) => b.length - a.length || b[0].lastDate.getTime() - a[0].lastDate.getTime(),
  );
  const dominant = ranked[0];
  if (dominant.length < 2) return [];

  const notes = [inventoryNote(dominant, order)];

  const stepDays = STEP_DAYS[dominant[0].step];
  const stragglers = ranked.slice(1).filter((cluster) => {
    const behindSteps =
      (dominant[0].lastDate.getTime() - cluster[0].lastDate.getTime()) / 86_400_000 / stepDays;
    return behindSteps >= STRAGGLER_STEPS_MIN && behindSteps <= STRAGGLER_STEPS_MAX;
  });
  if (stragglers.length) notes.push(misalignmentNote(dominant, stragglers, order));
  return notes;
}

/**
 * File-level period-axis notes for one workbook: at most one "shared axis"
 * inventory note per detected step, plus at most one "fell behind" note per
 * step when a minority of sheets ends about one period short of where most
 * of them ended up.
 *
 * Computed once from the raw workbook rather than from any one shrink
 * plan's SheetDigests, because the underlying axes do not change as a
 * digest is compressed and every plan's candidate needs the identical
 * notes — enforceFloor never has to touch them, the same way it already
 * leaves the compression and conditional-formatting notes alone.
 */
function buildPeriodAxisNotes(wb: ParsedWorkbook): string[] {
  const axes = wb.sheets
    .map((s) => detectSheetPeriodAxis(s))
    .filter((a): a is SheetPeriodAxis => a !== null);
  if (axes.length < 2) return [];

  const order = new Map(wb.sheets.map((s, i) => [s.name, i]));
  const byStep = new Map<PeriodStep, SheetPeriodAxis[]>();
  for (const axis of axes) {
    const list = byStep.get(axis.step);
    if (list) list.push(axis);
    else byStep.set(axis.step, [axis]);
  }

  const notes: string[] = [];
  for (const group of byStep.values()) {
    if (group.length >= 2) notes.push(...periodAxisNotesForStep(group, order));
  }
  return notes;
}

/**
 * The last resort: even the tightest plan can exceed the budget on a
 * many-sheet workbook, because per-sheet fixed costs add up. Strip
 * per-sheet detail, largest sheets first, until the estimate fits. The
 * complete sheet list (name, size, counts) and the notes always survive —
 * a model that knows a sheet exists can ask about it; one that doesn't
 * cannot.
 */
function enforceFloor(candidate: FileDigest, budget: number): FileDigest {
  if (candidate.approxTokens <= budget) return candidate;
  // Reserve this note's own cost before the loop runs, so every in-loop
  // estimate below is already the size of the digest we'd actually return —
  // not one that's about to grow by one more note right after the loop
  // decides it fits.
  candidate.notes.push(
    "Digest was hard-truncated to fit the token budget: per-sheet detail was dropped for the largest sheets.",
  );
  const bySize = [...candidate.sheets].sort((a, b) => estimateTokens(b) - estimateTokens(a));
  for (const s of bySize) {
    s.columns = [];
    s.sections = [];
    s.sampleRows = [];
    s.formulaPatterns = [];
    s.repeatedBlocks = [];
    s.merges = [];
    s.anchors = [];
    s.crossSheetRefs = [];
    s.periodAxis = null;
    s.blockLayout = null;
    s.notes = [];
    candidate.approxTokens = estimateTokens(candidate);
    if (candidate.approxTokens <= budget) break;
  }
  return candidate;
}

// Floored at this many formula cells so a handful of unrelated stub cells in
// an otherwise normal file can never fire this note (see the share check
// below) — deliberately well above the false-positive risk of a small,
// coincidentally-uncalculated cluster, and well under the size of the real
// files this note targets (over a thousand formula cells each).
const UNCALCULATED_NOTE_MIN_FORMULAS = 20;
const UNCALCULATED_NOTE_SHARE = 0.5;

/**
 * File-level note for a workbook whose formula cells were saved with no
 * cached value at all — the whole file reads as `{=formula -> 0}` in the
 * grid appendix (renderCellContent) and every sample row below, identical
 * in shape to a formula that genuinely evaluates to 0, with nothing in
 * ParsedWorkbook to tell the two apart at a glance (GridCell.uncalculated
 * is the one place that distinction survives, and this is the one place the
 * digest surfaces it). Without this note a model has no way to know
 * "displayed 0" doesn't mean "already correct" or "still blank" — see
 * .superpowers/sdd/reports/fix3-uncached-recalc.md for the measurements
 * (100% of formula cells affected on the real files this targets) and
 * lib/bench/edits.ts's appliedPlanReader for the scoring-side half of this
 * fix, which recomputes these cells rather than trusting their cache.
 *
 * Computed once from the raw workbook, like buildPeriodAxisNotes — the
 * underlying flag doesn't change as the digest is compressed, so every
 * candidate in buildFileDigest's loop gets the identical note.
 */
function buildUncalculatedFormulaNote(wb: ParsedWorkbook): string[] {
  let formulaCells = 0;
  let uncalculatedCells = 0;
  for (const sheet of wb.sheets) {
    for (const cell of sheet.cells.values()) {
      if (!cell.formula) continue;
      formulaCells++;
      if (cell.uncalculated) uncalculatedCells++;
    }
  }
  if (formulaCells < UNCALCULATED_NOTE_MIN_FORMULAS) return [];
  if (uncalculatedCells / formulaCells <= UNCALCULATED_NOTE_SHARE) return [];

  return [
    "This file's formula cells all show 0 here: their cached values were never saved, not because " +
      "they are blank or broken. The engine recomputes every formula honestly at submit time.",
  ];
}

/**
 * Build the digest for one workbook, shrinking sample rows and formula patterns
 * until it fits the token budget. Anything dropped is recorded in `notes`.
 */
export function buildFileDigest(
  wb: ParsedWorkbook,
  budget = TOKEN_BUDGET_PER_FILE,
): FileDigest {
  const plans: DigestPlan[] = [
    { sampleRows: MAX_SAMPLE_ROWS, formulaPatterns: MAX_FORMULA_PATTERNS, sectionColumns: 60, definedNames: 200 },
    { sampleRows: 15, formulaPatterns: 30, sectionColumns: 40, definedNames: 100 },
    { sampleRows: 8, formulaPatterns: 20, sectionColumns: 25, definedNames: 50 },
    { sampleRows: 4, formulaPatterns: 12, sectionColumns: 12, definedNames: 25 },
    { sampleRows: 2, formulaPatterns: 6, sectionColumns: 6, definedNames: 10 },
    { sampleRows: 0, formulaPatterns: 3, sectionColumns: 3, definedNames: 5 },
    { sampleRows: 0, formulaPatterns: 0, sectionColumns: 0, definedNames: 0 },
  ];

  const referenced = formulaIdentifiers(wb);
  // Plan-independent — the underlying axes don't change as the digest is
  // compressed — so this is computed once and pushed into every candidate.
  const periodAxisNotes = buildPeriodAxisNotes(wb);
  // Same reasoning: whether a formula cell's cache was ever populated is a
  // property of the source file, not of how hard this candidate compresses.
  const uncalculatedFormulaNote = buildUncalculatedFormulaNote(wb);
  let digest: FileDigest | null = null;
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const notes: string[] = [];
    const named = rankDefinedNames(wb, plan.definedNames, referenced);
    const candidate: FileDigest = {
      fileName: wb.fileName,
      sourceIdPrefix: wb.id,
      sheets: wb.sheets.map((s) => buildSheetDigest(s, plan)),
      definedNames: named.kept,
      omittedDefinedNames: named.omitted,
      notes,
      approxTokens: 0,
    };
    if (i > 0) {
      notes.push(
        `Digest was compressed to fit the ${budget}-token budget: at most ${plan.sampleRows} sample rows, ${plan.formulaPatterns} formula patterns and ${plan.sectionColumns} column statistics per sheet, and ${plan.definedNames} defined names.`,
      );
    }
    notes.push(
      "Conditional formatting rules are not extracted (not exposed by the parser); do not assume none exist.",
    );
    notes.push(...periodAxisNotes);
    notes.push(...uncalculatedFormulaNote);
    candidate.approxTokens = estimateTokens(candidate);
    digest = candidate;
    if (candidate.approxTokens <= budget) break;
  }

  return enforceFloor(digest!, budget);
}

export function buildDigests(workbooks: ParsedWorkbook[]): FileDigest[] {
  return workbooks.map((wb) => buildFileDigest(wb));
}
