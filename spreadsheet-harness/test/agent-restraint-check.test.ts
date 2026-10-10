import { describe, expect, it } from "vitest";
import { colToIndex } from "@/lib/a1";
import {
  findHeaderStyledRowWrites,
  findUncorroboratedColumns,
  headerStyledRowWarning,
  restraintWarnings,
  uncorroboratedColumnWarning,
} from "@/lib/agent/restraint-check";
import type { CellEditPlan } from "@/lib/plan/edits";
import { cellKey, type GridCell, type ParsedSheet, type ParsedWorkbook } from "@/lib/workbook";
import type { ResolvedStyle } from "@/lib/workbook-styles";

/**
 * lib/agent/restraint-check.ts: two mechanically-catchable over-fill
 * warnings appended to the first-submit preview (see loop.ts). Unit-tests
 * both levers directly on synthetic workbooks, built by hand (no XLSX
 * round-trip needed — ParsedWorkbook/ParsedSheet/GridCell are plain data,
 * the same approach test/formula-shift.test.ts's workbookOf uses) so style
 * data (fill/bold/color, needed for Lever 2) can be set explicitly without
 * fighting SheetJS's own writer.
 *
 * Real-fixture calibration (see the module's own header comment and this
 * file's own doc on each lever) confirmed against the actual SpreadsheetBench
 * Template held-out set: Lever 1 fires on 03_01's M&A_Consolidation!C35:C40
 * (a headerless "Cash Flow Statement" block the model duplicated a column
 * into) and stays silent on 05_01/07_01/09_01/12_01 (whose own over-fill, if
 * any, is not this mechanism); Lever 2 fires on 15_01's DebtAnalysis!B38
 * (styled like the sheet's real section titles) and nowhere else. Both stay
 * silent across all five Financial_Model sentinel tasks (01_02, 02_01,
 * 02_02, 02_04, 02_05) — solved tasks that must never see a false alarm.
 * 03_01 has OTHER over-fill instances (row 17 vs. row 18 — which line is the
 * real equity plug) that neither lever catches: that ambiguity is a
 * domain-judgment call about accounting semantics, not a structural signal,
 * and is deliberately out of scope (see restraint-check.ts's own doc).
 */

function refToRowCol(ref: string): [number, number] {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref)!;
  return [Number(m[2]) - 1, colToIndex(m[1])];
}

type Spec = { text: string; styleIdx?: number } | { num: number; styleIdx?: number };

function buildSheet(
  name: string,
  rows: number,
  cols: number,
  specs: Record<string, Spec>,
  styles?: (ResolvedStyle | undefined)[],
): ParsedSheet {
  const cells = new Map<string, GridCell>();
  for (const [ref, spec] of Object.entries(specs)) {
    const [row, col] = refToRowCol(ref);
    if ("text" in spec) {
      cells.set(cellKey(row, col), { row, col, value: spec.text, text: spec.text, type: "text", styleIdx: spec.styleIdx });
    } else {
      cells.set(cellKey(row, col), { row, col, value: spec.num, text: String(spec.num), type: "number", styleIdx: spec.styleIdx });
    }
  }
  return { name, rows, cols, totalRows: rows, totalCols: cols, truncated: false, cells, merges: [], colWidths: [], styles };
}

function buildWorkbook(sheets: ParsedSheet[]): ParsedWorkbook {
  return { id: "wb", fileName: "wb.xlsx", sheets, definedNames: [] };
}

function plan(edits: CellEditPlan["edits"]): CellEditPlan {
  return { edits, newSheets: [], notes: "" };
}

// ---------------------------------------------------------------------------
// LEVER 1: uncorroborated column
// ---------------------------------------------------------------------------

describe("findUncorroboratedColumns", () => {
  it("fires on a genuinely headerless block: no nearby data, no header, in either direction", () => {
    // Mirrors 03_01's M&A_Consolidation!C35:C40 shape: a section title (row
    // 1) walled off by a double-blank separator (rows 2-3) from a block
    // (rows 4-5) that has no column header of its own.
    const sheet = buildSheet("S", 20, 6, {
      B1: { text: "Section" },
      B4: { text: "Metric X" },
      B5: { text: "Metric Y" },
    });
    const wb = buildWorkbook([sheet]);
    const p = plan([{ sheet: "S", range: "C4:C5", value: 1 }]);

    const groups = findUncorroboratedColumns(wb, p);
    expect(groups).toEqual([{ sheet: "S", col: 2, colLetter: "C", firstRow: 4, lastRow: 5 }]);
  });

  it("stays silent when an existing unedited cell in the same column sits within the ±5 window", () => {
    const sheet = buildSheet("S", 20, 6, {
      B1: { text: "Section" },
      B4: { text: "Metric X" },
      B5: { text: "Metric Y" },
      C6: { num: 100 }, // pre-existing data, 1 row below the written block
    });
    const wb = buildWorkbook([sheet]);
    const p = plan([{ sheet: "S", range: "C4:C5", value: 1 }]);
    expect(findUncorroboratedColumns(wb, p)).toEqual([]);
  });

  it("stays silent when a text header row is reachable by crossing a single blank row", () => {
    // Mirrors 12_01's NOL_Carryforward: one shared header several rows above
    // a sub-block, separated only by ONE blank row (not a double-blank
    // section break) — the header search must be able to reach past it.
    const sheet = buildSheet("S", 20, 6, {
      B1: { text: "Year" },
      C1: { text: "FY2020" },
      // row 2 blank
      B3: { text: "Metric" },
    });
    const wb = buildWorkbook([sheet]);
    const p = plan([{ sheet: "S", range: "C3", value: 1 }]);
    expect(findUncorroboratedColumns(wb, p)).toEqual([]);
  });

  it("still fires when the same header sits across a DOUBLE-blank boundary instead", () => {
    const sheet = buildSheet("S", 20, 6, {
      B1: { text: "Year" },
      C1: { text: "FY2020" },
      // rows 2-3 blank: a double-blank section separator
      B4: { text: "Metric" },
    });
    const wb = buildWorkbook([sheet]);
    const p = plan([{ sheet: "S", range: "C4", value: 1 }]);
    expect(findUncorroboratedColumns(wb, p)).toEqual([
      { sheet: "S", col: 2, colLetter: "C", firstRow: 4, lastRow: 4 },
    ]);
  });

  it("recognizes a bare year-number header row (05_01's shape: 2020/2021/2022/2023 as NUMBER cells, no text)", () => {
    const sheet = buildSheet("S", 20, 6, {
      C1: { num: 2020 },
      D1: { num: 2021 },
      B2: { text: "Metric" },
    });
    const wb = buildWorkbook([sheet]);
    const p = plan([{ sheet: "S", range: "C2:D2", value: 1 }]);
    expect(findUncorroboratedColumns(wb, p)).toEqual([]);
  });

  it("recognizes a period-INDEX header row (09_01's shape: a text label plus a strict arithmetic run 0,1,2,...)", () => {
    const sheet = buildSheet("S", 20, 6, {
      B1: { text: "Year" },
      C1: { num: 0 },
      D1: { num: 1 },
      E1: { num: 2 },
      B2: { text: "Metric" },
    });
    const wb = buildWorkbook([sheet]);
    const p = plan([{ sheet: "S", range: "C2:E2", value: 1 }]);
    expect(findUncorroboratedColumns(wb, p)).toEqual([]);
  });

  it("does not mistake an increasing-but-irregular numeric row for a header", () => {
    // 10, 15, 30 increases but never by a constant step — must not pass the
    // arithmetic-sequence fallback, and only 1 of its 4 cells is text, so it
    // fails the ratio rule too. Padded 6 rows below it with single-cell
    // filler (rows 2-7) so the ±5 data-corroboration window never reaches
    // row 1's own C1=10 directly — this isolates the header-search path
    // (which has no such radius limit) from the data-search path (which
    // would trivially "corroborate" column C via C1's mere presence,
    // regardless of whether row 1 looks like a header at all).
    const sheet = buildSheet("S", 20, 6, {
      B1: { text: "Values" },
      C1: { num: 10 },
      D1: { num: 15 },
      E1: { num: 30 },
      B2: { text: "Filler1" },
      B3: { text: "Filler2" },
      B4: { text: "Filler3" },
      B5: { text: "Filler4" },
      B6: { text: "Filler5" },
      B7: { text: "Filler6" },
      B8: { text: "Metric" },
    });
    const wb = buildWorkbook([sheet]);
    const p = plan([{ sheet: "S", range: "C8", value: 1 }]);
    expect(findUncorroboratedColumns(wb, p)).toEqual([
      { sheet: "S", col: 2, colLetter: "C", firstRow: 8, lastRow: 8 },
    ]);
  });

  it("stays silent on the DATA cell when the plan itself also writes the header-row cell for that column", () => {
    const sheet = buildSheet("S", 20, 6, {
      B1: { text: "Metric" },
      C1: { text: "FY2023" },
      B3: { text: "Costs" },
    });
    const wb = buildWorkbook([sheet]);
    // The plan extends the header itself (D1) AND writes the new column's
    // data cell (D3) in the same submit — the header write resolves the
    // ambiguity, so D3 (unlike D1 itself, which has nothing above it to
    // corroborate the header extension in this minimal fixture) must not be
    // flagged.
    const p = plan([
      { sheet: "S", range: "D1", value: "FY2024" },
      { sheet: "S", range: "D3", value: 1 },
    ]);
    const groups = findUncorroboratedColumns(wb, p);
    expect(groups.some((g) => g.col === 3 && g.firstRow <= 3 && g.lastRow >= 3)).toBe(false);
  });

  it("ignores `clear` edits entirely — clearing is the opposite of over-fill", () => {
    const sheet = buildSheet("S", 20, 6, {
      B1: { text: "Section" },
      B4: { text: "Metric X" },
      C4: { num: 5 },
    });
    const wb = buildWorkbook([sheet]);
    const p = plan([{ sheet: "S", range: "C4", clear: true }]);
    expect(findUncorroboratedColumns(wb, p)).toEqual([]);
  });

  it("does not flag a column axis-check.ts already owns (an orphaned period-axis column)", () => {
    // Two sheets sharing a period axis at row 1 (A1:C1); Sheet1's column D
    // already has real data below the header (D2/D3) but no header of its
    // own — exactly axis-check.ts's own orphan-column shape. Lever 1 must
    // defer to that check rather than doubly flagging the same column.
    // axis-check keys off detectSheetPeriodAxis, which needs real Date
    // cells (not text) — construct those directly, the same shape
    // test/bench-axis-check.test.ts's annualAxis/d helpers produce.
    const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
    const dateCell = (row: number, col: number, iso: string): GridCell => ({
      row,
      col,
      value: d(iso),
      text: iso,
      type: "date",
    });
    const sheet1Cells = new Map<string, GridCell>([
      [cellKey(0, 0), dateCell(0, 0, "2028-03-31")],
      [cellKey(0, 1), dateCell(0, 1, "2029-03-31")],
      [cellKey(0, 2), dateCell(0, 2, "2030-03-31")],
      [cellKey(1, 3), { row: 1, col: 3, value: 10, text: "10", type: "number" }],
      [cellKey(2, 3), { row: 2, col: 3, value: 20, text: "20", type: "number" }],
    ]);
    const sheet2Cells = new Map<string, GridCell>([
      [cellKey(0, 0), dateCell(0, 0, "2028-03-31")],
      [cellKey(0, 1), dateCell(0, 1, "2029-03-31")],
      [cellKey(0, 2), dateCell(0, 2, "2030-03-31")],
    ]);
    const sheet1: ParsedSheet = {
      name: "Sheet1",
      rows: 10,
      cols: 6,
      totalRows: 10,
      totalCols: 6,
      truncated: false,
      cells: sheet1Cells,
      merges: [],
      colWidths: [],
    };
    const sheet2: ParsedSheet = { ...sheet1, name: "Sheet2", cells: sheet2Cells };
    const wb = buildWorkbook([sheet1, sheet2]);
    const p = plan([{ sheet: "Sheet1", range: "D2:D3", value: 1 }]);
    expect(findUncorroboratedColumns(wb, p)).toEqual([]);
  });

  it("caps the flagged-group list at 4 with a '+N more' tail", () => {
    const specs: Record<string, Spec> = { B1: { text: "Section" } };
    const edits: CellEditPlan["edits"] = [];
    for (let i = 0; i < 5; i++) {
      const col = String.fromCharCode(67 + i); // C, D, E, F, G
      specs[`B${4 + i}`] = { text: `Metric ${i}` };
      edits.push({ sheet: "S", range: `${col}${4 + i}`, value: 1 });
    }
    const sheet = buildSheet("S", 20, 10, specs);
    const wb = buildWorkbook([sheet]);
    const warning = uncorroboratedColumnWarning(wb, plan(edits));
    expect(warning).toContain("column C");
    expect(warning).toContain("column D");
    expect(warning).toContain("column E");
    expect(warning).toContain("column F");
    expect(warning).not.toContain("column G");
    expect(warning).toContain("(+1 more column with the same issue)");
  });
});

describe("uncorroboratedColumnWarning", () => {
  it("returns null when there is nothing to flag", () => {
    const sheet = buildSheet("S", 10, 4, { B1: { text: "Metric" }, C1: { num: 5 }, C2: { num: 1 } });
    const wb = buildWorkbook([sheet]);
    expect(uncorroboratedColumnWarning(wb, plan([{ sheet: "S", range: "C2", value: 1 }]))).toBeNull();
  });

  it("phrases the warning with sheet, column, row range, and a concrete instruction", () => {
    const sheet = buildSheet("S", 20, 6, { B1: { text: "Section" }, B4: { text: "Metric X" }, B5: { text: "Metric Y" } });
    const wb = buildWorkbook([sheet]);
    const warning = uncorroboratedColumnWarning(wb, plan([{ sheet: "S", range: "C4:C5", value: 1 }]));
    expect(warning).toContain("Restraint check (uncorroborated column):");
    expect(warning).toContain("S column C rows 4-5");
    expect(warning).toContain("no existing content or header names this column near your edits");
    expect(warning).toContain("verify the task actually asks for it; if not, remove those edits.");
  });
});

// ---------------------------------------------------------------------------
// LEVER 2: header-styled row
// ---------------------------------------------------------------------------

const HEADER_STYLE: ResolvedStyle = { fill: "#4472C4", bold: true, color: "#FFFFFF" };
// Same visual signature (fill/bold/color) as HEADER_STYLE but a different
// cellXf (an extra border) — mirrors the real DebtAnalysis fixture, whose
// main title and section titles use two different styleIdx that resolve to
// the identical fill/bold/color combo.
const HEADER_STYLE_VARIANT: ResolvedStyle = { ...HEADER_STYLE, borderTop: "2px solid #000000" };
const PLAIN_STYLE: ResolvedStyle = { align: "left" };

describe("findHeaderStyledRowWrites", () => {
  it("fires when the plan writes into a row whose label cell carries the sheet's section-header signature", () => {
    const styles = [HEADER_STYLE, PLAIN_STYLE];
    const sheet = buildSheet(
      "S",
      20,
      4,
      {
        B2: { text: "Section A", styleIdx: 0 },
        B4: { text: "Section B", styleIdx: 0 },
        B6: { text: "Loan Balance at Maturity", styleIdx: 0 }, // the mis-styled row
        B8: { text: "Outstanding Principal", styleIdx: 1 }, // the real, plain target
      },
      styles,
    );
    const wb = buildWorkbook([sheet]);
    const hits = findHeaderStyledRowWrites(wb, plan([{ sheet: "S", range: "C6", value: 999 }]));
    expect(hits).toEqual([{ sheet: "S", row: 6, labelCell: "B6", suggestedRow: 8 }]);
  });

  it("stays silent when the style also dresses up a row holding non-text data (not discriminating)", () => {
    const styles = [HEADER_STYLE, PLAIN_STYLE];
    const sheet = buildSheet(
      "S",
      20,
      4,
      {
        B2: { text: "Section A", styleIdx: 0 },
        B4: { text: "Section B", styleIdx: 0 },
        B6: { text: "Loan Balance at Maturity", styleIdx: 0 },
        // This sheet also uses the SAME style on a real data cell elsewhere
        // — no longer a heading-only signal.
        C10: { num: 42, styleIdx: 0 },
      },
      styles,
    );
    const wb = buildWorkbook([sheet]);
    expect(findHeaderStyledRowWrites(wb, plan([{ sheet: "S", range: "C6", value: 999 }]))).toEqual([]);
  });

  it("stays silent when the style appears on only one title-bar row (needs >= 2 to be a signature)", () => {
    // B6 itself is title-bar-shaped (a single text cell) and so would count
    // toward its own signature's frequency — this fixture makes it the
    // ONLY row anywhere in the sheet using styleIdx 0, so the count stays
    // at 1 and the signature never qualifies.
    const styles = [HEADER_STYLE, PLAIN_STYLE];
    const sheet = buildSheet(
      "S",
      20,
      4,
      {
        B2: { text: "Only Section", styleIdx: 1 },
        B6: { text: "Loan Balance at Maturity", styleIdx: 0 },
      },
      styles,
    );
    const wb = buildWorkbook([sheet]);
    expect(findHeaderStyledRowWrites(wb, plan([{ sheet: "S", range: "C6", value: 999 }]))).toEqual([]);
  });

  it("groups by (fill, bold, color) rather than exact styleIdx: a border-only variant still counts toward the >= 2 threshold", () => {
    const styles = [HEADER_STYLE, HEADER_STYLE_VARIANT, PLAIN_STYLE];
    const sheet = buildSheet(
      "S",
      20,
      4,
      {
        B2: { text: "Main Title", styleIdx: 0 }, // plain variant
        B4: { text: "Section B", styleIdx: 1 }, // bordered variant, SAME fill/bold/color
        B6: { text: "Loan Balance at Maturity", styleIdx: 1 },
        B8: { text: "Outstanding Principal", styleIdx: 2 },
      },
      styles,
    );
    const wb = buildWorkbook([sheet]);
    const hits = findHeaderStyledRowWrites(wb, plan([{ sheet: "S", range: "C6", value: 999 }]));
    expect(hits).toEqual([{ sheet: "S", row: 6, labelCell: "B6", suggestedRow: 8 }]);
  });

  it("omits the suggested row when no plainly-styled row is found within reach", () => {
    const styles = [HEADER_STYLE];
    const sheet = buildSheet(
      "S",
      20,
      4,
      {
        B2: { text: "Section A", styleIdx: 0 },
        B4: { text: "Section B", styleIdx: 0 },
        B6: { text: "Section C", styleIdx: 0 },
        // Nothing populated in rows 7-11 (SUGGESTED_ROW_SEARCH = 5) at all.
      },
      styles,
    );
    const wb = buildWorkbook([sheet]);
    const hits = findHeaderStyledRowWrites(wb, plan([{ sheet: "S", range: "C6", value: 999 }]));
    expect(hits).toEqual([{ sheet: "S", row: 6, labelCell: "B6" }]);
  });

  it("ignores `clear` edits entirely", () => {
    const styles = [HEADER_STYLE, PLAIN_STYLE];
    const sheet = buildSheet(
      "S",
      20,
      4,
      {
        B2: { text: "Section A", styleIdx: 0 },
        B4: { text: "Section B", styleIdx: 0 },
        B6: { text: "Loan Balance at Maturity", styleIdx: 0 },
        C6: { num: 1, styleIdx: 1 },
      },
      styles,
    );
    const wb = buildWorkbook([sheet]);
    expect(findHeaderStyledRowWrites(wb, plan([{ sheet: "S", range: "C6", clear: true }]))).toEqual([]);
  });

  it("caps the flagged-row list at 4 with a '+N more' tail", () => {
    const styles = [HEADER_STYLE, PLAIN_STYLE];
    const specs: Record<string, Spec> = {
      B2: { text: "Section A", styleIdx: 0 },
      B4: { text: "Section B", styleIdx: 0 },
    };
    const edits: CellEditPlan["edits"] = [];
    for (let i = 0; i < 5; i++) {
      const row = 6 + i * 2;
      specs[`B${row}`] = { text: `Section header-styled ${i}`, styleIdx: 0 };
      edits.push({ sheet: "S", range: `C${row}`, value: 1 });
    }
    const sheet = buildSheet("S", 40, 4, specs, styles);
    const wb = buildWorkbook([sheet]);
    const warning = headerStyledRowWarning(wb, plan(edits));
    expect(warning).toContain("row 6'");
    expect(warning).toContain("row 8'");
    expect(warning).toContain("row 10'");
    expect(warning).toContain("row 12'");
    expect(warning).not.toContain("row 14'");
    expect(warning).toContain("(+1 more row with the same issue)");
  });
});

describe("headerStyledRowWarning", () => {
  it("returns null when there is nothing to flag", () => {
    const styles = [PLAIN_STYLE];
    const sheet = buildSheet("S", 10, 4, { B2: { text: "Metric", styleIdx: 0 } }, styles);
    const wb = buildWorkbook([sheet]);
    expect(headerStyledRowWarning(wb, plan([{ sheet: "S", range: "C2", value: 1 }]))).toBeNull();
  });

  it("phrases the warning with sheet, row, label cell, and a suggested plain row", () => {
    const styles = [HEADER_STYLE, PLAIN_STYLE];
    const sheet = buildSheet(
      "S",
      20,
      4,
      {
        B2: { text: "Section A", styleIdx: 0 },
        B4: { text: "Section B", styleIdx: 0 },
        B6: { text: "Loan Balance at Maturity", styleIdx: 0 },
        B8: { text: "Outstanding Principal", styleIdx: 1 },
      },
      styles,
    );
    const wb = buildWorkbook([sheet]);
    const warning = headerStyledRowWarning(wb, plan([{ sheet: "S", range: "C6", value: 999 }]));
    expect(warning).toContain("Restraint check (header-styled row):");
    expect(warning).toContain("S row 6's label (B6) has this sheet's section-title styling");
    expect(warning).toContain("headings, not data rows");
    expect(warning).toContain("e.g. row 8");
  });
});

// ---------------------------------------------------------------------------
// Combined entry point
// ---------------------------------------------------------------------------

describe("restraintWarnings", () => {
  it("returns null when neither lever finds anything", () => {
    const sheet = buildSheet("S", 10, 4, { B1: { text: "Metric" }, C1: { num: 5 }, C2: { num: 1 } });
    const wb = buildWorkbook([sheet]);
    expect(restraintWarnings(wb, plan([{ sheet: "S", range: "C2", value: 1 }]))).toBeNull();
  });

  it("joins both levers' text when both fire", () => {
    const styles = [HEADER_STYLE, PLAIN_STYLE];
    const sheet = buildSheet(
      "S",
      20,
      6,
      {
        // Lever 1 shape: headerless block.
        B1: { text: "Section" },
        B4: { text: "Metric X" },
        // Lever 2 shape: header-styled row, unrelated column/rows.
        B10: { text: "Section A", styleIdx: 0 },
        B12: { text: "Section B", styleIdx: 0 },
        B14: { text: "Loan Balance at Maturity", styleIdx: 0 },
        B16: { text: "Outstanding Principal", styleIdx: 1 },
      },
      styles,
    );
    const wb = buildWorkbook([sheet]);
    const p = plan([
      { sheet: "S", range: "C4", value: 1 },
      { sheet: "S", range: "D14", value: 999 },
    ]);
    const warning = restraintWarnings(wb, p);
    expect(warning).toContain("Restraint check (uncorroborated column):");
    expect(warning).toContain("Restraint check (header-styled row):");
  });
});
