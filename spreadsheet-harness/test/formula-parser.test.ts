import { describe, expect, it } from "vitest";
import { parseFormula } from "@/lib/formula/parser";
import type { AstNode, BinOp, CellRef, FuncCall, RangeRef, UnaryOp } from "@/lib/formula/ast";

describe("parseFormula — literals", () => {
  it("parses a number", () => {
    expect(parseFormula("42")).toEqual({ type: "number", value: 42 });
  });

  it("parses a string", () => {
    expect(parseFormula('"hi"')).toEqual({ type: "string", value: "hi" });
  });

  it("parses a boolean", () => {
    expect(parseFormula("TRUE")).toEqual({ type: "bool", value: true });
  });

  it("parses an error literal", () => {
    expect(parseFormula("#N/A")).toEqual({ type: "errorLiteral", code: "#N/A" });
  });
});

describe("parseFormula — cell and range references", () => {
  it("parses a bare cell reference", () => {
    expect(parseFormula("A1")).toEqual({
      type: "cellRef", col: "A", row: 1, sheet: undefined, absCol: false, absRow: false,
    });
  });

  it("parses absolute anchors", () => {
    expect(parseFormula("$B$2")).toEqual({
      type: "cellRef", col: "B", row: 2, sheet: undefined, absCol: true, absRow: true,
    });
  });

  it("parses a mixed anchor", () => {
    const node = parseFormula("$C4") as CellRef;
    expect(node).toMatchObject({ col: "C", row: 4, absCol: true, absRow: false });
  });

  it("parses a range", () => {
    expect(parseFormula("A1:B5")).toEqual({
      type: "rangeRef",
      start: { type: "cellRef", col: "A", row: 1, sheet: undefined, absCol: false, absRow: false },
      end: { type: "cellRef", col: "B", row: 5, sheet: undefined, absCol: false, absRow: false },
    });
  });

  it("parses an unquoted sheet-qualified cell", () => {
    const node = parseFormula("Sheet1!A1") as CellRef;
    expect(node).toMatchObject({ type: "cellRef", sheet: "Sheet1", col: "A", row: 1 });
  });

  it("parses a quoted sheet-qualified range", () => {
    const node = parseFormula("'Open Orders'!A1:A10") as RangeRef;
    expect(node.start).toMatchObject({ sheet: "Open Orders", col: "A", row: 1 });
    expect(node.end).toMatchObject({ sheet: "Open Orders", col: "A", row: 10 });
  });

  it("parses an unquoted sheet-qualified cell whose sheet name has non-ASCII letters", () => {
    // Mirrors the ASCII "Sheet1!A1" test above — Turkish sheet/product names
    // are real for this app's user base, and this must parse the same way.
    const node = parseFormula("Ürün!A1") as CellRef;
    expect(node).toMatchObject({ type: "cellRef", sheet: "Ürün", col: "A", row: 1 });
  });
});

describe("parseFormula — whole-column and whole-row references", () => {
  it("parses a single whole column as a wholeColumn RangeRef, row placeholders at 1", () => {
    expect(parseFormula("C:C")).toEqual({
      type: "rangeRef",
      wholeColumn: true,
      start: { type: "cellRef", col: "C", row: 1, sheet: undefined, absCol: false, absRow: false },
      end: { type: "cellRef", col: "C", row: 1, sheet: undefined, absCol: false, absRow: false },
    });
  });

  it("parses a multi-column whole-column range, keeping the real start/end columns", () => {
    const node = parseFormula("C:E") as RangeRef;
    expect(node.wholeColumn).toBe(true);
    expect(node.start.col).toBe("C");
    expect(node.end.col).toBe("E");
  });

  it("preserves $ anchors on a whole-column range", () => {
    const node = parseFormula("$C:$C") as RangeRef;
    expect(node.start).toMatchObject({ col: "C", absCol: true });
    expect(node.end).toMatchObject({ col: "C", absCol: true });
  });

  it("parses a sheet-qualified whole-column range", () => {
    const node = parseFormula("'Open Orders'!C:C") as RangeRef;
    expect(node.wholeColumn).toBe(true);
    expect(node.start).toMatchObject({ sheet: "Open Orders", col: "C" });
    expect(node.end).toMatchObject({ sheet: "Open Orders", col: "C" });
  });

  it("parses a single whole row as a wholeRow RangeRef, col placeholders at A", () => {
    expect(parseFormula("3:3")).toEqual({
      type: "rangeRef",
      wholeRow: true,
      start: { type: "cellRef", col: "A", row: 3, sheet: undefined, absCol: false, absRow: false },
      end: { type: "cellRef", col: "A", row: 3, sheet: undefined, absCol: false, absRow: false },
    });
  });

  it("parses a multi-row whole-row range, keeping the real start/end rows", () => {
    const node = parseFormula("3:5") as RangeRef;
    expect(node.wholeRow).toBe(true);
    expect(node.start.row).toBe(3);
    expect(node.end.row).toBe(5);
  });

  it("preserves $ anchors on a whole-row range", () => {
    const node = parseFormula("$3:$3") as RangeRef;
    expect(node.start).toMatchObject({ row: 3, absRow: true });
    expect(node.end).toMatchObject({ row: 3, absRow: true });
  });

  it("parses a sheet-qualified whole-row range", () => {
    const node = parseFormula("'Open Orders'!3:3") as RangeRef;
    expect(node.wholeRow).toBe(true);
    expect(node.start).toMatchObject({ sheet: "Open Orders", row: 3 });
  });

  it("SUM(C:C) parses as a funcCall wrapping a wholeColumn range", () => {
    const node = parseFormula("SUM(C:C)") as FuncCall;
    expect(node).toMatchObject({ type: "funcCall", name: "SUM" });
    expect(node.args[0]).toMatchObject({ type: "rangeRef", wholeColumn: true });
  });

  it("an ordinary bounded range still has no wholeColumn/wholeRow flag", () => {
    const node = parseFormula("A1:B5") as RangeRef;
    expect(node.wholeColumn).toBeUndefined();
    expect(node.wholeRow).toBeUndefined();
  });

  it("throws on a whole-column reference into an external workbook, same as before this feature existed", () => {
    // Regression pin: real fixtures (public/samples/output_plan.xlsx's
    // Weekly Plan!F10, public/scenarios/rebate_output.xlsx's Rebate Calc!B2)
    // use VLOOKUP/SUMIF against '[capacity.xlsx]Std Hours'!$A:$H-shaped
    // external references. "[" can never appear in a real sheet name, so
    // this "sheet" is unambiguously external — this engine has only one
    // workbook in scope and can't resolve it, so the whole formula must
    // keep failing to parse (letting buildWorkbookModel fall back to the
    // file's own correct cached value) rather than "succeeding" against a
    // phantom empty sheet and computing a wrong answer from scratch. See
    // parser.ts's isExternalWorkbookRef doc.
    expect(() => parseFormula("SUM('[capacity.xlsx]Std Hours'!$A:$H)")).toThrow();
    expect(() => parseFormula("SUM('[capacity.xlsx]Std Hours'!3:3)")).toThrow();
  });
});

describe("parseFormula — sheet-qualified dangling reference", () => {
  // A deleted row/column can leave an error token where Excel expects a
  // cell/range after `Sheet!` (the sheet itself survives). Excel can no
  // longer resolve this as a name and shows #NAME? — not the error code the
  // leftover token happens to spell, and not a thrown/unparseable formula.
  // See parser.ts's "sheet" atom branch and
  // .superpowers/sdd/reports/fix4-ref-token.md.

  it("parses the exact real-world shape from SpreadsheetBench 16_05_Ramjet to #NAME?", () => {
    expect(parseFormula("=Assumptions!#REF!")).toEqual({ type: "errorLiteral", code: "#NAME?" });
  });

  it("is #NAME?, not #REF! — distinct from a bare error literal of the same code", () => {
    expect(parseFormula("#REF!")).toEqual({ type: "errorLiteral", code: "#REF!" });
    expect(parseFormula("Sheet1!#REF!")).toEqual({ type: "errorLiteral", code: "#NAME?" });
  });

  it("collapses to #NAME? regardless of which error code the leftover token spells", () => {
    for (const code of ["#N/A", "#REF!", "#VALUE!", "#DIV/0!", "#NULL!", "#NUM!", "#NAME?"]) {
      expect(parseFormula(`Sheet1!${code}`)).toEqual({ type: "errorLiteral", code: "#NAME?" });
    }
  });

  it("applies under a quoted sheet name, including a workbook-path-prefixed one", () => {
    expect(parseFormula("'Open Orders'!#REF!")).toEqual({ type: "errorLiteral", code: "#NAME?" });
    // The grammar has no dedicated syntax for an external-workbook path —
    // the quoted-sheet-name scan already swallows "[Book.xlsx]Sheet" as
    // ordinary sheet-name text (see tokenize()'s `'` branch), so this shape
    // takes the identical path with no extra parser support needed.
    expect(parseFormula("'[Book1.xlsx]Sheet1'!#REF!")).toEqual({ type: "errorLiteral", code: "#NAME?" });
  });

  it("does not disturb an ordinary sheet-qualified cell or range reference", () => {
    expect(parseFormula("Sheet1!A1")).toMatchObject({ type: "cellRef", sheet: "Sheet1" });
    expect(parseFormula("Sheet1!A1:B2")).toMatchObject({ type: "rangeRef" });
  });

  it("still throws when a sheet reference is followed by neither a cell nor an error token", () => {
    // Conservative scope: only the evidenced/specified "error token where a
    // reference was expected" shape recovers. Anything else genuinely
    // unparseable keeps throwing, same as before this fix — the caller
    // (buildWorkbookModel) falls back to the cell's cached value for it,
    // unchanged.
    expect(() => parseFormula("Sheet1!+1")).toThrow();
  });
});

describe("parseFormula — error literals stay legitimate everywhere else", () => {
  it("parses an error literal as a function argument", () => {
    const node = parseFormula("IF(A1>0,1,#N/A)") as FuncCall;
    expect(node.args[2]).toEqual({ type: "errorLiteral", code: "#N/A" });
  });

  it("parses an error literal on the right of a comparison", () => {
    const node = parseFormula("A1=#N/A") as BinOp;
    expect(node.right).toEqual({ type: "errorLiteral", code: "#N/A" });
  });
});

describe("parseFormula — operator precedence", () => {
  it("binds * tighter than +", () => {
    const node = parseFormula("1+2*3") as BinOp;
    expect(node.op).toBe("+");
    expect((node.right as BinOp).op).toBe("*");
  });

  it("binds ^ tighter than *", () => {
    const node = parseFormula("2*3^2") as BinOp;
    expect(node.op).toBe("*");
    expect((node.right as BinOp).op).toBe("^");
  });

  it("binds & (concat) looser than + but tighter than comparison", () => {
    const node = parseFormula('1+1&"x"=2') as BinOp;
    expect(node.op).toBe("=");
    expect((node.left as BinOp).op).toBe("&");
  });

  it("is left-associative for a chain of the same precedence", () => {
    const node = parseFormula("1-2-3") as BinOp;
    // (1-2)-3, not 1-(2-3)
    expect((node.left as BinOp).op).toBe("-");
    expect((node.left as BinOp).left).toEqual({ type: "number", value: 1 });
  });

  it("respects parentheses", () => {
    const node = parseFormula("(1+2)*3") as BinOp;
    expect(node.op).toBe("*");
    expect((node.left as BinOp).op).toBe("+");
  });

  it("parses every comparison operator", () => {
    for (const [src, op] of [
      ["1=2", "="], ["1<>2", "<>"], ["1<2", "<"], ["1>2", ">"], ["1<=2", "<="], ["1>=2", ">="],
    ] as const) {
      expect((parseFormula(src) as BinOp).op).toBe(op);
    }
  });
});

describe("parseFormula — unary and percent", () => {
  it("parses unary minus", () => {
    expect(parseFormula("-5")).toEqual({
      type: "unaryOp", op: "-", operand: { type: "number", value: 5 },
    });
  });

  it("a leading + is a no-op, matching the Python source", () => {
    expect(parseFormula("+5")).toEqual({ type: "number", value: 5 });
  });

  it("double unary minus nests", () => {
    const node = parseFormula("--5") as UnaryOp;
    expect(node.op).toBe("-");
    expect((node.operand as UnaryOp).op).toBe("-");
  });

  it("parses postfix percent", () => {
    expect(parseFormula("5%")).toEqual({
      type: "percent", operand: { type: "number", value: 5 },
    });
  });

  it("unary minus binds tighter than power, matching the Python grammar", () => {
    // Python's _power() calls _unary() for both operands, so -2^2 is (-2)^2 = 4, not -(2^2) = -4.
    const node = parseFormula("-2^2") as BinOp;
    expect(node.op).toBe("^");
    expect(node.left).toEqual({ type: "unaryOp", op: "-", operand: { type: "number", value: 2 } });
  });
});

describe("parseFormula — function calls", () => {
  it("parses a call with one argument", () => {
    const node = parseFormula("SUM(A1)") as FuncCall;
    expect(node.name).toBe("SUM");
    expect(node.args).toHaveLength(1);
  });

  it("parses a call with several comma-separated arguments", () => {
    const node = parseFormula("IF(A1>0,1,2)") as FuncCall;
    expect(node.args).toHaveLength(3);
  });

  it("treats a semicolon the same as a comma between arguments", () => {
    const node = parseFormula("IF(A1>0;1;2)") as FuncCall;
    expect(node.args).toHaveLength(3);
  });

  it("parses a call with zero arguments", () => {
    const node = parseFormula("ROW()") as FuncCall;
    expect(node.args).toHaveLength(0);
  });

  it("parses a nested function call as an argument", () => {
    const node = parseFormula("SUM(MAX(A1,A2),1)") as FuncCall;
    expect((node.args[0] as FuncCall).name).toBe("MAX");
  });
});

describe("parseFormula — errors", () => {
  it("throws on a trailing unexpected token", () => {
    expect(() => parseFormula("1 1")).toThrow();
  });

  it("throws on an unterminated function call", () => {
    expect(() => parseFormula("SUM(A1")).toThrow();
  });

  it("throws on an empty expression", () => {
    expect(() => parseFormula("")).toThrow();
  });
});

describe("parseFormula — the leading =", () => {
  it("is optional", () => {
    expect(parseFormula("=1+2")).toEqual(parseFormula("1+2"));
  });
});
