import { describe, expect, it } from "vitest";
import { createSimulator } from "@/lib/formula/simulate";
import { parseWorkbook, type ParsedWorkbook } from "@/lib/workbook";
import {
  AnalysisError,
  lookupDefinedNames,
  readRange,
  searchCells,
  traceCell,
} from "@/lib/analysis/tools";
import { chainWb, xlsxBytes, type CellSpec } from "./helpers/workbooks";

describe("simulator graph queries", () => {
  it("answers precedents and dependents by cell address", () => {
    const sim = createSimulator(chainWb());
    expect(sim.precedentsOf("Calc", "B1")).toEqual(["CALC!A1"]);
    expect(sim.dependentsOf("Calc", "B1")).toEqual(["CALC!C1"]);
    expect(sim.precedentsOf("Calc", "A1")).toEqual([]);
    expect(sim.dependentsOf("Calc", "C1")).toEqual([]);
  });
});

describe("readRange", () => {
  it("renders formulas and values inside the requested range", () => {
    const wb = chainWb();
    const res = readRange(wb, "Calc", "A1:C1");
    expect(res.truncated).toBe(false);
    expect(res.text).toContain("A1=10");
    expect(res.text).toContain("B1={=A1*2 -> 20}");
    expect(res.text).toContain("C1={=B1+5 -> 25}");
  });

  it("resolves sheet names case-insensitively", () => {
    expect(readRange(chainWb(), "calc", "A1").text).toContain("A1=10");
  });

  it("throws a model-facing error for unknown sheets", () => {
    expect(() => readRange(chainWb(), "Nope", "A1")).toThrow(AnalysisError);
    expect(() => readRange(chainWb(), "Nope", "A1")).toThrow(/must be one of: Calc/);
  });

  it("throws a model-facing error for unparseable ranges", () => {
    expect(() => readRange(chainWb(), "Calc", "not-a-range")).toThrow(AnalysisError);
  });

  it("truncates at the character cap and says so", () => {
    const big: (string | number)[][] = Array.from({ length: 200 }, (_, r) =>
      Array.from({ length: 20 }, (_, c) => `row${r}col${c}-padding-padding`),
    );
    const wb = parseWorkbook(xlsxBytes({ Big: big as CellSpec[][] }), "big.xlsx");
    const res = readRange(wb, "Big", "A1:T200", 2_000);
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBeLessThanOrEqual(2_400);
    expect(res.text).toMatch(/cut for length/);
  });
});

describe("searchCells", () => {
  function searchWb(): ParsedWorkbook {
    return parseWorkbook(
      xlsxBytes({
        P1: [["Total Revenue", 100], ["Costs", { f: "SUM(B1:B1)", v: 100 }]],
        P2: [["Revenue Total", 7]],
      }),
      "search.xlsx",
    );
  }

  it("matches display text case-insensitively across sheets", () => {
    const res = searchCells(searchWb(), "total revenue");
    expect(res.matches).toEqual([
      { sheet: "P1", cell: "A1", text: "Total Revenue" },
    ]);
  });

  it("matches formula text too", () => {
    const res = searchCells(searchWb(), "SUM(");
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0]).toMatchObject({ sheet: "P1", cell: "B2", formula: "SUM(B1:B1)" });
  });

  it("restricts to named sheets and caps at the limit", () => {
    const res = searchCells(searchWb(), "e", { sheets: ["P2"], limit: 1 });
    expect(res.matches.every((m) => m.sheet === "P2")).toBe(true);
    expect(res.matches).toHaveLength(1);
  });
});

describe("lookupDefinedNames", () => {
  it("filters by substring and reports the total", () => {
    const wb = chainWb();
    wb.definedNames = [
      { name: "TaxRate", ref: "Calc!$A$1" },
      { name: "GrowthRate", ref: "Calc!$B$1" },
      { name: "Other", ref: "Calc!$C$1" },
    ];
    const res = lookupDefinedNames(wb, "rate");
    expect(res.names.map((n) => n.name)).toEqual(["TaxRate", "GrowthRate"]);
    expect(res.total).toBe(2);
  });
});

describe("traceCell", () => {
  it("walks one and two hops in both directions", () => {
    const sim = createSimulator(chainWb());
    expect(traceCell(sim, "Calc", "C1", "precedents", 1).levels).toEqual([["CALC!B1"]]);
    expect(traceCell(sim, "Calc", "C1", "precedents", 2).levels).toEqual([
      ["CALC!B1"],
      ["CALC!A1"],
    ]);
    expect(traceCell(sim, "Calc", "A1", "dependents", 2).levels).toEqual([
      ["CALC!B1"],
      ["CALC!C1"],
    ]);
  });

  it("rejects bad directions with a model-facing error", () => {
    const sim = createSimulator(chainWb());
    expect(() =>
      traceCell(sim, "Calc", "C1", "sideways" as "precedents", 1),
    ).toThrow(AnalysisError);
  });
});
