import { describe, expect, it } from "vitest";
import { excelError, type CellValue } from "@/lib/formula/ast";
import { FUNCTION_REGISTRY } from "@/lib/formula/functions";
import type { FunctionEvaluator } from "@/lib/formula/evaluator-types";
import { parseFormula } from "@/lib/formula/parser";

/** A minimal stand-in evaluator: args resolve to whatever this map says the
 *  parsed source text of that argument is, so tests don't need a real
 *  EngineState just to prove a function's own logic. */
function fakeEvaluator(resolve: (node: ReturnType<typeof parseFormula>) => CellValue): FunctionEvaluator {
  return {
    resolveArg: resolve,
    getCellValue: () => null,
    currentSheet: "S",
    currentRow: 1,
    currentColIndex: 1,
  };
}

/** Each positional value becomes one argument, resolved via a fresh
 *  placeholder AST node keyed by identity (the node's own text doesn't
 *  matter). */
function callFn(name: string, ...values: CellValue[]): CellValue {
  const args = values.map((_, i) => parseFormula(String(i)));
  const byIndex = new Map(args.map((node, i) => [node, values[i]]));
  const ev = fakeEvaluator((node) => byIndex.get(node)!);
  return FUNCTION_REGISTRY[name](ev, args);
}

describe("IF", () => {
  it("returns the second argument when the condition is true", () => {
    expect(callFn("IF", true, "yes", "no")).toBe("yes");
  });

  it("defaults the missing branches to true/false rather than blank", () => {
    expect(callFn("IF", true)).toBe(true);
    expect(callFn("IF", false)).toBe(false);
  });

  it("propagates an error in the condition", () => {
    expect(callFn("IF", excelError("#VALUE!"), 1, 2)).toEqual(excelError("#VALUE!"));
  });
});

describe("AND", () => {
  it("is true when every argument is truthy", () => {
    expect(callFn("AND", true, true, true)).toBe(true);
  });

  it("is true with no arguments at all (empty walk never finds a false)", () => {
    expect(callFn("AND")).toBe(true);
  });

  it("propagates an error argument", () => {
    expect(callFn("AND", true, excelError("#VALUE!"))).toEqual(excelError("#VALUE!"));
  });

  it("short-circuits false as soon as one argument is falsy", () => {
    expect(callFn("AND", true, false, true)).toBe(false);
  });

  it("walks a nested resolved-range argument: a false among trues makes it false", () => {
    const range: CellValue[][] = [
      [true, true, false],
      [true, true, true],
    ];
    const args = [parseFormula("0")];
    const ev = fakeEvaluator(() => range);
    expect(FUNCTION_REGISTRY.AND(ev, args)).toBe(false);
  });
});

describe("OR", () => {
  it("is true when at least one argument is truthy", () => {
    expect(callFn("OR", false, false, true)).toBe(true);
  });

  it("is false with no arguments at all (empty walk never finds a true)", () => {
    expect(callFn("OR")).toBe(false);
  });

  it("propagates an error argument", () => {
    expect(callFn("OR", false, excelError("#VALUE!"))).toEqual(excelError("#VALUE!"));
  });

  it("short-circuits true as soon as one argument is truthy", () => {
    expect(callFn("OR", false, true, false)).toBe(true);
  });

  it("walks a nested resolved-range argument: a true among falses makes it true", () => {
    const range: CellValue[][] = [
      [false, false, true],
      [false, false, false],
    ];
    const args = [parseFormula("0")];
    const ev = fakeEvaluator(() => range);
    expect(FUNCTION_REGISTRY.OR(ev, args)).toBe(true);
  });
});

describe("NOT", () => {
  it("negates true", () => {
    expect(callFn("NOT", true)).toBe(false);
  });

  it("coerces a numeric zero to false, then negates it to true", () => {
    expect(callFn("NOT", 0)).toBe(true);
  });

  it("propagates an error argument", () => {
    expect(callFn("NOT", excelError("#VALUE!"))).toEqual(excelError("#VALUE!"));
  });
});

describe("IFERROR", () => {
  it("returns the value unchanged when it isn't an error", () => {
    expect(callFn("IFERROR", 5, 10)).toBe(5);
  });

  it("defaults the fallback to empty string when the second argument is missing", () => {
    expect(callFn("IFERROR", excelError("#VALUE!"))).toBe("");
  });

  it("catches any error code, not just one specific code", () => {
    expect(callFn("IFERROR", excelError("#DIV/0!"), "fallback")).toBe("fallback");
    expect(callFn("IFERROR", excelError("#N/A"), "fallback")).toBe("fallback");
  });
});

describe("IFNA", () => {
  it("returns the value unchanged when it isn't an error", () => {
    expect(callFn("IFNA", 5, 10)).toBe(5);
  });

  it("defaults the fallback to empty string when the second argument is missing", () => {
    expect(callFn("IFNA", excelError("#N/A"))).toBe("");
  });

  it("catches #N/A and returns the fallback", () => {
    expect(callFn("IFNA", excelError("#N/A"), "fallback")).toBe("fallback");
  });

  it("does NOT catch a non-#N/A error — it passes through unchanged", () => {
    expect(callFn("IFNA", excelError("#VALUE!"), "fallback")).toEqual(excelError("#VALUE!"));
  });
});

describe("ISBLANK", () => {
  it("is true for null", () => {
    expect(callFn("ISBLANK", null)).toBe(true);
  });

  it("is true for an empty string", () => {
    expect(callFn("ISBLANK", "")).toBe(true);
  });

  it("does not treat an error as blank, and does not propagate it", () => {
    expect(callFn("ISBLANK", excelError("#VALUE!"))).toBe(false);
  });
});

describe("ISERROR", () => {
  it("is true for an error value", () => {
    expect(callFn("ISERROR", excelError("#VALUE!"))).toBe(true);
  });

  it("is false for a plain value", () => {
    expect(callFn("ISERROR", 5)).toBe(false);
  });

  it("is true for any error code, and does not propagate it", () => {
    expect(callFn("ISERROR", excelError("#N/A"))).toBe(true);
  });
});

describe("ISNA", () => {
  it("is true for #N/A", () => {
    expect(callFn("ISNA", excelError("#N/A"))).toBe(true);
  });

  it("is false for a plain value", () => {
    expect(callFn("ISNA", 5)).toBe(false);
  });

  it("is false for a non-#N/A error, and does not propagate it", () => {
    expect(callFn("ISNA", excelError("#VALUE!"))).toBe(false);
  });
});

describe("ISNUMBER", () => {
  it("is true for a number", () => {
    expect(callFn("ISNUMBER", 5)).toBe(true);
  });

  it("is false for a numeric string", () => {
    expect(callFn("ISNUMBER", "5")).toBe(false);
  });

  it("is false for a boolean, and does not propagate an error argument", () => {
    expect(callFn("ISNUMBER", true)).toBe(false);
    expect(callFn("ISNUMBER", excelError("#VALUE!"))).toBe(false);
  });
});

describe("ISTEXT", () => {
  it("is true for a string", () => {
    expect(callFn("ISTEXT", "hello")).toBe(true);
  });

  it("is false for a number", () => {
    expect(callFn("ISTEXT", 5)).toBe(false);
  });

  it("is false for an error, and does not propagate it", () => {
    expect(callFn("ISTEXT", excelError("#VALUE!"))).toBe(false);
  });
});

describe("TRUE", () => {
  it("returns true", () => {
    expect(callFn("TRUE")).toBe(true);
  });

  it("ignores any arguments passed to it (real Excel takes none)", () => {
    expect(callFn("TRUE", 1, 2, 3)).toBe(true);
  });

  it("still returns true even if an argument would be an error", () => {
    expect(callFn("TRUE", excelError("#VALUE!"))).toBe(true);
  });
});

describe("FALSE", () => {
  it("returns false", () => {
    expect(callFn("FALSE")).toBe(false);
  });

  it("ignores any arguments passed to it (real Excel takes none)", () => {
    expect(callFn("FALSE", 1, 2, 3)).toBe(false);
  });

  it("still returns false even if an argument would be an error", () => {
    expect(callFn("FALSE", excelError("#VALUE!"))).toBe(false);
  });
});

describe("IFS", () => {
  it("returns the value paired with the first true condition", () => {
    expect(callFn("IFS", false, 1, true, 2, true, 3)).toBe(2);
  });

  it("is #N/A when no condition matches", () => {
    expect(callFn("IFS", false, 1, false, 2)).toEqual(excelError("#N/A"));
  });

  it("propagates an error in a condition", () => {
    expect(callFn("IFS", excelError("#VALUE!"), 1, true, 2)).toEqual(excelError("#VALUE!"));
  });
});

describe("SWITCH", () => {
  it("returns the result paired with the matching value", () => {
    expect(callFn("SWITCH", 2, 1, "one", 2, "two")).toBe("two");
  });

  it("falls back to the default when nothing matches", () => {
    expect(callFn("SWITCH", 3, 1, "one", 2, "two", "default")).toBe("default");
  });

  it("is #N/A with fewer than 3 total args, or no match and no default", () => {
    expect(callFn("SWITCH", 1, 2)).toEqual(excelError("#N/A"));
    expect(callFn("SWITCH", 3, 1, "one", 2, "two")).toEqual(excelError("#N/A"));
  });
});

describe("NA", () => {
  it("returns #N/A", () => {
    expect(callFn("NA")).toEqual(excelError("#N/A"));
  });

  it("ignores any arguments passed to it (real Excel takes none)", () => {
    expect(callFn("NA", 1, 2)).toEqual(excelError("#N/A"));
  });

  it("still returns #N/A even if an argument would itself be a different error", () => {
    expect(callFn("NA", excelError("#VALUE!"))).toEqual(excelError("#N/A"));
  });
});

describe("ISLOGICAL", () => {
  it("is true for a boolean", () => {
    expect(callFn("ISLOGICAL", true)).toBe(true);
  });

  it("is false for a number", () => {
    expect(callFn("ISLOGICAL", 1)).toBe(false);
  });

  it("is false for an error, and does not propagate it", () => {
    expect(callFn("ISLOGICAL", excelError("#VALUE!"))).toBe(false);
  });
});

describe("TYPE", () => {
  it("returns 1 for a number", () => {
    expect(callFn("TYPE", 5)).toBe(1);
  });

  it("returns 2 for text", () => {
    expect(callFn("TYPE", "hello")).toBe(2);
  });

  it("returns 16 for an error, rather than propagating it", () => {
    expect(callFn("TYPE", excelError("#VALUE!"))).toBe(16);
  });

  it("covers all five Excel type codes: number, text, logical, error, array", () => {
    expect(callFn("TYPE", 5)).toBe(1);
    expect(callFn("TYPE", "hello")).toBe(2);
    expect(callFn("TYPE", true)).toBe(4);
    expect(callFn("TYPE", excelError("#VALUE!"))).toBe(16);

    const range: CellValue[][] = [[1, 2, 3]];
    const args = [parseFormula("0")];
    const ev = fakeEvaluator(() => range);
    expect(FUNCTION_REGISTRY.TYPE(ev, args)).toBe(64);
  });
});
