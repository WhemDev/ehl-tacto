import { describe, expect, it } from "vitest";
import { excelError, isExcelError, type AstNode, type CellValue } from "@/lib/formula/ast";
import { DependencyGraph, makeKey, type CellKey } from "@/lib/formula/graph";
import { parseFormula } from "@/lib/formula/parser";
import { FUNCTION_REGISTRY } from "@/lib/formula/functions";
import {
  evalNode,
  extractRefs,
  recalculate,
  type CellOrigin,
  type EngineState,
  type FunctionRegistry,
} from "@/lib/formula/evaluate";
import type { FunctionEvaluator } from "@/lib/formula/evaluator-types";

const ORIGIN: CellOrigin = { sheet: "S", col: "Z", row: 99 };

function emptyState(): EngineState {
  return { formulas: new Map(), values: new Map(), graph: new DependencyGraph() };
}

function evalFormula(
  formula: string,
  state: EngineState = emptyState(),
  functions: FunctionRegistry = {},
  origin: CellOrigin = ORIGIN,
): CellValue {
  return evalNode(parseFormula(formula), origin, state, functions);
}

describe("evalNode — literals", () => {
  it("evaluates a number", () => expect(evalFormula("42")).toBe(42));
  it("evaluates a string", () => expect(evalFormula('"hi"')).toBe("hi"));
  it("evaluates a boolean", () => expect(evalFormula("TRUE")).toBe(true));
  it("evaluates an error literal to an ExcelErrorValue", () => {
    expect(evalFormula("#N/A")).toEqual(excelError("#N/A"));
  });
});

describe("evalNode — sheet-qualified dangling reference (#NAME?)", () => {
  // The five semantics fix4-ref-token.md sets out, exercised at the
  // evaluator level with the real FUNCTION_REGISTRY (not a hand-rolled
  // stub) so IFERROR/ISERROR here are the actual production functions.

  it("semantic 1 (unchanged): a bare error literal evaluates to its own error value and propagates", () => {
    expect(evalFormula("#REF!")).toEqual(excelError("#REF!"));
    expect(evalFormula("A1+#REF!")).toEqual(excelError("#REF!"));
  });

  it("semantic 2: Sheet!#REF! evaluates to #NAME?, not #REF! and not 0 — the real SpreadsheetBench 16_05_Ramjet shape", () => {
    expect(evalFormula("Assumptions!#REF!")).toEqual(excelError("#NAME?"));
  });

  it("semantic 2b: the #NAME? propagates through arithmetic like any other error", () => {
    expect(evalFormula("1+Sheet1!#REF!")).toEqual(excelError("#NAME?"));
  });

  it("semantic 3: IFERROR catches it through the same error channel as any other evaluation error", () => {
    expect(evalFormula("IFERROR(Assumptions!#REF!,0)", emptyState(), FUNCTION_REGISTRY)).toBe(0);
    expect(evalFormula("ISERROR(Assumptions!#REF!)", emptyState(), FUNCTION_REGISTRY)).toBe(true);
  });

  it("semantic 4 (unchanged): a cell whose VALUE is an error is unaffected — that's a stored value, not a syntax token", () => {
    const state = emptyState();
    state.values.set(makeKey("S", "A", 1), excelError("#VALUE!"));
    expect(evalFormula("A1", state)).toEqual(excelError("#VALUE!"));
  });

  it("semantic 5 (unchanged): does not regress an error literal used legitimately inside a function call", () => {
    // The untaken IF branch holding #N/A is never resolved — IF's own
    // short-circuit, unrelated to this fix, just proving it still holds.
    expect(evalFormula("IF(TRUE,1,#N/A)", emptyState(), FUNCTION_REGISTRY)).toBe(1);
  });
});

describe("evalNode — cell references", () => {
  it("reads a value already computed on the same sheet", () => {
    const state = emptyState();
    state.values.set(makeKey("S", "A", 1), 7);
    expect(evalFormula("A1", state)).toBe(7);
  });

  it("reads across an explicitly qualified sheet", () => {
    const state = emptyState();
    state.values.set(makeKey("OTHER", "A", 1), 9);
    expect(evalFormula("Other!A1", state)).toBe(9);
  });

  it("an unpopulated cell reads as blank, not an error", () => {
    expect(evalFormula("Z99", emptyState())).toBeNull();
  });
});

describe("evalNode — ranges", () => {
  it("resolves a range to a 2D array in row-major order", () => {
    const state = emptyState();
    state.values.set(makeKey("S", "A", 1), 1);
    state.values.set(makeKey("S", "B", 1), 2);
    state.values.set(makeKey("S", "A", 2), 3);
    state.values.set(makeKey("S", "B", 2), 4);
    expect(evalFormula("A1:B2", state)).toEqual([[1, 2], [3, 4]]);
  });

  describe("whole-column / whole-row (Fix B)", () => {
    it("resolves C:C against the sheet's real used extent from sheetBounds, not a placeholder", () => {
      const state = emptyState();
      state.sheetBounds = new Map([["S", { rows: 3, cols: 5 }]]);
      state.values.set(makeKey("S", "C", 1), 10);
      state.values.set(makeKey("S", "C", 2), 20);
      state.values.set(makeKey("S", "C", 3), 30);
      expect(evalFormula("C:C", state)).toEqual([[10], [20], [30]]);
    });

    it("resolves 3:3 against the sheet's real column extent", () => {
      const state = emptyState();
      state.sheetBounds = new Map([["S", { rows: 5, cols: 3 }]]);
      state.values.set(makeKey("S", "A", 3), 1);
      state.values.set(makeKey("S", "B", 3), 2);
      state.values.set(makeKey("S", "C", 3), 3);
      expect(evalFormula("3:3", state)).toEqual([[1, 2, 3]]);
    });

    it("falls back to DEFAULT_SHEET_BOUNDS (never Excel's 1,048,576-row max) when sheetBounds omits the sheet", () => {
      const state = emptyState(); // no sheetBounds at all
      state.values.set(makeKey("S", "A", 1), 7);
      const result = evalFormula("A:A", state) as unknown[][];
      expect(result.length).toBe(5000); // DEFAULT_SHEET_BOUNDS.rows
      expect(result[0]).toEqual([7]);
    });

    it("an empty whole-column range is all blanks, not an error", () => {
      const state = emptyState();
      state.sheetBounds = new Map([["S", { rows: 4, cols: 1 }]]);
      expect(evalFormula("A:A", state)).toEqual([[null], [null], [null], [null]]);
    });
  });
});

describe("evalNode — arithmetic", () => {
  it.each([
    ["1+2", 3], ["5-2", 3], ["3*4", 12], ["10/4", 2.5], ["2^3", 8],
  ])("%s = %s", (src, expected) => expect(evalFormula(src)).toBe(expected));

  it("division by zero is #DIV/0!", () => {
    expect(evalFormula("1/0")).toEqual(excelError("#DIV/0!"));
  });

  it("blank coerces to 0 in arithmetic", () => {
    expect(evalFormula("Z99+1", emptyState())).toBe(1);
  });

  it("unparseable text is #VALUE! in arithmetic", () => {
    expect(evalFormula('"abc"+1')).toEqual(excelError("#VALUE!"));
  });

  it("propagates an error from the left operand", () => {
    expect(evalFormula("#N/A+1")).toEqual(excelError("#N/A"));
  });

  it("propagates an error from the right operand", () => {
    expect(evalFormula("1+#N/A")).toEqual(excelError("#N/A"));
  });

  it("unary minus negates", () => {
    expect(evalFormula("-5")).toBe(-5);
  });

  it("percent divides by 100", () => {
    expect(evalFormula("50%")).toBe(0.5);
  });
});

describe("evalNode — concatenation and comparison", () => {
  it("& concatenates display strings", () => {
    expect(evalFormula('"a"&"b"')).toBe("ab");
    expect(evalFormula('1&2')).toBe("12");
  });

  it("delegates comparison operators to compareValues", () => {
    expect(evalFormula("1<2")).toBe(true);
    expect(evalFormula('"abc"="ABC"')).toBe(true); // case-insensitive, per compareValues
  });
});

describe("evalNode — function calls", () => {
  it("returns #NAME? for an unregistered function", () => {
    expect(evalFormula("NOPE(1)")).toEqual(excelError("#NAME?"));
  });

  it("invokes a registered function with an evaluator and the raw argument nodes", () => {
    const functions: FunctionRegistry = {
      DOUBLE: (ev, args) => {
        const v = ev.resolveArg(args[0]);
        return typeof v === "number" ? v * 2 : excelError("#VALUE!");
      },
    };
    expect(evalFormula("DOUBLE(21)", emptyState(), functions)).toBe(42);
  });

  it("a throwing function degrades that cell to #VALUE!, not a crash", () => {
    const functions: FunctionRegistry = {
      BOOM: () => {
        throw new Error("bug");
      },
    };
    expect(evalFormula("BOOM()", emptyState(), functions)).toEqual(excelError("#VALUE!"));
  });

  it("ROW()/COLUMN()-style probes see the ORIGIN cell, not any inner call frame", () => {
    // Mirrors the real ROW()/COLUMN() functions the next plan adds: they
    // read evaluator.currentRow/currentColIndex directly, with no argument.
    const probe: FunctionEvaluator["resolveArg"] = () => null;
    const functions: FunctionRegistry = {
      PROBE_ROW: (ev) => ev.currentRow,
      PROBE_COL: (ev) => ev.currentColIndex,
      WRAP: (ev, args) => ev.resolveArg(args[0]), // one level of nesting
    };
    void probe;
    const origin: CellOrigin = { sheet: "S", col: "C", row: 7 }; // C = column 3
    expect(evalFormula("PROBE_ROW()", emptyState(), functions, origin)).toBe(7);
    expect(evalFormula("PROBE_COL()", emptyState(), functions, origin)).toBe(3);
    expect(evalFormula("WRAP(PROBE_ROW())", emptyState(), functions, origin)).toBe(7);
  });
});

describe("extractRefs", () => {
  it("finds a single cell reference", () => {
    const refs = extractRefs(parseFormula("A1"), "S");
    expect(refs).toEqual(new Set([makeKey("S", "A", 1)]));
  });

  it("expands a range into every cell inside it", () => {
    const refs = extractRefs(parseFormula("A1:B2"), "S");
    expect(refs).toEqual(new Set([
      makeKey("S", "A", 1), makeKey("S", "B", 1),
      makeKey("S", "A", 2), makeKey("S", "B", 2),
    ]));
  });

  it("walks into both sides of a BinOp and function arguments", () => {
    const refs = extractRefs(parseFormula("SUM(A1,B1)+C1"), "S");
    expect(refs).toEqual(new Set([
      makeKey("S", "A", 1), makeKey("S", "B", 1), makeKey("S", "C", 1),
    ]));
  });

  it("contributes nothing for a literal", () => {
    expect(extractRefs(parseFormula('1+"x"+TRUE'), "S")).toEqual(new Set());
  });

  it("resolves an unqualified reference against the given default sheet", () => {
    const refs = extractRefs(parseFormula("A1"), "OTHER");
    expect(refs).toEqual(new Set([makeKey("OTHER", "A", 1)]));
  });

  describe("whole-column / whole-row (Fix B graph edges)", () => {
    it("expands C:C into every cell in the sheet's bounded column, so an edit anywhere in it is a real edge", () => {
      const bounds = new Map([["S", { rows: 3, cols: 1 }]]);
      const refs = extractRefs(parseFormula("C:C"), "S", bounds);
      expect(refs).toEqual(new Set([
        makeKey("S", "C", 1), makeKey("S", "C", 2), makeKey("S", "C", 3),
      ]));
    });

    it("expands 3:3 into every cell in the sheet's bounded row", () => {
      const bounds = new Map([["S", { rows: 1, cols: 3 }]]);
      const refs = extractRefs(parseFormula("3:3"), "S", bounds);
      expect(refs).toEqual(new Set([
        makeKey("S", "A", 3), makeKey("S", "B", 3), makeKey("S", "C", 3),
      ]));
    });

    it("without a sheetBounds argument, still expands using DEFAULT_SHEET_BOUNDS rather than throwing", () => {
      const refs = extractRefs(parseFormula("A:A"), "S");
      expect(refs.size).toBe(5000);
      expect(refs.has(makeKey("S", "A", 1))).toBe(true);
      expect(refs.has(makeKey("S", "A", 5000))).toBe(true);
    });
  });
});

describe("recalculate", () => {
  function setFormula(state: EngineState, key: CellKey, formula: string, sheet: string): void {
    const node = parseFormula(formula);
    state.formulas.set(key, node);
    state.graph.addFormulaCell(key, extractRefs(node, sheet));
  }

  it("evaluates a chain in dependency order", () => {
    const state = emptyState();
    state.values.set(makeKey("S", "A", 1), 10);
    setFormula(state, makeKey("S", "B", 1), "A1*2", "S");
    setFormula(state, makeKey("S", "C", 1), "B1+1", "S");
    state.graph.markAllDirty();
    recalculate(state, {});
    expect(state.values.get(makeKey("S", "B", 1))).toBe(20);
    expect(state.values.get(makeKey("S", "C", 1))).toBe(21);
  });

  it("assigns #CIRCULAR! to a cycle instead of crashing", () => {
    const state = emptyState();
    setFormula(state, makeKey("S", "A", 1), "B1+1", "S");
    setFormula(state, makeKey("S", "B", 1), "A1+1", "S");
    state.graph.markAllDirty();
    expect(() => recalculate(state, {})).not.toThrow();
    expect(state.values.get(makeKey("S", "A", 1))).toEqual(excelError("#CIRCULAR!"));
    expect(state.values.get(makeKey("S", "B", 1))).toEqual(excelError("#CIRCULAR!"));
  });

  it("clears dirty flags on every cell it touches, cycle or not", () => {
    const state = emptyState();
    setFormula(state, makeKey("S", "A", 1), "B1+1", "S");
    setFormula(state, makeKey("S", "B", 1), "A1+1", "S");
    state.graph.markAllDirty();
    recalculate(state, {});
    expect(state.graph.isDirty(makeKey("S", "A", 1))).toBe(false);
    expect(state.graph.isDirty(makeKey("S", "B", 1))).toBe(false);
  });

  it("a cell whose evalNode call itself throws degrades to #VALUE!, without crashing the whole recalculation or affecting any other cell", () => {
    // evalFuncCall already guards a throwing *function*; this proves
    // recalculate also guards a throw from evalNode's own dispatch — e.g. a
    // malformed AST node reaching the exhaustiveness-check `default` branch,
    // which unconditionally throws. That node type can never come out of the
    // real parser (parseFormula only ever produces the AstNode union), so it
    // is injected directly here, standing in for any other way evalNode's
    // own logic — not a called function — might one day throw.
    const state = emptyState();
    const bogusNode = { type: "bogus" } as unknown as AstNode;
    const bogusKey = makeKey("S", "A", 1);
    state.formulas.set(bogusKey, bogusNode);
    state.graph.addFormulaCell(bogusKey, new Set());

    // A perfectly ordinary formula cell, unrelated to the bogus one, in the
    // same recalculation pass — this is what proves the failure is per-cell.
    setFormula(state, makeKey("S", "B", 1), "1+1", "S");

    state.graph.markAllDirty();
    expect(() => recalculate(state, {})).not.toThrow();
    expect(state.values.get(bogusKey)).toEqual(excelError("#VALUE!"));
    expect(state.values.get(makeKey("S", "B", 1))).toBe(2);
  });
});

describe("recalculate — implicit intersection on a top-level bare range", () => {
  // The 20_02 bug: a bare range reference as a formula's TOP-LEVEL result in
  // an ordinary cell (e.g. `='Other'!C5:C6`) must apply Excel's implicit
  // intersection, not store the raw CellValue[][]. A NESTED occurrence of
  // the identical range (an argument to SUM, say) must be completely
  // unaffected — see the "no regression on a nested range" test below.
  function setFormula(state: EngineState, key: CellKey, formula: string, sheet: string): void {
    const node = parseFormula(formula);
    state.formulas.set(key, node);
    state.graph.addFormulaCell(key, extractRefs(node, sheet));
  }

  it("single-column range spanning the origin's row intersects to that row's cell (the 20_02 shape)", () => {
    const state = emptyState();
    state.values.set(makeKey("OTHER", "C", 5), 2024);
    state.values.set(makeKey("OTHER", "C", 6), 2025);
    // R5 on "Cost Drivers", row 5 — matches the range's first row (C5).
    setFormula(state, makeKey("COST DRIVERS", "R", 5), "Other!C5:C6", "Cost Drivers");
    state.graph.markAllDirty();
    recalculate(state, {});
    expect(state.values.get(makeKey("COST DRIVERS", "R", 5))).toBe(2024);
  });

  it("single-column range spanning a DIFFERENT row of the origin intersects to that row's cell, not always the first", () => {
    const state = emptyState();
    state.values.set(makeKey("OTHER", "C", 5), 2024);
    state.values.set(makeKey("OTHER", "C", 6), 2025);
    // R6 this time — matches the range's second row (C6).
    setFormula(state, makeKey("COST DRIVERS", "R", 6), "Other!C5:C6", "Cost Drivers");
    state.graph.markAllDirty();
    recalculate(state, {});
    expect(state.values.get(makeKey("COST DRIVERS", "R", 6))).toBe(2025);
  });

  it("single-row range spanning the origin's column intersects to that column's cell", () => {
    const state = emptyState();
    state.values.set(makeKey("OTHER", "C", 5), 2024);
    state.values.set(makeKey("OTHER", "D", 5), 2025);
    // Formula cell in column D — matches the range's second column (D5).
    setFormula(state, makeKey("COST DRIVERS", "D", 10), "Other!C5:D5", "Cost Drivers");
    state.graph.markAllDirty();
    recalculate(state, {});
    expect(state.values.get(makeKey("COST DRIVERS", "D", 10))).toBe(2025);
  });

  it("a range that intersects on neither axis (and isn't 1x1) is #VALUE!", () => {
    const state = emptyState();
    state.values.set(makeKey("OTHER", "C", 5), 2024);
    state.values.set(makeKey("OTHER", "C", 6), 2025);
    // Origin row 1 falls outside the range's rows 5-6 — a single-column
    // range, but not spanning this formula cell's own row.
    setFormula(state, makeKey("S", "A", 1), "Other!C5:C6", "S");
    state.graph.markAllDirty();
    recalculate(state, {});
    expect(state.values.get(makeKey("S", "A", 1))).toEqual(excelError("#VALUE!"));
  });

  it("a multi-row, multi-column range is always #VALUE! regardless of origin position", () => {
    const state = emptyState();
    state.values.set(makeKey("OTHER", "C", 5), 1);
    state.values.set(makeKey("OTHER", "D", 5), 2);
    state.values.set(makeKey("OTHER", "C", 6), 3);
    state.values.set(makeKey("OTHER", "D", 6), 4);
    setFormula(state, makeKey("S", "C", 5), "Other!C5:D6", "S");
    state.graph.markAllDirty();
    recalculate(state, {});
    expect(state.values.get(makeKey("S", "C", 5))).toEqual(excelError("#VALUE!"));
  });

  it("a 1x1 range is returned directly regardless of the origin's position", () => {
    const state = emptyState();
    state.values.set(makeKey("OTHER", "C", 5), 42);
    // Origin at Z99 — nowhere near C5 on either axis.
    setFormula(state, makeKey("S", "Z", 99), "Other!C5:C5", "S");
    state.graph.markAllDirty();
    recalculate(state, {});
    expect(state.values.get(makeKey("S", "Z", 99))).toBe(42);
  });

  it("no regression on a nested range: SUM still aggregates the full range, not the intersected single value", () => {
    const state = emptyState();
    state.values.set(makeKey("OTHER", "C", 5), 2024);
    state.values.set(makeKey("OTHER", "C", 6), 2025);
    setFormula(state, makeKey("S", "A", 5), "SUM(Other!C5:C6)", "S");
    state.graph.markAllDirty();
    recalculate(state, FUNCTION_REGISTRY);
    // 2024 + 2025, not 2024 (the intersected single value) — proves the
    // inner rangeRef inside SUM's argument still receives the full array
    // via evalNode directly, unaffected by commitValue's top-level-only
    // post-processing.
    expect(state.values.get(makeKey("S", "A", 5))).toBe(4049);
  });

  it("a bare non-rangeRef array result (e.g. OFFSET used directly, height/width > 1) collapses via [0][0], matching benchValueFrom/formatPreviewValue's established convention", () => {
    const state = emptyState();
    state.values.set(makeKey("S", "B", 1), 10);
    state.values.set(makeKey("S", "C", 1), 20);
    state.values.set(makeKey("S", "B", 2), 30);
    state.values.set(makeKey("S", "C", 2), 40);
    // A stand-in for a function returning a 2D block directly (like
    // lookup.ts's real offset() does for height/width > 1) — what matters
    // here is only that a non-rangeRef root returning CellValue[][] takes
    // [0][0], not that this is literally OFFSET.
    const BLOCK: FunctionRegistry = {
      BLOCK: (ev) => [
        [ev.getCellValue("S", "B", 1), ev.getCellValue("S", "C", 1)],
        [ev.getCellValue("S", "B", 2), ev.getCellValue("S", "C", 2)],
      ],
    };
    setFormula(state, makeKey("S", "D", 1), "BLOCK()", "S");
    state.graph.markAllDirty();
    recalculate(state, BLOCK);
    expect(state.values.get(makeKey("S", "D", 1))).toBe(10); // [0][0], not #VALUE!
  });

  it("cyclic path (resolveCyclesIteratively) also applies implicit intersection at every pass, not just the raw array", () => {
    // A1 = 'B1:B2' (single column, origin row 1 -> intersects to B1);
    // B1 = A1*0.5+10 depends back on A1, forming a genuine cycle. This is a
    // contraction (each pass halves the remaining gap to the fixed point
    // A1=B1=20), so Gauss-Seidel converges instead of hitting the
    // non-convergent-guard — proving commitValue (and its intersection
    // post-processing) runs on every iterative pass, not only the ordinary
    // acyclic path.
    const state = emptyState();
    state.values.set(makeKey("S", "B", 2), 999); // unused by the intersection, just fills the range
    setFormula(state, makeKey("S", "A", 1), "B1:B2", "S");
    setFormula(state, makeKey("S", "B", 1), "A1*0.5+10", "S");
    state.graph.markAllDirty();
    recalculate(state, {}, { maxIterations: 100, maxChange: 0.001 });
    expect(state.values.get(makeKey("S", "A", 1))).toBeCloseTo(20, 1);
    expect(state.values.get(makeKey("S", "B", 1))).toBeCloseTo(20, 1);
  });
});

describe("reportResolvedRange / dynamic edges (Fix A plumbing)", () => {
  // A stand-in for OFFSET: it doesn't matter WHICH function calls
  // reportResolvedRange, only that evalFuncCall wires the hook to the
  // evaluating cell's own key and that graph.ts's dynamic maps pick it up —
  // lookup.ts's actual offset() is covered end-to-end in
  // formula-simulate.test.ts instead.
  const REPORTS_A1: FunctionRegistry = {
    REPORTS_A1: (ev) => {
      ev.reportResolvedRange?.("S", 1, 1, 0, 0); // A1, 0-based col
      return ev.getCellValue("S", "A", 1);
    },
  };

  function setFormula(state: EngineState, key: CellKey, formula: string, sheet: string): void {
    const node = parseFormula(formula);
    state.formulas.set(key, node);
    state.graph.addFormulaCell(key, extractRefs(node, sheet));
  }

  it("evalFuncCall registers a dynamic precedent edge on the evaluating cell, not a static one", () => {
    const state = emptyState();
    state.values.set(makeKey("S", "A", 1), 5);
    setFormula(state, makeKey("S", "B", 1), "REPORTS_A1()", "S");
    // No static walkRefs edge exists yet — REPORTS_A1() has no argument refs.
    expect(state.graph.precedentsOf(makeKey("S", "B", 1))).toEqual([]);

    state.graph.markAllDirty();
    recalculate(state, REPORTS_A1);

    expect(state.values.get(makeKey("S", "B", 1))).toBe(5);
    expect(state.graph.precedentsOf(makeKey("S", "B", 1))).toEqual([makeKey("S", "A", 1)]);
  });

  it("a subsequent edit to the dynamically-referenced cell now dirties the consumer", () => {
    const state = emptyState();
    state.values.set(makeKey("S", "A", 1), 5);
    setFormula(state, makeKey("S", "B", 1), "REPORTS_A1()", "S");
    state.graph.markAllDirty();
    recalculate(state, REPORTS_A1); // primes the dynamic edge

    state.graph.clearAllDirty();
    state.graph.markDirty(makeKey("S", "A", 1));
    expect(state.graph.isDirty(makeKey("S", "B", 1))).toBe(true);
  });

  it("does nothing for a cell that isn't a known formula cell (defensive no-op)", () => {
    const state = emptyState();
    // Call reportResolvedRange's underlying mechanism directly, via a
    // function evaluated with evalNode but never installed via
    // addFormulaCell — origin key "S!Z9" is not in the graph's formulaCells.
    const result = evalFormula("REPORTS_A1()", state, REPORTS_A1, { sheet: "S", col: "Z", row: 9 });
    expect(result).toBeNull(); // A1 was never set
    expect(state.graph.precedentsOf(makeKey("S", "Z", 9))).toEqual([]);
  });
});
