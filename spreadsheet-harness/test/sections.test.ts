import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseWorkbook, type ParsedSheet } from "@/lib/workbook";
import { buildFileDigest, detectHeaderRow, detectSections } from "@/lib/digest";

/**
 * Block-layout sheets: several labelled groups of rows stacked under one shared
 * header row, which is how a great many real planning sheets are actually laid
 * out.
 *
 * The case that matters most is a block whose data columns are entirely blank —
 * the one somebody is about to fill in. Every row in it carries only its item
 * name, so it looks exactly like a run of block headings, and describing the
 * sheet as one flat table hides it completely.
 */

interface Block {
  label: string;
  items: string[];
  /** null means the block is blank — only the item names are present. */
  values: number[] | null;
}

function makeSheet(
  blocks: Block[],
  opts: { months?: string[]; title?: boolean } = {},
): ParsedSheet {
  const months = opts.months ?? ["Jan", "Feb", "Mar", "Apr"];
  const aoa: unknown[][] = [];
  if (opts.title !== false) aoa.push(["SITE PLAN — Ashford"], []);
  aoa.push(["Item", ...months]);

  for (const b of blocks) {
    aoa.push([b.label]);
    for (const item of b.items) {
      aoa.push([item, ...months.map((_, i) => (b.values ? b.values[i % b.values.length] : null))]);
    }
    aoa.push([]);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Plan");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return parseWorkbook(new Uint8Array(buf), "plan.xlsx").sheets[0];
}

const ITEMS = ["SKU-1000", "SKU-1010", "SKU-1020", "SKU-1030"];

const THREE_BLOCKS: Block[] = [
  { label: "FORECAST", items: ITEMS, values: [120, 130, 140, 150] },
  { label: "PRODUCTION", items: ITEMS, values: null }, // the one to be filled
  { label: "STOCK ON HAND", items: ITEMS, values: [40, 45, 50, 55] },
];

describe("detectSections", () => {
  it("finds every block, including one that is entirely blank", () => {
    const sheet = makeSheet(THREE_BLOCKS);
    const found = detectSections(sheet, detectHeaderRow(sheet));
    expect(found.map((f) => f.label)).toEqual(["FORECAST", "PRODUCTION", "STOCK ON HAND"]);
  });

  it("does not mistake repeated item names for block headings", () => {
    const sheet = makeSheet(THREE_BLOCKS);
    const found = detectSections(sheet, detectHeaderRow(sheet));
    // Rows in the blank block carry only their item name, so without the
    // repetition signal every one of them would look like a heading.
    for (const f of found) expect(ITEMS).not.toContain(f.label);
    expect(found).toHaveLength(3);
  });

  it("leaves an ordinary flat table alone", () => {
    const aoa = [
      ["Order", "Qty", "Price"],
      ["A-1", 5, 10],
      ["A-2", 6, 12],
      ["A-3", 7, 14],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Flat");
    const sheet = parseWorkbook(
      new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer),
      "flat.xlsx",
    ).sheets[0];
    expect(detectSections(sheet, detectHeaderRow(sheet))).toEqual([]);
  });

  it("ignores a single stray one-cell row — that is a note, not a structure", () => {
    const aoa = [
      ["Order", "Qty", "Price"],
      ["A-1", 5, 10],
      ["Prices exclude VAT"],
      ["A-2", 6, 12],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Flat");
    const sheet = parseWorkbook(
      new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer),
      "flat.xlsx",
    ).sheets[0];
    expect(detectSections(sheet, detectHeaderRow(sheet))).toEqual([]);
  });
});

describe("section digests", () => {
  const digest = () =>
    buildFileDigest({
      id: "plan",
      fileName: "plan.xlsx",
      sheets: [makeSheet(THREE_BLOCKS)],
      definedNames: [],
    }).sheets[0];

  it("gives each block its own range and row count", () => {
    const s = digest();
    // Title(1) blank(2) header(3) | FORECAST(4) rows 5-8 | blank(9)
    // PRODUCTION(10) rows 11-14 | blank(15) | STOCK(16) rows 17-20
    expect(s.sections.map((x) => [x.label, x.range, x.rowCount])).toEqual([
      ["FORECAST", "A5:E8", 4],
      ["PRODUCTION", "A11:E14", 4],
      ["STOCK ON HAND", "A17:E20", 4],
    ]);
  });

  it("flags exactly the columns waiting to be filled", () => {
    const s = digest();
    const byLabel = Object.fromEntries(s.sections.map((x) => [x.label, x]));
    expect(byLabel["PRODUCTION"].emptyColumns).toEqual(["B", "C", "D", "E"]);
    expect(byLabel["FORECAST"].emptyColumns).toEqual([]);
    expect(byLabel["STOCK ON HAND"].emptyColumns).toEqual([]);
  });

  it("keeps the blank block's rows rather than trimming them away", () => {
    const production = digest().sections.find((x) => x.label === "PRODUCTION")!;
    expect(production.sampleRows).toHaveLength(4);
    expect(production.sampleRows[0][0]).toBe("SKU-1000");
    // Item name present, every period blank.
    expect(production.sampleRows[0].slice(1)).toEqual(["", "", "", ""]);
  });

  it("reports per-block fill rates instead of one blended figure", () => {
    const s = digest();
    const jan = (label: string) =>
      s.sections.find((x) => x.label === label)!.columns.find((c) => c.column === "B")!;
    expect(jan("FORECAST").nullRatio).toBe(0);
    expect(jan("PRODUCTION").nullRatio).toBe(1);
    // The sheet-level figure blends all three, which is why blocks exist.
    const sheetJan = s.columns.find((c) => c.column === "B")!;
    expect(sheetJan.nullRatio).toBeGreaterThan(0);
    expect(sheetJan.nullRatio).toBeLessThan(1);
  });

  it("describes the sheet as blocks and names the blank one", () => {
    const notes = digest().notes.join(" ");
    expect(notes).toMatch(/3 labelled blocks/);
    expect(notes).toMatch(/"PRODUCTION"/);
    expect(notes).toMatch(/candidates for what gets filled in/i);
  });

  it("does not claim the unshown rows follow the same shape", () => {
    // That note is true of a flat table and false of a block layout, where the
    // rows below differ in kind from the rows above.
    const notes = digest().notes.join(" ");
    expect(notes).not.toMatch(/follow the same column shapes/);
    expect(digest().sampleRows).toEqual([]);
  });

  it("still samples from the top for a flat sheet", () => {
    const aoa: unknown[][] = [["Order", "Qty"]];
    for (let i = 0; i < 40; i++) aoa.push([`A-${i}`, i]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Flat");
    const parsed = parseWorkbook(
      new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer),
      "flat.xlsx",
    );
    const s = buildFileDigest(parsed).sheets[0];
    expect(s.sections).toEqual([]);
    expect(s.sampleRows.length).toBeGreaterThan(0);
    expect(s.notes.join(" ")).toMatch(/follow the same column shapes/);
  });
});

describe("a long sheet still reaches its lower blocks", () => {
  it("describes a block 100+ rows down that top-sampling would never reach", () => {
    const many = Array.from({ length: 50 }, (_, i) => `SKU-${1000 + i * 10}`);
    const sheet = makeSheet([
      { label: "FORECAST", items: many, values: [100, 110, 120, 130] },
      { label: "PRODUCTION", items: many, values: null },
      { label: "STOCK ON HAND", items: many, values: [10, 20, 30, 40] },
    ]);
    const s = buildFileDigest({
      id: "plan",
      fileName: "plan.xlsx",
      sheets: [sheet],
      definedNames: [],
    }).sheets[0];

    expect(s.rows).toBeGreaterThan(150);
    // The blank block starts past row 55 — far beyond a 30-row sample.
    const production = s.sections.find((x) => x.label === "PRODUCTION")!;
    expect(production).toBeDefined();
    expect(production.rowCount).toBe(50);
    expect(production.emptyColumns).toEqual(["B", "C", "D", "E"]);
    expect(s.sections.map((x) => x.label)).toContain("STOCK ON HAND");
  });
});
