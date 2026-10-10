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
 *  both scalar args and 2D range args. */
function callFn(name: string, ...values: CellValue[]): CellValue {
  const args = values.map((_, i) => parseFormula(String(i)));
  const byIndex = new Map(args.map((node, i) => [node, values[i]]));
  const ev = fakeEvaluator((node) => byIndex.get(node)!);
  return FUNCTION_REGISTRY[name](ev, args);
}

describe("VLOOKUP", () => {
  const table: CellValue[][] = [
    [1, "Bronze", 0.01],
    [10, "Silver", 0.05],
    [100, "Gold", 0.1],
  ];

  it("finds an exact match (range_lookup = FALSE)", () => {
    expect(callFn("VLOOKUP", 10, table, 2, false)).toBe("Silver");
  });

  it("is #N/A when no row exactly matches", () => {
    expect(callFn("VLOOKUP", 5, table, 2, false)).toEqual(excelError("#N/A"));
  });

  it("approximate match lands on the last row whose key is <= the lookup value", () => {
    // 50 falls between the 10 and 100 rows; the 10 row is the answer.
    expect(callFn("VLOOKUP", 50, table, 2)).toBe("Silver");
  });

  it("approximate match below the smallest key is #N/A", () => {
    expect(callFn("VLOOKUP", 0, table, 2)).toEqual(excelError("#N/A"));
  });

  it("is #REF! when col_index is beyond the table's width", () => {
    expect(callFn("VLOOKUP", 10, table, 5, false)).toEqual(excelError("#REF!"));
  });
});

describe("HLOOKUP", () => {
  const table: CellValue[][] = [
    [1, 10, 100],
    ["Bronze", "Silver", "Gold"],
    [0.01, 0.05, 0.1],
  ];

  it("finds an exact match (range_lookup = FALSE)", () => {
    expect(callFn("HLOOKUP", 10, table, 2, false)).toBe("Silver");
  });

  it("is #N/A when no column exactly matches", () => {
    expect(callFn("HLOOKUP", 5, table, 2, false)).toEqual(excelError("#N/A"));
  });

  it("approximate match lands on the last column whose key is <= the lookup value", () => {
    expect(callFn("HLOOKUP", 50, table, 3)).toBe(0.05);
  });

  it("is #REF! when row_index is beyond the table's height", () => {
    expect(callFn("HLOOKUP", 10, table, 5, false)).toEqual(excelError("#REF!"));
  });
});

describe("INDEX", () => {
  const array: CellValue[][] = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ];

  it("does a normal (row, col) lookup", () => {
    expect(callFn("INDEX", array, 2, 3)).toBe(6);
  });

  it("row = 0 returns the whole column", () => {
    expect(callFn("INDEX", array, 0, 2)).toEqual([[2], [5], [8]]);
  });

  it("col = 0 returns the whole row", () => {
    expect(callFn("INDEX", array, 2, 0)).toEqual([[4, 5, 6]]);
  });

  it("is #REF! when the row is out of range", () => {
    expect(callFn("INDEX", array, 10, 1)).toEqual(excelError("#REF!"));
  });
});

describe("MATCH", () => {
  it("match_type 0: exact match", () => {
    const arr: CellValue[][] = [["a", "b", "c"]];
    expect(callFn("MATCH", "b", arr, 0)).toBe(2);
  });

  it("match_type 0: not found is #N/A", () => {
    const arr: CellValue[][] = [["a", "b", "c"]];
    expect(callFn("MATCH", "z", arr, 0)).toEqual(excelError("#N/A"));
  });

  it("match_type 1: ascending approximate match (largest value <= lookup)", () => {
    const arr: CellValue[][] = [[1, 10, 100]];
    expect(callFn("MATCH", 50, arr, 1)).toBe(2); // lands on 10
  });

  it("match_type -1: descending approximate match (smallest value >= lookup)", () => {
    const arr: CellValue[][] = [[100, 60, 10]];
    expect(callFn("MATCH", 50, arr, -1)).toBe(2); // lands on 60, the smallest value still >= 50
  });

  it("defaults match_type to 1 (ascending approximate) when omitted", () => {
    const arr: CellValue[][] = [[1, 10, 100]];
    expect(callFn("MATCH", 50, arr)).toBe(2);
  });
});

describe("CHOOSE", () => {
  it("index 1 selects the first option", () => {
    expect(callFn("CHOOSE", 1, "first", "second", "third")).toBe("first");
  });

  it("selects a middle option", () => {
    expect(callFn("CHOOSE", 2, "first", "second", "third")).toBe("second");
  });

  it("an out-of-range index is #VALUE!", () => {
    expect(callFn("CHOOSE", 5, "first", "second", "third")).toEqual(excelError("#VALUE!"));
  });

  it("index 0 is out of range and is #VALUE!", () => {
    expect(callFn("CHOOSE", 0, "first", "second", "third")).toEqual(excelError("#VALUE!"));
  });
});

describe("ROW", () => {
  it("with an explicit cell-reference argument, returns that cell's own row", () => {
    const ev = fakeEvaluator(() => null);
    const args = [parseFormula("A5")]; // real CellRef node, not in the resolve map
    expect(FUNCTION_REGISTRY.ROW(ev, args)).toBe(5);
  });

  it("with a range-reference argument, returns the range's start row", () => {
    const ev = fakeEvaluator(() => null);
    const args = [parseFormula("A5:C10")]; // real RangeRef node
    expect(FUNCTION_REGISTRY.ROW(ev, args)).toBe(5);
  });

  it("with no argument, returns the evaluator's current row", () => {
    const ev: FunctionEvaluator = {
      resolveArg: () => null,
      getCellValue: () => null,
      currentSheet: "S",
      currentRow: 7,
      currentColIndex: 1,
    };
    expect(FUNCTION_REGISTRY.ROW(ev, [])).toBe(7);
  });
});

describe("COLUMN", () => {
  it("with an explicit cell-reference argument, returns that cell's own column", () => {
    const ev = fakeEvaluator(() => null);
    const args = [parseFormula("C5")]; // column C -> 3
    expect(FUNCTION_REGISTRY.COLUMN(ev, args)).toBe(3);
  });

  it("with a range-reference argument, returns the range's start column", () => {
    const ev = fakeEvaluator(() => null);
    const args = [parseFormula("C5:E10")]; // starts at column C -> 3
    expect(FUNCTION_REGISTRY.COLUMN(ev, args)).toBe(3);
  });

  it("with no argument, returns the evaluator's current column index", () => {
    const ev: FunctionEvaluator = {
      resolveArg: () => null,
      getCellValue: () => null,
      currentSheet: "S",
      currentRow: 1,
      currentColIndex: 4,
    };
    expect(FUNCTION_REGISTRY.COLUMN(ev, [])).toBe(4);
  });
});

describe("ROWS", () => {
  it("counts the rows in a 2D range", () => {
    const range: CellValue[][] = [[1, 2], [3, 4], [5, 6]];
    expect(callFn("ROWS", range)).toBe(3);
  });

  it("a scalar counts as 1 row", () => {
    expect(callFn("ROWS", 42)).toBe(1);
  });
});

describe("COLUMNS", () => {
  it("counts the columns in a 2D range", () => {
    const range: CellValue[][] = [[1, 2, 3], [4, 5, 6]];
    expect(callFn("COLUMNS", range)).toBe(3);
  });

  it("a scalar counts as 1 column", () => {
    expect(callFn("COLUMNS", 42)).toBe(1);
  });
});

describe("OFFSET", () => {
  it("shifts by row/col offsets and reads the single resulting cell", () => {
    const base = parseFormula("B2"); // col B (index 1), row 2
    const rowOffNode = parseFormula("100"); // placeholder text, identity is what matters
    const colOffNode = parseFormula("101");
    const cells: Record<string, CellValue> = { "S!C3": 42 };
    const ev: FunctionEvaluator = {
      resolveArg: (node) => {
        if (node === rowOffNode) return 1;
        if (node === colOffNode) return 1;
        return null;
      },
      getCellValue: (sheet, col, row) => cells[`${sheet}!${col}${row}`] ?? null,
      currentSheet: "S",
      currentRow: 1,
      currentColIndex: 1,
    };
    // OFFSET(B2, 1, 1) -> C3
    expect(FUNCTION_REGISTRY.OFFSET(ev, [base, rowOffNode, colOffNode])).toBe(42);
  });

  it("height/width > 1 returns a 2D block of shifted cells", () => {
    const base = parseFormula("A1"); // col A (index 0), row 1
    const rowOffNode = parseFormula("100");
    const colOffNode = parseFormula("101");
    const heightNode = parseFormula("102");
    const widthNode = parseFormula("103");
    const grid: Record<string, CellValue> = {
      "S!A1": 1, "S!B1": 2,
      "S!A2": 3, "S!B2": 4,
    };
    const ev: FunctionEvaluator = {
      resolveArg: (node) => {
        if (node === rowOffNode) return 0;
        if (node === colOffNode) return 0;
        if (node === heightNode) return 2;
        if (node === widthNode) return 2;
        return null;
      },
      getCellValue: (sheet, col, row) => grid[`${sheet}!${col}${row}`] ?? null,
      currentSheet: "S",
      currentRow: 1,
      currentColIndex: 1,
    };
    expect(FUNCTION_REGISTRY.OFFSET(ev, [base, rowOffNode, colOffNode, heightNode, widthNode])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("is #REF! when the shifted position goes negative", () => {
    const base = parseFormula("A1"); // col A (index 0), row 1
    const rowOffNode = parseFormula("100");
    const colOffNode = parseFormula("101");
    const ev: FunctionEvaluator = {
      resolveArg: (node) => {
        if (node === rowOffNode) return -5; // row would go to -4
        if (node === colOffNode) return 0;
        return null;
      },
      getCellValue: () => null,
      currentSheet: "S",
      currentRow: 1,
      currentColIndex: 1,
    };
    expect(FUNCTION_REGISTRY.OFFSET(ev, [base, rowOffNode, colOffNode])).toEqual(excelError("#REF!"));
  });

  it("is #REF! when the base argument isn't a cell reference", () => {
    const base = parseFormula("5"); // number literal, not a CellRef
    const rowOffNode = parseFormula("100");
    const colOffNode = parseFormula("101");
    const ev: FunctionEvaluator = {
      resolveArg: (node) => {
        if (node === rowOffNode) return 0;
        if (node === colOffNode) return 0;
        return null;
      },
      getCellValue: () => null,
      currentSheet: "S",
      currentRow: 1,
      currentColIndex: 1,
    };
    expect(FUNCTION_REGISTRY.OFFSET(ev, [base, rowOffNode, colOffNode])).toEqual(excelError("#REF!"));
  });
});
