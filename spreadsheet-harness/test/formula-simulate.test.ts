import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseWorkbook } from "@/lib/workbook";
import { excelError } from "@/lib/formula/ast";
import { makeKey } from "@/lib/formula/graph";
import { createSimulator } from "@/lib/formula/simulate";

function workbookFrom(sheets: Record<string, [string, unknown][]>): ReturnType<typeof parseWorkbook> {
  const wb = XLSX.utils.book_new();
  for (const [name, cells] of Object.entries(sheets)) {
    const ws: XLSX.WorkSheet = {};
    let maxCol = 0;
    let maxRow = 0;
    for (const [addr] of cells) {
      const ref = XLSX.utils.decode_cell(addr);
      maxCol = Math.max(maxCol, ref.c);
      maxRow = Math.max(maxRow, ref.r);
    }
    for (const [addr, value] of cells) {
      if (typeof value === "string" && value.startsWith("=")) {
        ws[addr] = { t: "n", f: value.slice(1), v: 0 };
      } else {
        ws[addr] = { t: typeof value === "number" ? "n" : "s", v: value };
      }
    }
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const bytes = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
  return parseWorkbook(bytes, "wb.xlsx");
}

describe("createSimulator", () => {
  it("recalculates on construction, with no explicit call needed", async () => {
    const wb = workbookFrom({ Sheet1: [["A1", 5], ["B1", "=A1*2"]] });
    const sim = createSimulator(wb);
    expect(sim.getValue("Sheet1", "B1")).toBe(10);
  });

  it("reads across sheets", async () => {
    const wb = workbookFrom({ First: [["A1", 3]], Second: [["A1", 9]] });
    const sim = createSimulator(wb);
    expect(sim.getValue("First", "A1")).toBe(3);
    expect(sim.getValue("Second", "A1")).toBe(9);
  });

  it("parses a $-anchored address the same as a bare one", async () => {
    const wb = workbookFrom({ Sheet1: [["B2", 7]] });
    const sim = createSimulator(wb);
    expect(sim.getValue("Sheet1", "$B$2")).toBe(7);
  });

  it("a sheet-qualified dangling reference evaluates to #NAME? end to end, matching Excel — not 0 and not #REF!", () => {
    // The exact real-world shape from SpreadsheetBench 16_05_Ramjet (a
    // deleted row/column leaving "Sheet!#REF!" behind): golden caches
    // "#NAME?" for it; before fix4-ref-token.md this engine's full pipeline
    // produced 0 (parseFormula threw, buildWorkbookModel fell back to the
    // input file's stale cached value) rather than reaching evalNode at all.
    const wb = workbookFrom({ Sheet1: [["A1", "=Assumptions!#REF!"]] });
    const sim = createSimulator(wb);
    expect(sim.getValue("Sheet1", "A1")).toEqual(excelError("#NAME?"));
  });

  it("setValue overwrites a formula cell with a constant, but does not itself recalculate downstream cells", async () => {
    const wb = workbookFrom({ Sheet1: [["A1", 5], ["B1", "=A1*2"], ["C1", "=B1+1"]] });
    const sim = createSimulator(wb);
    expect(sim.getValue("Sheet1", "C1")).toBe(11);

    await sim.setValue("Sheet1", "B1", 100);
    // Not recalculated yet — C1 still reads its stale value.
    expect(sim.getValue("Sheet1", "C1")).toBe(11);

    await sim.recalculate();
    expect(sim.getValue("Sheet1", "C1")).toBe(101);
  });

  it("evaluateWithChanges recalculates internally and returns the requested targets", async () => {
    const wb = workbookFrom({ Sheet1: [["A1", 5], ["B1", "=A1*2"]] });
    const sim = createSimulator(wb);

    const result = await sim.evaluateWithChanges(
      { Sheet1: { A1: 10 } },
      { Sheet1: ["B1"] },
    );
    expect(result).toEqual({ Sheet1: { B1: 20 } });
  });

  it("evaluateWithChanges is non-destructive — the original state is restored afterward", async () => {
    const wb = workbookFrom({ Sheet1: [["A1", 5], ["B1", "=A1*2"]] });
    const sim = createSimulator(wb);

    await sim.evaluateWithChanges({ Sheet1: { A1: 999 } }, { Sheet1: ["B1"] });

    expect(sim.getValue("Sheet1", "A1")).toBe(5);
    expect(sim.getValue("Sheet1", "B1")).toBe(10);
  });

  it("evaluateWithChanges restores correctly across several calls in a row", async () => {
    const wb = workbookFrom({ Sheet1: [["A1", 1], ["B1", "=A1+1"]] });
    const sim = createSimulator(wb);

    const first = await sim.evaluateWithChanges({ Sheet1: { A1: 10 } }, { Sheet1: ["B1"] });
    const second = await sim.evaluateWithChanges({ Sheet1: { A1: 20 } }, { Sheet1: ["B1"] });

    expect(first).toEqual({ Sheet1: { B1: 11 } });
    expect(second).toEqual({ Sheet1: { B1: 21 } });
    expect(sim.getValue("Sheet1", "A1")).toBe(1); // still the original
  });

  it("a target the change didn't touch still evaluates correctly", async () => {
    const wb = workbookFrom({ Sheet1: [["A1", 5], ["B1", 100], ["C1", "=A1+B1"]] });
    const sim = createSimulator(wb);
    const result = await sim.evaluateWithChanges({ Sheet1: { A1: 1 } }, { Sheet1: ["C1"] });
    expect(result).toEqual({ Sheet1: { C1: 101 } });
  });

  it("an unpopulated cell reads as null, not undefined or a thrown error", async () => {
    const wb = workbookFrom({ Sheet1: [["A1", 1]] });
    const sim = createSimulator(wb);
    expect(sim.getValue("Sheet1", "Z99")).toBeNull();
  });
});

describe("createSimulator — whole-column / whole-row references (Fix B)", () => {
  it("SUM(C:C) over a sparse column computes the real total, not 0", () => {
    const wb = workbookFrom({
      Sheet1: [
        ["C1", 1], ["C5", 2], ["C9", 3], // sparse — most of the column is blank
        ["D1", "=SUM(C:C)"],
      ],
    });
    const sim = createSimulator(wb);
    expect(sim.getValue("Sheet1", "D1")).toBe(6);
  });

  it("editing a cell inside the whole-column range dirties and updates the SUM consumer", async () => {
    const wb = workbookFrom({
      Sheet1: [["C1", 1], ["C2", 2], ["D1", "=SUM(C:C)"]],
    });
    const sim = createSimulator(wb);
    expect(sim.getValue("Sheet1", "D1")).toBe(3);

    await sim.setValue("Sheet1", "C2", 20);
    expect(sim.dirtyCells()).toContain(makeKey("SHEET1", "D", 1));

    await sim.recalculate();
    expect(sim.getValue("Sheet1", "D1")).toBe(21);
  });

  it("A:A over an entirely empty column sums to 0", () => {
    const wb = workbookFrom({ Sheet1: [["B1", "=SUM(A:A)"]] });
    const sim = createSimulator(wb);
    expect(sim.getValue("Sheet1", "B1")).toBe(0);
  });

  it("the whole-row form (3:3) also computes a real total", () => {
    const wb = workbookFrom({
      Sheet1: [["A3", 5], ["B3", 10], ["C1", "=SUM(3:3)"]],
    });
    const sim = createSimulator(wb);
    expect(sim.getValue("Sheet1", "C1")).toBe(15);
  });

  it("a sheet-qualified whole-column reference resolves against the target sheet's own extent", () => {
    const wb = workbookFrom({
      Data: [["C1", 4], ["C2", 6]],
      Sheet1: [["A1", "=SUM(Data!C:C)"]],
    });
    const sim = createSimulator(wb);
    expect(sim.getValue("Sheet1", "A1")).toBe(10);
  });
});

describe("createSimulator — OFFSET-resolved ranges enter the dependency graph (Fix A)", () => {
  it("editing a cell inside OFFSET's resolved target dirties the SUM(OFFSET(...)) consumer and it recomputes", async () => {
    // The 08_02 idiom in miniature: a monthly row (B1:D1) and a rollup that
    // reads a sub-range of it via OFFSET rather than a literal range — the
    // exact shape walkRefs alone can never see, since the target only
    // exists once OFFSET's own arguments are evaluated.
    const wb = workbookFrom({
      Sheet1: [
        ["B1", 10], ["C1", 20], ["D1", 30], // Jan, Feb, Mar
        ["F1", 2], // number of months to roll up (col offset width driver)
        ["G1", "=SUM(OFFSET($A1,0,1,1,F1))"], // rolls up B1:C1
      ],
    });
    const sim = createSimulator(wb);
    expect(sim.getValue("Sheet1", "G1")).toBe(30); // 10 + 20

    await sim.setValue("Sheet1", "C1", 200);
    // This is the exact bug Fix A closes: without a dynamic edge from C1 to
    // G1, C1 -> G1 has no path in the graph at all, so G1 would never enter
    // the dirty closure markDirty computes here.
    expect(sim.dirtyCells()).toContain(makeKey("SHEET1", "G", 1));

    await sim.recalculate();
    expect(sim.getValue("Sheet1", "G1")).toBe(210); // 10 + 200
  });

  it("an edit to an unrelated cell does not dirty an OFFSET consumer whose target it never touched", async () => {
    const wb = workbookFrom({
      Sheet1: [
        ["B1", 10], ["C1", 20],
        ["F1", 2],
        ["G1", "=SUM(OFFSET($A1,0,1,1,F1))"], // reads B1:C1
        ["Z1", 999], // outside the OFFSET target entirely
      ],
    });
    const sim = createSimulator(wb);
    expect(sim.getValue("Sheet1", "G1")).toBe(30);

    await sim.setValue("Sheet1", "Z1", 1);
    expect(sim.dirtyCells()).not.toContain(makeKey("SHEET1", "G", 1));
  });

  it("a shifted OFFSET target (its own argument edited) is re-primed without a stale edge to the old target", async () => {
    const wb = workbookFrom({
      Sheet1: [
        ["B1", 10], ["C1", 20], ["D1", 30],
        ["E1", 1], // col offset
        ["F1", "=OFFSET($A1,0,E1)"], // single cell, currently B1
      ],
    });
    const sim = createSimulator(wb);
    expect(sim.getValue("Sheet1", "F1")).toBe(10);

    // Shift the offset itself (a STATIC edge already covers E1, so this
    // dirties F1 regardless of Fix A) — after recalculate, F1's dynamic
    // edge should point at C1 (its new target), not still at B1.
    await sim.setValue("Sheet1", "E1", 2);
    await sim.recalculate();
    expect(sim.getValue("Sheet1", "F1")).toBe(20); // now reads C1

    await sim.setValue("Sheet1", "B1", 999); // the OLD target — must be irrelevant now
    expect(sim.dirtyCells()).not.toContain(makeKey("SHEET1", "F", 1));
  });
});

describe("createSimulator — implicit intersection on a top-level bare range", () => {
  // The exact FM 20_02 shape: a bare range as a formula's whole result in an
  // ordinary cell must intersect against the formula cell's own row/column,
  // not store the raw array — and a downstream SUMIF using that cell as its
  // criteria argument must then see the intersected scalar, not an array it
  // can never match anything with (the array-criteria bug this whole fix
  // exists to close).
  it("Cost Drivers!R5 intersects to 'Revenue Driver'!C5, and a SUMIF using R5 as criteria matches correctly", () => {
    const wb = workbookFrom({
      "Revenue Driver": [
        ["C5", 2024], ["C6", 2025], // the header row this bug corrupted
        ["A1", 2024], ["B1", 100],
        ["A2", 2025], ["B2", 200],
      ],
      "Cost Drivers": [
        ["R5", "='Revenue Driver'!C5:C6"],
        ["R6", "=SUMIF('Revenue Driver'!A1:A2,R5,'Revenue Driver'!B1:B2)"],
      ],
    });
    const sim = createSimulator(wb);
    expect(sim.getValue("Cost Drivers", "R5")).toBe(2024);
    // Pre-fix, R5 held the raw array [2024,2025], SUMIF's criteria never
    // matched either A1 or A2, and this was 0.
    expect(sim.getValue("Cost Drivers", "R6")).toBe(100);
  });

  it("single-row variant: intersects on the origin's column instead of its row", () => {
    const wb = workbookFrom({
      "Revenue Driver": [["C5", 2024], ["D5", 2025]],
      "Cost Drivers": [["D10", "='Revenue Driver'!C5:D5"]], // column D matches D5
    });
    const sim = createSimulator(wb);
    expect(sim.getValue("Cost Drivers", "D10")).toBe(2025);
  });

  it("a bare range that intersects on neither axis is #VALUE!, end to end", () => {
    const wb = workbookFrom({
      "Revenue Driver": [["C5", 2024], ["C6", 2025]],
      "Cost Drivers": [["A1", "='Revenue Driver'!C5:C6"]], // row 1, outside rows 5-6
    });
    const sim = createSimulator(wb);
    expect(sim.getValue("Cost Drivers", "A1")).toEqual(excelError("#VALUE!"));
  });

  it("no regression: SUM over the identical range still aggregates all of it when nested inside a function", () => {
    const wb = workbookFrom({
      "Revenue Driver": [["C5", 2024], ["C6", 2025]],
      "Cost Drivers": [["A5", "=SUM('Revenue Driver'!C5:C6)"]], // row 5 would intersect if this were bare
    });
    const sim = createSimulator(wb);
    expect(sim.getValue("Cost Drivers", "A5")).toBe(4049); // full sum, not the intersected 2024
  });
});
