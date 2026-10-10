import { describe, expect, it } from "vitest";
import { buildFileDigest } from "@/lib/digest";
import { cellKey, type GridCell, type ParsedSheet, type ParsedWorkbook } from "@/lib/workbook";

/**
 * The file-level note buildFileDigest adds when most of a workbook's formula
 * cells never had a cached value (GridCell.uncalculated) — see
 * lib/workbook.ts's doc on that flag and .superpowers/sdd/reports/
 * fix3-uncached-recalc.md for the real files this targets (02_Project PP,
 * 11_Project Switchgear, 16_05: 100% of formula cells affected).
 *
 * Builds ParsedWorkbook/GridCell objects directly rather than round-tripping
 * through real .xlsx bytes — the note only reads GridCell.formula/
 * .uncalculated, which parseWorkbook's own behavior is covered separately
 * (test/workbook-uncalculated.test.ts). Same direct-construction pattern as
 * test/digest-budget.test.ts's junkNamesWb.
 */

const KEY_PHRASE = "cached values were never saved";

/** `total` formula cells (A1, A2, …), `uncalculatedCount` of them flagged
 *  uncalculated: true, the rest fully cached with a real (non-zero) value —
 *  so a fully-cached file's note-eligibility check has real values to see,
 *  not coincidental zeros. */
function formulaSheet(total: number, uncalculatedCount: number): ParsedSheet {
  const cells = new Map<string, GridCell>();
  for (let i = 0; i < total; i++) {
    const uncalculated = i < uncalculatedCount;
    cells.set(cellKey(i, 0), {
      row: i,
      col: 0,
      value: uncalculated ? 0 : 42,
      text: uncalculated ? "0" : "42",
      type: "empty",
      formula: "B1+1",
      uncalculated: uncalculated || undefined,
    });
  }
  return {
    name: "Sheet1",
    rows: total,
    cols: 1,
    totalRows: total,
    totalCols: 1,
    truncated: false,
    cells,
    merges: [],
    colWidths: [],
  };
}

function workbookOf(sheet: ParsedSheet): ParsedWorkbook {
  return { id: "wb", fileName: "wb.xlsx", sheets: [sheet], definedNames: [] };
}

function notesOf(wb: ParsedWorkbook): string {
  return buildFileDigest(wb).notes.join(" ");
}

describe("buildFileDigest: uncalculated-formula file note", () => {
  it("fires when most formula cells (above the floor) are uncalculated", () => {
    const wb = workbookOf(formulaSheet(30, 25)); // 30 formula cells, 25 uncalculated (83%)
    expect(notesOf(wb)).toContain(KEY_PHRASE);
  });

  it("stays quiet at or below the 50% share threshold", () => {
    const wb = workbookOf(formulaSheet(30, 15)); // exactly 50% — not "more than half"
    expect(notesOf(wb)).not.toContain(KEY_PHRASE);
  });

  it("stays quiet below the formula-count floor even at 100% uncalculated", () => {
    const wb = workbookOf(formulaSheet(10, 10)); // 100% uncalculated, but only 10 formula cells
    expect(notesOf(wb)).not.toContain(KEY_PHRASE);
  });

  it("stays quiet on a fully-cached workbook (the common case)", () => {
    const wb = workbookOf(formulaSheet(1200, 0)); // large, realistic sheet, 0% uncalculated
    expect(notesOf(wb)).not.toContain(KEY_PHRASE);
  });

  it("stays quiet with no formula cells at all", () => {
    const sheet = formulaSheet(0, 0);
    expect(notesOf(workbookOf(sheet))).not.toContain(KEY_PHRASE);
  });
});
