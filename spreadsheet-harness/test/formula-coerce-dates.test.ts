/**
 * Pins the fix for the bug documented in .superpowers/sdd/nm-diagnosis.md:
 * a literal Date cell (parsed from a real .xlsx date cell — see
 * lib/workbook.ts's parseWorkbook, which reads with cellDates:true and
 * carries a raw `Date` instance straight through to state.values via
 * workbook-model.ts's cellValueFrom) has no branch in toNumberForArithmetic
 * or coerceNumber (lib/formula/coerce.ts), so any arithmetic on it — the
 * standard `(end-start)/365` day-count idiom included — fell through to
 * #VALUE!, corrupting whole downstream DCF blocks in the Financial_Model
 * SpreadsheetBench family.
 */
import { describe, expect, it } from "vitest";
import { parseWorkbook } from "@/lib/workbook";
import { createSimulator } from "@/lib/formula/simulate";
import { dateToSerial } from "@/lib/formula/functions/date";
import { xlsxBytes } from "./helpers/workbooks";

describe("Date-typed cells coerce to Excel serial numbers in arithmetic", () => {
  it("(B1-A1)/365 for two Date cells exactly one year apart is ~1.0", () => {
    const a1 = new Date(Date.UTC(2024, 2, 31)); // 2024-03-31
    const b1 = new Date(Date.UTC(2025, 2, 31)); // 2025-03-31, 365 days later

    const wb = parseWorkbook(
      xlsxBytes({
        Calc: [[a1, b1, { f: "(B1-A1)/365" }]],
      }),
      "dates.xlsx",
    );

    // Guard: confirm the fixture's parsed cell actually IS a Date instance —
    // i.e. this exercises the same shape a real .xlsx literal date cell
    // parses to — so the test can't silently pass by testing the wrong
    // thing (e.g. a plain serial number that never touches the coercion gap).
    expect(wb.sheets[0].cells.get("0:0")?.value).toBeInstanceOf(Date);
    expect(wb.sheets[0].cells.get("0:1")?.value).toBeInstanceOf(Date);

    const sim = createSimulator(wb);
    const result = sim.getValue("Calc", "C1");

    expect(typeof result).toBe("number");
    expect(result as number).toBeCloseTo(1.0, 2); // within +/- 0.01
  });

  it("A1+30 for a Date cell returns its Excel serial number plus 30", () => {
    const a1 = new Date(Date.UTC(2024, 2, 31)); // 2024-03-31

    const wb = parseWorkbook(
      xlsxBytes({
        Calc: [[a1, { f: "A1+30" }]],
      }),
      "dates.xlsx",
    );

    expect(wb.sheets[0].cells.get("0:0")?.value).toBeInstanceOf(Date);

    const sim = createSimulator(wb);
    const result = sim.getValue("Calc", "B1");

    // dateToSerial is this engine's own single source of truth for the
    // Date->serial mapping (including its deliberate two-day divergence
    // from real Excel past 1900-02-28) — reusing it here, rather than
    // hardcoding a serial number, is what the fix itself is required to do.
    expect(result).toBe(dateToSerial(a1) + 30);
  });
});
