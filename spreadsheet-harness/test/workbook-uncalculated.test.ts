import { describe, expect, it } from "vitest";
import { parseWorkbook } from "@/lib/workbook";
import { xlsxBytes } from "./helpers/workbooks";

/**
 * GridCell.uncalculated: true exactly for a formula cell whose source XML
 * never cached a value (SheetJS types it "z" — see lib/workbook.ts's doc on
 * the field, and the raw-cell survey in .superpowers/sdd/reports/
 * fix3-uncached-recalc.md that pinned this signal down against the real
 * dataset). This file exercises parseWorkbook itself — the fixture goes
 * through a real XLSX.write/XLSX.read round-trip (test/helpers/workbooks.ts's
 * xlsxBytes), not a hand-built ParsedWorkbook — since the flag's whole job is
 * to survive that exact parse.
 */
describe("GridCell.uncalculated", () => {
  it("is true for a formula cell whose source never cached a value", () => {
    const wb = parseWorkbook(
      xlsxBytes({ Calc: [[10, { f: "A1*2", uncalculated: true }]] }),
      "uncalculated.xlsx",
    );
    const cell = wb.sheets[0].cells.get("0:1")!; // B1
    expect(cell.formula).toBe("A1*2");
    expect(cell.uncalculated).toBe(true);
  });

  it("is undefined for a formula cell WITH a cached value, including a genuine cached 0", () => {
    const wb = parseWorkbook(
      xlsxBytes({
        Calc: [[10, { f: "A1*2", v: 20 }, { f: "A1-A1", v: 0 }]],
      }),
      "cached.xlsx",
    );
    const cached = wb.sheets[0].cells.get("0:1")!; // B1, cached 20
    const cachedZero = wb.sheets[0].cells.get("0:2")!; // C1, genuinely cached 0
    expect(cached.formula).toBe("A1*2");
    expect(cached.uncalculated).toBeUndefined();
    expect(cachedZero.formula).toBe("A1-A1");
    expect(cachedZero.uncalculated).toBeUndefined();
    // value/text are untouched either way — the byte-identical-for-existing-
    // consumers guarantee GridCell.uncalculated's doc promises.
    expect(cachedZero.value).toBe(0);
    expect(cachedZero.text).toBe("0");
  });

  it("is undefined for a non-formula cell, regardless of its value", () => {
    const wb = parseWorkbook(xlsxBytes({ Calc: [[10, "text", null]] }), "literal.xlsx");
    const number = wb.sheets[0].cells.get("0:0")!;
    const text = wb.sheets[0].cells.get("0:1")!;
    expect(number.formula).toBeUndefined();
    expect(number.uncalculated).toBeUndefined();
    expect(text.formula).toBeUndefined();
    expect(text.uncalculated).toBeUndefined();
  });

  it("value/text still coerce to 0/\"0\" for an uncalculated cell — unchanged existing behavior", () => {
    // The hard guarantee this feature must not break: every existing reader
    // of GridCell.value/.text (grid rendering, digest, every pre-existing
    // test) keeps seeing exactly what it always has for a cell like this.
    const wb = parseWorkbook(
      xlsxBytes({ Calc: [[10, { f: "A1*2", uncalculated: true }]] }),
      "uncalculated2.xlsx",
    );
    const cell = wb.sheets[0].cells.get("0:1")!;
    expect(cell.value).toBe(0);
    expect(cell.text).toBe("0");
  });
});
