import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseWorkbook, type ParsedSheet } from "@/lib/workbook";
import { buildFileDigest, type FileDigest } from "@/lib/digest";
import { digestBlock } from "@/lib/anthropic/prompts";

/**
 * Digest precompute: the period axis, anchor cells and the derived-block
 * flag (see docs/superpowers/specs/2026-08-14-digest-precompute-and-model-
 * migration-design.md, §1 "New detection").
 *
 * Every one of these must emit nothing when its precondition is absent — no
 * block layout, no date row, no absolute refs — which is what proves the
 * change generalises rather than special-casing one file's shape. Each
 * describe block below checks a flat table stays silent for that reason.
 */

function toSheet(aoa: unknown[][], wire?: (ws: XLSX.WorkSheet) => void): ParsedSheet {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  wire?.(ws);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return parseWorkbook(
    new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer),
    "test.xlsx",
  ).sheets[0];
}

function digestOf(sheet: ParsedSheet): FileDigest {
  return buildFileDigest({ id: "t", fileName: "test.xlsx", sheets: [sheet], definedNames: [] });
}

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function addMonths(iso: string, n: number): string {
  const dt = d(iso);
  dt.setUTCMonth(dt.getUTCMonth() + n);
  return dt.toISOString().slice(0, 10);
}

function flatTable(): ParsedSheet {
  const aoa: unknown[][] = [["Order", "Qty", "Price"]];
  for (let i = 0; i < 20; i++) aoa.push([`A-${i}`, i, i * 2]);
  return toSheet(aoa);
}

/* ------------------------------------------------------------------ *
 * B1: period axis
 * ------------------------------------------------------------------ */

function blockLayoutSheet(months: string[]): ParsedSheet {
  const aoa: unknown[][] = [[]];
  for (const p of ["A", "B", "C"]) {
    // A second non-empty cell keeps this row out of detectSections' single-cell
    // heuristic (see repeated-blocks.test.ts's PRODUCTS fixture) so it falls
    // through to detectRepeatedBlocks, which is what this fixture is testing.
    aoa.push([`${p} - product`, "note", ...months.slice(1).map(() => null)]);
    aoa.push(["Period", ...months.map((m) => d(m))]);
    aoa.push(["Forecast", ...months.map((_, i) => 100 + i)]);
    aoa.push(["Purchase Order", ...months.map((_, i) => 10 + i)]);
  }
  return toSheet(aoa, (ws) => {
    // "Period" is the second row of each 4-row block (title, Period, Forecast, Purchase Order).
    for (let block = 0; block < 3; block++) {
      const row = 2 + block * 4;
      for (let c = 1; c <= months.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: row, c });
        if (ws[addr]) ws[addr].z = "mmm-yy";
      }
    }
  });
}

describe("period axis", () => {
  const months = ["2025-06-01", "2025-07-01", "2025-08-01", "2025-09-01", "2025-10-01", "2025-11-01"];
  const labels = ["Jun-25", "Jul-25", "Aug-25", "Sep-25", "Oct-25", "Nov-25"];

  it("states which column is which period, once per sheet", () => {
    const digest = digestOf(blockLayoutSheet(months));
    const sheet = digest.sheets[0];
    expect(sheet.periodAxis).toEqual(
      labels.map((label, i) => ({ column: XLSX.utils.encode_col(i + 1), label })),
    );
    expect(digestBlock([digest])).toContain(
      "period axis: B=Jun-25, C=Jul-25, D=Aug-25, E=Sep-25, F=Oct-25, G=Nov-25",
    );
  });

  it("caps the rendered line instead of printing a wide sheet's whole axis", () => {
    const wide = Array.from({ length: 30 }, (_, i) => addMonths("2025-01-01", i));
    const digest = digestOf(blockLayoutSheet(wide));
    expect(digest.sheets[0].periodAxis).toHaveLength(30); // the digest field itself is not capped
    const rendered = digestBlock([digest]);
    const line = rendered.split("\n").find((l) => l.includes("period axis:"))!;
    expect(line).toContain("B=Jan-25"); // first
    expect(line).toContain("…");
    expect(line).toMatch(/=Jun-27$/); // last of 30 months from Jan-25
    expect(line).not.toContain("Jan-26"); // a middle entry, dropped by the cap
  });

  it("emits nothing for a flat table", () => {
    const digest = digestOf(flatTable());
    expect(digest.sheets[0].periodAxis).toBeNull();
    expect(digestBlock([digest])).not.toContain("period axis:");
  });
});

/* ------------------------------------------------------------------ *
 * B2: anchor cells
 * ------------------------------------------------------------------ */

function sheetWithAbsoluteRef(): ParsedSheet {
  const aoa: unknown[][] = [["Item", "Qty", "Adjusted"]];
  for (let i = 0; i < 10; i++) aoa.push([`Item-${i}`, 100 + i, null]);
  aoa.push([5]); // row 12: A12 holds the divisor
  return toSheet(aoa, (ws) => {
    for (let r = 2; r <= 11; r++) {
      ws[`C${r}`] = { t: "n", f: `B${r}/$A$12`, v: (100 + (r - 2)) / 5 };
    }
  });
}

function sheetWithoutAbsoluteRef(): ParsedSheet {
  const aoa: unknown[][] = [["A", "B", "C"]];
  for (let i = 0; i < 10; i++) aoa.push([i, i * 2, null]);
  return toSheet(aoa, (ws) => {
    for (let r = 2; r <= 11; r++) {
      ws[`C${r}`] = { t: "n", f: `A${r}+B${r}`, v: 1 };
    }
  });
}

describe("anchor cells", () => {
  it("surfaces an absolute ref with its resolved value and where it's used", () => {
    const digest = digestOf(sheetWithAbsoluteRef());
    const sheet = digest.sheets[0];
    expect(sheet.anchors).toEqual([{ cell: "A12", value: "5", usedIn: ["C2:C11"] }]);
    expect(digestBlock([digest])).toContain("anchors: A12 = 5 (used in C2:C11 formulas)");
  });

  it("does not label a range's own corners as anchors", () => {
    // $B$2:$B$99-style range bounds are not a single named parameter cell.
    const aoa: unknown[][] = [["Key", "Val", "Out"]];
    for (let i = 0; i < 10; i++) aoa.push([`k${i}`, i, null]);
    const sheet = toSheet(aoa, (ws) => {
      for (let r = 2; r <= 11; r++) {
        ws[`C${r}`] = { t: "n", f: `SUMIF($A$2:$A$11,A${r},$B$2:$B$11)`, v: 1 };
      }
    });
    expect(digestOf(sheet).sheets[0].anchors).toEqual([]);
  });

  it("emits nothing on a sheet with no absolute refs", () => {
    const digest = digestOf(sheetWithoutAbsoluteRef());
    expect(digest.sheets[0].anchors).toEqual([]);
    expect(digestBlock([digest])).not.toContain("anchors:");
  });

  it("emits nothing for a flat table", () => {
    const digest = digestOf(flatTable());
    expect(digest.sheets[0].anchors).toEqual([]);
    expect(digestBlock([digest])).not.toContain("anchors:");
  });

  it("does not resolve a cross-sheet absolute ref against this sheet", () => {
    // Sheet2!$A$12 is absolute on Sheet2, not Sheet1 — resolving it against
    // Sheet1's A12 would silently report the wrong sheet's value as fact.
    const aoa: unknown[][] = [["Item", "Qty", "Adjusted"]];
    for (let i = 0; i < 10; i++) aoa.push([`Item-${i}`, 100 + i, null]);
    aoa.push([5]); // row 12: A12 holds an unrelated value on THIS sheet
    const sheet = toSheet(aoa, (ws) => {
      for (let r = 2; r <= 11; r++) {
        ws[`C${r}`] = { t: "n", f: `B${r}/Sheet2!$A$12`, v: (100 + (r - 2)) / 5 };
      }
    });
    expect(digestOf(sheet).sheets[0].anchors).toEqual([]);
  });

  it("skips an absolute ref that resolves to an empty cell", () => {
    const aoa: unknown[][] = [["Item", "Qty", "Adjusted"]];
    for (let i = 0; i < 10; i++) aoa.push([`Item-${i}`, 100 + i, null]);
    // Row 12 is left empty: $A$12 has nothing to resolve to.
    const sheet = toSheet(aoa, (ws) => {
      for (let r = 2; r <= 11; r++) {
        ws[`C${r}`] = { t: "n", f: `B${r}/$A$12`, v: 100 + (r - 2) };
      }
    });
    const digest = digestOf(sheet);
    expect(digest.sheets[0].anchors).toEqual([]);
    expect(digestBlock([digest])).not.toContain("anchors:");
  });
});

/* ------------------------------------------------------------------ *
 * B3: derived-block flag
 * ------------------------------------------------------------------ */

function pushBlock(
  aoa: unknown[][],
  id: string,
  fields: { forecast: number[]; po: number[]; other: number[] },
) {
  // A second non-empty cell keeps the title row out of detectSections' single-cell
  // heuristic (see repeated-blocks.test.ts's PRODUCTS fixture).
  aoa.push([`${id} - name`, "note", ...fields.forecast.slice(1).map(() => null)]);
  aoa.push(["Forecast", ...fields.forecast]);
  aoa.push(["Purchase Order", ...fields.po]);
  aoa.push(["Other", ...fields.other]);
}

describe("derived-block flag", () => {
  it("flags a block whose fields total the blocks before it", () => {
    const a = { forecast: [10, 20, 30, 40, 50, 60], po: [1, 2, 3, 4, 5, 6], other: [7, 3, 9, 2, 8, 4] };
    const b = { forecast: [5, 15, 25, 35, 45, 55], po: [2, 3, 4, 5, 6, 7], other: [1, 6, 2, 9, 3, 7] };
    const c = {
      forecast: a.forecast.map((v, i) => v + b.forecast[i]),
      po: a.po.map((v, i) => v + b.po[i]),
      other: [11, 22, 33, 44, 55, 66], // unrelated to a/b's "Other" — must not count as agreeing
    };
    const aoa: unknown[][] = [[]];
    pushBlock(aoa, "A", a);
    pushBlock(aoa, "B", b);
    pushBlock(aoa, "C-Total", c);
    const digest = digestOf(toSheet(aoa));
    const blocks = digest.sheets[0].repeatedBlocks;
    expect(blocks).toHaveLength(3);
    expect(blocks[0].derivedFrom).toBeNull();
    expect(blocks[1].derivedFrom).toBeNull();
    expect(blocks[2].derivedFrom).toEqual([1, 2]);
    expect(digestBlock([digest])).toContain(
      "DERIVED — appears to total blocks [1][2], not an independent input",
    );
  });

  it("does not flag independent blocks that happen to sit after two others", () => {
    const a = { forecast: [10, 20, 30, 40, 50, 60], po: [1, 2, 3, 4, 5, 6], other: [1, 1, 1, 1, 1, 1] };
    const b = { forecast: [5, 15, 25, 35, 45, 55], po: [2, 3, 4, 5, 6, 7], other: [2, 2, 2, 2, 2, 2] };
    const c = { forecast: [100, 90, 80, 70, 60, 50], po: [9, 8, 7, 6, 5, 4], other: [3, 3, 3, 3, 3, 3] };
    const aoa: unknown[][] = [[]];
    pushBlock(aoa, "A", a);
    pushBlock(aoa, "B", b);
    pushBlock(aoa, "C", c);
    const digest = digestOf(toSheet(aoa));
    const blocks = digest.sheets[0].repeatedBlocks;
    expect(blocks).toHaveLength(3);
    for (const block of blocks) expect(block.derivedFrom).toBeNull();
    expect(digestBlock([digest])).not.toContain("DERIVED");
  });

  it("emits nothing for a flat table", () => {
    const digest = digestOf(flatTable());
    expect(digest.sheets[0].repeatedBlocks).toEqual([]);
    expect(digestBlock([digest])).not.toContain("DERIVED");
  });
});

/* ------------------------------------------------------------------ *
 * A1: formula example's anchor cell
 * ------------------------------------------------------------------ */

describe("formula example cell", () => {
  it("records the cell the disambiguating example came from", () => {
    const aoa: unknown[][] = [["A", "B", "C"]];
    for (let i = 0; i < 10; i++) aoa.push([i, i * 2, null]);
    const sheet = toSheet(aoa, (ws) => {
      for (let r = 2; r <= 11; r++) {
        ws[`C${r}`] = { t: "n", f: `A${r}+B${r}`, v: 1 };
      }
    });
    const digest = digestOf(sheet);
    const pattern = digest.sheets[0].formulaPatterns[0];
    expect(pattern.exampleCell).toBe("C2");
    expect(digestBlock([digest])).toContain("e.g. C2 = =A2+B2");
  });

  it("carries the example cell through the sideways-merge pass", () => {
    const columns = 12;
    const aoa: unknown[][] = [["Item", ...Array.from({ length: columns }, (_, i) => `M${i}`)]];
    aoa.push(["Opening", ...Array.from({ length: columns }, () => 100)]);
    aoa.push(["Closing", ...Array.from({ length: columns }, () => null)]);
    const sheet = toSheet(aoa, (ws) => {
      for (let c = 2; c <= columns; c++) {
        const here = XLSX.utils.encode_col(c);
        const left = XLSX.utils.encode_col(c - 1);
        ws[`${here}3`] = { t: "n", f: `${left}3-${here}2`, v: 1 };
      }
    });
    const digest = digestOf(sheet);
    const pattern = digest.sheets[0].formulaPatterns[0];
    expect(pattern.pattern).toBe("={c-1}{r}-{c}{r}");
    // The example is the first cell in the merged group — the loop fills from column C.
    expect(pattern.exampleCell).toBe("C3");
    expect(digestBlock([digest])).toContain("e.g. C3 = =B3-C2");
  });
});
