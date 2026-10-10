/**
 * Excel's coercion rules. Genuinely three different "value to number" rules
 * exist in the Python source (see the plan task this module was written
 * from for exactly which Python function each one ports and why) — this
 * file exists specifically so the next plan's function-porting tasks reach
 * for the one whose contract they actually need, rather than one
 * do-everything helper that silently gets a call site wrong.
 */

import { type CellValue, type ExcelErrorValue, excelError, isExcelError } from "./ast";
import { dateToSerial } from "./functions/date";

// Decimal only: optional sign, digits with an optional point, optional
// exponent. Deliberately narrower than what JS's own Number() accepts —
// Number("0x10") is 16 and Number("Infinity") is a real number in JS, but
// Python's float("0x10") and float("Infinity")-as-text-in-a-cell would not
// parse the same way, and a hex-looking product code is a far more
// plausible spreadsheet cell than an actual hex literal.
const NUMERIC_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function parseNumericString(s: string): number | null {
  const trimmed = s.trim();
  if (!NUMERIC_RE.test(trimmed)) return null;
  return Number(trimmed);
}

/** Arithmetic operands (`+ - * / ^`). Blank -> 0; bad text -> #VALUE!. */
export function toNumberForArithmetic(v: CellValue): number | ExcelErrorValue {
  if (isExcelError(v)) return v;
  if (v === null) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseNumericString(v);
    return n === null ? excelError("#VALUE!") : n;
  }
  if (v instanceof Date) return dateToSerial(v);
  return excelError("#VALUE!");
}

/**
 * Values flowing into a range-reducing function (SUM, AVERAGE, …). A value
 * that can't be read as a number is skipped, not an error — that's the
 * entire reason SUM over a range with some text cells in it doesn't error.
 *
 * An ExcelErrorValue is ALSO skipped here (returns null) — but that is no
 * longer what SUM/AVERAGE/MIN/MAX/PRODUCT/MEDIAN/LARGE/SMALL/SUMPRODUCT
 * actually want: real Excel propagates an error found anywhere in an
 * aggregated range instead of silently treating it as a blank (confirmed
 * damage: a SUM over a range containing a #NAME? returned one surviving
 * operand's value instead of the error, and the wrong number then fed a
 * Gauss-Seidel cycle that converged to a self-consistent WRONG fixed point —
 * see the LBO benchmark task this fix was written for). Those call sites use
 * toNumberOrErrorForAggregate below instead. This function's skip-the-error
 * behavior is kept, unchanged, for the one aggregate that genuinely still
 * wants it: COUNT, which per real Excel does not propagate an error either —
 * it just doesn't count it, the same as it doesn't count text. See
 * functions/math.ts's count() and collectNumbers() doc comments.
 */
export function toNumberForAggregate(v: CellValue): number | null {
  if (isExcelError(v)) return null;
  if (v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseNumericString(v);
  return null;
}

/**
 * Same numeric coercion as toNumberForAggregate immediately above, except an
 * ExcelErrorValue is returned as itself instead of being swallowed as null —
 * the caller is expected to check isExcelError on the result and propagate
 * it (short-circuiting the whole aggregation) rather than treat it as "not a
 * number, skip it" the way a blank or a non-numeric string still is. This is
 * the coercion SUM/AVERAGE/MIN/MAX/PRODUCT/MEDIAN/LARGE/SMALL/SUMPRODUCT use
 * (see functions/math.ts's flattenNumbersOrError) — real Excel behavior,
 * verified: `=SUM(1,#DIV/0!)` is `#DIV/0!`, not `1`. COUNT is the one
 * exception in that same family and deliberately keeps using the
 * error-skipping toNumberForAggregate above instead.
 */
export function toNumberOrErrorForAggregate(v: CellValue): number | ExcelErrorValue | null {
  if (isExcelError(v)) return v;
  return toNumberForAggregate(v);
}

/**
 * Values flowing into a SUMIF/AVERAGEIF/MAXIFS/MINIFS/SUMIFS/AVERAGEIFS
 * aggregation range. Stricter than toNumberForAggregate above: conditional_
 * funcs.py inlines `isinstance(sv, (int, float)) and not isinstance(sv,
 * bool)` at each of its own six aggregation sites (SUMIF/SUMIFS/AVERAGEIF/
 * AVERAGEIFS/MAXIFS/MINIFS all share this exact guard) — a boolean cell is
 * excluded entirely, not converted to 1/0, and unlike toNumberForAggregate a
 * numeric-looking string isn't coerced either; only a real Python
 * int/float (JS `number`) counts. Confirmed via the Task 7 oracle: a TRUE
 * cell mixed into an otherwise-numeric SUMIF/AVERAGEIF/MAXIFS/MINIFS range
 * contributes nothing in the real engine, where toNumberForAggregate would
 * have included it as 1.
 */
export function toNumberExcludingBool(v: CellValue): number | null {
  return typeof v === "number" ? v : null;
}

/** Single/pairwise-argument math functions (ABS, ROUND, …). Blank -> 0; bad text -> #VALUE!. */
export function coerceNumber(v: CellValue): number | ExcelErrorValue {
  if (isExcelError(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseNumericString(v);
    return n === null ? excelError("#VALUE!") : n;
  }
  if (v === null) return 0;
  if (v instanceof Date) return dateToSerial(v);
  return excelError("#VALUE!");
}

export function toBoolean(v: CellValue): boolean | ExcelErrorValue {
  if (isExcelError(v)) return v;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const up = v.toUpperCase();
    if (up === "TRUE") return true;
    if (up === "FALSE") return false;
    return excelError("#VALUE!");
  }
  if (v === null) return false;
  return excelError("#VALUE!");
}

/**
 * Deliberately renders an ExcelErrorValue as its code rather than
 * propagating it — ported from engine.py::_to_str, which every text
 * function in the next plan calls without checking for an error first, and
 * which the `&` operator (evalBinOp, above evaluate.ts) also uses directly.
 * Surprising, but real: `=LEN(#N/A)` returns 4 in the reference engine, not
 * an error. The oracle test holds this port to that fact.
 */
export function toDisplayString(v: CellValue): string {
  if (v === null) return "";
  if (isExcelError(v)) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  // JS's own String() already renders a whole-number float without a
  // decimal point (String(5) === "5"), unlike Python where str(5.0) keeps
  // the ".0" and str(int(5.0)) is needed to drop it — no branch required here.
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return formatExcelDate(v);
  if (Array.isArray(v)) return v.map((row) => row.map(toDisplayString).join(",")).join(";");
  return String(v);
}

/**
 * Renders a `Date` the way Python's `str(datetime)` does: `"YYYY-MM-DD
 * HH:MM:SS"`, always with a time component even when it's midnight. Ported
 * from engine.py::_to_str (not text_funcs.py — see the comment on
 * toDisplayString below), which falls through to plain `str(val)` for
 * anything that isn't `None`, `bool`, or a whole-number `float`.
 *
 * Uses UTC accessors rather than local-time ones so this is stable
 * regardless of the host's timezone, matching how a `Date` gets here in the
 * first place: SheetJS's `cellDates: true` encodes a cell's wall-clock date
 * fields as UTC, and openpyxl (the oracle's own reader) hands back a naive
 * datetime with no timezone at all — neither side has a "local time" to
 * convert through.
 */
export function formatExcelDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

export type CompareOp = "=" | "<>" | "<" | ">" | "<=" | ">=";

/**
 * Ported from engine.py::_compare (lines 268–314 of that file), including
 * its two real quirks: comparing text to a number takes a different code
 * path than comparing a number to text (see the plan task this was written
 * from), and a boolean on either side coerces BOTH sides by truthiness
 * rather than by type. Neither is normalised away — this is oracle parity,
 * not a redesign.
 *
 * Assumes the caller has already checked isExcelError on both operands and
 * short-circuited — this function never receives one in practice, matching
 * engine.py::_eval_binop.
 */
export function compareValues(left: CellValue, right: CellValue, op: CompareOp): boolean {
  let l: number | string;
  let r: number | string;

  if (typeof left === "number") {
    if (typeof right === "number") {
      l = left;
      r = right;
    } else if (right === null) {
      l = left;
      r = 0;
    } else {
      // A number is always "less than" text in this engine, regardless of
      // what the text says. A lookup table, not a fallthrough.
      switch (op) {
        case "<": return true;
        case ">": return false;
        case "=": return false;
        case "<>": return true;
        case "<=": return true;
        case ">=": return false;
      }
    }
  } else if (typeof left === "string" && typeof right === "string") {
    l = left.toUpperCase();
    r = right.toUpperCase();
  } else if (left === null && typeof right === "number") {
    l = 0;
    r = right;
  } else if (left === null && right === null) {
    l = 0;
    r = 0;
  } else if (typeof left === "boolean" || typeof right === "boolean") {
    // Truthiness on whichever side isn't already a boolean too — a quirk
    // of the source, not a design choice. See the module doc above.
    l = left ? 1 : 0;
    r = right ? 1 : 0;
  } else {
    // Reached when left is text and right is a number (among other rare
    // shapes) — genuinely different from the number-vs-text table above,
    // because dispatch is on the LEFT operand's type. Not normalised away.
    l = left ? String(left) : "";
    r = right ? String(right) : "";
  }

  switch (op) {
    case "=": return l === r;
    case "<>": return l !== r;
    case "<": return l < r;
    case ">": return l > r;
    case "<=": return l <= r;
    case ">=": return l >= r;
  }
}
