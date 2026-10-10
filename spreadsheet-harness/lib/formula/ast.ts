/**
 * AST node types and the value shapes formulas evaluate to.
 *
 * Ports simulation/ast_nodes.py field-for-field. Python uses frozen
 * dataclasses distinguished by class identity; this uses a `type`
 * discriminant so evaluate.ts can switch on it, which is the natural
 * TypeScript equivalent of the same design.
 */

export type ErrorCode =
  | "#N/A"
  | "#REF!"
  | "#VALUE!"
  | "#DIV/0!"
  | "#NULL!"
  | "#NUM!"
  | "#NAME?"
  /**
   * Not a real Excel code. The Python reference engine has no defined
   * behaviour for a circular reference — it raises and crashes rather than
   * producing a value — so there is no oracle output to match here. This
   * engine must not crash on a cycle, so it invents this one.
   */
  | "#CIRCULAR!";

export interface ExcelErrorValue {
  readonly kind: "error";
  readonly code: ErrorCode;
}

export function excelError(code: ErrorCode): ExcelErrorValue {
  return { kind: "error", code };
}

export function isExcelError(v: unknown): v is ExcelErrorValue {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { kind?: unknown }).kind === "error" &&
    typeof (v as { code?: unknown }).code === "string"
  );
}

/**
 * What a cell can hold or a formula can evaluate to.
 *
 * `Date` is here because GridCell.value (lib/workbook.ts) can hold one —
 * SheetJS surfaces a date-formatted cell as a JS Date, matching how openpyxl
 * surfaces one as a Python datetime on the reference-engine side. Nothing in
 * this plan's coercers understands Date specially, on purpose: neither does
 * the Python source outside its dedicated date functions (out of scope
 * here), so arithmetic directly on a date cell falls through to an error or
 * gets skipped, matching the oracle.
 */
export type CellValue =
  | number
  | string
  | boolean
  | ExcelErrorValue
  | Date
  | CellValue[][]
  | null;

export type AstNode =
  | NumberLiteral
  | StringLiteral
  | BoolLiteral
  | ErrorLiteral
  | CellRef
  | RangeRef
  | BinOp
  | UnaryOp
  | FuncCall
  | Percent;

export interface NumberLiteral {
  readonly type: "number";
  readonly value: number;
}

export interface StringLiteral {
  readonly type: "string";
  readonly value: string;
}

export interface BoolLiteral {
  readonly type: "bool";
  readonly value: boolean;
}

/** A literal error typed into a formula, e.g. `=IF(A1>0,1,#N/A)`. Distinct
 *  from ExcelErrorValue, which is a runtime CellValue, not syntax. */
export interface ErrorLiteral {
  readonly type: "errorLiteral";
  readonly code: ErrorCode;
}

export interface CellRef {
  readonly type: "cellRef";
  readonly col: string;
  readonly row: number;
  readonly sheet?: string;
  /** Parsed but unused by evaluation — see the module doc above. */
  readonly absCol: boolean;
  readonly absRow: boolean;
}

export interface RangeRef {
  readonly type: "rangeRef";
  readonly start: CellRef;
  readonly end: CellRef;
  /**
   * True when this was written as an open column form (`C:C`, `C:E`) — the
   * parser has no sheet to bound it against, so `start.row`/`end.row` are
   * placeholders (1) rather than real rows. A consumer that cares about the
   * actual extent (evaluate.ts's resolveRange/walkRefs) must resolve this
   * against the target sheet's real used extent before reading those rows;
   * one that only wants the column bounds (or ROW()/COLUMN() semantics —
   * see lookup.ts's row/column, which read `start` as-is and are correct
   * unchanged: a whole column's "row" genuinely is 1) can use start/end as
   * written.
   */
  readonly wholeColumn?: boolean;
  /** Same idea as `wholeColumn`, for an open row form (`3:3`, `3:5`) —
   *  `start.col`/`end.col` are the placeholder ("A") here instead. */
  readonly wholeRow?: boolean;
}

export type BinOperator =
  | "+" | "-" | "*" | "/" | "^" | "&"
  | "=" | "<>" | "<" | ">" | "<=" | ">=";

export interface BinOp {
  readonly type: "binOp";
  readonly op: BinOperator;
  readonly left: AstNode;
  readonly right: AstNode;
}

export interface UnaryOp {
  readonly type: "unaryOp";
  readonly op: "-";
  readonly operand: AstNode;
}

export interface FuncCall {
  readonly type: "funcCall";
  readonly name: string;
  readonly args: AstNode[];
}

/** Postfix `%`, e.g. `5%` => `0.05`. */
export interface Percent {
  readonly type: "percent";
  readonly operand: AstNode;
}
