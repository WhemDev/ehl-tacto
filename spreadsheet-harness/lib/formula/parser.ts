/**
 * Recursive-descent Excel formula parser. Ports the Parser class and
 * _parse_cell_token from simulation/parser.py exactly — same precedence
 * chain, same grammar decisions (including the ones that look surprising,
 * like unary minus binding tighter than power: -2^2 parses as (-2)^2).
 */

import {
  type AstNode,
  type BinOperator,
  type CellRef,
  type ErrorCode,
  type RangeRef,
} from "./ast";
import { tokenize, type Token, type TokenType } from "./tokenizer";

function parseCellToken(value: string): {
  col: string;
  row: number;
  absCol: boolean;
  absRow: boolean;
} {
  const s = value.toUpperCase();
  let idx = 0;
  let absCol = false;
  let absRow = false;

  if (s[idx] === "$") {
    absCol = true;
    idx += 1;
  }

  const colStart = idx;
  while (idx < s.length && /[A-Z]/.test(s[idx])) idx += 1;
  const col = s.slice(colStart, idx);

  if (s[idx] === "$") {
    absRow = true;
    idx += 1;
  }

  const row = Number(s.slice(idx));
  return { col, row, absCol, absRow };
}

// "[" can never appear in a REAL sheet name — Excel reserves it (along with
// : \ / ? * ]), so a quoted sheet token containing one is unambiguously an
// external-workbook reference like "[capacity.xlsx]Std Hours" (the tokenizer
// already folds the whole "[Book.xlsx]Sheet" text into one sheet token — see
// its own external-reference comment). This engine only ever has ONE parsed
// workbook in scope, so such a "sheet" can never be resolved for real; a
// bounded reference into it already silently reads blank cells (an existing,
// separately-scoped gap this fix does not touch), but a WHOLE-COLUMN/ROW
// reference into it must NOT newly start "succeeding" at parse time — doing
// so would make evaluate.ts actually run VLOOKUP/SUMIF/etc. against a
// phantom empty sheet and produce a wrong answer, where today's behavior
// (this shape fails to parse, so buildWorkbookModel keeps the file's own
// correct cached value — see fix9/fixB report) is silently better. Confirmed
// against real fixtures: public/samples/output_plan.xlsx's Weekly Plan!F10
// (VLOOKUP against '[capacity.xlsx]Std Hours'!$A:$H) and
// public/scenarios/rebate_output.xlsx's Rebate Calc!B2 (SUMIF against
// '[rebate_sales.xlsx]Sales'!$A:$A) both regressed against the Python oracle
// without this guard.
function isExternalWorkbookRef(sheetName: string): boolean {
  return sheetName.includes("[");
}

/** Splits a "colref" token's raw text ("C", "$C") into column + anchor. */
function parseColOnlyToken(value: string): { col: string; absCol: boolean } {
  const s = value.toUpperCase();
  return s[0] === "$" ? { col: s.slice(1), absCol: true } : { col: s, absCol: false };
}

/** Splits a "rowref" token's raw text ("3", "$3") into row + anchor. */
function parseRowOnlyToken(value: string): { row: number; absRow: boolean } {
  const s = value;
  return s[0] === "$" ? { row: Number(s.slice(1)), absRow: true } : { row: Number(s), absRow: false };
}

// Row=1 (wholeColumn) / col="A" (wholeRow) are not arbitrary filler: they're
// the genuinely correct answer for ROW()/COLUMN() of an open reference (see
// lookup.ts's row/column, which read start.row/start.col as-is) — a whole
// column's top row IS 1, a whole row's first column IS A. Every OTHER
// consumer (evaluate.ts's resolveRange/walkRefs) must resolve the open axis
// against the target sheet's real used extent instead of trusting these.
function makeWholeColumnRange(
  start: { col: string; absCol: boolean },
  end: { col: string; absCol: boolean },
  sheet: string | undefined,
): RangeRef {
  return {
    type: "rangeRef",
    wholeColumn: true,
    start: { type: "cellRef", col: start.col, row: 1, absCol: start.absCol, absRow: false, sheet },
    end: { type: "cellRef", col: end.col, row: 1, absCol: end.absCol, absRow: false, sheet },
  };
}

function makeWholeRowRange(
  start: { row: number; absRow: boolean },
  end: { row: number; absRow: boolean },
  sheet: string | undefined,
): RangeRef {
  return {
    type: "rangeRef",
    wholeRow: true,
    start: { type: "cellRef", col: "A", row: start.row, absCol: false, absRow: start.absRow, sheet },
    end: { type: "cellRef", col: "A", row: end.row, absCol: false, absRow: end.absRow, sheet },
  };
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType): Token {
    const tok = this.advance();
    if (tok.type !== type) {
      throw new SyntaxError(`Expected ${type}, got ${tok.type} at pos ${tok.pos}`);
    }
    return tok;
  }

  /**
   * The end half of a row range ("3" in "3:3"). Unlike a colref, whose bare
   * form always tokenizes as "colref" on both sides (see tokenizer.ts), a
   * bare row number is only tokenized as "rowref" when the tokenizer itself
   * saw a colon immediately after it — the END of "3:3" has no such
   * lookahead (it's followed by ")" or whatever ends the range), so it
   * comes through as a plain "number" token instead. Both are accepted
   * here; a "number" end is always unanchored ($3 would have tokenized as
   * "rowref" instead).
   */
  private expectRowEnd(): { row: number; absRow: boolean } {
    if (this.peek().type === "rowref") {
      return parseRowOnlyToken(this.advance().value as string);
    }
    const tok = this.expect("number");
    return { row: tok.value as number, absRow: false };
  }

  parse(): AstNode {
    const node = this.expr();
    if (this.peek().type !== "eof") {
      throw new SyntaxError(`Unexpected token ${this.peek().type} at pos ${this.peek().pos}`);
    }
    return node;
  }

  // comparison < concat < additive < multiplicative < power < unary < postfix < atom
  private expr(): AstNode {
    return this.comparison();
  }

  private comparison(): AstNode {
    let left = this.concat();
    const ops: Partial<Record<TokenType, BinOperator>> = {
      eq: "=", neq: "<>", lt: "<", gt: ">", lte: "<=", gte: ">=",
    };
    while (this.peek().type in ops) {
      const opTok = this.advance();
      const right = this.concat();
      left = { type: "binOp", op: ops[opTok.type]!, left, right };
    }
    return left;
  }

  private concat(): AstNode {
    let left = this.additive();
    while (this.peek().type === "amp") {
      this.advance();
      const right = this.additive();
      left = { type: "binOp", op: "&", left, right };
    }
    return left;
  }

  private additive(): AstNode {
    let left = this.multiplicative();
    while (this.peek().type === "plus" || this.peek().type === "minus") {
      const opTok = this.advance();
      const right = this.multiplicative();
      left = { type: "binOp", op: opTok.type === "plus" ? "+" : "-", left, right };
    }
    return left;
  }

  private multiplicative(): AstNode {
    let left = this.power();
    while (this.peek().type === "star" || this.peek().type === "slash") {
      const opTok = this.advance();
      const right = this.power();
      left = { type: "binOp", op: opTok.type === "star" ? "*" : "/", left, right };
    }
    return left;
  }

  private power(): AstNode {
    const base = this.unary();
    if (this.peek().type === "caret") {
      this.advance();
      const exp = this.unary();
      return { type: "binOp", op: "^", left: base, right: exp };
    }
    return base;
  }

  private unary(): AstNode {
    if (this.peek().type === "minus") {
      this.advance();
      return { type: "unaryOp", op: "-", operand: this.unary() };
    }
    if (this.peek().type === "plus") {
      this.advance();
      return this.unary();
    }
    return this.postfix();
  }

  private postfix(): AstNode {
    const node = this.atom();
    if (this.peek().type === "percent") {
      this.advance();
      return { type: "percent", operand: node };
    }
    return node;
  }

  private atom(): AstNode {
    const tok = this.peek();

    if (tok.type === "number") {
      this.advance();
      return { type: "number", value: tok.value as number };
    }

    if (tok.type === "string") {
      this.advance();
      return { type: "string", value: tok.value as string };
    }

    if (tok.type === "bool") {
      this.advance();
      return { type: "bool", value: tok.value as boolean };
    }

    if (tok.type === "error") {
      this.advance();
      return { type: "errorLiteral", code: tok.value as ErrorCode };
    }

    if (tok.type === "lparen") {
      this.advance();
      const node = this.expr();
      this.expect("rparen");
      return node;
    }

    if (tok.type === "func") {
      return this.funcCall();
    }

    // Sheet-qualified reference: Sheet1!A1 or 'Sheet Name'!A1.
    if (tok.type === "sheet") {
      const sheetName = tok.value as string;
      this.advance();
      if (this.peek().type === "bang") this.advance();

      // Sheet-qualified dangling reference: Sheet1!#REF! (or any other error
      // token where a cell/range was expected) — what's left in the formula
      // text after rows/columns were deleted out from under the reference,
      // while the sheet itself survived. Excel can no longer resolve this as
      // a name, and shows #NAME? — NOT the error code the leftover token
      // happens to spell — confirmed against real SpreadsheetBench golden
      // output (16_05_Ramjet: `=Assumptions!#REF!` cells cache "#NAME?").
      // Modeled as the same ErrorLiteral node a typed `#NAME?` literal would
      // parse to, so it evaluates through the identical error channel:
      // propagates through arithmetic, is caught by IFERROR/ISERROR, etc.
      // `'[Book.xlsx]Sheet'!#REF!` takes this same path — the quoted-sheet
      // token already swallows a workbook-path prefix as ordinary sheet-name
      // text (see tokenize()), so nothing extra is needed for that shape.
      if (this.peek().type === "error") {
        this.advance();
        return { type: "errorLiteral", code: "#NAME?" };
      }

      // Sheet-qualified open reference: 'Sheet'!C:C or 'Sheet'!3:3 — but not
      // for an external-workbook "sheet" (see isExternalWorkbookRef's doc):
      // falling through to the ordinary `expect("cell")` below reproduces
      // this shape's original ParseError-and-keep-the-cached-value behavior.
      if (!isExternalWorkbookRef(sheetName)) {
        if (this.peek().type === "colref") {
          const startTok = this.advance();
          const start = parseColOnlyToken(startTok.value as string);
          this.expect("colon");
          const endTok = this.expect("colref");
          const end = parseColOnlyToken(endTok.value as string);
          return makeWholeColumnRange(start, end, sheetName);
        }
        if (this.peek().type === "rowref") {
          const startTok = this.advance();
          const start = parseRowOnlyToken(startTok.value as string);
          this.expect("colon");
          const end = this.expectRowEnd();
          return makeWholeRowRange(start, end, sheetName);
        }
      }

      const cellTok = this.expect("cell");
      const cell = parseCellToken(cellTok.value as string);
      const cellRef: CellRef = { type: "cellRef", ...cell, sheet: sheetName };
      if (this.peek().type === "colon") {
        this.advance();
        const endTok = this.expect("cell");
        const end = parseCellToken(endTok.value as string);
        return {
          type: "rangeRef",
          start: cellRef,
          end: { type: "cellRef", ...end, sheet: sheetName },
        };
      }
      return cellRef;
    }

    if (tok.type === "cell") {
      this.advance();
      const cell = parseCellToken(tok.value as string);
      const cellRef: CellRef = { type: "cellRef", ...cell, sheet: undefined };
      if (this.peek().type === "colon") {
        this.advance();
        const endTok = this.expect("cell");
        const end = parseCellToken(endTok.value as string);
        return {
          type: "rangeRef",
          start: cellRef,
          end: { type: "cellRef", ...end, sheet: undefined },
        };
      }
      return cellRef;
    }

    // Open reference, unqualified: C:C or 3:3.
    if (tok.type === "colref") {
      const startTok = this.advance();
      const start = parseColOnlyToken(startTok.value as string);
      this.expect("colon");
      const endTok = this.expect("colref");
      const end = parseColOnlyToken(endTok.value as string);
      return makeWholeColumnRange(start, end, undefined);
    }
    if (tok.type === "rowref") {
      const startTok = this.advance();
      const start = parseRowOnlyToken(startTok.value as string);
      this.expect("colon");
      const end = this.expectRowEnd();
      return makeWholeRowRange(start, end, undefined);
    }

    throw new SyntaxError(`Unexpected token ${tok.type} (${String(tok.value)}) at pos ${tok.pos}`);
  }

  private funcCall(): AstNode {
    const nameTok = this.advance();
    this.expect("lparen");
    const args: AstNode[] = [];
    if (this.peek().type !== "rparen") {
      args.push(this.expr());
      while (this.peek().type === "comma" || this.peek().type === "semicolon") {
        this.advance();
        args.push(this.expr());
      }
    }
    this.expect("rparen");
    return { type: "funcCall", name: nameTok.value as string, args };
  }
}

export function parseFormula(formula: string): AstNode {
  const tokens = tokenize(formula);
  return new Parser(tokens).parse();
}
