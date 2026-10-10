import { describe, expect, it } from "vitest";
import { tokenize, type Token } from "@/lib/formula/tokenizer";

const types = (tokens: Token[]) => tokens.map((t) => t.type);
const values = (tokens: Token[]) => tokens.map((t) => t.value);

describe("tokenize", () => {
  it("strips a leading =", () => {
    expect(tokenize("=1+2")).toEqual(tokenize("1+2"));
  });

  it("tokenizes an integer and a decimal", () => {
    const t = tokenize("42+3.5");
    expect(values(t)).toEqual([42, "+", 3.5, null]);
    expect(types(t)).toEqual(["number", "plus", "number", "eof"]);
  });

  it("tokenizes scientific notation", () => {
    const t = tokenize("1.5E3");
    expect(values(t)[0]).toBe(1500);
  });

  it("tokenizes a string literal with an escaped quote", () => {
    const t = tokenize('"say ""hi"""');
    expect(t[0]).toMatchObject({ type: "string", value: 'say "hi"' });
  });

  it("tokenizes every error literal", () => {
    for (const code of ["#N/A", "#REF!", "#VALUE!", "#DIV/0!", "#NULL!", "#NUM!", "#NAME?"]) {
      const t = tokenize(code);
      expect(t[0]).toMatchObject({ type: "error", value: code });
    }
  });

  it("tokenizes TRUE and FALSE case-insensitively as booleans", () => {
    expect(tokenize("true")[0]).toMatchObject({ type: "bool", value: true });
    expect(tokenize("FALSE")[0]).toMatchObject({ type: "bool", value: false });
  });

  it("tokenizes a cell reference with absolute anchors", () => {
    const t = tokenize("$A$1");
    expect(t[0]).toMatchObject({ type: "cell", value: "$A$1" });
  });

  it("tokenizes a bare three-letter column cell", () => {
    expect(tokenize("AAA100")[0]).toMatchObject({ type: "cell", value: "AAA100" });
  });

  it("tokenizes a function name as FUNC immediately followed by LPAREN", () => {
    const t = tokenize("SUM(A1)");
    expect(types(t)).toEqual(["func", "lparen", "cell", "rparen", "eof"]);
    expect(t[0].value).toBe("SUM");
  });

  it("upper-cases a lower-case function name", () => {
    expect(tokenize("sum(1)")[0].value).toBe("SUM");
  });

  it("tokenizes an unquoted sheet-qualified reference", () => {
    const t = tokenize("Sheet1!A1");
    expect(types(t)).toEqual(["sheet", "bang", "cell", "eof"]);
    expect(t[0].value).toBe("Sheet1");
  });

  it("tokenizes a single-quoted sheet name containing a space", () => {
    const t = tokenize("'Open Orders'!B2");
    expect(t[0]).toMatchObject({ type: "sheet", value: "Open Orders" });
  });

  it("tokenizes a sheet-qualified error token as sheet, bang, error — never as a cell", () => {
    // The tokenizer needs no fix for this bug: it already emits a plain
    // "error" token here exactly as it would anywhere else in a formula.
    // What the parser does with this token sequence (parser.ts's "sheet"
    // atom branch, recovering it to #NAME?) is covered in
    // formula-parser.test.ts. Real-world shape: SpreadsheetBench
    // 16_05_Ramjet's `=Assumptions!#REF!` cells — a deleted row/column left
    // an error token where a cell reference used to be, while the sheet
    // itself survived. See .superpowers/sdd/reports/fix4-ref-token.md.
    const t = tokenize("Assumptions!#REF!");
    expect(types(t)).toEqual(["sheet", "bang", "error", "eof"]);
    expect(values(t)).toEqual(["Assumptions", "!", "#REF!", null]);
  });

  it("tokenizes an unquoted sheet name containing non-ASCII letters, same shape as the ASCII case", () => {
    // Python's tokenize() uses str.isalpha()/str.isalnum(), which are
    // Unicode-aware — "Ürün!A1" (Turkish for "Product") must parse the same
    // way an ASCII sheet name does, not throw partway through the identifier.
    const t = tokenize("Ürün!A1");
    expect(types(t)).toEqual(["sheet", "bang", "cell", "eof"]);
    expect(t[0].value).toBe("Ürün");
  });

  it("tokenizes every two-character comparison operator distinctly from the one-character ones", () => {
    expect(types(tokenize("<>"))).toEqual(["neq", "eof"]);
    expect(types(tokenize("<="))).toEqual(["lte", "eof"]);
    expect(types(tokenize(">="))).toEqual(["gte", "eof"]);
    expect(types(tokenize("<"))).toEqual(["lt", "eof"]);
    expect(types(tokenize(">"))).toEqual(["gt", "eof"]);
  });

  it("tokenizes every single-character operator and piece of punctuation", () => {
    const t = tokenize("(),;:!+-*/^&=%");
    expect(types(t)).toEqual([
      "lparen", "rparen", "comma", "semicolon", "colon", "bang",
      "plus", "minus", "star", "slash", "caret", "amp", "eq", "percent", "eof",
    ]);
  });

  it("skips whitespace between tokens", () => {
    expect(types(tokenize("  1   +   2  "))).toEqual(["number", "plus", "number", "eof"]);
  });

  it("always terminates with an EOF token", () => {
    const t = tokenize("");
    expect(t).toHaveLength(1);
    expect(t[0].type).toBe("eof");
  });

  it("records each token's position in the source", () => {
    const t = tokenize("1+2");
    expect(t.map((tok) => tok.pos)).toEqual([0, 1, 2, 3]);
  });

  describe("whole-column / whole-row reference halves", () => {
    it("tokenizes both sides of a whole-column range as colref, not func", () => {
      const t = tokenize("C:C");
      expect(types(t)).toEqual(["colref", "colon", "colref", "eof"]);
      expect(values(t)).toEqual(["C", ":", "C", null]);
    });

    it("tokenizes a $-anchored whole-column range as colref", () => {
      const t = tokenize("$C:$C");
      expect(types(t)).toEqual(["colref", "colon", "colref", "eof"]);
      expect(values(t)).toEqual(["$C", ":", "$C", null]);
    });

    it("tokenizes the start of a whole-row range as rowref (bare digits, colon lookahead)", () => {
      const t = tokenize("3:3");
      // Only the START has the colon-lookahead that makes a bare integer
      // unambiguous; the END is a plain "number" (see parser.ts's
      // expectRowEnd, which accepts both).
      expect(types(t)).toEqual(["rowref", "colon", "number", "eof"]);
      expect(values(t)).toEqual(["3", ":", 3, null]);
    });

    it("tokenizes a $-anchored whole-row range as rowref on both sides", () => {
      const t = tokenize("$3:$3");
      expect(types(t)).toEqual(["rowref", "colon", "rowref", "eof"]);
      expect(values(t)).toEqual(["$3", ":", "$3", null]);
    });

    it("a plain number never becomes a rowref when not followed by a colon", () => {
      expect(types(tokenize("3+3"))).toEqual(["number", "plus", "number", "eof"]);
    });

    it("still tokenizes an ordinary bounded range as cell, not colref/rowref", () => {
      expect(types(tokenize("A1:B2"))).toEqual(["cell", "colon", "cell", "eof"]);
    });
  });
});
