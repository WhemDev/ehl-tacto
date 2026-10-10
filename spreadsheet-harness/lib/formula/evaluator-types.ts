/**
 * The contract a worksheet function is written against. Kept separate from
 * evaluate.ts, which is where the one real implementation of
 * FunctionEvaluator lives — function modules (the next plan's SUM,
 * AVERAGE, VLOOKUP, ...) import only this file's types, never evaluate.ts
 * itself, which will import THEM via the function registry. This file is
 * what keeps that from becoming a circular import.
 */

import type { AstNode, CellValue } from "./ast";

export interface FunctionEvaluator {
  /** Evaluate one of this function's own argument AST nodes to a value. */
  resolveArg(node: AstNode): CellValue;
  /** Read an already-computed cell directly, bypassing argument evaluation. */
  getCellValue(sheet: string, col: string, row: number): CellValue;
  /** The sheet of the cell whose formula is being evaluated — not any inner call frame. */
  readonly currentSheet: string;
  /** Same, for ROW() with no argument. */
  readonly currentRow: number;
  /** Same, 1-based, for COLUMN() with no argument. */
  readonly currentColIndex: number;
  /**
   * Tell the dependency graph that this evaluation actually read
   * `sheet`'s rectangle [startRow..endRow] x [startColIndex..endColIndex]
   * (1-based rows, 0-based column indices, both inclusive — same convention
   * as evaluate.ts's resolveRange) — cells no STATIC walk of the argument
   * ASTs would ever reveal, because the reference was built at runtime
   * (OFFSET's target, resolved from the current values of its row/col
   * offset arguments; a future INDIRECT would be the same shape). Optional:
   * only evaluate.ts's real evaluator supplies this; a function that never
   * resolves a dynamic target (nearly all of them) simply never calls it.
   * See evaluate.ts's `recalculate` doc for the edge lifecycle this feeds —
   * in short, edges registered here are rebuilt fresh every time the
   * calling cell is (re)evaluated, so a shifted OFFSET target never leaves
   * a stale edge to the range it used to read.
   */
  reportResolvedRange?(
    sheet: string,
    startRow: number,
    endRow: number,
    startColIndex: number,
    endColIndex: number,
  ): void;
}

export type ExcelFunction = (evaluator: FunctionEvaluator, args: AstNode[]) => CellValue;
