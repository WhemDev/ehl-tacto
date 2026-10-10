/**
 * Math and statistical functions. Ports simulation/functions/math_funcs.py
 * in full — see the plan task this was written from for the exact Python
 * line ranges each export below corresponds to.
 */

import { excelError, isExcelError, type AstNode, type CellValue, type ExcelErrorValue } from "../ast";
import { coerceNumber, toNumberForAggregate, toNumberOrErrorForAggregate } from "../coerce";
import type { ExcelFunction, FunctionEvaluator } from "../evaluator-types";

function collectNumbers(val: CellValue | CellValue[], into: number[]): void {
  if (Array.isArray(val)) {
    for (const item of val) collectNumbers(item, into);
    return;
  }
  const n = toNumberForAggregate(val);
  if (n !== null) into.push(n);
}

/** Resolve every argument (which may itself be a range) and collect the
 *  numbers found in it — anything that isn't a number is skipped, silently,
 *  including an ExcelErrorValue. Used ONLY by COUNT below: real Excel's
 *  COUNT genuinely does not propagate an error the way SUM/AVERAGE/etc. do
 *  (see toNumberForAggregate's doc comment in coerce.ts) — it just doesn't
 *  count it, same as it doesn't count text. Every other aggregate in this
 *  file uses flattenNumbersOrError below instead. */
function flattenNumbers(evaluator: FunctionEvaluator, args: AstNode[]): number[] {
  const nums: number[] = [];
  for (const arg of args) {
    collectNumbers(evaluator.resolveArg(arg), nums);
  }
  return nums;
}

/** Like collectNumbers above, but the first ExcelErrorValue encountered
 *  while walking `val` (row-major: left to right, top to bottom, matching
 *  how a person reads a range) aborts the walk and is returned instead of
 *  being swallowed as a skippable non-number. Returns null on a clean walk
 *  (the `into` array holds the result in that case). */
function collectNumbersOrError(
  val: CellValue | CellValue[],
  into: number[],
): ExcelErrorValue | null {
  if (Array.isArray(val)) {
    for (const item of val) {
      const err = collectNumbersOrError(item, into);
      if (err) return err;
    }
    return null;
  }
  const n = toNumberOrErrorForAggregate(val);
  if (n === null) return null;
  if (isExcelError(n)) return n;
  into.push(n);
  return null;
}

/** Resolve every argument (which may itself be a range) and collect the
 *  numbers found in it, propagating the first ExcelErrorValue found instead
 *  of skipping it — real Excel's actual behavior for SUM, AVERAGE, MIN, MAX,
 *  PRODUCT, MEDIAN, LARGE, SMALL, and (via its own error check) SUMPRODUCT.
 *  Exported so lib/formula/functions/financial.ts's NPV can reuse the same
 *  "flatten a mix of scalars and ranges, propagate an error, skip anything
 *  else non-numeric" contract rather than inventing a second copy of it. */
export function flattenNumbersOrError(
  evaluator: FunctionEvaluator,
  args: AstNode[],
): number[] | ExcelErrorValue {
  const nums: number[] = [];
  for (const arg of args) {
    const err = collectNumbersOrError(evaluator.resolveArg(arg), nums);
    if (err) return err;
  }
  return nums;
}

export const sum: ExcelFunction = (evaluator, args) => {
  const nums = flattenNumbersOrError(evaluator, args);
  if (isExcelError(nums)) return nums;
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : 0;
};

// -- aggregate shape, with the DIV0-on-empty variant AVERAGE alone has --
// math_funcs.py:74-79 — diverges from the Python source (which skips an
// error the same way toNumberForAggregate always has) to match real Excel:
// an error anywhere in the range propagates before the empty-set check ever
// runs. See coerce.ts's toNumberOrErrorForAggregate doc comment.
export const average: ExcelFunction = (evaluator, args) => {
  const nums = flattenNumbersOrError(evaluator, args);
  if (isExcelError(nums)) return nums;
  if (nums.length === 0) return excelError("#DIV/0!");
  return nums.reduce((a, b) => a + b, 0) / nums.length;
};

// math_funcs.py:82-85 — 0 on an empty set, unlike AVERAGE. Propagates an
// in-range error before that empty-set fallback, same as SUM/AVERAGE.
export const min: ExcelFunction = (evaluator, args) => {
  const nums = flattenNumbersOrError(evaluator, args);
  if (isExcelError(nums)) return nums;
  return nums.length > 0 ? nums.reduce((a, b) => Math.min(a, b)) : 0;
};

// math_funcs.py:88-91 — mirrors MIN, including the error-propagation change.
export const max: ExcelFunction = (evaluator, args) => {
  const nums = flattenNumbersOrError(evaluator, args);
  if (isExcelError(nums)) return nums;
  return nums.length > 0 ? nums.reduce((a, b) => Math.max(a, b)) : 0;
};

// math_funcs.py:94-96 — counts however many values toNumberForAggregate
// accepted. Deliberately still uses flattenNumbers (the skip-everything-
// non-numeric helper), NOT flattenNumbersOrError: real Excel's COUNT does
// not propagate an error present in its range, it just doesn't count it —
// `=COUNT(1,2,#DIV/0!)` is 2, not #DIV/0!. This is the one aggregate in this
// file that keeps the old (pre-fix) toNumberForAggregate behavior, and does
// so on purpose.
export const count: ExcelFunction = (evaluator, args) => flattenNumbers(evaluator, args).length;

// -- presence-check shape: COUNTA/COUNTBLANK are not numeric coercion at all --
// math_funcs.py:99-136
function countPresence(evaluator: FunctionEvaluator, args: AstNode[], wantPresent: boolean): number {
  let count = 0;
  const visit = (val: CellValue | CellValue[]): void => {
    if (Array.isArray(val)) {
      for (const item of val) visit(item);
      return;
    }
    const present = val !== null && val !== "";
    if (present === wantPresent) count++;
  };
  for (const arg of args) visit(evaluator.resolveArg(arg));
  return count;
}

export const counta: ExcelFunction = (evaluator, args) => countPresence(evaluator, args, true);
export const countblank: ExcelFunction = (evaluator, args) => countPresence(evaluator, args, false);

// -- simple single-arg scalar shape --
// math_funcs.py:139-144
export const abs: ExcelFunction = (evaluator, args) => {
  const val = coerceNumber(evaluator.resolveArg(args[0]));
  return isExcelError(val) ? val : Math.abs(val);
};

/**
 * Python's round(val, digits): round half to even (banker's rounding) on
 * the TRUE, exact binary value of the double — not on a decimal
 * approximation of it. This is what math_funcs.py's ROUND actually
 * produces via Python's built-in round(), which converts the double to its
 * correctly-rounded decimal digits (CPython's `_Py_dg_dtoa`) rather than
 * scaling by 10**digits first.
 *
 * That distinction is not academic: scaling first (`val * 10**digits`,
 * this function's previous implementation) introduces a *new* rounding
 * error from the multiplication itself, which silently changes results for
 * ordinary currency-style values whose decimal literal isn't exactly
 * representable in binary — confirmed concretely (both oracle-verified
 * against the real Python engine in Task 7's functions.xlsx fixture):
 * ROUND(0.15,1) must be 0.1, not 0.2 (0.15 is actually stored as
 * 0.1499999999999999944...); ROUND(2.675,2) must be 2.67, not 2.68 (2.675
 * is actually stored as 2.67499999999999982...). The scaled-multiplication
 * approach saw these as sitting past the .5 boundary and rounded up; they
 * never were, once you look at the double's real value instead of the
 * decimal string that produced it.
 *
 * The fix: read out the double's exact decimal expansion via toFixed at a
 * digit count far past the target rounding position — V8's toFixed
 * computes this exactly, not a re-rounded approximation, for any
 * spreadsheet-realistic magnitude — then round that decimal-digit array at
 * the target position by hand (ties to even), with manual carry
 * propagation for the all-9s case. No multiplication by a power of ten
 * (and thus no new floating-point error) is involved in the rounding
 * decision itself.
 *
 * Exported (not module-private) because text.ts's TEXT needs exactly this
 * rule too: every numeric branch of text_funcs.py's own TEXT is either
 * `round(val)` or an f-string `f"{val:.Nf}"`, and CPython rounds both the
 * same correctly-rounded-decimal way. text.ts previously carried its own
 * copy of the OLD scaled-integer algorithm under the name bankersRound,
 * which kept the already-fixed bug alive on the TEXT side — see the final
 * whole-plan review note in .superpowers/sdd/progress.md. One
 * implementation, two call sites, no room to drift apart again.
 */
export function pythonRound(val: number, digits: number): number {
  if (!Number.isFinite(val) || val === 0) return val;
  const negative = val < 0;
  const abs = Math.abs(val);

  // 60 digits of headroom past the target position is far more than any
  // spreadsheet-realistic double needs to reach the end of its exact
  // (finite) decimal expansion — see the doc comment above.
  const fixedDigits = Math.min(100, Math.max(0, digits) + 60);
  const exact = abs.toFixed(fixedDigits);
  const dotIndex = exact.indexOf(".");
  const intStr = dotIndex === -1 ? exact : exact.slice(0, dotIndex);
  const fracStr = dotIndex === -1 ? "" : exact.slice(dotIndex + 1);

  let digitsArr = (intStr + fracStr).split("").map(Number);
  let cut = intStr.length + digits; // index of the first digit to DROP

  if (cut < 0) {
    // Rounding position falls entirely before the most significant digit
    // (e.g. ROUND(4, -2)) — pad with leading zeros so the general case
    // below can treat it uniformly.
    digitsArr = new Array(-cut).fill(0).concat(digitsArr);
    cut = 0;
  }
  if (cut >= digitsArr.length) {
    // Requested precision exceeds even the padded expansion (an absurdly
    // large `digits`) — nothing left to round away.
    return val;
  }

  const keep = digitsArr.slice(0, cut);
  const firstDropped = digitsArr[cut];
  const restNonZero = digitsArr.slice(cut + 1).some((d) => d !== 0);

  let roundUp: boolean;
  if (firstDropped > 5 || (firstDropped === 5 && restNonZero)) {
    roundUp = true;
  } else if (firstDropped < 5) {
    roundUp = false;
  } else {
    // Exact tie (all-zero tail) — round to even on the last kept digit,
    // treating "no kept digits at all" as an implicit (even) 0.
    const lastKept = keep.length > 0 ? keep[keep.length - 1] : 0;
    roundUp = lastKept % 2 !== 0;
  }

  if (roundUp) {
    let i = keep.length - 1;
    while (i >= 0 && keep[i] === 9) {
      keep[i] = 0;
      i--;
    }
    if (i >= 0) keep[i]++;
    else keep.unshift(1); // carried past the most significant digit
  }

  const magnitude = keep.length === 0 ? 0 : Number(keep.join(""));
  const result = magnitude / 10 ** digits;
  return negative ? -result : result;
}

// -- single-arg with an optional second numeric argument (digits/significance) --
// math_funcs.py:147-153
export const round: ExcelFunction = (evaluator, args) => {
  const val = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(val)) return val;
  let digits = 0;
  if (args.length > 1) {
    const d = coerceNumber(evaluator.resolveArg(args[1]));
    if (isExcelError(d)) return d;
    digits = Math.trunc(d);
  }
  return pythonRound(val, digits);
};

// math_funcs.py:156-166 — rounds away from zero regardless of sign.
export const roundup: ExcelFunction = (evaluator, args) => {
  const val = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(val)) return val;
  let digits = 0;
  if (args.length > 1) {
    const d = coerceNumber(evaluator.resolveArg(args[1]));
    if (isExcelError(d)) return d;
    digits = Math.trunc(d);
  }
  const factor = 10 ** digits;
  return val >= 0 ? Math.ceil(val * factor) / factor : Math.floor(val * factor) / factor;
};

// math_funcs.py:169-179 — rounds toward zero, the mirror image of ROUNDUP.
export const rounddown: ExcelFunction = (evaluator, args) => {
  const val = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(val)) return val;
  let digits = 0;
  if (args.length > 1) {
    const d = coerceNumber(evaluator.resolveArg(args[1]));
    if (isExcelError(d)) return d;
    digits = Math.trunc(d);
  }
  const factor = 10 ** digits;
  return val >= 0 ? Math.floor(val * factor) / factor : Math.ceil(val * factor) / factor;
};

// math_funcs.py:182-192 — second arg (significance) defaults to 1.0; a 0
// significance short-circuits to 0 before ever dividing by it.
export const ceiling: ExcelFunction = (evaluator, args) => {
  const val = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(val)) return val;
  let sig = 1.0;
  if (args.length > 1) {
    const s = coerceNumber(evaluator.resolveArg(args[1]));
    if (isExcelError(s)) return s;
    sig = s;
  }
  if (sig === 0) return 0;
  return Math.ceil(val / sig) * sig;
};

// math_funcs.py:195-205 — mirrors CEILING.
export const floor: ExcelFunction = (evaluator, args) => {
  const val = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(val)) return val;
  let sig = 1.0;
  if (args.length > 1) {
    const s = coerceNumber(evaluator.resolveArg(args[1]));
    if (isExcelError(s)) return s;
    sig = s;
  }
  if (sig === 0) return 0;
  return Math.floor(val / sig) * sig;
};

// math_funcs.py:208-213 — Math.floor always, not Math.trunc (matters for negatives).
export const int: ExcelFunction = (evaluator, args) => {
  const val = coerceNumber(evaluator.resolveArg(args[0]));
  return isExcelError(val) ? val : Math.floor(val);
};

// -- two-arg with a DIV0 guard --
// math_funcs.py:216-226 — Python-style modulo: num - divisor*floor(num/divisor),
// so the sign of the result follows the divisor's sign like Python's %, not JS's.
export const mod: ExcelFunction = (evaluator, args) => {
  const num = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(num)) return num;
  const divisor = coerceNumber(evaluator.resolveArg(args[1]));
  if (isExcelError(divisor)) return divisor;
  if (divisor === 0) return excelError("#DIV/0!");
  return num - divisor * Math.floor(num / divisor);
};

// math_funcs.py:229-240 — a non-finite result (NaN/Infinity) becomes #NUM!,
// mirroring the Python source's OverflowError/ValueError -> NUM_ERROR catch
// around `base ** exp`. One case needed reading the Python source directly:
// a zero base with a negative exponent raises Python's ZeroDivisionError,
// which _power does NOT catch (its except clause only names OverflowError
// and ValueError) — it propagates out to the reference engine's outer
// catch-all (engine.py::_eval_func), which turns *any* uncaught exception
// into #VALUE!, not #NUM!. Verified directly: `(0.0) ** -1.0` raises
// ZeroDivisionError in Python, while JS's `Math.pow(0, -1)` silently
// returns Infinity, so this needed an explicit special case rather than
// falling out of the finite-result check below.
export const power: ExcelFunction = (evaluator, args) => {
  const base = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(base)) return base;
  const exp = coerceNumber(evaluator.resolveArg(args[1]));
  if (isExcelError(exp)) return exp;
  if (base === 0 && exp < 0) return excelError("#VALUE!");
  const result = Math.pow(base, exp);
  return Number.isFinite(result) ? result : excelError("#NUM!");
};

// math_funcs.py:243-250 — negative input is #NUM! before ever calling Math.sqrt.
export const sqrt: ExcelFunction = (evaluator, args) => {
  const val = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(val)) return val;
  if (val < 0) return excelError("#NUM!");
  return Math.sqrt(val);
};

// math_funcs.py:253-263 — second arg (base) defaults to 10; a non-positive
// value, non-positive base, or base of exactly 1 is #NUM!.
export const log: ExcelFunction = (evaluator, args) => {
  const val = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(val)) return val;
  let base = 10;
  if (args.length > 1) {
    const b = coerceNumber(evaluator.resolveArg(args[1]));
    if (isExcelError(b)) return b;
    base = b;
  }
  if (val <= 0 || base <= 0 || base === 1) return excelError("#NUM!");
  return Math.log(val) / Math.log(base);
};

// math_funcs.py:266-273
export const ln: ExcelFunction = (evaluator, args) => {
  const val = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(val)) return val;
  if (val <= 0) return excelError("#NUM!");
  return Math.log(val);
};

// math_funcs.py:276-284 — a non-finite (overflowing) result is #NUM!.
export const exp: ExcelFunction = (evaluator, args) => {
  const val = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(val)) return val;
  const result = Math.exp(val);
  return Number.isFinite(result) ? result : excelError("#NUM!");
};

// math_funcs.py:287-296
export const sign: ExcelFunction = (evaluator, args) => {
  const val = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(val)) return val;
  if (val > 0) return 1;
  if (val < 0) return -1;
  return 0;
};

// math_funcs.py:299-307 — 0 on an empty set, unlike real Excel's 1; ported
// as the Python source has it. Propagates an in-range error like SUM, unlike
// the empty-set behavior above (that divergence from real Excel is left
// alone — see the Python-source note — but error propagation is real Excel
// behavior in its own right, confirmed: `=PRODUCT(2,#DIV/0!)` is #DIV/0!).
export const product: ExcelFunction = (evaluator, args) => {
  const nums = flattenNumbersOrError(evaluator, args);
  if (isExcelError(nums)) return nums;
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a * b, 1);
};

/** Resolves one argument to a flat array: a range flattens (rows then
 *  cells), a scalar becomes a 1-element array. Mirrors math_funcs.py's
 *  inline flattening in _sumproduct (lines 312-324) — deliberately not
 *  flattenNumbers/collectNumbers, since SUMPRODUCT keeps non-numeric cells
 *  in place (as 0) rather than skipping them. Exported so
 *  functions/financial.ts's XNPV/XIRR can reuse the exact same
 *  "position-preserving, nothing skipped" flattening for pairing a values
 *  range with a same-length dates range by index — the same shape
 *  SUMPRODUCT needs this for, for the same reason (an index-aligned pairing
 *  across two ranges must not silently drop an element from just one side). */
export function flattenOneLevel(val: CellValue): CellValue[] {
  if (!Array.isArray(val)) return [val];
  const flat: CellValue[] = [];
  for (const row of val) {
    if (Array.isArray(row)) flat.push(...row);
    else flat.push(row);
  }
  return flat;
}

// math_funcs.py:310-343 — resolves every arg to a flat array; #VALUE! if the
// flattened arrays have mismatched lengths; a missing/non-numeric cell
// becomes 0, not skipped. A cell that IS an ExcelErrorValue is the one
// exception to that 0-substitution: it propagates instead, matching real
// Excel (`=SUMPRODUCT(A1:A3,B1:B3)` with a #DIV/0! anywhere in either range
// returns #DIV/0!, not a total computed by treating that cell as 0) — the
// Python source's own `_to_number` folds an error into the same "becomes 0"
// bucket as any other non-numeric cell, which is the bug this diverges from
// on purpose, same as every other aggregate in this file.
export const sumproduct: ExcelFunction = (evaluator, args) => {
  const arrays = args.map((arg) => flattenOneLevel(evaluator.resolveArg(arg)));
  if (arrays.length === 0) return 0;
  const length = arrays[0].length;
  for (const arr of arrays.slice(1)) {
    if (arr.length !== length) return excelError("#VALUE!");
  }
  let total = 0;
  for (let i = 0; i < length; i++) {
    let product = 1;
    for (const arr of arrays) {
      const cell = arr[i];
      if (isExcelError(cell)) return cell;
      product *= toNumberForAggregate(cell) ?? 0;
    }
    total += product;
  }
  return total;
};

// math_funcs.py:346-348 — no args, always Math.PI.
export const pi: ExcelFunction = () => Math.PI;

// -- non-deterministic shape --
// math_funcs.py:351-354
export const rand: ExcelFunction = () => Math.random();

// math_funcs.py:357-362
export const randbetween: ExcelFunction = (evaluator, args) => {
  const lo = Math.trunc(coerceNumber(evaluator.resolveArg(args[0])) as number);
  const hi = Math.trunc(coerceNumber(evaluator.resolveArg(args[1])) as number);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
};

// math_funcs.py:365-374 — #NUM! on an empty set (not #DIV/0! like AVERAGE);
// sorts first. Propagates an in-range error before either of those, like
// SUM/AVERAGE/MIN/MAX (confirmed real Excel behavior: `=MEDIAN(1,#N/A,2)` is
// #N/A, not 1.5).
export const median: ExcelFunction = (evaluator, args) => {
  const numsOrErr = flattenNumbersOrError(evaluator, args);
  if (isExcelError(numsOrErr)) return numsOrErr;
  const nums = numsOrErr.sort((a, b) => a - b);
  if (nums.length === 0) return excelError("#NUM!");
  const n = nums.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
};

// math_funcs.py:377-383 — k is 1-based from the top; #NUM! if k is out of
// range. Propagates an error found in the data range (args[0]) the same way
// SUM does — confirmed real Excel: `=LARGE(A1:A3,1)` with a #DIV/0! among
// A1:A3 is #DIV/0!, not the largest surviving number. k's own error handling
// (below) is unrelated and unchanged.
export const large: ExcelFunction = (evaluator, args) => {
  const numsOrErr = flattenNumbersOrError(evaluator, [args[0]]);
  if (isExcelError(numsOrErr)) return numsOrErr;
  const nums = numsOrErr.sort((a, b) => b - a);
  const kRaw = coerceNumber(evaluator.resolveArg(args[1]));
  // math_funcs.py never checks whether the resolved k is itself an
  // ExcelError before calling Python's int() on it — that call throws
  // (ExcelError has no __int__), and engine.py's outer per-function
  // exception handler catches it generically, producing a *generic*
  // #VALUE!, not k's own error code. Discard kRaw's code here to match.
  if (isExcelError(kRaw)) return excelError("#VALUE!");
  const k = Math.trunc(kRaw);
  if (k < 1 || k > nums.length) return excelError("#NUM!");
  return nums[k - 1];
};

// math_funcs.py:386-392 — mirrors LARGE from the bottom, including the same
// error-propagation-from-the-data-range behavior.
export const small: ExcelFunction = (evaluator, args) => {
  const numsOrErr = flattenNumbersOrError(evaluator, [args[0]]);
  if (isExcelError(numsOrErr)) return numsOrErr;
  const nums = numsOrErr.sort((a, b) => a - b);
  const kRaw = coerceNumber(evaluator.resolveArg(args[1]));
  // See LARGE above: Python's int() on an ExcelError throws, and the outer
  // handler in engine.py turns that into a generic #VALUE!, not k's own
  // error code.
  if (isExcelError(kRaw)) return excelError("#VALUE!");
  const k = Math.trunc(kRaw);
  if (k < 1 || k > nums.length) return excelError("#NUM!");
  return nums[k - 1];
};
