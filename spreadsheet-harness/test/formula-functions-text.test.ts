import { describe, expect, it } from "vitest";
import { excelError, type CellValue } from "@/lib/formula/ast";
import { FUNCTION_REGISTRY } from "@/lib/formula/functions";
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
 *  matter). A value may itself be a 2D CellValue[][] range — these
 *  functions resolve their range arguments to arrays, not scalars, and
 *  CellValue[][] is itself a valid CellValue, so the same helper covers
 *  both scalar args and 2D range args. */
function callFn(name: string, ...values: CellValue[]): CellValue {
  const args = values.map((_, i) => parseFormula(String(i)));
  const byIndex = new Map(args.map((node, i) => [node, values[i]]));
  const ev = fakeEvaluator((node) => byIndex.get(node)!);
  return FUNCTION_REGISTRY[name](ev, args);
}

describe("LEN", () => {
  it("returns the length of a string", () => {
    expect(callFn("LEN", "hello")).toBe(5);
  });

  it("stringifies a number first (via toDisplayString), then measures it", () => {
    expect(callFn("LEN", 12345)).toBe(5);
  });

  it("the preserved quirk: LEN on an upstream error returns the length of its code string, not an error", () => {
    expect(callFn("LEN", excelError("#N/A"))).toBe(4);
  });
});

describe("LEFT", () => {
  it("defaults to 1 character", () => {
    expect(callFn("LEFT", "hello")).toBe("h");
  });

  it("takes n characters from the start", () => {
    expect(callFn("LEFT", "hello", 3)).toBe("hel");
  });

  it("n=0 is an empty string", () => {
    expect(callFn("LEFT", "hello", 0)).toBe("");
  });
});

describe("RIGHT", () => {
  it("defaults to 1 character", () => {
    expect(callFn("RIGHT", "hello")).toBe("o");
  });

  it("takes n characters from the end", () => {
    expect(callFn("RIGHT", "hello", 3)).toBe("llo");
  });

  it("n<=0 is an empty string, not an error", () => {
    expect(callFn("RIGHT", "hello", 0)).toBe("");
  });
});

describe("MID", () => {
  it("extracts a substring by 1-based start and length", () => {
    expect(callFn("MID", "hello world", 7, 5)).toBe("world");
  });

  it("a start beyond the string's length is an empty string", () => {
    expect(callFn("MID", "hello", 99, 3)).toBe("");
  });

  it("numChars=0 is an empty string", () => {
    expect(callFn("MID", "hello", 1, 0)).toBe("");
  });
});

describe("TRIM", () => {
  it("collapses internal runs of spaces to one", () => {
    expect(callFn("TRIM", "a    b   c")).toBe("a b c");
  });

  it("strips leading and trailing whitespace", () => {
    expect(callFn("TRIM", "  padded  ")).toBe("padded");
  });

  it("leaves already-normalized text unchanged", () => {
    expect(callFn("TRIM", "one two three")).toBe("one two three");
  });
});

describe("UPPER", () => {
  it("uppercases a string", () => {
    expect(callFn("UPPER", "hello")).toBe("HELLO");
  });

  it("is a no-op on already-uppercase text", () => {
    expect(callFn("UPPER", "HELLO")).toBe("HELLO");
  });

  it("stringifies a number first, then uppercases it", () => {
    expect(callFn("UPPER", 42)).toBe("42");
  });
});

describe("LOWER", () => {
  it("lowercases a string", () => {
    expect(callFn("LOWER", "HELLO")).toBe("hello");
  });

  it("handles mixed case", () => {
    expect(callFn("LOWER", "HeLLo WoRLD")).toBe("hello world");
  });

  it("stringifies a number first, then lowercases it", () => {
    expect(callFn("LOWER", 42)).toBe("42");
  });
});

describe("PROPER", () => {
  it("title-cases a simple space-separated string", () => {
    expect(callFn("PROPER", "hello world")).toBe("Hello World");
  });

  it("lowercases the remainder of an all-caps word", () => {
    expect(callFn("PROPER", "HELLO WORLD")).toBe("Hello World");
  });

  it("preserves extra internal whitespace between words while title-casing each", () => {
    expect(callFn("PROPER", "  multiple   spaces  ")).toBe("  Multiple   Spaces  ");
  });
});

describe("CONCATENATE", () => {
  it("joins its arguments in order", () => {
    expect(callFn("CONCATENATE", "a", "b", "c")).toBe("abc");
  });

  it("stringifies non-string arguments via toDisplayString", () => {
    expect(callFn("CONCATENATE", "x=", 1, true)).toBe("x=1TRUE");
  });

  it("returns an error immediately when a direct argument is an error", () => {
    expect(callFn("CONCATENATE", "a", excelError("#VALUE!"), "c")).toEqual(excelError("#VALUE!"));
  });
});

describe("CONCAT", () => {
  it("joins scalar arguments", () => {
    expect(callFn("CONCAT", "a", "b", "c")).toBe("abc");
  });

  it("flattens a 2D range argument", () => {
    const range: CellValue[][] = [
      ["a", "b"],
      ["c", "d"],
    ];
    expect(callFn("CONCAT", range)).toBe("abcd");
  });

  it("returns an error when the error is inside a flattened range, not just a direct argument", () => {
    const range: CellValue[][] = [
      ["a", excelError("#DIV/0!")],
      ["c", "d"],
    ];
    expect(callFn("CONCAT", range)).toEqual(excelError("#DIV/0!"));
  });
});

describe("TEXTJOIN", () => {
  it("joins with the given delimiter", () => {
    expect(callFn("TEXTJOIN", "-", false, "a", "b", "c")).toBe("a-b-c");
  });

  it("ignore_empty=TRUE skips empty-string parts", () => {
    expect(callFn("TEXTJOIN", ",", true, "a", "", "b", "")).toBe("a,b");
  });

  it("flattens a 2D range argument", () => {
    const range: CellValue[][] = [
      ["a", "b"],
      ["c", "d"],
    ];
    expect(callFn("TEXTJOIN", "-", false, range)).toBe("a-b-c-d");
  });
});

describe("TEXT", () => {
  it('format "0" rounds to a whole-number string', () => {
    expect(callFn("TEXT", 1234, "0")).toBe("1234");
  });

  it('format "0.00" fixes two decimal places', () => {
    expect(callFn("TEXT", 3.14159, "0.00")).toBe("3.14");
  });

  it('a "%" format multiplies by 100 and appends a percent sign', () => {
    expect(callFn("TEXT", 0.5, "0%")).toBe("50%");
  });

  it("propagates an upstream error in the value argument (unlike other text functions)", () => {
    expect(callFn("TEXT", excelError("#N/A"), "0")).toEqual(excelError("#N/A"));
  });

  // Regression pins for the final whole-plan review. text.ts used to carry
  // its own bankersRound — a copy of math.ts's pythonRound as it stood
  // BEFORE Task 7 rewrote it — so the binary-imprecision bug fixed for
  // ROUND stayed live in TEXT. Every expected value below was produced by
  // running simulation/functions/text_funcs.py's real TEXT directly; the
  // pre-fix code returned "0.2"/"2.68"/"0.4"/"2.4"/"1,234.56" for the
  // first five. A scaled-integer round is wrong in BOTH directions, so
  // 0.45 and 2.45 (which must round UP) are here alongside 0.15 and 2.675
  // (which must round DOWN) — a test using only the round-down cases would
  // pass against a naive "always truncate" implementation.
  it("rounds on the double's true binary value, not the decimal literal (rounding down)", () => {
    expect(callFn("TEXT", 0.15, "0.0")).toBe("0.1");
    expect(callFn("TEXT", 2.675, "0.00")).toBe("2.67");
  });

  it("rounds on the double's true binary value, not the decimal literal (rounding up)", () => {
    expect(callFn("TEXT", 0.45, "0.0")).toBe("0.5");
    expect(callFn("TEXT", 2.45, "0.0")).toBe("2.5");
    expect(callFn("TEXT", 1234.565, "#,##0.00")).toBe("1,234.57");
  });

  it("breaks an exact tie to even, like Python's round(), not away from zero", () => {
    expect(callFn("TEXT", 2.5, "0")).toBe("2");
    expect(callFn("TEXT", 3.5, "0")).toBe("4");
  });

  // Second finding from the same review: a negative value that rounds away
  // to nothing keeps its sign in Python's f-string formatting, but JS drops
  // it twice over ((-0).toFixed(2) is "0.00", and -0 < 0 is false).
  it("keeps the sign on a negative value that rounds to zero", () => {
    expect(callFn("TEXT", -0.004, "0.00")).toBe("-0.00");
    expect(callFn("TEXT", -0.4, "#,##0")).toBe("-0");
    expect(callFn("TEXT", -0.0001, "0%")).toBe("-0%");
  });

  it('the "0" format alone drops that sign, because its Python source is str(int(round(val)))', () => {
    expect(callFn("TEXT", -0.4, "0")).toBe("0");
  });

  // Fix C (fix9-text-format.md): the old generic fallback naively split the
  // RAW format string on "." to count decimal places, so any format with
  // more than one "." across its sections (any multi-section custom format
  // with a decimal point in more than one section) counted garbage digits
  // and emitted an unformatted float instead of respecting the format at
  // all. Every format string below is a REAL one, collected by scanning
  // every TEXT() call across data/spreadsheetbench-v2/*/spreadsheet/**/*.xlsx
  // (a ~470-file, 2069-call corpus) — see the report for the scan script and
  // the full distinct-format list. Date-format sections found in that same
  // scan ("h:mm", "'yy", "mmmm", "DDD", "mm/dd/yyyy", "dd mmm, yyyy", "mmm",
  // "yy") are out of scope: TEXT() never reaches this code for a Date-typed
  // value (it stringifies via toDisplayString instead, unchanged by this
  // fix), and every real corpus use of those formats is against an actual
  // date cell, never a raw number.
  describe("custom multi-section formats (Fix C)", () => {
    it('the task\'s own worked example: "0.0x;(0.0x);\'-\'"', () => {
      const fmt = "0.0x;(0.0x);'-'";
      expect(callFn("TEXT", 1.4, fmt)).toBe("1.4x");
      expect(callFn("TEXT", -0.07, fmt)).toBe("(0.1x)"); // rounds to 0.1x, then parenthesized
      expect(callFn("TEXT", 0, fmt)).toBe("-");
    });

    it('"#" (the single most common corpus format, 1456 uses) — a bare integer, no grouping', () => {
      expect(callFn("TEXT", 1234.5, "#")).toBe("1234"); // banker's rounding, no thousands comma
      expect(callFn("TEXT", 0, "#")).toBe("0");
    });

    it('"0.0x" (44 uses) — single-section literal suffix', () => {
      expect(callFn("TEXT", 2.5, "0.0x")).toBe("2.5x");
      expect(callFn("TEXT", -2.5, "0.0x")).toBe("-2.5x"); // no dedicated negative section: auto sign
    });

    it('"0.0x;(0.0x)" (22 uses) — two sections, no zero literal', () => {
      const fmt = "0.0x;(0.0x)";
      expect(callFn("TEXT", 1.4, fmt)).toBe("1.4x");
      expect(callFn("TEXT", -1.4, fmt)).toBe("(1.4x)");
      expect(callFn("TEXT", 0, fmt)).toBe("0.0x"); // <3 sections: zero uses the positive section
    });

    it('"0%;(0%);\'-\'" (22 uses) — percent scaling combined with section selection', () => {
      const fmt = "0%;(0%);'-'";
      expect(callFn("TEXT", 0.5, fmt)).toBe("50%");
      expect(callFn("TEXT", -0.5, fmt)).toBe("(50%)");
      expect(callFn("TEXT", 0, fmt)).toBe("-");
    });

    it('"0%" (44 uses, single section) unaffected by the rewrite — still matches the old dedicated branch', () => {
      expect(callFn("TEXT", 0.5, "0%")).toBe("50%");
      expect(callFn("TEXT", -0.0001, "0%")).toBe("-0%");
    });

    it('"0.0%" (11 uses) unaffected by the rewrite', () => {
      expect(callFn("TEXT", 0.256, "0.0%")).toBe("25.6%");
    });
  });
});

describe("SUBSTITUTE", () => {
  it("without an instance argument, replaces every occurrence", () => {
    expect(callFn("SUBSTITUTE", "a-b-c-b", "b", "X")).toBe("a-X-c-X");
  });

  it("with an instance argument, replaces only that occurrence", () => {
    expect(callFn("SUBSTITUTE", "a-b-c-b", "b", "X", 2)).toBe("a-b-c-X");
  });

  it("returns the original text unchanged when old_text isn't found", () => {
    expect(callFn("SUBSTITUTE", "hello", "z", "X")).toBe("hello");
  });

  // An empty old_text is not an exotic input: it is what a blank cell
  // coerces to, so =SUBSTITUTE(A1,B1,"X") lands here whenever B1 is empty.
  // Both expected values below come from running Python's own str.replace:
  // "abc".replace("","X") == "XaXbXcX" and "".replace("","X") == "X". The
  // pre-fix code used split("").join(), which gave "aXbXc" and "".
  it("with an empty old_text, inserts at every boundary including both ends, like Python's str.replace", () => {
    expect(callFn("SUBSTITUTE", "abc", "", "X")).toBe("XaXbXcX");
    expect(callFn("SUBSTITUTE", "", "", "X")).toBe("X");
  });

  it("resolves a blank cell reference for old_text the same way", () => {
    expect(callFn("SUBSTITUTE", "abc", null, "X")).toBe("XaXbXcX");
  });

  it("iterates by code point, not UTF-16 unit, when old_text is empty", () => {
    expect(callFn("SUBSTITUTE", "héllo", "", "-")).toBe("-h-é-l-l-o-");
  });

  // The Python source's own instance!=0 while-loop never terminates on an
  // empty old_text (it advances by len(old_text) == 0), so there is no
  // oracle value to match — it hangs rather than returning. This port
  // returns #VALUE! instead of hanging the browser; see the comment on
  // `substitute`. A test that merely completes is the point here.
  it("returns #VALUE! rather than looping forever when old_text is empty and an instance is given", () => {
    expect(callFn("SUBSTITUTE", "abc", "", "X", 1)).toEqual(excelError("#VALUE!"));
    expect(callFn("SUBSTITUTE", "abc", null, "X", 2)).toEqual(excelError("#VALUE!"));
  });
});

describe("REPLACE", () => {
  it("replaces a fixed character range in the middle of the text", () => {
    expect(callFn("REPLACE", "hello world", 7, 5, "there")).toBe("hello there");
  });

  it("replaces starting at position 1", () => {
    expect(callFn("REPLACE", "hello", 1, 1, "J")).toBe("Jello");
  });

  it("num_chars=0 inserts without removing any characters", () => {
    expect(callFn("REPLACE", "hello", 1, 0, "X")).toBe("Xhello");
  });
});

describe("FIND", () => {
  it("finds the 1-based position of a substring", () => {
    expect(callFn("FIND", "lo", "hello")).toBe(4);
  });

  it("is case-sensitive: a differently-cased substring is not found", () => {
    expect(callFn("FIND", "LO", "hello")).toEqual(excelError("#VALUE!"));
  });

  it("honors a start position argument", () => {
    expect(callFn("FIND", "b", "abcb", 3)).toBe(4);
  });
});

describe("SEARCH", () => {
  it("finds the 1-based position of a substring, case-insensitively", () => {
    expect(callFn("SEARCH", "LO", "hello")).toBe(4);
  });

  it("supports the * wildcard", () => {
    expect(callFn("SEARCH", "h*o", "hello")).toBe(1);
  });

  it("is #VALUE! when the text isn't found", () => {
    expect(callFn("SEARCH", "zz", "hello")).toEqual(excelError("#VALUE!"));
  });
});

describe("VALUE", () => {
  it("parses a plain numeric string", () => {
    expect(callFn("VALUE", "123.5")).toBe(123.5);
  });

  it("strips commas before parsing", () => {
    expect(callFn("VALUE", "1,234.5")).toBe(1234.5);
  });

  it("is #VALUE! for unparseable text", () => {
    expect(callFn("VALUE", "not a number")).toEqual(excelError("#VALUE!"));
  });
});

describe("REPT", () => {
  it("repeats the text n times", () => {
    expect(callFn("REPT", "ab", 3)).toBe("ababab");
  });

  it("n=0 is an empty string", () => {
    expect(callFn("REPT", "ab", 0)).toBe("");
  });

  it("a negative n is an empty string, not an error", () => {
    expect(callFn("REPT", "ab", -5)).toBe("");
  });
});

describe("EXACT", () => {
  it("TRUE for identical strings", () => {
    expect(callFn("EXACT", "hello", "hello")).toBe(true);
  });

  it("case-sensitive: differently-cased strings are not exact", () => {
    expect(callFn("EXACT", "Hello", "hello")).toBe(false);
  });

  it("compares via toDisplayString, so a number and its string form are exact", () => {
    expect(callFn("EXACT", 42, "42")).toBe(true);
  });
});

describe("T", () => {
  it("returns a string argument unchanged", () => {
    expect(callFn("T", "hello")).toBe("hello");
  });

  it("a numeric argument becomes an empty string", () => {
    expect(callFn("T", 42)).toBe("");
  });

  it("a boolean argument becomes an empty string", () => {
    expect(callFn("T", true)).toBe("");
  });
});

describe("N", () => {
  it("a numeric argument passes through unchanged", () => {
    expect(callFn("N", 42)).toBe(42);
  });

  it("TRUE/FALSE become 1/0", () => {
    expect(callFn("N", true)).toBe(1);
    expect(callFn("N", false)).toBe(0);
  });

  it("a string argument becomes 0", () => {
    expect(callFn("N", "hello")).toBe(0);
  });
});

describe("CLEAN", () => {
  it("strips control characters below code point 32", () => {
    expect(callFn("CLEAN", "a\x01b\x02c")).toBe("abc");
  });

  it("leaves normal printable text unchanged", () => {
    expect(callFn("CLEAN", "hello world")).toBe("hello world");
  });

  it("stringifies a number first, which has nothing to strip", () => {
    expect(callFn("CLEAN", 123)).toBe("123");
  });
});

describe("CHAR", () => {
  it("converts a code point to its character", () => {
    expect(callFn("CHAR", 65)).toBe("A");
  });

  it("is #VALUE! below 1", () => {
    expect(callFn("CHAR", 0)).toEqual(excelError("#VALUE!"));
  });

  it("is #VALUE! above 255", () => {
    expect(callFn("CHAR", 256)).toEqual(excelError("#VALUE!"));
  });
});

describe("CODE", () => {
  it("returns the code point of the first character", () => {
    expect(callFn("CODE", "A")).toBe(65);
  });

  it("uses only the first character of a longer string", () => {
    expect(callFn("CODE", "abc")).toBe(97);
  });

  it("is #VALUE! for an empty string", () => {
    expect(callFn("CODE", "")).toEqual(excelError("#VALUE!"));
  });
});

describe("NUMBERVALUE", () => {
  it("parses a plain numeric string with default separators", () => {
    expect(callFn("NUMBERVALUE", "1,234.56")).toBe(1234.56);
  });

  it("honors custom decimal and group separators", () => {
    expect(callFn("NUMBERVALUE", "1.234,56", ",", ".")).toBe(1234.56);
  });

  it("is #VALUE! for unparseable text", () => {
    expect(callFn("NUMBERVALUE", "not a number")).toEqual(excelError("#VALUE!"));
  });
});
