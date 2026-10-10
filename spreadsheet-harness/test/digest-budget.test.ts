import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildFileDigest, TOKEN_BUDGET_PER_FILE } from "@/lib/digest";
import { digestBlock } from "@/lib/anthropic/prompts";
import { parseWorkbook, type ParsedWorkbook } from "@/lib/workbook";

/** Real .xlsx bytes from row-major arrays — the house fixture pattern. */
function xlsxBytes(sheets: Record<string, (string | number | null)[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

function smallWb(): ParsedWorkbook {
  return parseWorkbook(
    xlsxBytes({ Data: [["Name", "Qty"], ["a", 1], ["b", 2]] }),
    "small.xlsx",
  );
}

/** A workbook drowning in legacy junk names, plus a few real ones. */
function junkNamesWb(): ParsedWorkbook {
  const wb = smallWb();
  const junk = Array.from({ length: 5000 }, (_, i) => ({
    name: `${"_".repeat(1 + (i % 20))}a${i}`,
    ref: `{"2",#N/A,FALSE,TRUE}`,
  }));
  wb.definedNames = [
    { name: "TaxRate", ref: "Assumptions!$B$2" },
    { name: "Horizon", ref: "Assumptions!$B$3" },
    ...junk,
  ];
  // A formula that references one of the real names, so ranking has signal.
  wb.sheets[0].cells.set("1:1", {
    row: 1, col: 1, value: 5, text: "5", type: "number", formula: "A2*TaxRate",
  });
  return wb;
}

describe("defined-name capping", () => {
  it("keeps small workbooks untouched", () => {
    const d = buildFileDigest(smallWb());
    expect(d.definedNames).toHaveLength(0);
    expect(d.omittedDefinedNames ?? 0).toBe(0);
  });

  it("caps junk-heavy name lists and counts the omissions", () => {
    const d = buildFileDigest(junkNamesWb());
    expect(d.definedNames.length).toBeLessThanOrEqual(200);
    expect(d.omittedDefinedNames).toBe(5002 - d.definedNames.length);
    // The formula-referenced name must survive the cut, first.
    expect(d.definedNames[0].name).toBe("TaxRate");
    // Junk refs sort behind every valid ref.
    const junkIndex = d.definedNames.findIndex((n) => n.ref.startsWith("{"));
    const validCount = d.definedNames.filter((n) => !n.ref.startsWith("{")).length;
    if (junkIndex !== -1) expect(junkIndex).toBeGreaterThanOrEqual(validCount);
  });

  it("renders the omission count in the digest block", () => {
    const d = buildFileDigest(junkNamesWb());
    const text = digestBlock([d]);
    expect(text).toMatch(/\+ [\d,]+ more omitted/);
  });

  it("fits the token budget on a junk-names workbook", () => {
    const d = buildFileDigest(junkNamesWb());
    expect(d.approxTokens).toBeLessThanOrEqual(TOKEN_BUDGET_PER_FILE);
  });
});

describe("column-stats capping", () => {
  function wideWb(): ParsedWorkbook {
    const header = Array.from({ length: 150 }, (_, i) => `H${i + 1}`);
    const row = Array.from({ length: 150 }, (_, i) => i);
    return parseWorkbook(
      xlsxBytes({ Wide: [header, row, row, row] }),
      "wide.xlsx",
      { maxRows: 5000, maxCols: 16_384 },
    );
  }

  it("caps per-sheet column statistics at the plan's sectionColumns", () => {
    const d = buildFileDigest(wideWb());
    const sheet = d.sheets[0];
    expect(sheet.columns.length).toBeLessThanOrEqual(60);
    for (const r of sheet.sampleRows) expect(r.length).toBeLessThanOrEqual(60);
    expect(sheet.notes.join(" ")).toMatch(/column statistics shown for the first 60 of \d+/);
  });

  it("leaves narrow sheets un-noted", () => {
    const d = buildFileDigest(smallWb());
    expect(d.sheets[0].notes.join(" ")).not.toMatch(/column statistics shown/);
  });
});

describe("the budget is a contract", () => {
  /** A 01_01-shaped monster: many sheets, wide, drowning in junk defined names. */
  function monsterWb(): ParsedWorkbook {
    const header = Array.from({ length: 150 }, (_, i) => `H${i + 1}`);
    const row = Array.from({ length: 150 }, (_, i) => `v${i}`);
    const sheets: Record<string, (string | number | null)[][]> = {};
    for (let s = 0; s < 25; s++) sheets[`Sheet${s + 1}`] = [header, ...Array(40).fill(row)];
    const wb = parseWorkbook(xlsxBytes(sheets), "monster.xlsx", { maxRows: 5000, maxCols: 16_384 });
    wb.definedNames = Array.from({ length: 10_000 }, (_, i) => ({
      name: `_${"_".repeat(i % 25)}x${i}`,
      ref: `{"2",#N/A,FALSE}`,
    }));
    return wb;
  }

  it("holds on a 01_01-shaped monster (many sheets, wide, junk names)", () => {
    const d = buildFileDigest(monsterWb());
    expect(d.approxTokens).toBeLessThanOrEqual(TOKEN_BUDGET_PER_FILE);
    // The complete sheet list survives no matter what.
    expect(d.sheets).toHaveLength(25);
    for (const s of d.sheets) {
      expect(s.name).toBeTruthy();
      expect(s.usedRange).toBeTruthy();
    }
  });

  it("hard-strips per-sheet detail when even the tightest plan cannot fit", () => {
    const d = buildFileDigest(monsterWb(), 3000);
    expect(d.approxTokens).toBeLessThanOrEqual(3000);
    expect(d.notes.join(" ")).toMatch(/hard-truncated/);
    // Stripped sheets keep identity but lose detail.
    expect(d.sheets).toHaveLength(25);
    expect(d.sheets.some((s) => s.columns.length === 0 && s.notes.length === 0)).toBe(true);
    for (const s of d.sheets) {
      expect(s.name).toBeTruthy();
      expect(s.usedRange).toBeTruthy();
    }
  });
});
