import { describe, expect, it } from "vitest";
import {
  applyEditPlan,
  appliedPlanReader,
  cellIsAffected,
  makeEditPlanSchema,
  type CellEditPlan,
} from "@/lib/bench/edits";
import { cellKey, type GridCell, type ParsedSheet, type ParsedWorkbook } from "@/lib/workbook";

function sheetOf(
  name: string,
  cells: Record<string, { v?: unknown; f?: string; uncalculated?: boolean }>,
): ParsedSheet {
  const map = new Map<string, GridCell>();
  let rows = 1;
  let cols = 1;
  for (const [ref, spec] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    const col = m[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const row = Number(m[2]) - 1;
    rows = Math.max(rows, row + 1);
    cols = Math.max(cols, col + 1);
    map.set(cellKey(row, col), {
      row,
      col,
      value: spec.v ?? null,
      text: String(spec.v ?? ""),
      type: typeof spec.v === "number" ? "number" : "text",
      formula: spec.f,
      uncalculated: spec.uncalculated,
    });
  }
  return {
    name,
    rows,
    cols,
    totalRows: rows,
    totalCols: cols,
    truncated: false,
    cells: map,
    merges: [],
    colWidths: [],
  };
}

function workbookOf(sheets: ParsedSheet[]): ParsedWorkbook {
  return { id: "wb", fileName: "wb.xlsx", sheets, definedNames: [] };
}

const wb = () =>
  workbookOf([
    sheetOf("Data", { A1: { v: "Qty" }, A2: { v: 2 }, A3: { v: 3 }, B1: { v: "Price" }, B2: { v: 10 }, B3: { v: 20 } }),
  ]);

describe("makeEditPlanSchema", () => {
  const schema = makeEditPlanSchema(wb());

  it("accepts a well-formed plan and defaults optional fields", () => {
    const parsed = schema.parse({
      edits: [{ sheet: "Data", range: "C2:C3", formula: "=A2*B2" }],
    });
    expect(parsed.newSheets).toEqual([]);
    expect(parsed.notes).toBe("");
  });

  it("resolves sheet names case-insensitively but rejects unknown ones", () => {
    expect(schema.safeParse({ edits: [{ sheet: "data", range: "C2", value: 1 }] }).success).toBe(true);
    const bad = schema.safeParse({ edits: [{ sheet: "Sales", range: "C2", value: 1 }] });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.success ? "" : bad.error.issues)).toContain("unknown sheet");
  });

  it("allows edits on declared new sheets only", () => {
    expect(
      schema.safeParse({
        edits: [{ sheet: "Summary", range: "A1", value: "Total" }],
        newSheets: ["Summary"],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ edits: [{ sheet: "Summary", range: "A1", value: "Total" }] }).success,
    ).toBe(false);
  });

  it("rejects unbounded and unparseable ranges", () => {
    expect(schema.safeParse({ edits: [{ sheet: "Data", range: "C:C", value: 1 }] }).success).toBe(false);
    expect(schema.safeParse({ edits: [{ sheet: "Data", range: "2:2", value: 1 }] }).success).toBe(false);
    expect(schema.safeParse({ edits: [{ sheet: "Data", range: "the total column", value: 1 }] }).success).toBe(false);
  });

  it("requires exactly one action per edit", () => {
    expect(schema.safeParse({ edits: [{ sheet: "Data", range: "C2" }] }).success).toBe(false);
    expect(
      schema.safeParse({ edits: [{ sheet: "Data", range: "C2", value: 1, formula: "=A1" }] }).success,
    ).toBe(false);
    expect(schema.safeParse({ edits: [{ sheet: "Data", range: "C2", clear: true }] }).success).toBe(true);
  });

  it("checks the shape of an explicit values grid", () => {
    expect(
      schema.safeParse({
        edits: [{ sheet: "Data", range: "C2:D3", values: [[1, 2], [3, 4]] }],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        edits: [{ sheet: "Data", range: "C2:D3", values: [[1, 2, 5], [3, 4, 6]] }],
      }).success,
    ).toBe(false);
  });

  it("caps the total number of edited cells", () => {
    const big = schema.safeParse({
      edits: [
        { sheet: "Data", range: "A1:CV600", value: 0 }, // 100 cols × 600 rows = 60k
      ],
    });
    expect(big.success).toBe(false);
    expect(JSON.stringify(big.success ? "" : big.error.issues)).toContain("ceiling");
  });
});

describe("applyEditPlan", () => {
  const plan = (edits: CellEditPlan["edits"], rest?: Partial<CellEditPlan>): CellEditPlan => ({
    edits,
    newSheets: [],
    notes: "",
    ...rest,
  });

  it("fills a formula down a range with shifted references", async () => {
    const state = await applyEditPlan(wb(), plan([
      { sheet: "Data", range: "C2:C3", formula: "=A2*B2" },
    ]));
    expect(state.sim.getValue("Data", "C2")).toBe(20);
    expect(state.sim.getValue("Data", "C3")).toBe(60);
    expect(state.editedFormulas.get("Data")?.get("C3")).toBe("A3*B3");
    expect(state.formulaParseFailures).toEqual([]);
    expect(state.unsupportedFunctions).toEqual([]);
  });

  it("recalculates existing formulas that depend on edited cells", async () => {
    const book = workbookOf([
      sheetOf("Data", { A1: { v: 5 }, B1: { f: "A1*2", v: 10 } }),
    ]);
    const state = await applyEditPlan(book, plan([
      { sheet: "Data", range: "A1", value: 7 },
    ]));
    expect(state.sim.getValue("Data", "B1")).toBe(14);
  });

  it("writes scalar values, grids, and clears", async () => {
    const state = await applyEditPlan(wb(), plan([
      { sheet: "Data", range: "D1:D2", value: "x" },
      { sheet: "Data", range: "E1:F1", values: [["a", "b"]] },
      { sheet: "Data", range: "A2", clear: true },
    ]));
    expect(state.sim.getValue("Data", "D1")).toBe("x");
    expect(state.sim.getValue("Data", "D2")).toBe("x");
    expect(state.sim.getValue("Data", "E1")).toBe("a");
    expect(state.sim.getValue("Data", "F1")).toBe("b");
    expect(state.sim.getValue("Data", "A2")).toBe(null);
  });

  it("lets a later edit override an earlier one, formula over value included", async () => {
    const state = await applyEditPlan(wb(), plan([
      { sheet: "Data", range: "C2", value: 111 },
      { sheet: "Data", range: "C2", formula: "=A2+B2" },
    ]));
    expect(state.sim.getValue("Data", "C2")).toBe(12);
    expect(state.editedValues.get("Data")?.has("C2")).toBe(false);
    expect(state.editedFormulas.get("Data")?.get("C2")).toBe("A2+B2");
  });

  it("records an unparseable formula as a finding and writes it as text", async () => {
    const state = await applyEditPlan(wb(), plan([
      { sheet: "Data", range: "C2", formula: "=SUM((" },
    ]));
    expect(state.formulaParseFailures).toHaveLength(1);
    expect(state.formulaParseFailures[0]).toMatchObject({ sheet: "Data", cell: "C2" });
    expect(state.sim.getValue("Data", "C2")).toBe("=SUM((");
  });

  it("reports functions outside the engine registry as unsupported", async () => {
    const state = await applyEditPlan(wb(), plan([
      { sheet: "Data", range: "C2", formula: "=XLOOKUP(A2,A2:A3,B2:B3)" },
    ]));
    expect(state.unsupportedFunctions).toContain("XLOOKUP");
    const v = state.sim.getValue("Data", "C2");
    expect(v).toMatchObject({ kind: "error", code: "#NAME?" });
  });

  it("supports edits on a declared new sheet", async () => {
    const state = await applyEditPlan(wb(), plan(
      [
        { sheet: "Summary", range: "A1", value: "Total qty" },
        { sheet: "Summary", range: "B1", formula: "=SUM(Data!A2:A3)" },
      ],
      { newSheets: ["Summary"] },
    ));
    expect(state.sim.getValue("Summary", "A1")).toBe("Total qty");
    expect(state.sim.getValue("Summary", "B1")).toBe(5);
  });
});

describe("applyEditPlan — OFFSET-resolved ranges enter the blast radius (Fix A, full pipeline)", () => {
  // The 08_02 idiom (Financial_Model dataset, monthly row -> OFFSET-SUM
  // rollup) in miniature: E1 is a PRE-EXISTING input formula the plan never
  // touches directly — it rolls up B1:D1 via OFFSET, so no static AST walk
  // of E1's own formula ever names B1/C1/D1. The plan edits C1 (Feb) only.
  const plan = (edits: CellEditPlan["edits"]): CellEditPlan => ({ edits, newSheets: [], notes: "" });

  const offsetWb = () =>
    workbookOf([
      sheetOf("Data", {
        B1: { v: 10 }, // Jan
        C1: { v: 20 }, // Feb
        D1: { v: 30 }, // Mar
        E1: { f: "SUM(OFFSET($A1,0,1,1,3))", v: 60 }, // Q1 rollup
        G1: { v: 999 }, // unrelated, plain literal — never touched
      }),
    ]);

  it("an edit to a cell inside the OFFSET target enters affectedKeys and the rollup recomputes", async () => {
    const state = await applyEditPlan(offsetWb(), plan([
      { sheet: "Data", range: "C1", value: 200 },
    ]));
    expect(cellIsAffected(state, "Data", "E1")).toBe(true);
    expect(state.sim.getValue("Data", "E1")).toBe(240); // 10 + 200 + 30
  });

  it("this is exactly what appliedPlanReader needs: the recalculated value wins for the affected rollup cell", async () => {
    const state = await applyEditPlan(offsetWb(), plan([
      { sheet: "Data", range: "C1", value: 200 },
    ]));
    const reader = appliedPlanReader(state);
    expect(reader.value("Data", "E1")).toBe(240);
  });

  it("an edit to an unrelated cell does NOT pull the OFFSET rollup into affectedKeys", async () => {
    const state = await applyEditPlan(offsetWb(), plan([
      { sheet: "Data", range: "G1", value: 1000 },
    ]));
    expect(cellIsAffected(state, "Data", "E1")).toBe(false);
    // appliedPlanReader must therefore defer to the file's own cached value
    // here, not the engine's recalculation — this is the scoring-safety
    // half of the fix: an untouched OFFSET cell must never start scoring by
    // engine output just because the engine is now ABLE to compute it.
    const reader = appliedPlanReader(state);
    expect(reader.value("Data", "E1")).toBe(60); // the input's own cached value
  });
});

describe("appliedPlanReader", () => {
  it("keeps the file's cached value on cells no edit could have reached (the preserved guardrail)", async () => {
    // The file says B1 is 999 (what Excel last computed); the engine would
    // compute 10. No edit touches A1 or B1, so the file's word stands —
    // an engine/Excel disagreement must not read as damage the plan did.
    // B1 is NOT flagged uncalculated (this is the ordinary, fully-cached
    // case — see the "uncalculated" describe block below for the other
    // half of appliedPlanReader.value's rule), so this pins exactly the
    // guardrail the fix in that block must not erode: a cached formula
    // cell outside affectedKeys always scores by its cache, never the
    // engine, no matter what the engine itself would compute.
    const book = workbookOf([
      sheetOf("Data", { A1: { v: 5 }, B1: { f: "A1*2", v: 999 }, C1: { v: 1 } }),
    ]);
    const state = await applyEditPlan(book, {
      edits: [{ sheet: "Data", range: "C1", value: 2 }],
      newSheets: [],
      notes: "",
    });
    const reader = appliedPlanReader(state);
    expect(reader.value("Data", "B1")).toBe(999); // file cache, not engine's 10
    expect(reader.value("Data", "C1")).toBe(2); // edited → engine
  });

  it("switches a cell to engine values once an edit reaches it upstream", async () => {
    const book = workbookOf([
      sheetOf("Data", { A1: { v: 5 }, B1: { f: "A1*2", v: 999 } }),
    ]);
    const state = await applyEditPlan(book, {
      edits: [{ sheet: "Data", range: "A1", value: 7 }],
      newSheets: [],
      notes: "",
    });
    expect(appliedPlanReader(state).value("Data", "B1")).toBe(14); // downstream of the edit
  });

  it("serves engine values and post-edit formulas, original elsewhere", async () => {
    const book = workbookOf([
      sheetOf("Data", { A1: { v: 5 }, B1: { f: "A1*2", v: 10 }, C1: { v: "keep" } }),
    ]);
    const state = await applyEditPlan(book, {
      edits: [
        { sheet: "Data", range: "A1", value: 7 },
        { sheet: "Data", range: "D1", formula: "=B1+1" },
        { sheet: "Data", range: "C1", clear: true },
      ],
      newSheets: ["Extra"],
      notes: "",
    });
    const reader = appliedPlanReader(state);
    expect(reader.sheetNames()).toEqual(["Data", "Extra"]);
    expect(reader.value("Data", "A1")).toBe(7);
    expect(reader.value("Data", "B1")).toBe(14); // recalculated
    expect(reader.value("Data", "D1")).toBe(15);
    expect(reader.value("Data", "C1")).toBe(null);
    expect(reader.formulaOrValue("Data", "B1")).toBe("=A1*2"); // original formula kept
    expect(reader.formulaOrValue("Data", "D1")).toBe("=B1+1"); // new formula
    expect(reader.formulaOrValue("Data", "A1")).toBe(7); // literal edit
    expect(reader.formulaOrValue("Data", "C1")).toBe(null); // cleared
  });
});

describe("appliedPlanReader: cells the input never cached a value for", () => {
  it("reads the engine's value for an unaffected uncalculated cell, not the input's stub 0", async () => {
    // B1 is a formula cell whose source never cached a value (v:0, text:"0"
    // is what SheetJS's own default gives such a cell — see
    // lib/workbook.ts's GridCell.uncalculated doc — deliberately NOT the
    // 999-style "the file disagrees with the engine" shape the guardrail
    // test above pins; there is no real Excel answer here to defer to).
    // No edit touches A1 or B1.
    const book = workbookOf([
      sheetOf("Data", { A1: { v: 5 }, B1: { v: 0, f: "A1*2", uncalculated: true }, C1: { v: 1 } }),
    ]);
    const state = await applyEditPlan(book, {
      edits: [{ sheet: "Data", range: "C1", value: 2 }],
      newSheets: [],
      notes: "",
    });
    const reader = appliedPlanReader(state);
    expect(reader.value("Data", "B1")).toBe(10); // engine's A1*2, not the input's stub 0
    expect(reader.value("Data", "C1")).toBe(2); // edited → engine, unchanged behavior
  });

  it("still prefers the engine once an edit also reaches the cell upstream (affected AND uncalculated agree)", async () => {
    const book = workbookOf([
      sheetOf("Data", { A1: { v: 5 }, B1: { v: 0, f: "A1*2", uncalculated: true } }),
    ]);
    const state = await applyEditPlan(book, {
      edits: [{ sheet: "Data", range: "A1", value: 7 }],
      newSheets: [],
      notes: "",
    });
    expect(appliedPlanReader(state).value("Data", "B1")).toBe(14);
  });

  it("formulaOrValue is unaffected by the uncalculated flag: still the original formula text", async () => {
    // See the comment on appliedPlanReader's formulaOrValue in edits.ts:
    // it never routes a formula cell through its cached *value* in the
    // first place, so the "0 for an uncached formula" bug value() works
    // around never reaches it — pinned here so that stays true.
    const book = workbookOf([
      sheetOf("Data", { A1: { v: 5 }, B1: { v: 0, f: "A1*2", uncalculated: true } }),
    ]);
    const state = await applyEditPlan(book, { edits: [], newSheets: [], notes: "" });
    expect(appliedPlanReader(state).formulaOrValue("Data", "B1")).toBe("=A1*2");
  });
});
