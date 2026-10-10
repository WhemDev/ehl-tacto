import { describe, expect, it } from "vitest";
import { excelError, isExcelError } from "@/lib/formula/ast";
import {
  coerceNumber,
  compareValues,
  formatExcelDate,
  toBoolean,
  toDisplayString,
  toNumberExcludingBool,
  toNumberForAggregate,
  toNumberForArithmetic,
} from "@/lib/formula/coerce";

describe("the three number coercions agree on ordinary values", () => {
  it("pass a plain number through unchanged", () => {
    expect(toNumberForArithmetic(5)).toBe(5);
    expect(toNumberForAggregate(5)).toBe(5);
    expect(coerceNumber(5)).toBe(5);
  });

  it("read a boolean as 1 or 0", () => {
    expect(toNumberForArithmetic(true)).toBe(1);
    expect(toNumberForAggregate(false)).toBe(0);
    expect(coerceNumber(true)).toBe(1);
  });

  it("parse a numeric string", () => {
    expect(toNumberForArithmetic("42")).toBe(42);
    expect(toNumberForAggregate("42")).toBe(42);
    expect(coerceNumber("42")).toBe(42);
  });
});

describe("the three number coercions disagree on blank and bad text — the whole point of having three", () => {
  it("blank is 0 for arithmetic and single-arg coercion, but skipped for aggregation", () => {
    expect(toNumberForArithmetic(null)).toBe(0);
    expect(coerceNumber(null)).toBe(0);
    expect(toNumberForAggregate(null)).toBeNull();
  });

  it("unparseable text is #VALUE! for arithmetic and single-arg coercion, but skipped for aggregation", () => {
    expect(isExcelError(toNumberForArithmetic("abc"))).toBe(true);
    expect(isExcelError(coerceNumber("abc"))).toBe(true);
    expect(toNumberForAggregate("abc")).toBeNull();
  });

  it("does not parse a hex-looking string as a number, unlike JS's own Number()", () => {
    // Number("0x10") is 16 in plain JS — a real bug risk here, since a
    // spreadsheet cell containing a product code like "0x10" is far more
    // plausible than an actual hex literal, and Python's float() would
    // reject it too.
    expect(isExcelError(toNumberForArithmetic("0x10"))).toBe(true);
    expect(toNumberForAggregate("0x10")).toBeNull();
  });
});

describe("toNumberForArithmetic and coerceNumber agree on an error input", () => {
  it("coerceNumber passes an ExcelErrorValue straight through", () => {
    const e = excelError("#N/A");
    expect(coerceNumber(e)).toBe(e);
  });

  it("toNumberForArithmetic also passes it through unchanged", () => {
    const e = excelError("#DIV/0!");
    expect(toNumberForArithmetic(e)).toBe(e);
  });
});

describe("toNumberExcludingBool — the *IF/*IFS aggregation sites' stricter cousin of toNumberForAggregate", () => {
  it("passes a plain number through unchanged", () => {
    expect(toNumberExcludingBool(5)).toBe(5);
    expect(toNumberExcludingBool(-2.5)).toBe(-2.5);
  });

  it("excludes a boolean entirely, unlike toNumberForAggregate's 1/0", () => {
    // conditional_funcs.py inlines `isinstance(sv, (int, float)) and not
    // isinstance(sv, bool)` at each of SUMIF/SUMIFS/AVERAGEIF/AVERAGEIFS/
    // MAXIFS/MINIFS's own aggregation sites — a TRUE/FALSE cell
    // contributes nothing, confirmed via the Task 7 oracle.
    expect(toNumberExcludingBool(true)).toBeNull();
    expect(toNumberExcludingBool(false)).toBeNull();
    expect(toNumberForAggregate(true)).toBe(1);
  });

  it("does not coerce a numeric-looking string, unlike toNumberForAggregate", () => {
    expect(toNumberExcludingBool("42")).toBeNull();
    expect(toNumberForAggregate("42")).toBe(42);
  });

  it("blank and an error are both excluded", () => {
    expect(toNumberExcludingBool(null)).toBeNull();
    expect(toNumberExcludingBool(excelError("#N/A"))).toBeNull();
  });
});

describe("toBoolean", () => {
  it("passes a boolean through", () => {
    expect(toBoolean(true)).toBe(true);
  });

  it("treats a nonzero number as true, zero as false", () => {
    expect(toBoolean(3)).toBe(true);
    expect(toBoolean(0)).toBe(false);
  });

  it("reads TRUE/FALSE text case-insensitively", () => {
    expect(toBoolean("true")).toBe(true);
    expect(toBoolean("FALSE")).toBe(false);
  });

  it("errors on text that isn't TRUE or FALSE", () => {
    expect(isExcelError(toBoolean("maybe"))).toBe(true);
  });

  it("blank is false", () => {
    expect(toBoolean(null)).toBe(false);
  });

  it("passes an error straight through", () => {
    const e = excelError("#VALUE!");
    expect(toBoolean(e)).toBe(e);
  });
});

describe("toDisplayString", () => {
  it("blank is an empty string", () => {
    expect(toDisplayString(null)).toBe("");
  });

  it("a whole-number float drops its decimal point", () => {
    expect(toDisplayString(5)).toBe("5");
  });

  it("a fractional number keeps it", () => {
    expect(toDisplayString(5.25)).toBe("5.25");
  });

  it("renders a boolean as TRUE/FALSE, not true/false", () => {
    expect(toDisplayString(true)).toBe("TRUE");
    expect(toDisplayString(false)).toBe("FALSE");
  });

  it("renders an error as its code, not empty or a thrown exception", () => {
    // Deliberately preserved from text_funcs.py's own _to_str: a text
    // function called on an upstream error stringifies it rather than
    // propagating — a real, if surprising, behaviour of the reference
    // engine that the oracle test will hold this port to.
    expect(toDisplayString(excelError("#N/A"))).toBe("#N/A");
  });

  it("passes an ordinary string through", () => {
    expect(toDisplayString("hello")).toBe("hello");
  });

  it("renders a Date as a full 'YYYY-MM-DD HH:MM:SS' timestamp, not just a date — matching engine.py::_to_str, not text_funcs.py", () => {
    // Python's str(datetime.datetime(2020, 1, 2)) is "2020-01-02 00:00:00":
    // a full timestamp even at midnight, not the ISO date-only form.
    expect(toDisplayString(new Date(Date.UTC(2020, 0, 2)))).toBe("2020-01-02 00:00:00");
  });

  it("keeps a nonzero time component when rendering a Date", () => {
    expect(toDisplayString(new Date(Date.UTC(2020, 0, 2, 14, 30, 5)))).toBe("2020-01-02 14:30:05");
  });
});

describe("formatExcelDate", () => {
  it("formats midnight with an explicit zero time, not just the date", () => {
    expect(formatExcelDate(new Date(Date.UTC(2020, 0, 2)))).toBe("2020-01-02 00:00:00");
  });

  it("formats a nonzero time component, zero-padded", () => {
    expect(formatExcelDate(new Date(Date.UTC(2020, 0, 2, 14, 30, 5)))).toBe("2020-01-02 14:30:05");
  });
});

describe("compareValues — the ordinary cases", () => {
  it("compares two numbers", () => {
    expect(compareValues(1, 2, "<")).toBe(true);
    expect(compareValues(2, 2, "=")).toBe(true);
  });

  it("compares two strings case-insensitively", () => {
    expect(compareValues("abc", "ABC", "=")).toBe(true);
    expect(compareValues("a", "b", "<")).toBe(true);
  });

  it("treats a blank as 0 against a number", () => {
    expect(compareValues(null, 5, "<")).toBe(true);
    expect(compareValues(5, null, ">")).toBe(true);
  });

  it("two blanks are equal", () => {
    expect(compareValues(null, null, "=")).toBe(true);
  });
});

describe("compareValues — number vs text uses a hardcoded table, not the text's content", () => {
  it("a number is always less than text, regardless of what the text says", () => {
    expect(compareValues(999, "1", "<")).toBe(true);
    expect(compareValues(999, "1", ">")).toBe(false);
    expect(compareValues(999, "1", "=")).toBe(false);
    expect(compareValues(999, "1", "<>")).toBe(true);
  });
});

describe("compareValues — the left/right asymmetry, ported as-is", () => {
  it("text-vs-number does NOT use the number-vs-text table — it stringifies and compares lexicographically instead", () => {
    // "5" < "abc" lexicographically (digit sorts before letter in ASCII),
    // which is the opposite sense from 5 < "abc" via the hardcoded table
    // above (a number is always less than text). Both are faithful to
    // engine.py::_compare, which dispatches on the LEFT operand's type.
    expect(compareValues("5", 999, "<")).toBe(true);
  });
});

describe("compareValues — the boolean-truthiness quirk, ported as-is", () => {
  it("compares by truthiness on both sides when either is a boolean, not by type", () => {
    // "" is falsy, so this compares 0 to 0 — not a type error, not a
    // string-vs-boolean comparison. Matches engine.py::_compare exactly.
    expect(compareValues("", false, "=")).toBe(true);
  });

  it("a non-empty string is truthy against a boolean", () => {
    expect(compareValues("anything", false, ">")).toBe(true);
  });
});
