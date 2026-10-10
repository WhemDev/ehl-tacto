import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isExcelError, type ExcelErrorValue } from "@/lib/formula/ast";
import { formatExcelDate } from "@/lib/formula/coerce";
import { createSimulator } from "@/lib/formula/simulate";
import { parseWorkbook } from "@/lib/workbook";

type OracleRaw = number | string | boolean | null;

interface OracleTarget {
  file: string;
  fixture: string;
}

const TARGETS: OracleTarget[] = [
  { file: "public/samples/output_plan.xlsx", fixture: "test/fixtures/oracle/output_plan.json" },
  { file: "public/scenarios/rebate_output.xlsx", fixture: "test/fixtures/oracle/rebate_output.json" },
  { file: "public/samples/capacity.xlsx", fixture: "test/fixtures/oracle/capacity.json" },
];

/** Relative tolerance for float comparison, per the design spec. */
function approxEqual(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / scale < 1e-9;
}

// A literal date cell round-trips as a native `Date` here and a native
// `datetime` on the Python side — CellValue keeps `Date` un-stringified on
// purpose (see lib/formula/ast.ts), so `dump-oracle.py` prints it via
// Python's `str(datetime)` for JSON-safety. `formatExcelDate` (from
// lib/formula/coerce.ts, the same helper production code uses for the `&`
// operator) matches that exact "YYYY-MM-DD HH:MM:SS" shape — openpyxl hands
// back naive datetimes, and SheetJS's cellDates:true encodes the same
// wall-clock fields in UTC — rather than comparing a Date instance to a
// string, which can never be equal.

describe.each(TARGETS)("formula oracle: $file", ({ file, fixture }) => {
  const oracle = JSON.parse(readFileSync(join(process.cwd(), fixture), "utf8")) as Record<
    string,
    OracleRaw
  >;
  const bytes = readFileSync(join(process.cwd(), file));
  const workbook = parseWorkbook(new Uint8Array(bytes), file);
  const sim = createSimulator(workbook);
  const addresses = Object.keys(oracle);

  it("the fixture actually has cells to check", () => {
    expect(addresses.length).toBeGreaterThan(0);
  });

  it.each(addresses)("%s matches the Python oracle", (addr) => {
    const bang = addr.lastIndexOf("!");
    const sheet = addr.slice(0, bang);
    const cell = addr.slice(bang + 1);
    const actual = sim.getValue(sheet, cell);
    const raw = oracle[addr];

    if (raw === null) {
      expect(actual).toBeNull();
    } else if (typeof raw === "boolean") {
      expect(actual).toBe(raw);
    } else if (typeof raw === "number") {
      expect(typeof actual).toBe("number");
      expect(approxEqual(actual as number, raw)).toBe(true);
    } else if (raw.startsWith("__error__")) {
      expect(isExcelError(actual)).toBe(true);
      expect((actual as ExcelErrorValue).code).toBe(raw.slice("__error__".length));
    } else if (actual instanceof Date) {
      expect(formatExcelDate(actual)).toBe(raw);
    } else {
      expect(actual).toBe(raw);
    }
  });
});
