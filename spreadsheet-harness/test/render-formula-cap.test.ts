import { describe, expect, it } from "vitest";
import { renderCellContent } from "@/lib/analysis/render";
import { readRange } from "@/lib/analysis/tools";
import { gridAppendix, GRID_APPENDIX_BUDGET } from "@/lib/agent/grid-appendix";
import { parseWorkbook } from "@/lib/workbook";
import { xlsxBytes } from "./helpers/workbooks";

/**
 * Fix 1: renderCellContent gains an OPTIONAL formula-length cap, threaded
 * from the grid appendix (lib/agent/grid-appendix.ts) only — every other
 * caller (lib/analysis/completeness.ts's null checks, lib/analysis/tools.ts's
 * readRange) keeps calling it with no options and stays uncapped. See this
 * suite's last describe block for the direct proof of that non-regression.
 */

/** A deterministic nested-IF-shaped string of exactly `len` characters —
 *  real-world-shaped (like Excaliba.xlsx's "Stock Level (Month)" formulas)
 *  without needing to be a genuinely balanced/evaluable formula: parseWorkbook
 *  never validates or evaluates `f`, it only stores the raw text (see
 *  lib/workbook.ts's `formula: cell.f ? String(cell.f) : undefined`). */
function longFormula(len: number): string {
  const unit = "IF(A1>0,1,IF(A2>0,2,IF(A3>0,3,0)))";
  let s = "";
  while (s.length < len) s += unit;
  return s.slice(0, len);
}

function sheetWith(formula: string, cachedValue = 42): ReturnType<typeof parseWorkbook> {
  return parseWorkbook(xlsxBytes({ Sheet1: [[{ f: formula, v: cachedValue }]] }), "cap.xlsx");
}

describe("renderCellContent: optional formula cap", () => {
  it("renders the full formula when no options are passed (default: uncapped)", () => {
    const formula = longFormula(1500);
    const wb = sheetWith(formula);
    const out = renderCellContent(wb.sheets[0], 0, 0);
    expect(out).toBe(`A1={=${formula} -> 42}`);
    expect(out).not.toContain("…[+");
  });

  it("caps the formula at maxFormulaChars, appending a `…[+N chars]` marker", () => {
    const formula = longFormula(1500);
    const wb = sheetWith(formula);
    const out = renderCellContent(wb.sheets[0], 0, 0, { maxFormulaChars: 240 });
    const expectedRemainder = formula.length - 240; // 1260
    expect(out).toBe(`A1={=${formula.slice(0, 240)}…[+${expectedRemainder} chars] -> 42}`);
  });

  it("never truncates the ` -> value` suffix — the computed value stays fully visible when capped", () => {
    const formula = longFormula(1500);
    const wb = sheetWith(formula, 123456.789);
    const out = renderCellContent(wb.sheets[0], 0, 0, { maxFormulaChars: 240 });
    expect(out).toContain(" -> 123456.789}");
    expect(out?.endsWith(" -> 123456.789}")).toBe(true);
  });

  it("does not touch a formula at or under the cap", () => {
    const formula = longFormula(240);
    const wb = sheetWith(formula);
    const out = renderCellContent(wb.sheets[0], 0, 0, { maxFormulaChars: 240 });
    expect(out).toBe(`A1={=${formula} -> 42}`);
    expect(out).not.toContain("…[+");
  });

  it("a formula exactly one char over the cap is marked with exactly '+1 chars'", () => {
    const formula = longFormula(241);
    const wb = sheetWith(formula);
    const out = renderCellContent(wb.sheets[0], 0, 0, { maxFormulaChars: 240 });
    expect(out).toBe(`A1={=${formula.slice(0, 240)}…[+1 chars] -> 42}`);
  });

  it("a non-formula cell is unaffected by maxFormulaChars", () => {
    const wb = parseWorkbook(xlsxBytes({ Sheet1: [["hello", 42, null]] }), "x.xlsx");
    const sheet = wb.sheets[0];
    expect(renderCellContent(sheet, 0, 0, { maxFormulaChars: 3 })).toBe('A1="hello"');
    expect(renderCellContent(sheet, 0, 1, { maxFormulaChars: 3 })).toBe("B1=42");
  });
});

describe("gridAppendix: applies the cap so long-formula rows no longer starve the rest of the sheet", () => {
  it("reaches a marker row far below several 1,500-char-formula rows, within the real GRID_APPENDIX_BUDGET", () => {
    // Shaped after the real Excaliba.xlsx bug this fixes: a handful of rows
    // near the top, each wide (24 long-formula columns, mirroring a
    // "Stock Level (Month)" row spanning many product-tracking columns),
    // followed by many short "lower table" rows a model still needs to see
    // (Purchase Order / Month-End-Stock-shaped data). Uncapped, the wide
    // rows alone blow the entire budget (proven below without touching
        // gridAppendix's internals — just renderCellContent's own uncapped
    // output for these exact cells) — capped, they leave enough budget for
    // the appendix to reach deep into the sheet.
    const WIDE_ROWS = 4;
    const WIDE_COLS = 24;
    const LOWER_ROWS = 50;
    const formula = longFormula(1500);

    const rows: (string | number | { f: string; v: number })[][] = [];
    for (let r = 0; r < WIDE_ROWS; r++) {
      const row: { f: string; v: number }[] = [];
      for (let c = 0; c < WIDE_COLS; c++) row.push({ f: formula, v: r * 100 + c });
      rows.push(row);
    }
    for (let r = 0; r < LOWER_ROWS; r++) {
      rows.push([`lower-table-row-${r}`, r]);
    }
    const markerRow = WIDE_ROWS + LOWER_ROWS - 1; // 0-indexed
    rows[markerRow] = ["LOWER_TABLE_MARKER_ROW", "FOUND_IT"];

    const wb = parseWorkbook(xlsxBytes({ Sheet1: rows }), "wide.xlsx");
    const sheet = wb.sheets[0];

    // Sanity check the fixture actually stresses the bug: rendering just the
    // WIDE_ROWS uncapped (renderCellContent's own default, unaffected by
    // this fix) already exceeds the whole appendix budget on its own, so an
    // uncapped renderSheet could never reach the marker row.
    let uncappedWideRowsTotal = 0;
    for (let r = 0; r < WIDE_ROWS; r++) {
      for (let c = 0; c < WIDE_COLS; c++) {
        uncappedWideRowsTotal += renderCellContent(sheet, r, c)!.length + 3; // +3 for " | " separators
      }
    }
    expect(uncappedWideRowsTotal).toBeGreaterThan(GRID_APPENDIX_BUDGET);

    // The real, production entry point — no options exposed to the caller;
    // the cap lives inside grid-appendix.ts's own call to renderCellContent.
    const out = gridAppendix(wb);

    expect(out).toContain("LOWER_TABLE_MARKER_ROW");
    expect(out).toContain("FOUND_IT");
    expect(out).not.toContain("(sheet is empty)");
  });

  it("still cuts (and says so) when even the capped content cannot fit a much smaller budget", () => {
    // The cap reduces the DEGREE of starvation; it does not make the budget
    // infinite. A budget too small for even one capped wide row should still
    // cut, honestly, the same way the pre-fix code did.
    const formula = longFormula(1500);
    const rows: { f: string; v: number }[][] = [[{ f: formula, v: 1 }]];
    const wb = parseWorkbook(xlsxBytes({ Sheet1: rows }), "tiny.xlsx");
    const out = gridAppendix(wb, 50);
    expect(out).toContain("cut for length");
  });
});

describe("every other renderCellContent caller stays uncapped (unaffected by Fix 1)", () => {
  it("readRange (lib/analysis/tools.ts) still renders a long formula in full", () => {
    const formula = longFormula(1500);
    const wb = sheetWith(formula);
    const res = readRange(wb, "Sheet1", "A1");
    expect(res.text).toContain(formula);
    expect(res.text).not.toContain("…[+");
  });
});
