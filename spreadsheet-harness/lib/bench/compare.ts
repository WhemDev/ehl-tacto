/**
 * SpreadsheetBench 2 scoring, ported from the official evaluator.
 *
 * Source of truth: RUCKBReasoning/SpreadsheetBench-2, evaluation/evaluation.py
 * (the file that computes the leaderboard numbers). This module is a
 * function-for-function port of its comparison semantics so a score printed
 * by `npm run bench` means the same thing as one printed by the official
 * Python pipeline:
 *
 *  - cells named by `answer_position` are split into REGRESSION cells (equal
 *    between input and golden — the task must not disturb them) and
 *    MODIFICATION cells (changed by the golden answer — the task must produce
 *    them);
 *  - values compare with a 1% relative tolerance (absolute when either side
 *    is zero), dates collapse to Excel serial numbers, "#N/A"-style
 *    placeholders are mutually equivalent, and formula strings compare
 *    case-insensitively with `$` anchors stripped;
 *  - a task is CORRECT (accuracy 1) only when regression accuracy is at
 *    least 99.8% (then treated as 1.0) and modification accuracy is 100%.
 *
 * Deliberate divergence, stated once: the official evaluator compares font
 * colors for Debugging tasks whose path contains "Color". SheetJS CE does not
 * expose reliable per-cell font colors, so this port scores those tasks on
 * values alone and flags `fontColorSkipped` in the result — the official
 * Python evaluator remains the authority for that slice.
 *
 * Everything here is pure: cell access goes through the `CellReader`
 * interface, so the same scoring runs against a parsed .xlsx (openpyxl's
 * data_only=True view is SheetJS's cached values) and against the formula
 * engine's in-memory result of applying an edit plan.
 */

/** What a cell reads as for comparison purposes. Excel error values are
 *  their display strings ("#REF!"), matching what openpyxl returns. */
export type BenchCellValue = number | string | boolean | Date | null;

/** The two views the official evaluator loads per workbook. */
export interface CellReader {
  /** Worksheet names, in file order. */
  sheetNames(): string[];
  /** openpyxl data_only=True: the cached/computed value. */
  value(sheet: string, cell: string): BenchCellValue;
  /** openpyxl data_only=False: the formula WITH its leading "=", or the
   *  literal value for a non-formula cell. */
  formulaOrValue(sheet: string, cell: string): BenchCellValue;
}

export interface CompareMode {
  /** Debugging tasks whose spreadsheet_path contains "Embedded". */
  withFormula: boolean;
  /** Debugging tasks whose spreadsheet_path contains "Color". */
  withFontColor: boolean;
}

export const VALUE_MODE: CompareMode = { withFormula: false, withFontColor: false };

/** Mirrors evaluation.py's mode sniffing in process_single_item. */
export function compareModeFor(category: string, spreadsheetPath: string): CompareMode {
  const isDebugging = category.includes("Debugging");
  return {
    withFormula: isDebugging && spreadsheetPath.includes("Embedded"),
    withFontColor: isDebugging && spreadsheetPath.includes("Color"),
  };
}

// ---------------------------------------------------------------------------
// Value comparison (port of transform_value / compare_cell_value)
// ---------------------------------------------------------------------------

/** Excel's day-zero. Serial = whole days since 1899-12-30 plus a day fraction. */
function dateToSerial(d: Date): number {
  // openpyxl hands the Python evaluator naive datetimes whose components are
  // the displayed date; SheetJS builds its Date objects from the same
  // components in local time, so local accessors recover them exactly.
  const days =
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const seconds = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  return days + seconds / 86_400;
}

/**
 * Python's round(): banker's rounding, half to even, decided on the EXACT
 * binary value of the double — round(0.005, 2) is 0.01 in Python because
 * 0.005 is stored a hair above the true half, and a naive `x * 100` loses
 * exactly that hair. The double is decomposed into mantissa × 2^exp with
 * BigInt so the comparison against the decimal boundary is exact.
 */
export function pythonRound(x: number, ndigits = 0): number {
  if (!Number.isFinite(x)) return x;
  if (x === 0) return 0;

  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(x));
  const bits = view.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const fracBits = bits & 0xf_ffff_ffff_ffffn;
  const mant = expBits === 0 ? fracBits : fracBits | (1n << 52n);
  const exp = expBits === 0 ? -1074 : expBits - 1075;

  // |x| * 10^ndigits as the exact rational num/den, then divide to the
  // nearest integer with ties to even.
  let num = mant * 10n ** BigInt(ndigits);
  let den = 1n;
  if (exp >= 0) num <<= BigInt(exp);
  else den = 1n << BigInt(-exp);

  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  const rounded = twice > den || (twice === den && (q & 1n) === 1n) ? q + 1n : q;

  const result = Number(rounded) / 10 ** ndigits;
  return x < 0 ? -result : result;
}

/** Python float() over a string: numeric or throws. Number() alone would
 *  accept "" and "0x10", which float() does not. */
function parseFloatStrict(s: string): number | null {
  const t = s.trim();
  if (t === "" || /^0[xXbBoO]/.test(t)) return null;
  const n = Number(t);
  return Number.isNaN(n) && t.toLowerCase() !== "nan" ? null : n;
}

/** isinstance(v, (int, float)) — Python counts booleans as ints. */
function asPythonNumber(v: BenchCellValue): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

/** Port of transform_value. Applied only after the numeric fast path. */
function transformValue(v: BenchCellValue): BenchCellValue {
  const n = asPythonNumber(v);
  if (n !== null) return pythonRound(n, 2);
  if (v instanceof Date) return pythonRound(dateToSerial(v), 0);
  if (typeof v === "string") {
    const parsed = parseFloatStrict(v);
    if (parsed !== null) return pythonRound(parsed, 2);
  }
  return v;
}

const DISPLAY_EQUIVALENT_ERRORS = new Set(["#DIV/0!", "#N/A"]);
const NOT_MEANINGFUL = new Set([
  ...DISPLAY_EQUIVALENT_ERRORS,
  "N/A", "NA", "N.A.", "N/M", "NM", "N.M.",
  "NOT MEANINGFUL", "NOT APPLICABLE", "NOT AVAILABLE",
  "—", "–", "-", "--", "---",
]);

function isNotMeaningful(v: BenchCellValue): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim().toUpperCase();
  return NOT_MEANINGFUL.has(s);
}

function numbersMatch(a: number, b: number, tolerance: number): boolean {
  if (a === b) return true;
  if (a === 0 || b === 0) return Math.abs(a - b) <= tolerance;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= tolerance;
}

/** The comparison "type" bucket Python's `type(v1) != type(v2)` sees after
 *  transform_value: numbers, strings, or None. */
function typeTag(v: BenchCellValue): string {
  if (v === null) return "none";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "number"; // bool is int in Python
  if (v instanceof Date) return "date";
  return "other";
}

/** Port of compare_cell_value. */
export function compareCellValue(
  v1: BenchCellValue,
  v2: BenchCellValue,
  tolerance = 0.01,
): boolean {
  if (isNotMeaningful(v1) && isNotMeaningful(v2)) return true;

  // Numeric fast path on raw values — no rounding, to avoid boundary artifacts.
  const n1 = asPythonNumber(v1);
  const n2 = asPythonNumber(v2);
  if (n1 !== null && n2 !== null) return numbersMatch(n1, n2, tolerance);

  const t1 = transformValue(v1);
  const t2 = transformValue(v2);
  if ((t1 === "" && t2 === null) || (t1 === null && t2 === "")) return true;
  if ((t1 === "" && t2 === "") || (t1 === null && t2 === null)) return true;
  // None ≡ 0: rounding can produce 0 from near-zero, and empty cells read as None.
  if (t1 === null && typeof t2 === "number" && t2 === 0) return true;
  if (t2 === null && typeof t1 === "number" && t1 === 0) return true;
  if (typeTag(t1) !== typeTag(t2)) return false;
  if (t1 === t2) return true;
  if (
    typeof t1 === "string" && typeof t2 === "string" &&
    t1.startsWith("=") && t2.startsWith("=")
  ) {
    return t1.replace(/\$/g, "").toUpperCase() === t2.replace(/\$/g, "").toUpperCase();
  }
  if (typeof t1 === "number" && typeof t2 === "number") {
    if (t1 === 0 && t2 === 0) return true;
    if (t1 === 0 || t2 === 0) return Math.abs(t1 - t2) <= tolerance;
    return Math.abs(t1 - t2) / Math.max(Math.abs(t1), Math.abs(t2)) <= tolerance;
  }
  return false;
}

/** Port of compare_cell_formula: both sides are the data_only=False view. */
export function compareCellFormula(f1: BenchCellValue, f2: BenchCellValue): boolean {
  if (
    typeof f1 === "string" && typeof f2 === "string" &&
    f1.startsWith("=") && f2.startsWith("=")
  ) {
    const normalize = (f: string) => {
      let s = f.replace(/\$/g, "").toUpperCase();
      if (s.startsWith("=+")) s = "=" + s.slice(2);
      return s;
    };
    return normalize(f1) === normalize(f2);
  }
  const empty = (v: BenchCellValue) => v === null || v === "";
  if (empty(f1) && empty(f2)) return true;
  return compareCellValue(f1, f2);
}

// ---------------------------------------------------------------------------
// answer_position parsing (port of parse_answer_position / generate_cell_names)
// ---------------------------------------------------------------------------

/** Split on commas outside single quotes: "'ACC,Dil'!B2:K52,C3" → two refs. */
export function parseAnswerPosition(answerPosition: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  for (const char of answerPosition) {
    if (char === "'") inQuote = !inQuote;
    if (char === "," && !inQuote) {
      if (current.trim()) result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

export class AnswerPositionError extends Error {}

function colNameToNum(name: string): number {
  let num = 0;
  for (const c of name) num = num * 26 + (c.charCodeAt(0) - 64);
  return num;
}

function colNumToName(n: number): string {
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Port of generate_cell_names: column-major, matching the official order.
 *  Bounded rectangles only — the official parser has no whole-column form. */
export function generateCellNames(rangeStr: string): string[] {
  if (!rangeStr.includes(":")) return [rangeStr];
  const [startCell, endCell] = rangeStr.split(":");
  const parse = (cell: string): { col: number; row: number } => {
    const m = /^([A-Za-z]+)(\d+)$/.exec(cell.trim());
    if (!m) throw new AnswerPositionError(`unparseable cell "${cell}" in range "${rangeStr}"`);
    return { col: colNameToNum(m[1].toUpperCase()), row: Number(m[2]) };
  };
  const start = parse(startCell);
  const end = parse(endCell);
  const cells: string[] = [];
  for (let c = start.col; c <= end.col; c++) {
    for (let r = start.row; r <= end.row; r++) {
      cells.push(`${colNumToName(c)}${r}`);
    }
  }
  return cells;
}

/** One entry of answer_position, resolved to sheet + bare range. Mirrors the
 *  official loop: no "!" means the golden file's first sheet. */
export function splitAnswerEntry(entry: string, fallbackSheet: string): { sheet: string; range: string } {
  const bang = entry.indexOf("!");
  if (bang === -1) {
    return { sheet: fallbackSheet, range: entry.replace(/^'|'$/g, "").trim() };
  }
  const sheet = entry.slice(0, bang).replace(/^'|'$/g, "").trim();
  const range = entry.slice(bang + 1).replace(/^'|'$/g, "").trim();
  return { sheet, range };
}

// ---------------------------------------------------------------------------
// Cell classification and task scoring
// ---------------------------------------------------------------------------

const EXCEL_ERRORS = new Set([
  "#REF!", "#VALUE!", "#DIV/0!", "#NAME?", "#NULL!", "#N/A", "#NUM!",
]);

function hasExcelError(v: BenchCellValue): boolean {
  return typeof v === "string" && EXCEL_ERRORS.has(v);
}

/** Port of _find_sheet: exact, then whitespace-tolerant case-insensitive. */
export function findSheetName(reader: CellReader, name: string): string | null {
  const names = reader.sheetNames();
  if (names.includes(name)) return name;
  const target = name.trim().toLowerCase();
  for (const sn of names) {
    if (sn.trim().toLowerCase() === target) return sn;
  }
  return null;
}

/** Compare one cell between two readers under the mode's rules, including the
 *  error-value fallback: an Excel error on either side compares by formula. */
function cellsMatch(
  a: CellReader,
  aSheet: string,
  b: CellReader,
  bSheet: string,
  cell: string,
  mode: CompareMode,
): boolean {
  if (mode.withFormula) {
    return compareCellFormula(a.formulaOrValue(aSheet, cell), b.formulaOrValue(bSheet, cell));
  }
  const va = a.value(aSheet, cell);
  const vb = b.value(bSheet, cell);
  if (hasExcelError(va) || hasExcelError(vb)) {
    return compareCellFormula(a.formulaOrValue(aSheet, cell), b.formulaOrValue(bSheet, cell));
  }
  // Font-color mode would additionally compare font colors here; see the
  // module doc for why that check is skipped in this port.
  return compareCellValue(va, vb);
}

export interface RangeClassification {
  regression: string[];
  modification: string[];
}

/** Port of classify_cells_by_modification: input vs golden decides which cells
 *  the task was supposed to change. Missing sheet on either side → empty. */
export function classifyCells(
  input: CellReader,
  golden: CellReader,
  sheetName: string,
  cellRange: string,
  mode: CompareMode,
): RangeClassification {
  const inSheet = findSheetName(input, sheetName);
  const goldSheet = findSheetName(golden, sheetName);
  if (!inSheet || !goldSheet) return { regression: [], modification: [] };

  const regression: string[] = [];
  const modification: string[] = [];
  for (const cell of generateCellNames(cellRange)) {
    const same = cellsMatch(input, inSheet, golden, goldSheet, cell, mode);
    (same ? regression : modification).push(cell);
  }
  return { regression, modification };
}

export interface CellCounts {
  correct: number;
  total: number;
}

export interface TaskScore {
  /** Fraction of unchanged cells the output preserved, rounded to 4 places;
   *  ≥ 0.998 is promoted to 1.0, exactly as the official evaluator does. */
  regressionAccuracy: number;
  /** Fraction of golden-modified cells the output got right. */
  modificationAccuracy: number;
  /** 1 when the task counts as solved, else 0. */
  accuracy: 0 | 1;
  regression: CellCounts;
  modification: CellCounts;
  /** First mismatch, in the official "… error at Sheet!A1: …" phrasing. */
  errorMessage: string;
  /** All mismatch messages, for diagnosis (the official code keeps them too). */
  errors: string[];
  /** True for Color-mode tasks, where this port compares values only. */
  fontColorSkipped: boolean;
}

function formatValue(v: BenchCellValue): string {
  if (v === null) return "None";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Score one task: the port of compare_workbooks_with_regression plus
 * process_single_item's ratio/accuracy arithmetic.
 */
export function scoreTask(opts: {
  input: CellReader;
  golden: CellReader;
  output: CellReader;
  answerPosition: string;
  mode?: CompareMode;
}): TaskScore {
  const mode = opts.mode ?? VALUE_MODE;
  const { input, golden, output } = opts;

  const reg: CellCounts = { correct: 0, total: 0 };
  const mod: CellCounts = { correct: 0, total: 0 };
  const errors: string[] = [];

  for (const entry of parseAnswerPosition(opts.answerPosition)) {
    const fallback = golden.sheetNames()[0] ?? "Sheet1";
    const { sheet, range } = splitAnswerEntry(entry, fallback);

    const { regression, modification } = classifyCells(input, golden, sheet, range, mode);
    reg.total += regression.length;
    mod.total += modification.length;

    const outSheet = findSheetName(output, sheet);
    if (!outSheet) {
      errors.push(`${sheet} worksheet not found`);
      continue;
    }
    const goldSheet = findSheetName(golden, sheet);
    if (!goldSheet) continue; // classification already returned empty sets

    const count = (cells: string[], label: string, counts: CellCounts) => {
      for (const cell of cells) {
        if (cellsMatch(golden, goldSheet, output, outSheet, cell, mode)) {
          counts.correct++;
        } else {
          errors.push(
            `${label} error at ${sheet}!${cell}: ` +
              `answer=${formatValue(golden.value(goldSheet, cell))}, ` +
              `output=${formatValue(output.value(outSheet, cell))}`,
          );
        }
      }
    };
    count(regression, "Regression", reg);
    count(modification, "Modification", mod);
  }

  let regRatio = reg.total ? round4(reg.correct / reg.total) : 0;
  const modRatio = mod.total ? round4(mod.correct / mod.total) : 0;
  if (regRatio >= 0.998) regRatio = 1.0;
  const accuracy: 0 | 1 = regRatio === 1.0 && modRatio === 1.0 ? 1 : 0;

  return {
    regressionAccuracy: regRatio,
    modificationAccuracy: modRatio,
    accuracy,
    regression: reg,
    modification: mod,
    errorMessage: errors[0] ?? "",
    errors,
    fontColorSkipped: mode.withFontColor,
  };
}

function round4(x: number): number {
  return pythonRound(x, 4);
}

// ---------------------------------------------------------------------------
// Aggregation (port of evaluation()'s global statistics)
// ---------------------------------------------------------------------------

export interface TaskResultForAggregate {
  regressionAccuracy: number;
  modificationAccuracy: number;
  accuracy: number;
  /** Truthy when the task never produced an output / its input was missing. */
  missing?: boolean;
}

export interface AggregateScore {
  totalTasks: number;
  missingOutputs: number;
  /** Mean per-task regression accuracy, missing-output tasks excluded. */
  regressionAccuracy: number;
  /** Mean per-task modification accuracy, missing-output tasks excluded. */
  modificationAccuracy: number;
  /** THE headline score: fraction of tasks fully solved. Missing tasks count
   *  as zeros here, exactly as in the official evaluator. */
  accuracy: number;
}

export function aggregateScores(results: TaskResultForAggregate[]): AggregateScore {
  const avg = (xs: number[]) => (xs.length ? round4(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const present = results.filter((r) => !r.missing);
  return {
    totalTasks: results.length,
    missingOutputs: results.filter((r) => r.missing).length,
    regressionAccuracy: avg(present.map((r) => r.regressionAccuracy)),
    modificationAccuracy: avg(present.map((r) => r.modificationAccuracy)),
    accuracy: avg(results.map((r) => r.accuracy)),
  };
}
