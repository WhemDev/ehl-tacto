import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseWorkbook, type ParsedSheet } from "@/lib/workbook";
import { buildFileDigest, detectRepeatedBlocks } from "@/lib/digest";

/**
 * Row-oriented sheets: the same small table repeated once per item, fields
 * running down the left and periods across the top.
 *
 * Modelled on a real production-planning file that this originally could not
 * read at all — it reported no header row, no structure, and spent 7,300
 * tokens describing 56 meaningless columns. Two properties of that file matter
 * and are reproduced here: block heights are NOT uniform (a subtotal table with
 * no id, an extra comment row), and the row that gets filled in by hand is
 * partly populated rather than empty.
 */

const MONTHS = ["Jun-25", "Jul-25", "Aug-25", "Sep-25", "Oct-25", "Nov-25"];

interface Product {
  id: string;
  name: string;
  batch: number;
  /** Extra rows before the next block, so heights vary like a real file. */
  padRows?: number;
  /** How many months of Purchase Order are filled in. */
  ordersFilled?: number;
}

function makeSheet(products: Product[]): ParsedSheet {
  const aoa: unknown[][] = [[]];

  for (const p of products) {
    aoa.push([`${p.id} - ${p.name}`, null, null, null, 317000, 303000]);
    aoa.push(["2025-2026", ...MONTHS]);
    aoa.push(["Forecast", ...MONTHS.map((_, i) => 40000 + i * 1000)]);
    aoa.push([
      "Purchase Order",
      ...MONTHS.map((_, i) => (i < (p.ordersFilled ?? 2) ? p.batch : null)),
    ]);
    aoa.push(["Month End Stock", ...MONTHS.map((_, i) => -38714 - i * 42000)]);
    aoa.push([p.batch, ...MONTHS.map(() => 0)]);
    aoa.push(["Stock Level (Month)", ...MONTHS.map((_, i) => -(0.9 + i))]);
    for (let k = 0; k < (p.padRows ?? 0); k++) aoa.push([`note ${p.id}-${k}`]);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "UrunPlan");
  return parseWorkbook(
    new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer),
    "plan.xlsx",
  ).sheets[0];
}

const PRODUCTS: Product[] = [
  { id: "401047", name: "Excaliba 20/5 mg", batch: 107142 },
  { id: "401048", name: "Excaliba 40/5 mg", batch: 53571, padRows: 1 },
  { id: "401049", name: "Excaliba 40/10 mg", batch: 53571 },
  { id: "401050", name: "Excaliba 80/5 mg", batch: 26785, padRows: 2 },
];

const digestOf = (sheet: ParsedSheet) =>
  buildFileDigest({ id: "plan", fileName: "plan.xlsx", sheets: [sheet], definedNames: [] })
    .sheets[0];

describe("detectRepeatedBlocks", () => {
  it("finds every repetition despite differing block heights", () => {
    const found = detectRepeatedBlocks(makeSheet(PRODUCTS));
    expect(found).not.toBeNull();
    expect(found!.starts).toHaveLength(PRODUCTS.length);
  });

  it("recognises the repeated field rows", () => {
    const found = detectRepeatedBlocks(makeSheet(PRODUCTS))!;
    expect(found.fieldLabels).toEqual(
      expect.arrayContaining([
        "Forecast",
        "Purchase Order",
        "Month End Stock",
        "Stock Level (Month)",
      ]),
    );
  });

  it("does not fire on an ordinary flat table", () => {
    const aoa: unknown[][] = [["Order", "Qty", "Price"]];
    for (let i = 0; i < 40; i++) aoa.push([`A-${i}`, i, i * 2]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Flat");
    const sheet = parseWorkbook(
      new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer),
      "flat.xlsx",
    ).sheets[0];
    expect(detectRepeatedBlocks(sheet)).toBeNull();
  });

  it("needs more than one repeated label to call it a layout", () => {
    const aoa: unknown[][] = [["Total"], [1], [2], ["Total"], [3], [4], ["Total"], [5]];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Odd");
    const sheet = parseWorkbook(
      new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer),
      "odd.xlsx",
    ).sheets[0];
    expect(detectRepeatedBlocks(sheet)).toBeNull();
  });
});

describe("the digest of a row-oriented sheet", () => {
  it("titles each repetition with its product", () => {
    const s = digestOf(makeSheet(PRODUCTS));
    expect(s.repeatedBlocks.map((b) => b.title)).toEqual([
      "401047 - Excaliba 20/5 mg",
      "401048 - Excaliba 40/5 mg",
      "401049 - Excaliba 40/10 mg",
      "401050 - Excaliba 80/5 mg",
    ]);
  });

  it("keeps each product's own batch size visible", () => {
    const s = digestOf(makeSheet(PRODUCTS));
    for (const [i, p] of PRODUCTS.entries()) {
      const labels = s.repeatedBlocks[i].fields.map((f) => f.label);
      expect(labels, `block ${i}`).toContain(String(p.batch));
    }
  });

  it("names the partly-filled row as the one filled in by hand", () => {
    const note = digestOf(makeSheet(PRODUCTS))
      .notes.find((n) => n.includes("likeliest"));
    expect(note).toBeDefined();
    expect(note).toMatch(/"Purchase Order"/);
  });

  it("does not mistake a per-block numeric label for a field name", () => {
    // Batch sizes differ per product, so they are values, not shared fields.
    const note = digestOf(makeSheet(PRODUCTS)).notes.find((n) => n.includes("likeliest"));
    expect(note).not.toMatch(/107142|53571|26785/);
  });

  it("drops the whole-column statistics, which average across every block", () => {
    const s = digestOf(makeSheet(PRODUCTS));
    expect(s.blockLayout).not.toBeNull();
    expect(s.columns).toEqual([]);
    expect(s.sampleRows).toEqual([]);
    expect(s.notes.join(" ")).toMatch(/NOT one table/);
  });

  it("says the rows are fields and the columns are periods", () => {
    expect(digestOf(makeSheet(PRODUCTS)).notes.join(" ")).toMatch(
      /rows are the fields .* columns are the periods/i,
    );
  });
});

describe("formulas filled sideways", () => {
  function sheetWithRowFill(columns: number): ParsedSheet {
    const aoa: unknown[][] = [["Item", ...Array.from({ length: columns }, (_, i) => `M${i}`)]];
    aoa.push(["Opening", ...Array.from({ length: columns }, () => 100)]);
    aoa.push(["Closing", ...Array.from({ length: columns }, () => null)]);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Row 3 filled across: each cell references the one to its left.
    for (let c = 2; c <= columns; c++) {
      const here = XLSX.utils.encode_col(c);
      const left = XLSX.utils.encode_col(c - 1);
      ws[`${here}3`] = { t: "n", f: `${left}3-${here}2`, v: 1 };
    }
    XLSX.utils.book_append_sheet(wb, ws, "Across");
    return parseWorkbook(
      new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer),
      "across.xlsx",
    ).sheets[0];
  }

  it("collapses a long sideways fill into one rule", () => {
    const s = digestOf(sheetWithRowFill(12));
    expect(s.formulaPatterns).toHaveLength(1);
    expect(s.formulaPatterns[0].pattern).toBe("={c-1}{r}-{c}{r}");
    expect(s.formulaPatterns[0].count).toBe(11);
  });

  it("leaves a short run as literal column letters, which read better", () => {
    const s = digestOf(sheetWithRowFill(2));
    expect(s.formulaPatterns.every((p) => !p.pattern.includes("{c"))).toBe(true);
  });

  it("still collapses an ordinary fill-down by row", () => {
    const aoa: unknown[][] = [["A", "B", "C"]];
    for (let i = 0; i < 10; i++) aoa.push([i, i * 2, null]);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    for (let r = 2; r <= 11; r++) ws[`C${r}`] = { t: "n", f: `A${r}+B${r}`, v: 1 };
    XLSX.utils.book_append_sheet(wb, ws, "Down");
    const sheet = parseWorkbook(
      new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer),
      "down.xlsx",
    ).sheets[0];
    const s = digestOf(sheet);
    expect(s.formulaPatterns[0].pattern).toBe("=A{r}+B{r}");
  });
});
