import { describe, expect, it } from "vitest";
import { shiftFormula } from "@/lib/formula/shift";
import { createSimulator } from "@/lib/formula/simulate";
import { cellKey, type GridCell, type ParsedSheet, type ParsedWorkbook } from "@/lib/workbook";

describe("shiftFormula", () => {
  it("shifts relative references and leaves absolute anchors", () => {
    expect(shiftFormula("=E2-F2", 1, 0)).toBe("=E3-F3");
    expect(shiftFormula("=E2-F2", 0, 2)).toBe("=G2-H2");
    expect(shiftFormula("=$B$2*C1", 3, 1)).toBe("=$B$2*D4");
    expect(shiftFormula("=$B2+B$2", 1, 1)).toBe("=$B3+C$2");
  });

  it("preserves everything it does not own; rewritten refs canonicalise", () => {
    // String literals and spacing survive untouched; the refs it does
    // rewrite come out in Excel's canonical uppercase.
    expect(shiftFormula("=IF(A1>0, \"see cell A1\", SUM(b2:b9))", 1, 0)).toBe(
      "=IF(A2>0, \"see cell A1\", SUM(B3:B10))",
    );
    expect(shiftFormula("SUM(A1)", 1, 0)).toBe("SUM(A2)"); // no leading =
  });

  it("keeps sheet-qualified references' sheet names intact", () => {
    expect(shiftFormula("='My Sheet'!A1+Other!B2", 1, 1)).toBe("='My Sheet'!B2+Other!C3");
  });

  it("turns references pushed off the grid into #REF!, like Excel", () => {
    expect(shiftFormula("=A1", -1, 0)).toBe("=#REF!");
    expect(shiftFormula("=A1", 0, -1)).toBe("=#REF!");
    expect(shiftFormula("=$A$1+A1", 0, -1)).toBe("=$A$1+#REF!");
    expect(shiftFormula("=$A$1+B1", 0, -1)).toBe("=$A$1+A1"); // B1 survives the shift
  });

  it("returns the formula unchanged for a zero shift", () => {
    const f = "=SUM(A1:A9)";
    expect(shiftFormula(f, 0, 0)).toBe(f);
  });

  it("does not treat function names or booleans as references", () => {
    expect(shiftFormula("=LOG10(A1)+TRUE", 1, 0)).toBe("=LOG10(A2)+TRUE");
  });
});

function workbookOf(cells: Record<string, { v?: unknown; f?: string }>): ParsedWorkbook {
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
    });
  }
  const sheet: ParsedSheet = {
    name: "S",
    rows,
    cols,
    totalRows: rows,
    totalCols: cols,
    truncated: false,
    cells: map,
    merges: [],
    colWidths: [],
  };
  return { id: "wb", fileName: "wb.xlsx", sheets: [sheet], definedNames: [] };
}

describe("Simulator.setFormula", () => {
  it("installs a new formula over a literal and recalculates dependents", async () => {
    const sim = createSimulator(
      workbookOf({ A1: { v: 2 }, A2: { v: 3 }, B1: { v: 999 }, C1: { f: "B1*10" } }),
    );
    await sim.setFormula("S", "B1", "=A1+A2");
    await sim.recalculate();
    expect(sim.getValue("S", "B1")).toBe(5);
    expect(sim.getValue("S", "C1")).toBe(50); // dependent picked up the change
  });

  it("replaces an existing formula and rewires its dependencies", async () => {
    const sim = createSimulator(
      workbookOf({ A1: { v: 2 }, A2: { v: 30 }, B1: { f: "A1*2" } }),
    );
    await sim.recalculate();
    expect(sim.getValue("S", "B1")).toBe(4);
    await sim.setFormula("S", "B1", "=A2*2");
    await sim.recalculate();
    expect(sim.getValue("S", "B1")).toBe(60);
    // The old precedent no longer propagates.
    await sim.setValue("S", "A1", 1000);
    await sim.recalculate();
    expect(sim.getValue("S", "B1")).toBe(60);
  });

  it("keeps setValue's formula-deleting behaviour intact afterwards", async () => {
    const sim = createSimulator(workbookOf({ A1: { v: 2 } }));
    await sim.setFormula("S", "B1", "=A1*3");
    await sim.recalculate();
    expect(sim.getValue("S", "B1")).toBe(6);
    await sim.setValue("S", "B1", 42);
    await sim.recalculate();
    expect(sim.getValue("S", "B1")).toBe(42);
    await sim.setValue("S", "A1", 5);
    await sim.recalculate();
    expect(sim.getValue("S", "B1")).toBe(42); // formula is gone
  });

  it("throws on an unparseable formula and leaves state untouched", async () => {
    const sim = createSimulator(workbookOf({ A1: { v: 2 } }));
    await expect(sim.setFormula("S", "B1", "=SUM((")).rejects.toThrow();
    await sim.recalculate();
    expect(sim.getValue("S", "B1")).toBe(null);
  });

  it("surfaces a circular reference as an error value, not a crash", async () => {
    const sim = createSimulator(workbookOf({ A1: { v: 1 } }));
    await sim.setFormula("S", "B1", "=C1+1");
    await sim.setFormula("S", "C1", "=B1+1");
    await sim.recalculate();
    const b1 = sim.getValue("S", "B1");
    expect(b1).toMatchObject({ kind: "error" });
  });

  it("works with cross-sheet references in the installed formula", async () => {
    const wb = workbookOf({ A1: { v: 7 } });
    const other: ParsedSheet = {
      ...wb.sheets[0],
      name: "Data",
      cells: new Map(wb.sheets[0].cells),
    };
    wb.sheets.push(other);
    const sim = createSimulator(wb);
    await sim.setFormula("S", "B1", "=Data!A1*2");
    await sim.recalculate();
    expect(sim.getValue("S", "B1")).toBe(14);
  });
});
