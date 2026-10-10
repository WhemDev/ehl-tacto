import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isExcelError, type ExcelErrorValue } from "@/lib/formula/ast";
import { createSimulator } from "@/lib/formula/simulate";
import { parseWorkbook } from "@/lib/workbook";

type OracleRaw = number | string | boolean | null;

function approxEqual(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / scale < 1e-9;
}

describe("formula oracle: functions.xlsx", () => {
  const oracle = JSON.parse(
    readFileSync(join(process.cwd(), "test/fixtures/oracle/functions.json"), "utf8"),
  ) as Record<string, OracleRaw>;
  const bytes = readFileSync(join(process.cwd(), "public/samples/functions.xlsx"));
  const workbook = parseWorkbook(new Uint8Array(bytes), "functions.xlsx");
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
    } else {
      expect(actual).toBe(raw);
    }
  });
});
