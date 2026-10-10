import { describe, expect, it } from "vitest";
import { excelError, isExcelError, type CellValue } from "@/lib/formula/ast";
import { FUNCTION_REGISTRY } from "@/lib/formula/functions";
import type { FunctionEvaluator } from "@/lib/formula/evaluator-types";
import { parseFormula } from "@/lib/formula/parser";
import { DependencyGraph, makeKey, type CellKey } from "@/lib/formula/graph";
import { extractRefs, recalculate, type EngineState } from "@/lib/formula/evaluate";

/** A minimal stand-in evaluator: args resolve to whatever this map says the
 *  parsed source text of that argument is, so tests don't need a real
 *  EngineState just to prove SUM's own logic. */
function fakeEvaluator(resolve: (node: ReturnType<typeof parseFormula>) => CellValue): FunctionEvaluator {
  return {
    resolveArg: resolve,
    getCellValue: () => null,
    currentSheet: "S",
    currentRow: 1,
    currentColIndex: 1,
  };
}

function callSum(...values: CellValue[]): CellValue {
  const args = values.map((_, i) => parseFormula(String(i))); // placeholder AST nodes, identity doesn't matter here
  const byIndex = new Map(args.map((node, i) => [node, values[i]]));
  const ev = fakeEvaluator((node) => byIndex.get(node)!);
  return FUNCTION_REGISTRY.SUM(ev, args);
}

/** Same pattern as callSum, generalized to any registered function: each
 *  positional value becomes one argument, resolved via a fresh placeholder
 *  AST node keyed by identity (the node's own text doesn't matter). */
function callFn(name: string, ...values: CellValue[]): CellValue {
  const args = values.map((_, i) => parseFormula(String(i)));
  const byIndex = new Map(args.map((node, i) => [node, values[i]]));
  const ev = fakeEvaluator((node) => byIndex.get(node)!);
  return FUNCTION_REGISTRY[name](ev, args);
}

describe("SUM", () => {
  it("adds plain numbers", () => {
    expect(callSum(1, 2, 3)).toBe(6);
  });

  it("is 0 with no numeric arguments at all", () => {
    expect(callSum()).toBe(0);
  });

  it("skips a blank", () => {
    expect(callSum(1, null, 2)).toBe(3);
  });

  it("skips text that isn't a number", () => {
    expect(callSum(1, "abc", 2)).toBe(3);
  });

  it("parses a numeric string", () => {
    expect(callSum("10", 5)).toBe(15);
  });

  it("counts a boolean as 1 or 0", () => {
    expect(callSum(true, false, 1)).toBe(2);
  });

  it("propagates an error rather than skipping it — matches real Excel, not the (buggy) reference engine", () => {
    // Was `toBe(5)` (silently skipping the error like a blank cell) until
    // this fix — that was ported byte-for-byte from math_funcs.py's own
    // _to_number, which the reference engine (this port's usual oracle) has
    // the identical bug in. Real Excel does NOT do this: `=SUM(#N/A,5)` is
    // #N/A, not 5. Confirmed damage from the old behavior: a SUM over a
    // range containing a #NAME? silently returned one surviving operand's
    // value instead of the error, which then fed a Gauss-Seidel cycle that
    // converged to a self-consistent WRONG fixed point in a real LBO
    // benchmark task. See coerce.ts's toNumberOrErrorForAggregate.
    expect(callSum(excelError("#N/A"), 5)).toEqual(excelError("#N/A"));
  });

  it("propagates the FIRST error found, in row-major reading order, when a range has more than one", () => {
    const range: CellValue[][] = [[excelError("#DIV/0!"), excelError("#N/A")]];
    const args = [parseFormula("0")];
    const ev = fakeEvaluator(() => range);
    expect(FUNCTION_REGISTRY.SUM(ev, args)).toEqual(excelError("#DIV/0!"));
  });

  it("flattens a 2D range and sums every numeric cell in it, skipping non-numeric text and blanks", () => {
    const range: CellValue[][] = [
      [1, "x", 2],
      [null, 3, undefined as unknown as CellValue],
    ];
    const args = [parseFormula("0")];
    const ev = fakeEvaluator(() => range);
    expect(FUNCTION_REGISTRY.SUM(ev, args)).toBe(6); // 1+2+3
  });

  it("propagates an error found anywhere in a flattened 2D range, not just a top-level argument", () => {
    const range: CellValue[][] = [
      [1, "x", 2],
      [null, 3, excelError("#DIV/0!")],
    ];
    const args = [parseFormula("0")];
    const ev = fakeEvaluator(() => range);
    expect(FUNCTION_REGISTRY.SUM(ev, args)).toEqual(excelError("#DIV/0!"));
  });
});

describe("AVERAGE", () => {
  it("averages plain numbers", () => {
    expect(callFn("AVERAGE", 2, 4, 6)).toBe(4);
  });

  it("is #DIV/0! with no numeric arguments — the one aggregate function that errors on empty", () => {
    expect(callFn("AVERAGE")).toEqual(excelError("#DIV/0!"));
  });

  it("aggregate tier: skips non-numeric text rather than erroring", () => {
    expect(callFn("AVERAGE", 2, "abc", 4)).toBe(3);
  });

  it("propagates an error, checked before the empty-set #DIV/0! fallback", () => {
    expect(callFn("AVERAGE", excelError("#VALUE!"), 4)).toEqual(excelError("#VALUE!"));
  });
});

describe("MIN", () => {
  it("finds the smallest number", () => {
    expect(callFn("MIN", 5, 2, 9)).toBe(2);
  });

  it("is 0 with no numeric arguments", () => {
    expect(callFn("MIN")).toBe(0);
  });

  it("aggregate tier: skips a blank and non-numeric text", () => {
    expect(callFn("MIN", 5, null, "x", 2)).toBe(2);
  });

  it("propagates an error rather than treating it as skippable", () => {
    expect(callFn("MIN", 5, excelError("#REF!"), 2)).toEqual(excelError("#REF!"));
  });
});

describe("MAX", () => {
  it("finds the largest number", () => {
    expect(callFn("MAX", 5, 2, 9)).toBe(9);
  });

  it("is 0 with no numeric arguments", () => {
    expect(callFn("MAX")).toBe(0);
  });

  it("aggregate tier: skips a blank and non-numeric text", () => {
    expect(callFn("MAX", 5, null, "x", 2)).toBe(5);
  });

  it("propagates an error rather than treating it as skippable", () => {
    expect(callFn("MAX", 5, excelError("#REF!"), 2)).toEqual(excelError("#REF!"));
  });
});

describe("COUNT", () => {
  it("counts numeric arguments", () => {
    expect(callFn("COUNT", 1, 2, 3)).toBe(3);
  });

  it("is 0 with no arguments", () => {
    expect(callFn("COUNT")).toBe(0);
  });

  it("aggregate tier: counts only what toNumberForAggregate accepted", () => {
    expect(callFn("COUNT", 1, "abc", null, 2)).toBe(2);
  });

  it("does NOT propagate an error — real Excel's COUNT just doesn't count it, unlike SUM/AVERAGE/MIN/MAX above", () => {
    expect(callFn("COUNT", 1, excelError("#DIV/0!"), 2)).toBe(2);
  });
});

describe("COUNTA", () => {
  it("counts non-blank cells including text and booleans", () => {
    expect(callFn("COUNTA", 1, "x", true)).toBe(3);
  });

  it("is 0 when every cell is null or empty string", () => {
    expect(callFn("COUNTA", null, "")).toBe(0);
  });

  it("presence tier: text, booleans, and 0 all count as present — no numeric coercion", () => {
    expect(callFn("COUNTA", "abc", false, 0)).toBe(3);
  });

  it("counts an error cell as present too — it's non-blank, same as any other value", () => {
    expect(callFn("COUNTA", excelError("#DIV/0!"), 1)).toBe(2);
  });
});

describe("COUNTBLANK", () => {
  it("counts null and empty-string cells", () => {
    expect(callFn("COUNTBLANK", null, "", 1)).toBe(2);
  });

  it("is 0 when nothing is blank", () => {
    expect(callFn("COUNTBLANK", 1, 2, 3)).toBe(0);
  });

  it("presence tier: false and 0 are not blank, only null/empty-string are", () => {
    expect(callFn("COUNTBLANK", "abc", false, 0)).toBe(0);
  });
});

describe("ABS", () => {
  it("takes the absolute value", () => {
    expect(callFn("ABS", -5)).toBe(5);
  });

  it("treats a blank as 0", () => {
    expect(callFn("ABS", null)).toBe(0);
  });

  it("single tier: bad text is #VALUE!, not skipped", () => {
    expect(callFn("ABS", "abc")).toEqual(excelError("#VALUE!"));
  });
});

describe("ROUND", () => {
  it("rounds to the given number of digits", () => {
    expect(callFn("ROUND", 3.456, 2)).toBe(3.46);
  });

  it("defaults digits to 0 when omitted", () => {
    expect(callFn("ROUND", 3.456)).toBe(3);
  });

  it("single tier: bad text is #VALUE!", () => {
    expect(callFn("ROUND", "abc", 1)).toEqual(excelError("#VALUE!"));
  });

  it("rounds .5 half to even (banker's rounding), matching Python's round()", () => {
    expect(callFn("ROUND", 2.5, 0)).toBe(2); // rounds down to even, not up to 3
    expect(callFn("ROUND", 0.5, 0)).toBe(0);
    expect(callFn("ROUND", 1.5, 0)).toBe(2);
    expect(callFn("ROUND", 3.5, 0)).toBe(4);
  });

  it("applies banker's rounding at a nonzero digit count", () => {
    expect(callFn("ROUND", 2.25, 1)).toBe(2.2); // 2.2 is even at the tenths place
  });

  it("rounds on the double's true binary value, not a scaled-multiplication approximation", () => {
    // Task 7's oracle fixture (public/samples/functions.xlsx) caught this
    // directly against the real Python engine: a naive `val * 10**digits`
    // implementation introduces new floating-point error from the
    // multiplication itself and gets these wrong (0.15 -> 0.2, 2.675 ->
    // 2.68, 0.35 -> 0.4, 1.15 -> 1.2) because none of these decimal
    // literals are exactly representable in binary — 0.15 is actually
    // stored as 0.1499999999999999944..., 2.675 as 2.67499999999999982....
    // Python's real round() sees the true stored value, not the decimal
    // you typed, and so does this port now.
    expect(callFn("ROUND", 0.15, 1)).toBe(0.1);
    expect(callFn("ROUND", 2.675, 2)).toBe(2.67);
    expect(callFn("ROUND", 0.35, 1)).toBe(0.3);
    expect(callFn("ROUND", 1.15, 1)).toBe(1.1);
  });

  it("rounds with a negative digit count (nearest ten/hundred/…)", () => {
    expect(callFn("ROUND", 1234.5678, -2)).toBe(1200);
    expect(callFn("ROUND", 1350, -2)).toBe(1400); // ties to even: 14 is even
  });

  it("rounds a negative number symmetrically", () => {
    expect(callFn("ROUND", -2.675, 2)).toBe(-2.67);
  });
});

describe("ROUNDUP", () => {
  it("rounds away from zero", () => {
    expect(callFn("ROUNDUP", 3.2, 0)).toBe(4);
    expect(callFn("ROUNDUP", -3.2, 0)).toBe(-4);
  });

  it("leaves an exact value unchanged", () => {
    expect(callFn("ROUNDUP", 0, 2)).toBe(0);
  });

  it("single tier: bad text is #VALUE!", () => {
    expect(callFn("ROUNDUP", "abc", 0)).toEqual(excelError("#VALUE!"));
  });
});

describe("ROUNDDOWN", () => {
  it("rounds toward zero", () => {
    expect(callFn("ROUNDDOWN", 3.9, 0)).toBe(3);
    expect(callFn("ROUNDDOWN", -3.9, 0)).toBe(-3);
  });

  it("leaves an exact value unchanged", () => {
    expect(callFn("ROUNDDOWN", 0, 2)).toBe(0);
  });

  it("single tier: bad text is #VALUE!", () => {
    expect(callFn("ROUNDDOWN", "abc", 0)).toEqual(excelError("#VALUE!"));
  });
});

describe("CEILING", () => {
  it("rounds up to the nearest multiple of significance", () => {
    expect(callFn("CEILING", 2.5, 1)).toBe(3);
  });

  it("zero significance short-circuits to 0 rather than dividing by it", () => {
    expect(callFn("CEILING", 5, 0)).toBe(0);
  });

  it("defaults significance to 1.0 when omitted (single tier default-arg behavior)", () => {
    expect(callFn("CEILING", 2.1)).toBe(3);
  });
});

describe("FLOOR", () => {
  it("rounds down to the nearest multiple of significance", () => {
    expect(callFn("FLOOR", 2.5, 1)).toBe(2);
  });

  it("zero significance short-circuits to 0 rather than dividing by it", () => {
    expect(callFn("FLOOR", 5, 0)).toBe(0);
  });

  it("defaults significance to 1.0 when omitted", () => {
    expect(callFn("FLOOR", 2.9)).toBe(2);
  });
});

describe("INT", () => {
  it("floors a positive number", () => {
    expect(callFn("INT", 3.9)).toBe(3);
  });

  it("treats a blank as 0", () => {
    expect(callFn("INT", null)).toBe(0);
  });

  it("floors toward negative infinity, not toward zero — Math.floor, not Math.trunc", () => {
    expect(callFn("INT", -3.1)).toBe(-4);
  });
});

describe("MOD", () => {
  it("computes the remainder", () => {
    expect(callFn("MOD", 7, 3)).toBe(1);
  });

  it("is #DIV/0! when the divisor is 0", () => {
    expect(callFn("MOD", 5, 0)).toEqual(excelError("#DIV/0!"));
  });

  it("single tier: bad text is #VALUE!", () => {
    expect(callFn("MOD", "abc", 3)).toEqual(excelError("#VALUE!"));
  });

  it("follows the divisor's sign like Python's %, not JS's", () => {
    expect(callFn("MOD", -7, 3)).toBe(2); // JS `-7 % 3` would be -1
  });
});

describe("POWER", () => {
  it("raises to a power", () => {
    expect(callFn("POWER", 2, 10)).toBe(1024);
  });

  it("handles a zero base", () => {
    expect(callFn("POWER", 0, 5)).toBe(0);
  });

  it("single tier: bad text is #VALUE!", () => {
    expect(callFn("POWER", "abc", 2)).toEqual(excelError("#VALUE!"));
  });

  it("a non-finite result (fractional power of a negative base) becomes #NUM!", () => {
    expect(callFn("POWER", -8, 0.5)).toEqual(excelError("#NUM!"));
  });

  it("a zero base with a negative exponent is #VALUE!, matching Python's uncaught ZeroDivisionError — not #NUM!", () => {
    expect(callFn("POWER", 0, -1)).toEqual(excelError("#VALUE!"));
  });
});

describe("SQRT", () => {
  it("takes the square root", () => {
    expect(callFn("SQRT", 9)).toBe(3);
  });

  it("is 0 at 0", () => {
    expect(callFn("SQRT", 0)).toBe(0);
  });

  it("a negative input is #NUM! before Math.sqrt would produce NaN", () => {
    expect(callFn("SQRT", -1)).toEqual(excelError("#NUM!"));
  });
});

describe("LOG", () => {
  it("defaults to base 10", () => {
    expect(callFn("LOG", 100)).toBe(2);
  });

  it("accepts an explicit base", () => {
    expect(callFn("LOG", 8, 2)).toBe(3);
  });

  it("single tier: non-positive value, non-positive base, or base 1 is #NUM!", () => {
    expect(callFn("LOG", -1)).toEqual(excelError("#NUM!"));
    expect(callFn("LOG", 10, 1)).toEqual(excelError("#NUM!"));
  });
});

describe("LN", () => {
  it("takes the natural log", () => {
    expect(callFn("LN", Math.E)).toBeCloseTo(1);
  });

  it("is 0 at 1", () => {
    expect(callFn("LN", 1)).toBe(0);
  });

  it("a non-positive input is #NUM!", () => {
    expect(callFn("LN", 0)).toEqual(excelError("#NUM!"));
    expect(callFn("LN", -5)).toEqual(excelError("#NUM!"));
  });
});

describe("EXP", () => {
  it("raises e to the given power", () => {
    expect(callFn("EXP", 1)).toBeCloseTo(Math.E);
  });

  it("is 1 at 0", () => {
    expect(callFn("EXP", 0)).toBe(1);
  });

  it("a non-finite (overflowing) result becomes #NUM!", () => {
    expect(callFn("EXP", 1000)).toEqual(excelError("#NUM!"));
  });
});

describe("SIGN", () => {
  it("returns 1 for positive, -1 for negative", () => {
    expect(callFn("SIGN", 5)).toBe(1);
    expect(callFn("SIGN", -5)).toBe(-1);
  });

  it("returns 0 at 0", () => {
    expect(callFn("SIGN", 0)).toBe(0);
  });

  it("single tier: bad text is #VALUE!", () => {
    expect(callFn("SIGN", "abc")).toEqual(excelError("#VALUE!"));
  });
});

describe("PRODUCT", () => {
  it("multiplies plain numbers", () => {
    expect(callFn("PRODUCT", 2, 3, 4)).toBe(24);
  });

  it("is 0 on an empty set — diverges from real Excel's 1, ported as the Python source has it", () => {
    expect(callFn("PRODUCT")).toBe(0);
  });

  it("aggregate tier: skips non-numeric text rather than erroring", () => {
    expect(callFn("PRODUCT", 2, "x", 3)).toBe(6);
  });

  it("propagates an error rather than treating it as skippable", () => {
    expect(callFn("PRODUCT", 2, excelError("#DIV/0!"), 3)).toEqual(excelError("#DIV/0!"));
  });
});

describe("SUMPRODUCT", () => {
  it("sums the pairwise products of two equal-length arrays", () => {
    const range1: CellValue[][] = [[1, 2, 3]];
    const range2: CellValue[][] = [[4, 5, 6]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue[][]>([
      [args[0], range1],
      [args[1], range2],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.SUMPRODUCT(ev, args)).toBe(32); // 1*4+2*5+3*6
  });

  it("is #VALUE! when the flattened arrays have mismatched lengths", () => {
    const range1: CellValue[][] = [[1, 2, 3]];
    const range2: CellValue[][] = [[4, 5]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue[][]>([
      [args[0], range1],
      [args[1], range2],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.SUMPRODUCT(ev, args)).toEqual(excelError("#VALUE!"));
  });

  it("treats a missing/non-numeric cell as 0 rather than skipping it", () => {
    const range1: CellValue[][] = [[1, "x", 3]];
    const range2: CellValue[][] = [[2, 2, 2]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue[][]>([
      [args[0], range1],
      [args[1], range2],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.SUMPRODUCT(ev, args)).toBe(8); // 1*2 + 0*2 + 3*2
  });

  it("propagates an error found in either array, rather than folding it into the 0-substitution", () => {
    // Real Excel: `=SUMPRODUCT(A1:A3,B1:B3)` with a #DIV/0! anywhere in
    // either range returns #DIV/0!, not a total computed by treating that
    // cell as 0 — the Python source's own _to_number folds an error into
    // the same "becomes 0" bucket as text, which this diverges from.
    const range1: CellValue[][] = [[1, excelError("#DIV/0!"), 3]];
    const range2: CellValue[][] = [[2, 2, 2]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue[][]>([
      [args[0], range1],
      [args[1], range2],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.SUMPRODUCT(ev, args)).toEqual(excelError("#DIV/0!"));
  });
});

describe("PI", () => {
  it("returns Math.PI", () => {
    expect(callFn("PI")).toBe(Math.PI);
  });

  it("ignores any arguments passed to it (real Excel takes none)", () => {
    expect(callFn("PI", 1, 2, 3)).toBe(Math.PI);
  });

  it("matches the well-known constant to several digits", () => {
    expect(callFn("PI")).toBeCloseTo(3.14159265358979, 10);
  });
});

describe("RAND", () => {
  it("returns a number in [0, 1)", () => {
    const ev = fakeEvaluator(() => null);
    for (let i = 0; i < 20; i++) {
      const v = FUNCTION_REGISTRY.RAND(ev, []);
      expect(typeof v).toBe("number");
      expect(v as number).toBeGreaterThanOrEqual(0);
      expect(v as number).toBeLessThan(1);
    }
  });
});

describe("RANDBETWEEN", () => {
  it("returns an integer within the given bounds, inclusive", () => {
    const args = [parseFormula("3"), parseFormula("7")];
    const byIndex = new Map(args.map((n, i) => [n, [3, 7][i]]));
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    for (let i = 0; i < 30; i++) {
      const v = FUNCTION_REGISTRY.RANDBETWEEN(ev, args) as number;
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});

describe("MEDIAN", () => {
  it("returns the middle value for an odd count", () => {
    expect(callFn("MEDIAN", 1, 2, 3, 4, 5)).toBe(3);
  });

  it("is #NUM! on an empty set — not #DIV/0! like AVERAGE", () => {
    expect(callFn("MEDIAN")).toEqual(excelError("#NUM!"));
  });

  it("averages the two middle values for an even count, after sorting", () => {
    expect(callFn("MEDIAN", 4, 1, 3, 2)).toBe(2.5);
  });

  it("aggregate tier: skips non-numeric text rather than erroring", () => {
    expect(callFn("MEDIAN", 1, "x", 2, 3)).toBe(2);
  });

  it("propagates an error, checked before sorting and the empty-set #NUM! fallback", () => {
    expect(callFn("MEDIAN", 1, excelError("#N/A"), 2)).toEqual(excelError("#N/A"));
  });
});

describe("LARGE", () => {
  it("returns the k-th largest value, 1-based from the top", () => {
    const range: CellValue[][] = [[5, 3, 9, 1]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], range],
      [args[1], 2],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.LARGE(ev, args)).toBe(5); // sorted desc: 9,5,3,1 -> k=2 is 5
  });

  it("is #NUM! when k is out of range", () => {
    const range: CellValue[][] = [[5, 3, 9, 1]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], range],
      [args[1], 0],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.LARGE(ev, args)).toEqual(excelError("#NUM!"));
  });

  it("single tier (k): bad text for k is #VALUE!", () => {
    const range: CellValue[][] = [[5, 3, 9, 1]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], range],
      [args[1], "abc"],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.LARGE(ev, args)).toEqual(excelError("#VALUE!"));
  });

  it("k resolving to an ExcelError produces a generic #VALUE!, not k's own error code", () => {
    const range: CellValue[][] = [[5, 3, 9, 1]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], range],
      [args[1], excelError("#DIV/0!")],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    const result = FUNCTION_REGISTRY.LARGE(ev, args);
    expect(result).toEqual(excelError("#VALUE!"));
    expect(result).not.toEqual(excelError("#DIV/0!"));
  });

  it("propagates an error found in the data range itself (args[0]), not just k's own error handling above", () => {
    const range: CellValue[][] = [[5, excelError("#REF!"), 9, 1]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], range],
      [args[1], 2],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.LARGE(ev, args)).toEqual(excelError("#REF!"));
  });
});

describe("SMALL", () => {
  it("returns the k-th smallest value, 1-based from the bottom", () => {
    const range: CellValue[][] = [[5, 3, 9, 1]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], range],
      [args[1], 2],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.SMALL(ev, args)).toBe(3); // sorted asc: 1,3,5,9 -> k=2 is 3
  });

  it("is #NUM! when k is out of range", () => {
    const range: CellValue[][] = [[5, 3, 9, 1]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], range],
      [args[1], 99],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.SMALL(ev, args)).toEqual(excelError("#NUM!"));
  });

  it("single tier (k): bad text for k is #VALUE!", () => {
    const range: CellValue[][] = [[5, 3, 9, 1]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], range],
      [args[1], "abc"],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.SMALL(ev, args)).toEqual(excelError("#VALUE!"));
  });

  it("k resolving to an ExcelError produces a generic #VALUE!, not k's own error code", () => {
    const range: CellValue[][] = [[5, 3, 9, 1]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], range],
      [args[1], excelError("#DIV/0!")],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    const result = FUNCTION_REGISTRY.SMALL(ev, args);
    expect(result).toEqual(excelError("#VALUE!"));
    expect(result).not.toEqual(excelError("#DIV/0!"));
  });

  it("propagates an error found in the data range itself (args[0]), not just k's own error handling above", () => {
    const range: CellValue[][] = [[5, excelError("#REF!"), 9, 1]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], range],
      [args[1], 2],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.SMALL(ev, args)).toEqual(excelError("#REF!"));
  });
});

describe("regression: SUM over a range containing an upstream #NAME? does not launder it into a number", () => {
  // Reproduces the real-world shape this fix was written for: a real LBO
  // benchmark task ("LBO & Lenders"!S47) had a cell compute #NAME? (because
  // PMT wasn't in FUNCTION_REGISTRY yet — see functions/financial.ts, this
  // change's sibling fix), and a SUM over a range containing that cell
  // silently returned one surviving operand's value (77.44) instead of the
  // error. That wrong number then fed a Gauss-Seidel iterative-calculation
  // cycle, which converged to a self-consistent WRONG fixed point — a
  // completely plausible-looking number with no error anywhere in sight.
  // This test drives the real evaluator (recalculate against a real
  // FUNCTION_REGISTRY), not a hand-rolled stand-in, so it exercises the same
  // code path the real bug went through end to end.
  function setFormula(state: EngineState, key: CellKey, formula: string, sheet: string): void {
    const node = parseFormula(formula);
    state.formulas.set(key, node);
    state.graph.addFormulaCell(key, extractRefs(node, sheet));
  }

  it("SUM over [number, #NAME?] is #NAME?, not the surviving number", () => {
    const state: EngineState = { formulas: new Map(), values: new Map(), graph: new DependencyGraph() };
    // A1 stands in for the S47 story's other operand (77.44); B1 stands in
    // for the PMT-shaped formula that used to resolve to #NAME? before this
    // change's sibling fix registered the financial functions.
    setFormula(state, makeKey("S", "A", 1), "77.44", "S");
    setFormula(state, makeKey("S", "B", 1), "SOME_UNREGISTERED_FUNCTION()", "S");
    setFormula(state, makeKey("S", "C", 1), "SUM(A1:B1)", "S");
    state.graph.markAllDirty();
    recalculate(state, FUNCTION_REGISTRY);

    expect(state.values.get(makeKey("S", "B", 1))).toEqual(excelError("#NAME?"));
    // The old (pre-fix) behavior here was 77.44 — the error silently
    // dropped, exactly the laundering this fix closes.
    const total = state.values.get(makeKey("S", "C", 1));
    expect(isExcelError(total)).toBe(true);
    expect(total).toEqual(excelError("#NAME?"));
  });
});
