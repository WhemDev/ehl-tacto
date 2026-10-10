/**
 * Conditional aggregation functions (SUMIF, COUNTIF, etc.). Ports
 * simulation/functions/conditional_funcs.py in full — see the plan task
 * this was written from for the exact Python line ranges each export below
 * corresponds to.
 */

import { excelError, isExcelError, type AstNode, type CellValue } from "../ast";
import { toNumberExcludingBool } from "../coerce";
import type { ExcelFunction, FunctionEvaluator } from "../evaluator-types";

type Predicate = (v: CellValue) => boolean;

// conditional_funcs.py:27-78 — the one predicate parser every function in
// this file shares. A number matches numerically; a leading comparison
// operator (checked longest-first so "<=" / ">=" / "<>" are never
// mis-tokenized as "<" / ">" followed by an orphaned "=") compares either
// numerically or as uppercased text depending on whether the remainder
// parses as a number; a string containing "*"/"?" becomes a case-insensitive
// wildcard match; anything else is an exact match, numeric if it parses,
// uppercased text otherwise.
function parseCriteria(criteria: CellValue): Predicate {
  if (typeof criteria === "number") {
    return (v) => typeof v === "number" && v === criteria;
  }

  const s = String(criteria ?? "");

  const ops: [string, (a: number, b: number) => boolean][] = [
    ["<>", (a, b) => a !== b],
    ["<=", (a, b) => a <= b],
    [">=", (a, b) => a >= b],
    ["<", (a, b) => a < b],
    [">", (a, b) => a > b],
    ["=", (a, b) => a === b],
  ];
  for (const [op, cmp] of ops) {
    if (s.startsWith(op)) {
      const rest = s.slice(op.length);
      const num = Number(rest);
      if (rest.trim() !== "" && !Number.isNaN(num)) {
        return (v) => typeof v === "number" && cmp(v, num);
      }
      const text = rest.toUpperCase();
      // Text comparison via the same operator, string-typed.
      const textCmp: Record<string, (a: string, b: string) => boolean> = {
        "<>": (a, b) => a !== b, "<=": (a, b) => a <= b, ">=": (a, b) => a >= b,
        "<": (a, b) => a < b, ">": (a, b) => a > b, "=": (a, b) => a === b,
      };
      return (v) => typeof v === "string" && textCmp[op](v.toUpperCase(), text);
    }
  }

  if (s.includes("*") || s.includes("?")) {
    const pattern = "^" + s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
    const re = new RegExp(pattern, "i");
    return (v) => typeof v === "string" && re.test(v);
  }

  const num = Number(s);
  if (s.trim() !== "" && !Number.isNaN(num)) {
    return (v) => typeof v === "number" && v === num;
  }
  const text = s.toUpperCase();
  return (v) => typeof v === "string" && v.toUpperCase() === text;
}

// conditional_funcs.py:12-24 — resolve one argument and flatten it (rows
// then cells) to a 1D array; a scalar becomes a 1-element array.
function flattenValues(evaluator: FunctionEvaluator, arg: AstNode): CellValue[] {
  const val = evaluator.resolveArg(arg);
  const flat: CellValue[] = [];
  const visit = (v: CellValue | CellValue[]): void => {
    if (Array.isArray(v)) { for (const item of v) visit(item); return; }
    flat.push(v);
  };
  visit(val);
  return flat;
}

// conditional_funcs.py:81-95 — range, criteria, [sum_range]; sum_range
// defaults to range itself when omitted.
//
// Every *IF/*IFS function below propagates an ExcelErrorValue found in its
// aggregation range (sum_range/average_range/max_range/min_range) ONCE that
// row has already matched every criterion — real Excel behavior, the same
// family of bug as math.ts's SUM/AVERAGE/etc. fix: toNumberExcludingBool
// returns null for anything that isn't a raw JS number, including an
// ExcelErrorValue, which used to discard a matched-and-errored cell exactly
// like the pre-fix toNumberForAggregate did. Checked ONLY on a value whose
// row already passed its predicate — an error in a row that didn't match
// never mattered to begin with, matching how real Excel never evaluates it
// either. Deliberately NOT applied to the criteria range itself: comparing a
// criteria against an ExcelErrorValue there simply doesn't match (none of
// parseCriteria's predicates return true for a non-number/non-string
// object), which is also real Excel behavior for the ordinary case (a
// criteria specifically targeting an error code, e.g. "=#N/A", is a much
// rarer edge left out of scope here).
export const sumif: ExcelFunction = (evaluator, args) => {
  const rangeVals = flattenValues(evaluator, args[0]);
  const criteria = evaluator.resolveArg(args[1]);
  const sumVals = args.length > 2 ? flattenValues(evaluator, args[2]) : rangeVals;
  const pred = parseCriteria(criteria);

  let total = 0;
  for (let i = 0; i < rangeVals.length; i++) {
    if (pred(rangeVals[i]) && i < sumVals.length) {
      const cell = sumVals[i];
      if (isExcelError(cell)) return cell;
      const n = toNumberExcludingBool(cell);
      if (n !== null) total += n;
    }
  }
  return total;
};

// conditional_funcs.py:98-120 — sum_range, then any number of
// (criteria_range, criteria) pairs; a row must match every pair.
export const sumifs: ExcelFunction = (evaluator, args) => {
  const sumVals = flattenValues(evaluator, args[0]);
  const pairs: { range: CellValue[]; pred: Predicate }[] = [];
  for (let i = 1; i + 1 < args.length; i += 2) {
    pairs.push({
      range: flattenValues(evaluator, args[i]),
      pred: parseCriteria(evaluator.resolveArg(args[i + 1])),
    });
  }

  let total = 0;
  for (let idx = 0; idx < sumVals.length; idx++) {
    const matches = pairs.every((p) => idx < p.range.length && p.pred(p.range[idx]));
    if (matches) {
      const cell = sumVals[idx];
      if (isExcelError(cell)) return cell;
      const n = toNumberExcludingBool(cell);
      if (n !== null) total += n;
    }
  }
  return total;
};

// conditional_funcs.py:123-128 — range, criteria; counts matches, no
// separate value range.
export const countif: ExcelFunction = (evaluator, args) => {
  const rangeVals = flattenValues(evaluator, args[0]);
  const pred = parseCriteria(evaluator.resolveArg(args[1]));

  let count = 0;
  for (const v of rangeVals) {
    if (pred(v)) count++;
  }
  return count;
};

// conditional_funcs.py:131-154 — any number of (criteria_range, criteria)
// pairs, no leading value range; the iteration length comes from the first
// pair's range. 0 with no pairs at all.
export const countifs: ExcelFunction = (evaluator, args) => {
  const pairs: { range: CellValue[]; pred: Predicate }[] = [];
  for (let i = 0; i + 1 < args.length; i += 2) {
    pairs.push({
      range: flattenValues(evaluator, args[i]),
      pred: parseCriteria(evaluator.resolveArg(args[i + 1])),
    });
  }
  if (pairs.length === 0) return 0;

  const length = pairs[0].range.length;
  let count = 0;
  for (let idx = 0; idx < length; idx++) {
    const matches = pairs.every((p) => idx < p.range.length && p.pred(p.range[idx]));
    if (matches) count++;
  }
  return count;
};

// conditional_funcs.py:157-175 — range, criteria, [average_range]; divides
// by the match count, #DIV/0! on zero matches (matching AVERAGE's own
// empty-set behavior).
export const averageif: ExcelFunction = (evaluator, args) => {
  const rangeVals = flattenValues(evaluator, args[0]);
  const criteria = evaluator.resolveArg(args[1]);
  const avgVals = args.length > 2 ? flattenValues(evaluator, args[2]) : rangeVals;
  const pred = parseCriteria(criteria);

  let total = 0;
  let count = 0;
  for (let i = 0; i < rangeVals.length; i++) {
    if (pred(rangeVals[i]) && i < avgVals.length) {
      const cell = avgVals[i];
      if (isExcelError(cell)) return cell;
      const n = toNumberExcludingBool(cell);
      if (n !== null) {
        total += n;
        count++;
      }
    }
  }
  if (count === 0) return excelError("#DIV/0!");
  return total / count;
};

// conditional_funcs.py:178-204 — average_range, then any number of
// (criteria_range, criteria) pairs. #DIV/0! on zero matches.
export const averageifs: ExcelFunction = (evaluator, args) => {
  const avgVals = flattenValues(evaluator, args[0]);
  const pairs: { range: CellValue[]; pred: Predicate }[] = [];
  for (let i = 1; i + 1 < args.length; i += 2) {
    pairs.push({
      range: flattenValues(evaluator, args[i]),
      pred: parseCriteria(evaluator.resolveArg(args[i + 1])),
    });
  }

  let total = 0;
  let count = 0;
  for (let idx = 0; idx < avgVals.length; idx++) {
    const matches = pairs.every((p) => idx < p.range.length && p.pred(p.range[idx]));
    if (matches) {
      const cell = avgVals[idx];
      if (isExcelError(cell)) return cell;
      const n = toNumberExcludingBool(cell);
      if (n !== null) {
        total += n;
        count++;
      }
    }
  }
  if (count === 0) return excelError("#DIV/0!");
  return total / count;
};

// conditional_funcs.py:207-231 — max_range, then any number of
// (criteria_range, criteria) pairs; folds with Math.max, defaulting to 0
// when nothing matches (result is None -> 0.0 in the Python source).
export const maxifs: ExcelFunction = (evaluator, args) => {
  const maxVals = flattenValues(evaluator, args[0]);
  const pairs: { range: CellValue[]; pred: Predicate }[] = [];
  for (let i = 1; i + 1 < args.length; i += 2) {
    pairs.push({
      range: flattenValues(evaluator, args[i]),
      pred: parseCriteria(evaluator.resolveArg(args[i + 1])),
    });
  }

  let result: number | null = null;
  for (let idx = 0; idx < maxVals.length; idx++) {
    const matches = pairs.every((p) => idx < p.range.length && p.pred(p.range[idx]));
    if (matches) {
      const cell = maxVals[idx];
      if (isExcelError(cell)) return cell;
      const n = toNumberExcludingBool(cell);
      if (n !== null && (result === null || n > result)) result = n;
    }
  }
  return result ?? 0;
};

// conditional_funcs.py:234-258 — mirrors MAXIFS with Math.min.
export const minifs: ExcelFunction = (evaluator, args) => {
  const minVals = flattenValues(evaluator, args[0]);
  const pairs: { range: CellValue[]; pred: Predicate }[] = [];
  for (let i = 1; i + 1 < args.length; i += 2) {
    pairs.push({
      range: flattenValues(evaluator, args[i]),
      pred: parseCriteria(evaluator.resolveArg(args[i + 1])),
    });
  }

  let result: number | null = null;
  for (let idx = 0; idx < minVals.length; idx++) {
    const matches = pairs.every((p) => idx < p.range.length && p.pred(p.range[idx]));
    if (matches) {
      const cell = minVals[idx];
      if (isExcelError(cell)) return cell;
      const n = toNumberExcludingBool(cell);
      if (n !== null && (result === null || n < result)) result = n;
    }
  }
  return result ?? 0;
};
