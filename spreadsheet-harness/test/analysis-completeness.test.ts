import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  findIncompleteAreas,
  hasCompletionTrigger,
  type IncompleteArea,
} from "@/lib/analysis/completeness";
import { parseWorkbook } from "@/lib/workbook";
import { xlsxBytes, type CellSpec } from "./helpers/workbooks";

function wbOf(sheets: Record<string, CellSpec[][]>) {
  return parseWorkbook(xlsxBytes(sheets), "completeness.xlsx");
}

/** Like xlsxBytes, but lets the caller declare merged cells — xlsxBytes
 *  itself never writes a `!merges` entry. */
function xlsxBytesWithMerges(
  rows: CellSpec[][],
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[],
): Uint8Array {
  const aoa = rows.map((row) => row.map((c) => (typeof c === "object" && c !== null ? null : c)));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

function findKind(areas: IncompleteArea[], kind: IncompleteArea["kind"]): IncompleteArea[] {
  return areas.filter((a) => a.kind === kind);
}

describe("hasCompletionTrigger", () => {
  it("matches the exact preamble sentence, case-insensitively", () => {
    expect(hasCompletionTrigger("Complete the financial model based on the provided assumptions.")).toBe(true);
    expect(hasCompletionTrigger("please COMPLETE THE FINANCIAL MODEL now")).toBe(true);
  });

  it("does not match unrelated instructions", () => {
    expect(hasCompletionTrigger("Fix the #DIV/0! error in the summary tab.")).toBe(false);
    expect(hasCompletionTrigger("Build a chart of monthly revenue.")).toBe(false);
  });
});

describe("findIncompleteAreas: row-gap", () => {
  it("finds a row that stops short of where its neighbors reach", () => {
    const wb = wbOf({
      Model: [
        ["Label", 2019, 2020, 2021, 2022],
        ["Revenue", 10, 11, 12, 13],
        ["EPS", 1, 2, null, null], // D3:E3 blank — the gap
        ["Margin", 5, 6, 7, 8],
      ],
    });
    const { areas, omitted } = findIncompleteAreas(wb);
    expect(omitted).toBe(0);
    const hits = findKind(areas, "row-gap");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sheet: "Model", range: "D3:E3", kind: "row-gap" });
    expect(hits[0].evidence).toMatch(/blank D:E/);
    expect(hits[0].id).toBe("A1");
  });

  it("requires at least 3 populated cells in the row before considering it", () => {
    // Only 2 populated cells ("Small", 1) — too little context to call the
    // rest of the row a gap rather than a naturally short row.
    const wb = wbOf({
      Model: [
        ["Full", 1, 2, 3, 4],
        ["Small", 1, null, null, null],
        ["Full2", 1, 2, 3, 4],
      ],
    });
    const { areas } = findIncompleteAreas(wb);
    expect(findKind(areas, "row-gap")).toHaveLength(0);
  });
});

describe("findIncompleteAreas: sequence-gap", () => {
  it("finds a year-style step-1 sequence that stops while siblings extend further", () => {
    const wb = wbOf({
      Model: [
        [null, 2020, 2021, null, null, null], // stops at C1; D1:F1 could continue
        ["Revenue", 10, 11, 12, 13, 14],
        ["Costs", 1, 2, 3, 4, 5],
      ],
    });
    const { areas, omitted } = findIncompleteAreas(wb);
    expect(omitted).toBe(0);
    const hits = findKind(areas, "sequence-gap");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sheet: "Model", range: "D1:F1", kind: "sequence-gap" });
    expect(hits[0].evidence).toMatch(/step-1 numeric sequence/);
  });

  it("does not fire on a sequence that already reaches the sheet's used edge", () => {
    const wb = wbOf({
      Model: [
        [null, 2020, 2021, 2022],
        ["Revenue", 10, 11, 12],
      ],
    });
    const { areas } = findIncompleteAreas(wb);
    expect(findKind(areas, "sequence-gap")).toHaveLength(0);
  });

  it("treats a merged header cell as populated, not a gap (regression: real Comps-sheet false positive)", () => {
    // A merged group header ("Group Header" spanning B1:E1, Excel-style) has
    // no raw cell entries for C1:E1 at all — sheet.cells only carries the
    // anchor. Without merge-awareness those three cells look identically
    // blank to a genuine gap, and two fully populated neighbor rows
    // corroborate it into a false positive.
    const rowsAoa: CellSpec[][] = [
      [null, "Group Header", null, null, null],
      ["Ref", 1, 2, 3, 4],
      ["Ref2", 1, 2, 3, 4],
    ];
    const unmerged = parseWorkbook(xlsxBytesWithMerges(rowsAoa, []), "unmerged.xlsx");
    const merged = parseWorkbook(
      xlsxBytesWithMerges(rowsAoa, [{ s: { r: 0, c: 1 }, e: { r: 0, c: 4 } }]),
      "merged.xlsx",
    );

    // Confirms the fixture is real: without declaring the merge, the false
    // positive this test guards against does happen.
    expect(findIncompleteAreas(unmerged).areas.length).toBeGreaterThan(0);

    // With the merge declared (matching what the real .xlsx actually has),
    // C1:E1 count as part of the merged header, not a blank run.
    expect(findIncompleteAreas(merged).areas).toEqual([]);
  });
});

describe("findIncompleteAreas: labeled-empty-row", () => {
  it("finds a lone label row sandwiched between populated rows", () => {
    const wb = wbOf({
      Ratios: [
        ["Quick Ratio", 1.2, 1.3, 1.4],
        ["Current Ratio", null, null, null], // B2:D2 blank — the gap
        ["Debt Ratio", 0.5, 0.6, 0.7],
      ],
    });
    const { areas, omitted } = findIncompleteAreas(wb);
    expect(omitted).toBe(0);
    const hits = findKind(areas, "labeled-empty-row");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sheet: "Ratios", range: "B2:D2", kind: "labeled-empty-row" });
    expect(hits[0].evidence).toContain("Current Ratio");
  });

  it("handles two label-only blocks side by side on the same row", () => {
    // A common financial-model layout: two peer companies' figures placed
    // next to each other, each with its own label column.
    const wb = wbOf({
      Peers: [
        ["Astral", null, null, null, "Supreme", null, null, null],
        ["Revenue", 10, 20, 30, "Revenue", 40, 50, 60],
        ["EBITDA", null, null, null, "EBITDA", null, null, null],
        ["EBIT", 1, 2, 3, "EBIT", 4, 5, 6],
      ],
    });
    const { areas } = findIncompleteAreas(wb);
    const hits = findKind(areas, "labeled-empty-row");
    // Row 1 (Astral/Supreme header labels) and row 3 (EBITDA/EBITDA) each
    // have two independent label-only blocks.
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.some((h) => h.range === "B3:D3")).toBe(true);
    expect(hits.some((h) => h.range === "F3:H3")).toBe(true);
  });
});

describe("findIncompleteAreas: dense sheet", () => {
  it("finds nothing in a fully rectangular, fully populated table", () => {
    const wb = wbOf({
      Table: [
        ["Item", "Q1", "Q2", "Q3"],
        ["Widget A", 10, 20, 30],
        ["Widget B", 15, 25, 35],
        ["Widget C", 5, 10, 15],
        ["Widget D", 8, 16, 24],
      ],
    });
    const { areas, omitted } = findIncompleteAreas(wb);
    expect(areas).toEqual([]);
    expect(omitted).toBe(0);
  });
});

describe("findIncompleteAreas: merging", () => {
  it("merges adjacent rows with the same blank span into one area", () => {
    const wb = wbOf({
      Merge: [
        ["Ref0", 1, 2, 3, 4, 5],
        ["Metric1", 1, 2, null, null, null], // D2:F2 blank
        ["Metric2", 1, 2, null, null, null], // D3:F3 blank, adjacent to the above
        ["Ref3", 1, 2, 3, 4, 5],
        ["Ref4", 1, 2, 3, 4, 5],
      ],
    });
    const { areas, omitted } = findIncompleteAreas(wb);
    expect(omitted).toBe(0);
    // Two adjacent row-gap hits over the same columns collapse into one
    // area spanning both rows, rather than spending two of the 40 slots on
    // what is clearly a single two-row gap. Priority also confirms
    // row-gap wins over the sequence-gap heuristic that also fires here
    // (Metric1/Metric2's "1, 2" is itself a step-1 run of length 2).
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ sheet: "Merge", range: "D2:F3", kind: "row-gap" });
  });
});

describe("findIncompleteAreas: cap", () => {
  it("caps at 40 areas and reports how many were omitted", () => {
    const GROUPS = 44;
    // Fix 2 note: each group's blank span now sits at a DIFFERENT column
    // pair (staggered across 20 positions, each used at most 3 times)
    // rather than always "D:E" as this fixture originally had it — with all
    // 44 groups sharing one identical span, the row-gap recurrence filter
    // this test suite now also covers (see the "recurrence filter" describe
    // block below) correctly recognizes that as sheet structure, not
    // incompleteness, and drops every one of them. That's the desired
    // behavior for a real sheet, but it defeats THIS test's actual purpose
    // (proving the 40-area cap/omitted-count mechanism), so the fixture
    // varies the span position enough to stay under the recurrence
    // threshold (see RECURRENCE_THRESHOLD's doc) while still producing 44
    // distinct row-gap hits. Filler is text ("v0", "v1", ...), not a step-1
    // numeric run, so the sequence-gap heuristic never fires alongside it.
    const ROW_WIDTH = 30;
    const full = (): CellSpec[] => Array.from({ length: ROW_WIDTH }, (_, c) => `v${c}`);
    const withGap = (start: number): CellSpec[] =>
      Array.from({ length: ROW_WIDTH }, (_, c) => (c === start || c === start + 1 ? null : `v${c}`));

    const rows: CellSpec[][] = [];
    for (let g = 0; g < GROUPS; g++) {
      const start = 2 + (g % 20); // 20 distinct positions (2..21), each used <= 3 times
      rows.push(full());
      rows.push(withGap(start)); // one gap per group, position staggered by group
      rows.push(full());
      rows.push([]); // spacer so groups don't corroborate each other's gaps
    }
    const wb = wbOf({ Big: rows });
    const { areas, omitted } = findIncompleteAreas(wb);
    expect(areas).toHaveLength(40);
    expect(omitted).toBe(GROUPS - 40);
    // Ids are stable "A1".."A40" in priority order.
    expect(areas.map((a) => a.id)).toEqual(Array.from({ length: 40 }, (_, i) => `A${i + 1}`));
  });
});

describe("findIncompleteAreas: row-gap recurrence filter (Fix 2)", () => {
  // Real failure: FM task 06_02's "Assumption sheet" has an identical
  // 2-column blank span (the J:K "Additions"/"Deductions" shape) recurring
  // at rows 13, 17, 21, 25, 29, 33, 37, 41, 48, 52... across dozens of
  // otherwise-populated metric rows — deliberate sheet structure
  // (spot-verified blank in the golden too), not incompleteness. It produced
  // 196 raw row-gap candidates that flooded the 40-area cap, and the
  // mandatory coverage accounting over all of them burned the model's whole
  // turn budget before it ever submitted a plan.
  const WIDTH = 14; // A..N

  /** A row fully populated across [0, WIDTH), except `gapCols` (a [start,
   *  end] pair, inclusive) left blank when supplied. */
  function rowOf(gapCols?: [number, number]): CellSpec[] {
    return Array.from({ length: WIDTH }, (_, c) => (gapCols && c >= gapCols[0] && c <= gapCols[1] ? null : `v${c}`));
  }

  it("drops a blank span recurring across 8 rows on the same sheet as sheet structure, not incompleteness", () => {
    const GAP_ROWS = new Set([12, 16, 20, 24, 28, 32, 36, 40]); // 0-indexed
    const rows: CellSpec[][] = [];
    for (let r = 0; r < 45; r++) rows.push(rowOf(GAP_ROWS.has(r) ? [9, 10] : undefined));
    const wb = wbOf({ "Assumption sheet": rows });
    const { areas } = findIncompleteAreas(wb);
    expect(findKind(areas, "row-gap")).toHaveLength(0);
  });

  it("still flags a genuine one-off row-gap on a sheet that also has a recurring structural span", () => {
    const GAP_ROWS = new Set([12, 16, 20, 24, 28, 32, 36, 40]); // structural — dropped
    const rows: CellSpec[][] = [];
    for (let r = 0; r < 45; r++) {
      // Row 30: a unique gap (cols C:D) far from every structural row, so
      // it neither merges nor shares a span with any of them.
      rows.push(r === 30 ? rowOf([2, 3]) : rowOf(GAP_ROWS.has(r) ? [9, 10] : undefined));
    }
    const wb = wbOf({ Model: rows });
    const { areas } = findIncompleteAreas(wb);
    const hits = findKind(areas, "row-gap");
    expect(hits.some((h) => h.range === "C31:D31")).toBe(true); // the genuine one-off, kept
    expect(hits.every((h) => h.range !== "J13:K13")).toBe(true); // none of the structural rows survive
  });

  it("keeps a span recurring in exactly RECURRENCE_THRESHOLD - 1 other rows (boundary)", () => {
    // 4 rows share the identical span (cols F:G). Each one sees exactly 3
    // OTHER rows with that same span — one short of the "dropped when >= 4
    // other rows share it" threshold — so all 4 must still be flagged.
    // Spaced 6 rows apart so none corroborate or merge with each other.
    const SHARED_ROWS = new Set([4, 10, 16, 22]);
    const rows: CellSpec[][] = [];
    for (let r = 0; r < 26; r++) rows.push(rowOf(SHARED_ROWS.has(r) ? [5, 6] : undefined));
    const wb = wbOf({ Model: rows });
    const { areas } = findIncompleteAreas(wb);
    expect(findKind(areas, "row-gap")).toHaveLength(4);
  });
});
