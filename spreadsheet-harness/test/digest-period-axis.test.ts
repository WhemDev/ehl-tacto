import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseWorkbook, type ParsedWorkbook } from "@/lib/workbook";
import { buildFileDigest, detectSheetPeriodAxis } from "@/lib/digest";
import { digestBlock } from "@/lib/anthropic/prompts";

/**
 * Cross-sheet period-axis comparison: detectSheetPeriodAxis (the per-sheet
 * primitive) plus the file-level notes buildFileDigest derives from it. See
 * the "Cross-sheet period-axis comparison" section of lib/digest.ts for the
 * motivating case (Financial_Model/01_02: a sheet whose FY axis quietly
 * stays one year behind its siblings after the rest get extended).
 */

/** UTC midnight for an ISO date — matches how a real date-typed cell comes
 *  back from parseWorkbook (lib/workbook.ts's own displayText round-trips
 *  through the same toISOString().slice(0, 10)). */
function d(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** `count` fiscal-year-end dates, one per column, year incrementing with
 *  month/day held fixed — the shape a real DCF model's header row takes. */
function annualDates(startYear: number, count: number, monthDay = "03-31"): Date[] {
  return Array.from({ length: count }, (_, i) => d(`${startYear + i}-${monthDay}`));
}

/** `count` first-of-month dates starting at `startIso`. */
function monthlyDates(startIso: string, count: number): Date[] {
  const first = d(startIso);
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, first.getUTCDate())),
  );
}

/** `count` calendar-quarter-end dates starting at `startIso` (a month-end). */
function quarterlyDates(startIso: string, count: number): Date[] {
  const first = d(startIso);
  return Array.from({ length: count }, (_, i) => {
    // Land on the last day of (month + 3*i) by asking for day 0 of the month after.
    return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 3 * i + 1, 0));
  });
}

/** Multi-sheet workbook straight from row-major arrays — the house fixture
 *  pattern (test/digest-budget.test.ts's xlsxBytes), extended with
 *  `cellDates: true` so a literal `Date` in the array round-trips as a
 *  proper date-typed cell (test/digest-precompute.test.ts's toSheet uses
 *  the same option, for the same reason). */
function workbook(sheets: Record<string, unknown[][]>): ParsedWorkbook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), name);
  }
  const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
  return parseWorkbook(bytes, "test.xlsx");
}

/** A label in column A, the given dates starting at column B, and one data
 *  row underneath — a period-axis header followed by a data row, the shape
 *  every real example takes. */
function axisRow(dates: Date[]): unknown[][] {
  return [["Particulars", ...dates], ["Revenue", ...dates.map((_, i) => 100 + i)]];
}

function notesOf(wb: ParsedWorkbook): string {
  return buildFileDigest(wb).notes.join(" ");
}

describe("detectSheetPeriodAxis", () => {
  it("detects a simple annual run and reports its row, columns, step and last date", () => {
    const sheet = workbook({ Sheet1: axisRow(annualDates(2021, 5)) }).sheets[0];
    const axis = detectSheetPeriodAxis(sheet);
    // lastDate is asserted as a date-only string, not a Date equality: a
    // literal Date round-tripped through aoa_to_sheet/XLSX.write picks up a
    // sub-day offset from the *local* machine's timezone (SheetJS's write
    // path reads local time fields), which would make this flaky depending
    // on where the test runs. The offset never crosses a day boundary here,
    // and the day is exactly what the feature itself reports (see isoDate
    // in lib/digest.ts) — so this is what's worth pinning down.
    expect(axis).toMatchObject({
      sheet: "Sheet1",
      row: 1,
      startCol: "B",
      endCol: "F",
      step: "annual",
      length: 5,
    });
    expect(axis?.lastDate.toISOString().slice(0, 10)).toBe("2025-03-31");
  });

  it("detects monthly and quarterly steps too", () => {
    const monthly = workbook({ M: axisRow(monthlyDates("2025-01-01", 4)) }).sheets[0];
    expect(detectSheetPeriodAxis(monthly)?.step).toBe("monthly");

    const quarterly = workbook({ Q: axisRow(quarterlyDates("2025-01-31", 4)) }).sheets[0];
    expect(detectSheetPeriodAxis(quarterly)?.step).toBe("quarterly");
  });

  it("returns null for a run shorter than 3 dates", () => {
    const sheet = workbook({ Sheet1: axisRow(annualDates(2021, 2)) }).sheets[0];
    expect(detectSheetPeriodAxis(sheet)).toBeNull();
  });

  it("returns null when consecutive gaps don't agree on one step", () => {
    // Monthly gap, then a multi-year jump: no single band fits both.
    const mixed = [d("2021-01-01"), d("2021-02-01"), d("2025-01-01")];
    const sheet = workbook({ Sheet1: axisRow(mixed) }).sheets[0];
    expect(detectSheetPeriodAxis(sheet)).toBeNull();
  });

  it("ignores an axis outside the top 6 rows", () => {
    const pad = Array.from({ length: 6 }, (_, i) => [`pad${i}`]);
    const rows = [...pad, ...axisRow(annualDates(2021, 5))]; // axis header lands on row 7
    const sheet = workbook({ Sheet1: rows }).sheets[0];
    expect(detectSheetPeriodAxis(sheet)).toBeNull();
  });

  it("picks the longer of two candidate rows on the same sheet", () => {
    const short = [null, ...annualDates(2026, 3)]; // row 1: 3 dates
    const long = ["Particulars", ...annualDates(2021, 6)]; // row 2: 6 dates, later end
    const sheet = workbook({ Sheet1: [short, long] }).sheets[0];
    const axis = detectSheetPeriodAxis(sheet);
    expect(axis?.row).toBe(2);
    expect(axis?.length).toBe(6);
  });
});

describe("cross-sheet period-axis notes", () => {
  it("emits an inventory note when sheets share an axis, listing sheet names", () => {
    const dates = annualDates(2021, 5); // ... 2025-03-31, col F
    const wb = workbook({
      "Sheet A": axisRow(dates),
      "Sheet B": axisRow(dates),
      "Sheet C": axisRow(dates),
    });
    const text = notesOf(wb);
    expect(text).toMatch(/Shared period axis \(annual, ends 2025-03-31, col F\) across 3 sheets/);
    expect(text).toContain("'Sheet A'");
    expect(text).toContain("'Sheet B'");
    expect(text).toContain("'Sheet C'");
    // Aligned axes are silent about misalignment — no note for equal ends.
    expect(text).not.toMatch(/Period axes \(/);
  });

  it("names a sheet whose axis ends one period earlier, with its own last cell", () => {
    const dates = annualDates(2021, 5); // ... 2025-03-31, col F
    const behind = annualDates(2021, 4); // ... 2024-03-31, col E — one year short
    const wb = workbook({
      "Sheet A": axisRow(dates),
      "Sheet B": axisRow(dates),
      "Sheet C": axisRow(dates),
      "Sheet D": axisRow(behind),
    });
    const text = notesOf(wb);
    expect(text).toMatch(/Period axes \(annual\): most sheets end col F \(2025-03-31/);
    expect(text).toContain("'Sheet D' ends E1 (2024-03-31), 1 period behind");
  });

  it("does not flag a sheet whose window is legitimately much shorter, not merely behind", () => {
    // Five years behind, not one — a segment table that only ever shows a
    // shorter history, not a straggler someone forgot to extend.
    const dates = annualDates(2021, 10); // ends 2030-03-31
    const muchShorter = annualDates(2021, 5); // ends 2025-03-31
    const wb = workbook({
      "Sheet A": axisRow(dates),
      "Sheet B": axisRow(dates),
      "Sheet C": axisRow(muchShorter),
      "Sheet D": axisRow(muchShorter),
    });
    const text = notesOf(wb);
    expect(text).toMatch(/Shared period axis/);
    expect(text).not.toMatch(/Period axes \(/);
  });

  it("detects no axis from fewer than 3 dates in a row, so no note fires", () => {
    const wb = workbook({
      "Sheet A": axisRow(annualDates(2021, 2)),
      "Sheet B": axisRow(annualDates(2021, 2)),
    });
    const text = notesOf(wb);
    expect(text).not.toContain("Shared period axis");
    expect(text).not.toMatch(/Period axes \(/);
  });

  it("does not compare a monthly axis against an annual one", () => {
    const wb = workbook({
      "Monthly Sheet": axisRow(monthlyDates("2025-01-01", 5)),
      "Annual Sheet": axisRow(annualDates(2021, 5)),
    });
    const text = notesOf(wb);
    // Neither step reaches two sheets sharing it, so no cross-group note —
    // and in particular, never one that mixes a monthly sheet with an
    // annual one.
    expect(text).not.toContain("Shared period axis");
    expect(text).not.toMatch(/Period axes \(/);
  });

  it("keeps monthly and annual groups separate even when both qualify on their own", () => {
    const wb = workbook({
      "Monthly A": axisRow(monthlyDates("2025-01-01", 4)),
      "Monthly B": axisRow(monthlyDates("2025-01-01", 4)),
      "Annual A": axisRow(annualDates(2021, 5)),
      "Annual B": axisRow(annualDates(2021, 5)),
    });
    const digest = buildFileDigest(wb);
    const periodNotes = digest.notes.filter(
      (n) => n.startsWith("Shared period axis") || n.startsWith("Period axes"),
    );
    expect(periodNotes).toHaveLength(2); // one inventory note per step
    for (const note of periodNotes) {
      const mentionsMonthly = /Monthly [AB]/.test(note);
      const mentionsAnnual = /Annual [AB]/.test(note);
      expect(mentionsMonthly && mentionsAnnual).toBe(false); // never both in one note
    }
  });

  it("caps the inventory list at 6 names and counts the rest", () => {
    const dates = annualDates(2021, 5);
    const sheets: Record<string, unknown[][]> = {};
    for (let i = 1; i <= 9; i++) sheets[`Sheet${i}`] = axisRow(dates);
    const wb = workbook(sheets);
    const text = notesOf(wb);
    const note = text.match(/Shared period axis[^.]*\./)?.[0] ?? "";
    const names = note.match(/'[^']+'/g) ?? [];
    expect(names).toHaveLength(6);
    expect(note).toContain("across 9 sheets");
    expect(note).toContain("+3 more");
  });

  it("stays silent on a single flat-table sheet", () => {
    const wb = workbook({ Data: [["Name", "Qty"], ["a", 1], ["b", 2]] });
    const text = notesOf(wb);
    expect(text).not.toContain("Shared period axis");
    expect(text).not.toMatch(/Period axes \(/);
  });

  it("calls out a sheet whose axis sits on an unusual row for its cluster", () => {
    const dates = annualDates(2021, 5);
    const onOtherRow = [["Title"], ...axisRow(dates)]; // same axis, one row lower
    const wb = workbook({
      "Sheet A": axisRow(dates),
      "Sheet B": axisRow(dates),
      "Sheet C": onOtherRow,
    });
    const text = notesOf(wb);
    expect(text).toContain("'Sheet C' (row 2)");
    // Sheets on the common row are not annotated.
    expect(text).not.toContain("'Sheet A' (row");
  });

  it("renders into the digestBlock text the prompts actually send", () => {
    const dates = annualDates(2021, 5);
    const wb = workbook({
      "Sheet A": axisRow(dates),
      "Sheet B": axisRow(dates),
      "Sheet C": axisRow(dates),
    });
    const digest = buildFileDigest(wb);
    expect(digestBlock([digest])).toContain("Shared period axis");
  });
});
