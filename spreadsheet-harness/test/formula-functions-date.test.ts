import { describe, expect, it } from "vitest";
import { excelError, type CellValue } from "@/lib/formula/ast";
import { FUNCTION_REGISTRY } from "@/lib/formula/functions";
import { dateToSerial, serialToDate } from "@/lib/formula/functions/date";
import type { FunctionEvaluator } from "@/lib/formula/evaluator-types";
import { parseFormula } from "@/lib/formula/parser";

/** A minimal stand-in evaluator: args resolve to whatever this map says the
 *  parsed source text of that argument is, so tests don't need a real
 *  EngineState just to prove a function's own logic. */
function fakeEvaluator(resolve: (node: ReturnType<typeof parseFormula>) => CellValue): FunctionEvaluator {
  return {
    resolveArg: resolve,
    getCellValue: () => null,
    currentSheet: "S",
    currentRow: 1,
    currentColIndex: 1,
  };
}

/** Each positional value becomes one argument, resolved via a fresh
 *  placeholder AST node keyed by identity (the node's own text doesn't
 *  matter). A value may itself be a 2D CellValue[][] range (NETWORKDAYS's
 *  holiday argument). */
function callFn(name: string, ...values: CellValue[]): CellValue {
  const args = values.map((_, i) => parseFormula(String(i)));
  const byIndex = new Map(args.map((node, i) => [node, values[i]]));
  const ev = fakeEvaluator((node) => byIndex.get(node)!);
  return FUNCTION_REGISTRY[name](ev, args);
}

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const dt = (y: number, m: number, day: number, h: number, mi: number, s: number) =>
  new Date(Date.UTC(y, m - 1, day, h, mi, s));

describe("dateToSerial / serialToDate — the preserved 1900 leap-year bug", () => {
  // NOTE ON THE EXPECTED VALUES BELOW: the brief that specified this test
  // gave 1900-02-28 -> 59 and 1900-03-01 -> 61 (real Excel's own serial
  // numbers). Running date_funcs.py's _date_to_serial directly (same
  // epoch, same >=60/>=61 thresholds the brief's own dateToSerial/
  // serialToDate code — used verbatim below — implements) shows the
  // reference engine actually produces 61 and 62 for those two dates, not
  // 59 and 61: its epoch/threshold pairing is shifted one day earlier
  // than real Excel's, so the "gap" (the nonexistent serial 60) falls
  // between 1900-02-27 and 1900-02-28, not between 1900-02-28 and
  // 1900-03-01. The values here are corrected to match what the actual
  // Python source computes (ground truth per the task instructions),
  // verified by executing it directly — see the task report.
  it("round-trips known serial/date pairs, including the phantom leap day", () => {
    const cases: [string, number][] = [
      ["1899-12-31", 1],
      ["1900-02-27", 59],
      // Serial 60 is skipped entirely — the reference engine's bug puts
      // the gap here, one day earlier than real Excel's phantom 2/29/1900.
      ["1900-02-28", 61],
    ];
    for (const [iso, serial] of cases) {
      const [y, m, dd] = iso.split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, dd));
      expect(dateToSerial(date)).toBe(serial);
      const back = serialToDate(serial);
      expect([back.getUTCFullYear(), back.getUTCMonth() + 1, back.getUTCDate()]).toEqual([y, m, dd]);
    }
  });
});

describe("TODAY", () => {
  it("returns a number", () => {
    expect(typeof callFn("TODAY")).toBe("number");
  });

  it("is close to dateToSerial(new Date()) — non-deterministic, not oracle-checkable", () => {
    const expected = dateToSerial(new Date());
    const actual = callFn("TODAY") as number;
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
  });

  it("ignores any arguments passed to it", () => {
    expect(callFn("TODAY", 1, 2, 3)).toBe(callFn("TODAY"));
  });
});

describe("NOW", () => {
  it("returns a number", () => {
    expect(typeof callFn("NOW")).toBe("number");
  });

  it("is close to dateToSerial(new Date()) plus a fractional day — non-deterministic", () => {
    const expected = dateToSerial(new Date());
    const actual = callFn("NOW") as number;
    expect(Math.abs(actual - expected)).toBeLessThan(1.01);
  });

  it("has a fractional part in [0, 1) representing the time of day", () => {
    const actual = callFn("NOW") as number;
    const frac = actual - Math.trunc(actual);
    expect(frac).toBeGreaterThanOrEqual(0);
    expect(frac).toBeLessThan(1);
  });
});

describe("DATE", () => {
  it("constructs a date from year/month/day", () => {
    expect(callFn("DATE", 2024, 1, 15)).toBe(dateToSerial(d(2024, 1, 15)));
  });

  it("rolls month overflow into the following year", () => {
    expect(callFn("DATE", 2024, 13, 1)).toBe(dateToSerial(d(2025, 1, 1)));
  });

  it("single tier: bad text for year is #VALUE!", () => {
    expect(callFn("DATE", "abc", 1, 1)).toEqual(excelError("#VALUE!"));
  });

  it("clamps an out-of-range day to the target month's real last day, rather than rolling into the next month", () => {
    expect(callFn("DATE", 2023, 2, 30)).toBe(dateToSerial(d(2023, 2, 28)));
  });
});

describe("YEAR", () => {
  it("extracts the year from a Date", () => {
    expect(callFn("YEAR", d(2024, 6, 15))).toBe(2024);
  });

  it("extracts the year from a serial number", () => {
    expect(callFn("YEAR", dateToSerial(d(2024, 6, 15)))).toBe(2024);
  });

  it("single tier: bad text is #VALUE!", () => {
    expect(callFn("YEAR", "not a date")).toEqual(excelError("#VALUE!"));
  });
});

describe("MONTH", () => {
  it("extracts the month from a Date", () => {
    expect(callFn("MONTH", d(2024, 6, 15))).toBe(6);
  });

  it("extracts the month from a serial number", () => {
    expect(callFn("MONTH", dateToSerial(d(2024, 6, 15)))).toBe(6);
  });

  it("single tier: bad text is #VALUE!", () => {
    expect(callFn("MONTH", "not a date")).toEqual(excelError("#VALUE!"));
  });
});

describe("DAY", () => {
  it("extracts the day from a Date", () => {
    expect(callFn("DAY", d(2024, 6, 15))).toBe(15);
  });

  it("extracts the day from a serial number", () => {
    expect(callFn("DAY", dateToSerial(d(2024, 6, 15)))).toBe(15);
  });

  it("single tier: bad text is #VALUE!", () => {
    expect(callFn("DAY", "not a date")).toEqual(excelError("#VALUE!"));
  });
});

describe("HOUR", () => {
  it("extracts the hour from a Date's own time-of-day", () => {
    expect(callFn("HOUR", dt(2024, 6, 15, 14, 30, 45))).toBe(14);
  });

  it("extracts the hour from a serial number's fractional part, not via coerceDate", () => {
    // 6:15:30 as a fraction of a day.
    const frac = (6 * 3600 + 15 * 60 + 30) / 86400;
    expect(callFn("HOUR", frac)).toBe(6);
  });

  it("single tier: bad text is #VALUE!", () => {
    expect(callFn("HOUR", "not a time")).toEqual(excelError("#VALUE!"));
  });
});

describe("MINUTE", () => {
  it("extracts the minute from a Date's own time-of-day", () => {
    expect(callFn("MINUTE", dt(2024, 6, 15, 14, 30, 45))).toBe(30);
  });

  it("extracts the minute from a serial number's fractional part, not via coerceDate", () => {
    const frac = (6 * 3600 + 15 * 60 + 30) / 86400;
    expect(callFn("MINUTE", frac)).toBe(15);
  });

  it("single tier: bad text is #VALUE!", () => {
    expect(callFn("MINUTE", "not a time")).toEqual(excelError("#VALUE!"));
  });
});

describe("SECOND", () => {
  it("extracts the second from a Date's own time-of-day", () => {
    expect(callFn("SECOND", dt(2024, 6, 15, 14, 30, 45))).toBe(45);
  });

  it("extracts the second from a serial number's fractional part, not via coerceDate", () => {
    const frac = (6 * 3600 + 15 * 60 + 30) / 86400;
    expect(callFn("SECOND", frac)).toBe(30);
  });

  it("single tier: bad text is #VALUE!", () => {
    expect(callFn("SECOND", "not a time")).toEqual(excelError("#VALUE!"));
  });
});

describe("EOMONTH", () => {
  it("returns the last day of the current month when months=0", () => {
    expect(callFn("EOMONTH", d(2024, 1, 15), 0)).toBe(dateToSerial(d(2024, 1, 31)));
  });

  it("shifts forward into a leap-year February", () => {
    expect(callFn("EOMONTH", d(2024, 1, 15), 1)).toBe(dateToSerial(d(2024, 2, 29)));
  });

  it("propagates a bad date argument as #VALUE!", () => {
    expect(callFn("EOMONTH", "not a date", 0)).toEqual(excelError("#VALUE!"));
  });
});

describe("EDATE", () => {
  it("shifts forward, clamping into a shorter month", () => {
    // Jan 31 shifted 1 month -> Feb 2024 (leap year, 29 days) -> Feb 29.
    expect(callFn("EDATE", d(2024, 1, 31), 1)).toBe(dateToSerial(d(2024, 2, 29)));
  });

  it("shifts backward across a year boundary", () => {
    expect(callFn("EDATE", d(2024, 1, 15), -1)).toBe(dateToSerial(d(2023, 12, 15)));
  });

  it("propagates a bad date argument as #VALUE!", () => {
    expect(callFn("EDATE", "not a date", 1)).toEqual(excelError("#VALUE!"));
  });
});

describe("DATEDIF", () => {
  const start = d(2024, 1, 1);
  const end = d(2024, 6, 15);

  it('computes whole days for unit "D"', () => {
    expect(callFn("DATEDIF", start, end, "D")).toBe(166);
  });

  it('computes whole months for unit "M"', () => {
    expect(callFn("DATEDIF", start, end, "M")).toBe(5);
  });

  it('computes whole years for unit "Y"', () => {
    expect(callFn("DATEDIF", start, end, "Y")).toBe(0);
  });

  it("is #VALUE! for any unit other than D/M/Y", () => {
    expect(callFn("DATEDIF", start, end, "W")).toEqual(excelError("#VALUE!"));
  });
});

describe("WEEKDAY", () => {
  // 2024-01-01 is a known Monday.
  const monday = d(2024, 1, 1);

  it("return_type 1: Sunday=1..Saturday=7", () => {
    expect(callFn("WEEKDAY", monday, 1)).toBe(2);
  });

  it("return_type 2: Monday=1..Sunday=7", () => {
    expect(callFn("WEEKDAY", monday, 2)).toBe(1);
  });

  it("return_type 3: Monday=0..Sunday=6", () => {
    expect(callFn("WEEKDAY", monday, 3)).toBe(0);
  });

  it("defaults to return_type 1 when omitted", () => {
    expect(callFn("WEEKDAY", monday)).toBe(2);
  });
});

describe("NETWORKDAYS", () => {
  const monday = d(2024, 1, 1);
  const friday = d(2024, 1, 5);

  it("counts weekdays inclusive of both endpoints, with no holidays", () => {
    expect(callFn("NETWORKDAYS", monday, friday)).toBe(5);
  });

  it("excludes a holiday that falls within the range", () => {
    const wednesday = d(2024, 1, 3);
    expect(callFn("NETWORKDAYS", monday, friday, [[wednesday]])).toBe(4);
  });

  it("sign-flips the count when end < start", () => {
    expect(callFn("NETWORKDAYS", friday, monday)).toBe(-5);
  });
});

describe("DATEVALUE", () => {
  it("parses an ISO date string to a serial number", () => {
    expect(callFn("DATEVALUE", "2024-06-15")).toBe(dateToSerial(d(2024, 6, 15)));
  });

  it("accepts a Date argument directly", () => {
    expect(callFn("DATEVALUE", d(2024, 6, 15))).toBe(dateToSerial(d(2024, 6, 15)));
  });

  it("is #VALUE! for an unparseable string", () => {
    expect(callFn("DATEVALUE", "not a date")).toEqual(excelError("#VALUE!"));
  });
});
