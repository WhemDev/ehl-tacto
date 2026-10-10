/**
 * Date and time functions. Ports simulation/functions/date_funcs.py in
 * full — see the plan task this was written from for the exact Python
 * line ranges each export below corresponds to.
 *
 * Excel dates are serial day-counts from 1899-12-30, with the "1900 is a
 * leap year" bug (real Excel/Lotus 1-2-3 history) baked into
 * dateToSerial/serialToDate below, ported exactly from _date_to_serial/
 * _serial_to_date (date_funcs.py:21-33) and preserved on purpose.
 *
 * That said — this reference engine's own epoch/threshold pairing does
 * NOT reproduce real Excel's actual serial numbers, which is a further,
 * unexpected wrinkle beyond "1900 is treated as a leap year": real Excel
 * has 1900-02-28 = 59, phantom 1900-02-29 = 60, 1900-03-01 = 61. Running
 * date_funcs.py's own `_date_to_serial` directly shows this engine instead
 * produces 1900-02-27 = 59, [gap] = 60, 1900-02-28 = 61, 1900-03-01 = 62 —
 * every date from 1900-02-28 onward is shifted two days off real Excel,
 * not one, and the skipped serial sits one calendar day earlier than real
 * Excel's phantom leap day. This is ported bug-for-bug (see the code
 * below, unchanged from the reference formula) because this file's job is
 * to match the reference engine, not real Excel. See the task report for
 * the round-trip verification that pins this down.
 */

import { excelError, isExcelError, type CellValue, type ExcelErrorValue } from "../ast";
import type { ExcelFunction } from "../evaluator-types";

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30); // month is 0-based: December
const MS_PER_DAY = 86_400_000;

// date_funcs.py:21-26
export function dateToSerial(d: Date): number {
  const days = Math.round(
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - EXCEL_EPOCH_UTC) / MS_PER_DAY,
  );
  return days >= 60 ? days + 1 : days; // the 1900 leap-year bug, preserved
}

// date_funcs.py:29-33
export function serialToDate(serial: number): Date {
  let s = Math.trunc(serial);
  if (s >= 61) s -= 1;
  return new Date(EXCEL_EPOCH_UTC + s * MS_PER_DAY);
}

/** Actual (real, proleptic-Gregorian) days in a 1-based month, matching
 *  Python's calendar.monthrange. Used for DATE's day-clamping and
 *  EDATE/EOMONTH's month-end math. Operates purely in real-calendar Date
 *  space, before dateToSerial's 1900 bug is ever applied, so — like
 *  Python's own calendar module — it is unaffected by that bug: JS's Date
 *  already follows real Gregorian leap-year rules (verified: Feb 1900 and
 *  Feb 2000 both come out correctly here, 28 and 29 days respectively). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

// Python's `%` is floor-mod (result takes the sign of the divisor); JS's
// `%` is a remainder (result takes the sign of the dividend). This closes
// that gap for the one divisor (12) date_funcs.py's carry arithmetic uses.
function pyMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

// date_funcs.py:77-83 (DATE), 166-174 (EOMONTH), 192-200 (EDATE) all carry
// an out-of-[1,12] month into the year with this exact formula. Its
// month<1 branch has a genuine bug, preserved here rather than fixed: `12
// + (month % 12)` doesn't reduce a month that's more than one full year
// negative, so for most negative inputs it produces a value still outside
// [1,12] (e.g. month=-1 becomes 23, not "11, one year earlier" as a caller
// would expect) — every call site below rejects that as an error, exactly
// as the Python source's own calendar.monthrange(...) does when handed an
// out-of-range month. See the task report for the verification table.
function carryMonth(year: number, month: number): [number, number] {
  if (month > 12) {
    year += floorDiv(month - 1, 12);
    month = pyMod(month - 1, 12) + 1;
  } else if (month < 1) {
    year += floorDiv(month - 12, 12);
    const m = pyMod(month, 12);
    month = m !== 0 ? 12 + m : 12;
  }
  return [year, month];
}

/** Every date function funnels its date-like argument through this first.
 *  date_funcs.py:36-55. Exported (not module-private) because
 *  functions/financial.ts's XNPV/XIRR need the exact same "Date object, or
 *  Excel serial number, or one of four parseable date-string formats"
 *  coercion for their own date arguments — reused rather than duplicated,
 *  per this module's own doc comment about matching the reference engine's
 *  rules in exactly one place. */
export function coerceDate(v: CellValue): Date | ExcelErrorValue {
  if (isExcelError(v)) return v;
  if (v instanceof Date) return v;
  if (typeof v === "number") return serialToDate(v);
  if (typeof v === "string") return parseDateString(v);
  return excelError("#VALUE!");
}

// date_funcs.py:48-54 tries four strptime formats in order, returning the
// first successful parse: "%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d".
// strptime accepts 1- or 2-digit month/day components and rejects a
// calendar-invalid combination (e.g. day 30 in February) for that format,
// falling through to try the next one — both mirrored here (the latter via
// daysInMonth). Deliberately wider than a plain "yyyy-mm-dd or mm/dd/yyyy,
// exactly 2 digits" regex would cover: see the task report for concrete
// strings (e.g. "25/03/2024", "2024/3/5") that need the extra formats and
// single-digit leniency to parse the same way the Python source does.
function parseDateString(v: string): Date | ExcelErrorValue {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (iso) {
    const d = ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (d) return d;
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = Number(slash[3]);
    const asMonthDayYear = ymd(y, a, b); // %m/%d/%Y, tried first
    if (asMonthDayYear) return asMonthDayYear;
    const asDayMonthYear = ymd(y, b, a); // %d/%m/%Y, tried second
    if (asDayMonthYear) return asDayMonthYear;
  }
  const isoSlash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(v);
  if (isoSlash) {
    const d = ymd(Number(isoSlash[1]), Number(isoSlash[2]), Number(isoSlash[3]));
    if (d) return d;
  }
  return excelError("#VALUE!");
}

function ymd(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

// -- serial-producing, zero-arg, non-deterministic (time-dependent, not
// oracle-checkable) -- date_funcs.py:58-60
export const today: ExcelFunction = () => dateToSerial(new Date());

// date_funcs.py:63-68 — TODAY's serial plus a fractional day for the
// time-of-day. Same non-determinism caveat as TODAY.
export const now: ExcelFunction = () => {
  const n = new Date();
  const frac = (n.getUTCHours() * 3600 + n.getUTCMinutes() * 60 + n.getUTCSeconds()) / 86400;
  return dateToSerial(n) + frac;
};

// date_funcs.py:71-92 — month/day overflow handling ported exactly,
// carryMonth bug included (see above). Unlike a naive Date.UTC rollover, a
// day beyond the target month's real length is clamped down to that
// month's last day (never rolled into the next month) — e.g. DATE(2023,2,
// 30) is 2023-02-28, not 2023-03-02 — and a day at or below 0 after that
// clamp is #VALUE!, matching Python's date(...) raising ValueError.
export const dateFn: ExcelFunction = (evaluator, args) => {
  const yearRaw = evaluator.resolveArg(args[0]);
  const monthRaw = evaluator.resolveArg(args[1]);
  const dayRaw = evaluator.resolveArg(args[2]);
  if (typeof yearRaw !== "number" || typeof monthRaw !== "number" || typeof dayRaw !== "number") {
    return excelError("#VALUE!");
  }
  const [year, month] = carryMonth(Math.trunc(yearRaw), Math.trunc(monthRaw));
  if (month < 1 || month > 12 || year < 1 || year > 9999) return excelError("#VALUE!");
  const day = Math.min(Math.trunc(dayRaw), daysInMonth(year, month));
  if (day < 1) return excelError("#VALUE!");
  return dateToSerial(new Date(Date.UTC(year, month - 1, day)));
};
// Registered as "DATE" — named dateFn to avoid shadowing the global Date.

// -- simple field-extraction shape -- date_funcs.py:95-119
export const year: ExcelFunction = (evaluator, args) => {
  const d = coerceDate(evaluator.resolveArg(args[0]));
  return isExcelError(d) ? d : d.getUTCFullYear();
};
export const month: ExcelFunction = (evaluator, args) => {
  const d = coerceDate(evaluator.resolveArg(args[0]));
  return isExcelError(d) ? d : d.getUTCMonth() + 1;
};
export const day: ExcelFunction = (evaluator, args) => {
  const d = coerceDate(evaluator.resolveArg(args[0]));
  return isExcelError(d) ? d : d.getUTCDate();
};

// date_funcs.py:122-154 — a bare number here means "just the time", not a
// full date, so it deliberately does NOT go through coerceDate (which
// would treat it as a whole-day serial and always yield midnight).
export const hour: ExcelFunction = (evaluator, args) => {
  const val = evaluator.resolveArg(args[0]);
  if (val instanceof Date) return val.getUTCHours();
  if (typeof val === "number") {
    const frac = val - Math.trunc(val);
    return pyMod(Math.trunc(frac * 24), 24);
  }
  return excelError("#VALUE!");
};

export const minute: ExcelFunction = (evaluator, args) => {
  const val = evaluator.resolveArg(args[0]);
  if (val instanceof Date) return val.getUTCMinutes();
  if (typeof val === "number") {
    const frac = val - Math.trunc(val);
    return pyMod(Math.trunc(frac * 1440), 60);
  }
  return excelError("#VALUE!");
};

export const second: ExcelFunction = (evaluator, args) => {
  const val = evaluator.resolveArg(args[0]);
  if (val instanceof Date) return val.getUTCSeconds();
  if (typeof val === "number") {
    const frac = val - Math.trunc(val);
    return pyMod(Math.trunc(frac * 86400), 60);
  }
  return excelError("#VALUE!");
};

// date_funcs.py:157-180 (EOMONTH), 183-207 (EDATE) — share DATE's
// carryMonth arithmetic (bug included). An out-of-[1,12] month here is
// #NUM!, not #VALUE! like DATE — a real distinction in the Python source
// (NUM_ERROR vs VALUE_ERROR), preserved.
export const eomonth: ExcelFunction = (evaluator, args) => {
  const d = coerceDate(evaluator.resolveArg(args[0]));
  if (isExcelError(d)) return d;
  const monthsRaw = evaluator.resolveArg(args[1]);
  if (typeof monthsRaw !== "number") return excelError("#VALUE!");
  const [newYear, newMonth] = carryMonth(d.getUTCFullYear(), d.getUTCMonth() + 1 + Math.trunc(monthsRaw));
  if (newMonth < 1 || newMonth > 12 || newYear < 1 || newYear > 9999) return excelError("#NUM!");
  const lastDay = daysInMonth(newYear, newMonth);
  return dateToSerial(new Date(Date.UTC(newYear, newMonth - 1, lastDay)));
};

export const edate: ExcelFunction = (evaluator, args) => {
  const d = coerceDate(evaluator.resolveArg(args[0]));
  if (isExcelError(d)) return d;
  const monthsRaw = evaluator.resolveArg(args[1]);
  if (typeof monthsRaw !== "number") return excelError("#VALUE!");
  const [newYear, newMonth] = carryMonth(d.getUTCFullYear(), d.getUTCMonth() + 1 + Math.trunc(monthsRaw));
  if (newMonth < 1 || newMonth > 12 || newYear < 1 || newYear > 9999) return excelError("#NUM!");
  const newDay = Math.min(d.getUTCDate(), daysInMonth(newYear, newMonth));
  return dateToSerial(new Date(Date.UTC(newYear, newMonth - 1, newDay)));
};

// date_funcs.py:210-227 — "D"/"M"/"Y" units only; anything else is #VALUE!.
export const datedif: ExcelFunction = (evaluator, args) => {
  const start = coerceDate(evaluator.resolveArg(args[0]));
  const end = coerceDate(evaluator.resolveArg(args[1]));
  const unitRaw = evaluator.resolveArg(args[2]);
  const unit = typeof unitRaw === "string" ? unitRaw.toUpperCase() : "";

  if (isExcelError(start)) return start;
  if (isExcelError(end)) return end;

  if (unit === "D") return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
  if (unit === "M") {
    return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  }
  if (unit === "Y") return end.getUTCFullYear() - start.getUTCFullYear();
  return excelError("#VALUE!");
};

// date_funcs.py:230-248 — three return_type variants. JS's own
// Date.getUTCDay() is already Sunday=0..Saturday=6, so each variant below
// is a small fixed remap from that (verified against known dates in the
// task report), not a re-derivation of Python's Monday-indexed weekday().
export const weekday: ExcelFunction = (evaluator, args) => {
  const d = coerceDate(evaluator.resolveArg(args[0]));
  if (isExcelError(d)) return d;
  let returnType = 1;
  if (args.length > 1) {
    const rt = evaluator.resolveArg(args[1]);
    if (typeof rt !== "number") return excelError("#VALUE!");
    returnType = Math.trunc(rt);
  }
  const jsDay = d.getUTCDay(); // 0=Sun..6=Sat
  if (returnType === 1) return jsDay + 1; // Sunday=1..Saturday=7
  if (returnType === 2) return ((jsDay + 6) % 7) + 1; // Monday=1..Sunday=7
  if (returnType === 3) return (jsDay + 6) % 7; // Monday=0..Sunday=6
  return excelError("#VALUE!");
};

// date_funcs.py:251-287 — counts weekdays between two dates (inclusive of
// both endpoints), excluding a holiday set, sign-flipping when end < start.
// Python's `current.weekday() < 5` (Mon=0..Fri=4) is jsDay outside {0, 6}
// in Sunday-indexed terms.
export const networkdays: ExcelFunction = (evaluator, args) => {
  const startD = coerceDate(evaluator.resolveArg(args[0]));
  if (isExcelError(startD)) return startD;
  const endD = coerceDate(evaluator.resolveArg(args[1]));
  if (isExcelError(endD)) return endD;

  const holidays = new Set<number>();
  if (args.length > 2) {
    const hvalsRaw = evaluator.resolveArg(args[2]);
    const flat: CellValue[] = [];
    if (Array.isArray(hvalsRaw)) {
      for (const row of hvalsRaw) {
        if (Array.isArray(row)) flat.push(...row);
        else flat.push(row);
      }
    } else {
      flat.push(hvalsRaw);
    }
    for (const h of flat) {
      const hd = coerceDate(h);
      if (!isExcelError(hd)) holidays.add(dateToSerial(hd));
    }
  }

  const sign = endD.getTime() >= startD.getTime() ? 1 : -1;
  const start = sign === 1 ? startD : endD;
  const end = sign === 1 ? endD : startD;

  let count = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
    const current = new Date(t);
    const dow = current.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(dateToSerial(current))) count++;
  }
  return count * sign;
};

// date_funcs.py:290-296 — the simplest function in the file.
export const datevalue: ExcelFunction = (evaluator, args) => {
  const d = coerceDate(evaluator.resolveArg(args[0]));
  return isExcelError(d) ? d : dateToSerial(d);
};
