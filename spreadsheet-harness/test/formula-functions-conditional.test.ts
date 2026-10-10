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
 *  matter). A value may itself be a 2D CellValue[][] range — these
 *  functions resolve their range arguments to arrays, not scalars, and
 *  CellValue[][] is itself a valid CellValue, so the same helper covers
 *  both scalar criteria args and 2D range args. */
function callFn(name: string, ...values: CellValue[]): CellValue {
  const args = values.map((_, i) => parseFormula(String(i)));
  const byIndex = new Map(args.map((node, i) => [node, values[i]]));
  const ev = fakeEvaluator((node) => byIndex.get(node)!);
  return FUNCTION_REGISTRY[name](ev, args);
}

describe("SUMIF", () => {
  it("sums matching cells against a numeric criteria (2-arg form)", () => {
    const range: CellValue[][] = [[10, 20, 30]];
    expect(callFn("SUMIF", range, ">15")).toBe(50); // 20 + 30
  });

  it("sums a separate sum-range where the criteria range matches a wildcard", () => {
    const range: CellValue[][] = [["Apple", "Excaliba Corp", "Banana"]];
    const sumRange: CellValue[][] = [[5, 10, 15]];
    expect(callFn("SUMIF", range, "*Excaliba*", sumRange)).toBe(10);
  });

  it("contributes nothing when no row matches", () => {
    const range: CellValue[][] = [[1, 2, 3]];
    expect(callFn("SUMIF", range, ">100")).toBe(0);
  });

  it("excludes a matching TRUE/FALSE cell entirely, rather than summing it as 1/0", () => {
    // conditional_funcs.py inlines `isinstance(sv, (int, float)) and not
    // isinstance(sv, bool)` at this exact aggregation site — confirmed via
    // the Task 7 oracle (public/samples/functions.xlsx rows 30-33).
    const range: CellValue[][] = [["A", "A", "A"]];
    const sumRange: CellValue[][] = [[10, true, -5]];
    expect(callFn("SUMIF", range, "A", sumRange)).toBe(5); // 10 + -5, TRUE excluded
  });

  it("propagates an error from a matched sum-range cell, rather than silently dropping it", () => {
    const range: CellValue[][] = [["A", "A", "A"]];
    const sumRange: CellValue[][] = [[10, excelError("#DIV/0!"), 5]];
    expect(callFn("SUMIF", range, "A", sumRange)).toEqual(excelError("#DIV/0!"));
  });

  it("does NOT propagate an error from a row that never matched the criteria in the first place", () => {
    const range: CellValue[][] = [["A", "B", "A"]];
    const sumRange: CellValue[][] = [[10, excelError("#DIV/0!"), 5]];
    expect(callFn("SUMIF", range, "A", sumRange)).toBe(15); // 10 + 5, the error's row (B) never matched
  });
});

describe("SUMIFS", () => {
  it("sums matching cells against a single numeric criteria", () => {
    const sumRange: CellValue[][] = [[10, 20, 30]];
    const critRange: CellValue[][] = [[1, 2, 3]];
    expect(callFn("SUMIFS", sumRange, critRange, ">1")).toBe(50); // 20 + 30
  });

  it("sums matching cells against a wildcard text criteria", () => {
    const sumRange: CellValue[][] = [[10, 20, 30]];
    const critRange: CellValue[][] = [["foo", "Excaliba Inc", "bar"]];
    expect(callFn("SUMIFS", sumRange, critRange, "*Excaliba*")).toBe(20);
  });

  it("contributes nothing when no row matches", () => {
    const sumRange: CellValue[][] = [[10, 20, 30]];
    const critRange: CellValue[][] = [[1, 2, 3]];
    expect(callFn("SUMIFS", sumRange, critRange, ">100")).toBe(0);
  });

  it("a row matching the first criteria but not the second does not count", () => {
    const sumRange: CellValue[][] = [[10, 20, 30]];
    const critRange1: CellValue[][] = [[1, 1, 2]];
    const critRange2: CellValue[][] = [["Yes", "No", "Yes"]];
    expect(callFn("SUMIFS", sumRange, critRange1, "=1", critRange2, "Yes")).toBe(10);
  });

  it("excludes a matching TRUE/FALSE cell entirely, rather than summing it as 1/0", () => {
    const sumRange: CellValue[][] = [[10, true, -5]];
    const critRange: CellValue[][] = [["A", "A", "A"]];
    expect(callFn("SUMIFS", sumRange, critRange, "A")).toBe(5);
  });

  it("propagates an error from a matched sum-range cell, rather than silently dropping it", () => {
    const sumRange: CellValue[][] = [[10, excelError("#NAME?"), 5]];
    const critRange: CellValue[][] = [["A", "A", "A"]];
    expect(callFn("SUMIFS", sumRange, critRange, "A")).toEqual(excelError("#NAME?"));
  });
});

describe("COUNTIF", () => {
  it("counts matches against a numeric criteria", () => {
    const range: CellValue[][] = [[5, 15, 25]];
    expect(callFn("COUNTIF", range, ">10")).toBe(2);
  });

  it("counts matches against a wildcard text criteria", () => {
    const range: CellValue[][] = [["cat", "catalog", "dog"]];
    expect(callFn("COUNTIF", range, "cat*")).toBe(2);
  });

  it("is 0 when no row matches", () => {
    const range: CellValue[][] = [[1, 2, 3]];
    expect(callFn("COUNTIF", range, ">100")).toBe(0);
  });

  it("parses the two-char '<>' operator before a bare '<', not as '<' followed by orphaned text", () => {
    const range: CellValue[][] = [[5, 5, 7]];
    expect(callFn("COUNTIF", range, "<>5")).toBe(1); // only the 7
  });
});

describe("COUNTIFS", () => {
  it("counts matches against a single numeric criteria", () => {
    const critRange: CellValue[][] = [[1, 2, 3]];
    expect(callFn("COUNTIFS", critRange, ">1")).toBe(2);
  });

  it("counts matches against a wildcard text criteria", () => {
    const critRange: CellValue[][] = [["foo", "Excaliba", "bar"]];
    expect(callFn("COUNTIFS", critRange, "*Excaliba*")).toBe(1);
  });

  it("is 0 when no row matches", () => {
    const critRange: CellValue[][] = [[1, 2, 3]];
    expect(callFn("COUNTIFS", critRange, ">100")).toBe(0);
  });

  it("a row matching the first criteria but not the second does not count", () => {
    const critRange1: CellValue[][] = [[1, 1, 2]];
    const critRange2: CellValue[][] = [["Yes", "No", "Yes"]];
    expect(callFn("COUNTIFS", critRange1, "=1", critRange2, "Yes")).toBe(1);
  });
});

describe("AVERAGEIF", () => {
  it("averages matching cells against a numeric criteria (2-arg form)", () => {
    const range: CellValue[][] = [[10, 20, 30]];
    expect(callFn("AVERAGEIF", range, ">15")).toBe(25); // (20+30)/2
  });

  it("averages a separate average-range where the criteria range matches a wildcard", () => {
    const range: CellValue[][] = [["foo", "Excaliba Co", "bar"]];
    const avgRange: CellValue[][] = [[10, 20, 30]];
    expect(callFn("AVERAGEIF", range, "*Excaliba*", avgRange)).toBe(20);
  });

  it("is #DIV/0! when no row matches", () => {
    const range: CellValue[][] = [[1, 2, 3]];
    expect(callFn("AVERAGEIF", range, ">100")).toEqual(excelError("#DIV/0!"));
  });

  it("excludes a matching TRUE/FALSE cell from both the sum and the count", () => {
    const range: CellValue[][] = [["A", "A", "A"]];
    const avgRange: CellValue[][] = [[10, true, -5]];
    expect(callFn("AVERAGEIF", range, "A", avgRange)).toBe(2.5); // (10-5)/2, TRUE excluded
  });

  it("propagates an error from a matched average-range cell, rather than silently dropping it", () => {
    const range: CellValue[][] = [["A", "A", "A"]];
    const avgRange: CellValue[][] = [[10, excelError("#DIV/0!"), 5]];
    expect(callFn("AVERAGEIF", range, "A", avgRange)).toEqual(excelError("#DIV/0!"));
  });
});

describe("AVERAGEIFS", () => {
  it("averages matching cells against a single numeric criteria", () => {
    const avgRange: CellValue[][] = [[10, 20, 30]];
    const critRange: CellValue[][] = [[1, 2, 3]];
    expect(callFn("AVERAGEIFS", avgRange, critRange, ">1")).toBe(25); // (20+30)/2
  });

  it("averages matching cells against a wildcard text criteria", () => {
    const avgRange: CellValue[][] = [[10, 20, 30]];
    const critRange: CellValue[][] = [["foo", "Excaliba", "bar"]];
    expect(callFn("AVERAGEIFS", avgRange, critRange, "*Excaliba*")).toBe(20);
  });

  it("is #DIV/0! when no row matches", () => {
    const avgRange: CellValue[][] = [[10, 20, 30]];
    const critRange: CellValue[][] = [[1, 2, 3]];
    expect(callFn("AVERAGEIFS", avgRange, critRange, ">100")).toEqual(excelError("#DIV/0!"));
  });

  it("a row matching the first criteria but not the second does not count", () => {
    const avgRange: CellValue[][] = [[10, 20, 30]];
    const critRange1: CellValue[][] = [[1, 1, 2]];
    const critRange2: CellValue[][] = [["Yes", "No", "Yes"]];
    expect(callFn("AVERAGEIFS", avgRange, critRange1, "=1", critRange2, "Yes")).toBe(10);
  });

  it("excludes a matching TRUE/FALSE cell from both the sum and the count", () => {
    const avgRange: CellValue[][] = [[10, true, -5]];
    const critRange: CellValue[][] = [["A", "A", "A"]];
    expect(callFn("AVERAGEIFS", avgRange, critRange, "A")).toBe(2.5);
  });

  it("propagates an error from a matched average-range cell, rather than silently dropping it", () => {
    const avgRange: CellValue[][] = [[10, excelError("#DIV/0!"), 5]];
    const critRange: CellValue[][] = [["A", "A", "A"]];
    expect(callFn("AVERAGEIFS", avgRange, critRange, "A")).toEqual(excelError("#DIV/0!"));
  });
});

describe("MAXIFS", () => {
  it("finds the max among matching cells against a single numeric criteria", () => {
    const maxRange: CellValue[][] = [[10, 20, 30]];
    const critRange: CellValue[][] = [[1, 2, 3]];
    expect(callFn("MAXIFS", maxRange, critRange, ">1")).toBe(30);
  });

  it("finds the max among matching cells against a wildcard text criteria", () => {
    const maxRange: CellValue[][] = [[10, 20, 30]];
    const critRange: CellValue[][] = [["foo", "Excaliba", "bar"]];
    expect(callFn("MAXIFS", maxRange, critRange, "*Excaliba*")).toBe(20);
  });

  it("defaults to 0 when no row matches", () => {
    const maxRange: CellValue[][] = [[10, 20, 30]];
    const critRange: CellValue[][] = [[1, 2, 3]];
    expect(callFn("MAXIFS", maxRange, critRange, ">100")).toBe(0);
  });

  it("a row matching the first criteria but not the second does not count", () => {
    const maxRange: CellValue[][] = [[10, 20, 30]];
    const critRange1: CellValue[][] = [[1, 1, 2]];
    const critRange2: CellValue[][] = [["Yes", "No", "Yes"]];
    expect(callFn("MAXIFS", maxRange, critRange1, "=1", critRange2, "Yes")).toBe(10);
  });

  it("excludes a matching TRUE cell — a bug that treated it as 1 would change the max", () => {
    // All-negative "A" group except the boolean, so TRUE-as-1 would win.
    const maxRange: CellValue[][] = [[-10, true, -5]];
    const critRange: CellValue[][] = [["A", "A", "A"]];
    expect(callFn("MAXIFS", maxRange, critRange, "A")).toBe(-5);
  });

  it("propagates an error from a matched max-range cell, rather than silently dropping it", () => {
    const maxRange: CellValue[][] = [[10, excelError("#DIV/0!"), 5]];
    const critRange: CellValue[][] = [["A", "A", "A"]];
    expect(callFn("MAXIFS", maxRange, critRange, "A")).toEqual(excelError("#DIV/0!"));
  });
});

describe("MINIFS", () => {
  it("finds the min among matching cells against a single numeric criteria", () => {
    const minRange: CellValue[][] = [[30, 20, 10]];
    const critRange: CellValue[][] = [[1, 2, 3]];
    expect(callFn("MINIFS", minRange, critRange, ">1")).toBe(10);
  });

  it("finds the min among matching cells against a wildcard text criteria", () => {
    const minRange: CellValue[][] = [[30, 20, 10]];
    const critRange: CellValue[][] = [["foo", "Excaliba", "bar"]];
    expect(callFn("MINIFS", minRange, critRange, "*Excaliba*")).toBe(20);
  });

  it("defaults to 0 when no row matches", () => {
    const minRange: CellValue[][] = [[30, 20, 10]];
    const critRange: CellValue[][] = [[1, 2, 3]];
    expect(callFn("MINIFS", minRange, critRange, ">100")).toBe(0);
  });

  it("a row matching the first criteria but not the second does not count", () => {
    const minRange: CellValue[][] = [[30, 20, 10]];
    const critRange1: CellValue[][] = [[1, 1, 2]];
    const critRange2: CellValue[][] = [["Yes", "No", "Yes"]];
    expect(callFn("MINIFS", minRange, critRange1, "=1", critRange2, "Yes")).toBe(30);
  });

  it("excludes a matching TRUE cell — a bug that treated it as 1 would change the min", () => {
    // All-positive "A" group except the boolean, so TRUE-as-1 would win.
    const minRange: CellValue[][] = [[10, true, 5]];
    const critRange: CellValue[][] = [["A", "A", "A"]];
    expect(callFn("MINIFS", minRange, critRange, "A")).toBe(5);
  });

  it("propagates an error from a matched min-range cell, rather than silently dropping it", () => {
    const minRange: CellValue[][] = [[10, excelError("#DIV/0!"), 5]];
    const critRange: CellValue[][] = [["A", "A", "A"]];
    expect(callFn("MINIFS", minRange, critRange, "A")).toEqual(excelError("#DIV/0!"));
  });
});
