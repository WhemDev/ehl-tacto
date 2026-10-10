/**
 * Logic and information functions. Ports simulation/functions/logic_funcs.py
 * in full — see the plan task this was written from for the exact Python
 * line ranges each export below corresponds to.
 */

import { excelError, isExcelError, type AstNode, type CellValue, type ExcelErrorValue } from "../ast";
import { toBoolean } from "../coerce";
import type { ExcelFunction, FunctionEvaluator } from "../evaluator-types";

// -- condition + branch shape, with non-blank defaults --
// logic_funcs.py:32-41
export const ifFn: ExcelFunction = (evaluator, args) => {
  const cond = toBoolean(evaluator.resolveArg(args[0]));
  if (isExcelError(cond)) return cond;
  if (cond) return args.length > 1 ? evaluator.resolveArg(args[1]) : true;
  return args.length > 2 ? evaluator.resolveArg(args[2]) : false;
};
// Registered as "IF" — named ifFn here because `if` is a reserved word.

// -- nested-range boolean walk, with short-circuit --
// logic_funcs.py:44-63 (AND), 66-85 (OR)
function walkBooleans(
  evaluator: FunctionEvaluator,
  args: AstNode[],
  shortCircuitOn: boolean,
): boolean | ExcelErrorValue {
  const visit = (val: CellValue | CellValue[]): boolean | ExcelErrorValue | null => {
    if (Array.isArray(val)) {
      for (const item of val) {
        const r = visit(item);
        if (r !== null) return r;
      }
      return null;
    }
    const b = toBoolean(val);
    if (isExcelError(b)) return b;
    return b === shortCircuitOn ? shortCircuitOn : null;
  };
  for (const arg of args) {
    const r = visit(evaluator.resolveArg(arg));
    if (r !== null) return r;
  }
  return !shortCircuitOn;
}

export const and: ExcelFunction = (evaluator, args) => walkBooleans(evaluator, args, false);
export const or: ExcelFunction = (evaluator, args) => walkBooleans(evaluator, args, true);

// logic_funcs.py:88-94
export const not: ExcelFunction = (evaluator, args) => {
  const b = toBoolean(evaluator.resolveArg(args[0]));
  if (isExcelError(b)) return b;
  return !b;
};

// -- error-catching shape, with a code-specific variant --
// logic_funcs.py:97-102
export const iferror: ExcelFunction = (evaluator, args) => {
  const val = evaluator.resolveArg(args[0]);
  if (isExcelError(val)) return args.length > 1 ? evaluator.resolveArg(args[1]) : "";
  return val;
};

// logic_funcs.py:105-110 — only catches #N/A, unlike IFERROR which catches any error.
export const ifna: ExcelFunction = (evaluator, args) => {
  const val = evaluator.resolveArg(args[0]);
  if (isExcelError(val) && val.code === "#N/A") {
    return args.length > 1 ? evaluator.resolveArg(args[1]) : "";
  }
  return val;
};

// logic_funcs.py:113-116
export const isblank: ExcelFunction = (evaluator, args) => {
  const val = evaluator.resolveArg(args[0]);
  return val === null || val === "";
};

// logic_funcs.py:119-122
export const iserror: ExcelFunction = (evaluator, args) => isExcelError(evaluator.resolveArg(args[0]));

// logic_funcs.py:125-128 — only #N/A, not every error.
export const isna: ExcelFunction = (evaluator, args) => {
  const val = evaluator.resolveArg(args[0]);
  return isExcelError(val) && val.code === "#N/A";
};

// logic_funcs.py:131-134 — booleans are automatically excluded since
// `typeof true !== "number"` in TS, no special-casing needed unlike
// Python's isinstance(val, (int, float)) and not isinstance(val, bool) dance.
export const isnumber: ExcelFunction = (evaluator, args) => typeof evaluator.resolveArg(args[0]) === "number";

// logic_funcs.py:137-140
export const istext: ExcelFunction = (evaluator, args) => typeof evaluator.resolveArg(args[0]) === "string";

// logic_funcs.py:143-145 — zero-arg, ignores any arguments passed.
export const trueFn: ExcelFunction = () => true;

// logic_funcs.py:148-150 — zero-arg, ignores any arguments passed.
export const falseFn: ExcelFunction = () => false;

// -- (condition, value) pair-walking shape --
// logic_funcs.py:153-165
export const ifs: ExcelFunction = (evaluator, args) => {
  let i = 0;
  while (i + 1 < args.length) {
    const cond = toBoolean(evaluator.resolveArg(args[i]));
    if (isExcelError(cond)) return cond;
    if (cond) return evaluator.resolveArg(args[i + 1]);
    i += 2;
  }
  return excelError("#N/A");
};

// logic_funcs.py:168-183 — expression, value1, result1, ..., [default].
//
// Matching is JS `===` where the Python source uses `==`. Note this is
// deliberately NOT compareValues (coerce.ts): that ports engine.py's `=`
// OPERATOR, which uppercases strings and has a number-vs-text lookup
// table, and SWITCH does not go through it on either side.
//
// `===` and `==` agree on the cases SWITCH is actually used for — numbers,
// case-sensitive strings, blanks. The final whole-plan review confirmed
// LEAVE, but the divergence set is wider than the one case recorded in
// progress.md, so it is written out here in full:
//   - two ExcelError values sharing a code: Python's ExcelError.__eq__
//     (ast_nodes.py:85) compares error_type, so they match; two distinct
//     objects never `===`.
//   - a Date on both sides: Python compares datetimes by value, `===`
//     compares object identity.
//   - ranges on both sides: Python compares lists element-wise.
//   - a number against a boolean: Python's `1.0 == True` is True.
// Each needs SWITCH to be handed an error, date, range, or boolean as BOTH
// the expression and a match value, which no ordinary sheet does. Fixing
// it means a bespoke pythonEquals covering four type pairs, none of which
// any oracle case or test reaches — more risk than the divergence.
export const switchFn: ExcelFunction = (evaluator, args) => {
  if (args.length < 3) return excelError("#N/A");
  const expr = evaluator.resolveArg(args[0]);
  let i = 1;
  while (i + 1 < args.length) {
    const testVal = evaluator.resolveArg(args[i]);
    if (expr === testVal) return evaluator.resolveArg(args[i + 1]);
    i += 2;
  }
  // Default value (odd number of remaining args).
  if (i < args.length) return evaluator.resolveArg(args[i]);
  return excelError("#N/A");
};

// logic_funcs.py:186-188 — zero-arg, ignores any arguments passed.
export const na: ExcelFunction = () => excelError("#N/A");

// logic_funcs.py:191-194
export const islogical: ExcelFunction = (evaluator, args) => typeof evaluator.resolveArg(args[0]) === "boolean";

// logic_funcs.py:197-210 — Excel's numeric type code: 1 number, 2 text,
// 4 logical, 16 error, 64 array, 1 as the fallback for anything else.
export const typeFn: ExcelFunction = (evaluator, args) => {
  const val = evaluator.resolveArg(args[0]);
  if (typeof val === "number") return 1;
  if (typeof val === "string") return 2;
  if (typeof val === "boolean") return 4;
  if (isExcelError(val)) return 16;
  if (Array.isArray(val)) return 64;
  return 1;
};
