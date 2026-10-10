import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseWorkbook, sheetHasFormulas, type ParsedWorkbook } from "@/lib/workbook";
import {
  TOKEN_BUDGET_PER_FILE,
  buildFileDigest,
  detectHeaderRow,
  estimateTokens,
  extractSheetRefs,
  normalizeFormula,
  type FileDigest,
} from "@/lib/digest";

const SAMPLES = join(process.cwd(), "public", "samples");

function load(name: string): ParsedWorkbook {
  const buf = readFileSync(join(SAMPLES, name));
  return parseWorkbook(new Uint8Array(buf), name);
}

describe("normalizeFormula", () => {
  it("collapses a filled-down column to one pattern", () => {
    const a = normalizeFormula("E2-F2");
    const b = normalizeFormula("E3-F3");
    const c = normalizeFormula("E400-F400");
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBe("E{r}-F{r}");
  });

  it("keeps absolute row anchors intact", () => {
    expect(normalizeFormula("SUMIF($B$2:$B$99,A2,$D$2:$D$99)")).toBe(
      "SUMIF($B$2:$B$99,A{r},$D$2:$D$99)",
    );
  });

  it("leaves refs inside string literals alone", () => {
    expect(normalizeFormula('IF(E2<F2,"below A1 level","")')).toBe(
      'IF(E{r}<F{r},"below A1 level","")',
    );
  });

  it("does not mangle function names that end in digits", () => {
    expect(normalizeFormula("LOG10(A2)")).toBe("LOG10(A{r})");
  });

  it("distinguishes genuinely different formulas", () => {
    expect(normalizeFormula("C2*D2")).not.toBe(normalizeFormula("C2+D2"));
  });
});

describe("extractSheetRefs", () => {
  it("finds plain and quoted sheet references", () => {
    expect(extractSheetRefs("VLOOKUP(A2,'Std Hours'!$A:$H,8,FALSE)")).toEqual(["Std Hours"]);
    expect(extractSheetRefs("SUM(Sheet2!A1:A9)")).toEqual(["Sheet2"]);
  });

  it("finds cross-workbook references", () => {
    expect(
      extractSheetRefs("VLOOKUP(B2,'[capacity.xlsx]Std Hours'!$A:$H,8,FALSE)"),
    ).toEqual(["[capacity.xlsx]Std Hours"]);
  });

  it("ignores exclamation marks inside strings", () => {
    expect(extractSheetRefs('IF(A2>0,"go!","")')).toEqual([]);
  });
});

describe("parsing the sample workbooks", () => {
  let orders: ParsedWorkbook;
  let capacity: ParsedWorkbook;
  let stock: ParsedWorkbook;
  let plan: ParsedWorkbook;

  beforeAll(() => {
    orders = load("orders.xlsx");
    capacity = load("capacity.xlsx");
    stock = load("stock.xlsx");
    plan = load("output_plan.xlsx");
  });

  it("reads sheet names", () => {
    expect(orders.sheets.map((s) => s.name)).toEqual(["Open Orders"]);
    expect(capacity.sheets.map((s) => s.name)).toEqual(["Work Centers", "Std Hours"]);
    expect(stock.sheets.map((s) => s.name)).toEqual(["Components", "BOM"]);
    expect(plan.sheets.map((s) => s.name)).toEqual(["Weekly Plan"]);
  });

  it("derives a stable source id from the file name", () => {
    expect(orders.id).toBe("orders");
    expect(plan.id).toBe("output_plan");
  });

  it("reads dimensions and keeps them under the caps", () => {
    const sheet = orders.sheets[0];
    expect(sheet.rows).toBe(43); // header + 42 orders
    expect(sheet.cols).toBe(11);
    expect(sheet.truncated).toBe(false);
  });

  it("preserves formulas", () => {
    expect(sheetHasFormulas(orders.sheets[0])).toBe(42);
    expect(sheetHasFormulas(stock.sheets[0])).toBe(36); // Available + Below ROP
    expect(sheetHasFormulas(plan.sheets[0])).toBeGreaterThan(0);
  });

  it("reads dates as dates, not serial numbers", () => {
    const due = orders.sheets[0].cells.get("1:6");
    expect(due?.type).toBe("date");
    expect(due?.text).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps number formats", () => {
    const eff = capacity.sheets[0].cells.get("1:7");
    expect(eff?.numFmt).toBe("0%");
  });
});

describe("digest construction", () => {
  let digests: Record<string, FileDigest>;

  beforeAll(() => {
    digests = Object.fromEntries(
      ["orders.xlsx", "capacity.xlsx", "stock.xlsx", "output_plan.xlsx"].map((n) => [
        n,
        buildFileDigest(load(n)),
      ]),
    );
  });

  it("detects the header row on every sample sheet", () => {
    for (const name of Object.keys(digests)) {
      for (const sheet of digests[name].sheets) {
        expect(sheet.headerRow, `${name} / ${sheet.name}`).toBe(1);
      }
    }
  });

  it("names the columns from the header row", () => {
    const orders = digests["orders.xlsx"].sheets[0];
    expect(orders.columns.map((c) => c.header)).toEqual([
      "Order No",
      "Customer",
      "Item Code",
      "Description",
      "Order Qty",
      "Qty Shipped",
      "Due Date",
      "Status",
      "Priority",
      "Routing",
      "Remaining Qty",
    ]);
  });

  it("infers column types", () => {
    const cols = digests["orders.xlsx"].sheets[0].columns;
    const byHeader = Object.fromEntries(cols.map((c) => [c.header, c]));
    expect(byHeader["Order Qty"].type).toBe("number");
    expect(byHeader["Due Date"].type).toBe("date");
    expect(byHeader["Customer"].type).toBe("text");
  });

  it("reports null ratio and distinct counts", () => {
    const status = digests["orders.xlsx"].sheets[0].columns.find(
      (c) => c.header === "Status",
    )!;
    expect(status.nullRatio).toBe(0);
    expect(status.distinctCount).toBeLessThanOrEqual(4); // Open/Partial/Closed/On Hold
    expect(status.sampleValues.length).toBeGreaterThan(0);
  });

  it("collapses each filled column into a single formula pattern", () => {
    const orders = digests["orders.xlsx"].sheets[0];
    expect(orders.formulaCount).toBe(42);
    // 42 cells, one pattern, covering K2:K43.
    expect(orders.formulaPatterns).toHaveLength(1);
    expect(orders.formulaPatterns[0]).toMatchObject({
      pattern: "=E{r}-F{r}",
      range: "K2:K43",
      count: 42,
    });
    expect(orders.formulaPatterns[0].example).toBe("=E2-F2");
  });

  it("captures the cross-workbook links the plan depends on", () => {
    const plan = digests["output_plan.xlsx"].sheets[0];
    expect(plan.crossSheetRefs).toEqual(
      expect.arrayContaining(["[capacity.xlsx]Std Hours", "[stock.xlsx]Components"]),
    );
  });

  it("records merged cells and defined names when present", () => {
    for (const d of Object.values(digests)) {
      expect(Array.isArray(d.definedNames)).toBe(true);
      for (const s of d.sheets) expect(Array.isArray(s.merges)).toBe(true);
    }
  });

  it("always says what it left out", () => {
    for (const d of Object.values(digests)) {
      expect(d.notes.join(" ")).toMatch(/Conditional formatting/i);
    }
  });

  it("stays under the per-file token budget", () => {
    for (const [name, d] of Object.entries(digests)) {
      expect(d.approxTokens, `${name} digest`).toBeLessThanOrEqual(TOKEN_BUDGET_PER_FILE);
      expect(estimateTokens(d)).toBeLessThanOrEqual(TOKEN_BUDGET_PER_FILE);
    }
  });

  it("compresses rather than overflowing when a sheet is large", () => {
    const wb = load("orders.xlsx");
    const tiny = buildFileDigest(wb, 900);
    expect(tiny.approxTokens).toBeLessThan(buildFileDigest(wb).approxTokens);
    expect(tiny.notes.join(" ")).toMatch(/compressed to fit/i);
  });
});
