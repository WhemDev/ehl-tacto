import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { cellKey, parseWorkbook, type GridCell, type ParsedSheet } from "@/lib/workbook";
import { makeKey } from "@/lib/formula/graph";
import { buildWorkbookModel } from "@/lib/formula/workbook-model";

function workbookFrom(sheets: Record<string, unknown[][]>): ReturnType<typeof parseWorkbook> {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  const bytes = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
  return parseWorkbook(bytes, "wb.xlsx");
}

describe("buildWorkbookModel", () => {
  it("stores a plain value cell, no formula", () => {
    const wb = workbookFrom({ Sheet1: [[10, 20]] });
    const state = buildWorkbookModel(wb);
    expect(state.values.get(makeKey("Sheet1", "A", 1))).toBe(10);
    expect(state.formulas.has(makeKey("Sheet1", "A", 1))).toBe(false);
  });

  it("converts 0-based ParsedSheet coordinates to 1-based Excel addresses", () => {
    // Row 2, column C (0-based row=2, col=2) in a raw array-of-arrays becomes C3.
    const wb = workbookFrom({ Sheet1: [[], [], [null, null, 99]] });
    const state = buildWorkbookModel(wb);
    expect(state.values.get(makeKey("Sheet1", "C", 3))).toBe(99);
  });

  it("parses a formula cell and registers it, rather than storing its cached value", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[5, null]]);
    ws["B1"] = { t: "n", f: "A1*2", v: 10 };
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
    const parsed = parseWorkbook(bytes, "wb.xlsx");

    const state = buildWorkbookModel(parsed);
    const key = makeKey("Sheet1", "B", 1);
    expect(state.formulas.has(key)).toBe(true);
    expect(state.values.has(key)).toBe(false); // not pre-populated with the cached value
  });

  it("builds a graph edge from a formula cell to what it references", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[5, null]]);
    ws["B1"] = { t: "n", f: "A1*2", v: 10 };
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
    const parsed = parseWorkbook(bytes, "wb.xlsx");

    const state = buildWorkbookModel(parsed);
    state.graph.markAllDirty();
    state.graph.markDirty(makeKey("Sheet1", "A", 1));
    expect(state.graph.isDirty(makeKey("Sheet1", "B", 1))).toBe(true);
  });

  it("resolves an unqualified reference in a formula against the sheet the formula is on", () => {
    const wb = XLSX.utils.book_new();
    const wsA = XLSX.utils.aoa_to_sheet([[5]]);
    const wsB = XLSX.utils.aoa_to_sheet([[null]]);
    wsB["A1"] = { t: "n", f: "A1", v: 0 }; // deliberately same-named cell on a different sheet
    XLSX.utils.book_append_sheet(wb, wsA, "First");
    XLSX.utils.book_append_sheet(wb, wsB, "Second");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
    const parsed = parseWorkbook(bytes, "wb.xlsx");

    const state = buildWorkbookModel(parsed);
    // Deliberately no markAllDirty() here: Second!A1 is itself a formula
    // cell, so markAllDirty() would mark it dirty unconditionally (see
    // formula-graph.test.ts's "markAllDirty marks every formula cell and
    // nothing else") and the assertion below could never be meaningful.
    // The graph starts clean; markDirty only propagates along real edges.
    state.graph.markDirty(makeKey("First", "A", 1));
    // Second!A1's formula (bare "A1") must depend on Second!A1's own sheet,
    // not First's, even though First!A1 happens to share the same address.
    expect(state.graph.isDirty(makeKey("Second", "A", 1))).toBe(false);
  });

  it("registers a sheet-qualified dangling reference as a formula instead of falling back to the cached value — the real SpreadsheetBench 16_05_Ramjet shape", () => {
    // Before the fix4-ref-token.md fix, "Assumptions!#REF!" failed to parse
    // (the parser demanded a cell token after "Assumptions!" and got an
    // error token instead), so this cell fell into the same catch-and-fall-
    // back-to-cached-value path the next test pins for a genuinely broken
    // formula — landing on this fixture's stale cached 0 instead of ever
    // reaching evalNode, let alone the #NAME? Excel's own golden output
    // caches for it.
    const sheet: ParsedSheet = {
      name: "Valuation Summary and Football",
      rows: 1,
      cols: 1,
      totalRows: 1,
      totalCols: 1,
      truncated: false,
      cells: new Map<string, GridCell>([
        [
          cellKey(0, 0),
          { row: 0, col: 0, value: 0, text: "0", type: "number", formula: "Assumptions!#REF!" },
        ],
      ]),
      merges: [],
      colWidths: [],
    };
    const state = buildWorkbookModel({ id: "wb", fileName: "wb.xlsx", sheets: [sheet], definedNames: [] });
    const key = makeKey("Valuation Summary and Football", "A", 1);
    expect(state.formulas.has(key)).toBe(true);
    expect(state.values.has(key)).toBe(false); // not pre-populated with the stale cached 0
  });

  it("keeps the cached value when a formula fails to parse, instead of dropping the cell", () => {
    const sheet: ParsedSheet = {
      name: "Sheet1",
      rows: 1,
      cols: 1,
      totalRows: 1,
      totalCols: 1,
      truncated: false,
      cells: new Map<string, GridCell>([
        [
          cellKey(0, 0),
          { row: 0, col: 0, value: 42, text: "42", type: "number", formula: "SUM(A1" }, // unterminated
        ],
      ]),
      merges: [],
      colWidths: [],
    };
    const state = buildWorkbookModel({ id: "wb", fileName: "wb.xlsx", sheets: [sheet], definedNames: [] });
    const key = makeKey("Sheet1", "A", 1);
    expect(state.formulas.has(key)).toBe(false);
    expect(state.values.get(key)).toBe(42);
  });

  it("carries a boolean and a date cell through as themselves, not stringified", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(
      [[true, new Date(2025, 5, 1)]],
      { cellDates: true },
    );
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
    const parsed = parseWorkbook(bytes, "wb.xlsx");

    const state = buildWorkbookModel(parsed);
    expect(state.values.get(makeKey("Sheet1", "A", 1))).toBe(true);
    expect(state.values.get(makeKey("Sheet1", "B", 1))).toBeInstanceOf(Date);
  });
});
