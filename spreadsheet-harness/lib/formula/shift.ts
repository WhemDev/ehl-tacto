/**
 * Relative-reference shifting: what Excel's fill handle does to a formula.
 *
 * `=E2-F2` filled one row down becomes `=E3-F3`; `=$B$2*C1` becomes
 * `=$B$2*C2` — absolute anchors stay put, relative parts move. A relative
 * reference pushed off the top or left edge of the grid becomes `#REF!`,
 * exactly as Excel renders it.
 *
 * Implemented over the tokenizer rather than a regex so string literals
 * ("see cell A1"), quoted sheet names, and function names that merely look
 * like references are never touched: only tokens the tokenizer itself
 * classified as cell references are rewritten, and everything between them
 * is preserved byte for byte.
 */

import { colToIndex, indexToCol } from "@/lib/a1";
import { tokenize } from "./tokenizer";

const CELL_PARTS = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/;

function shiftCellToken(text: string, dRow: number, dCol: number): string {
  const m = CELL_PARTS.exec(text);
  if (!m) return text;
  const [, colAbs, colLetters, rowAbs, rowDigits] = m;

  let col = colToIndex(colLetters);
  if (!colAbs) col += dCol;
  let row = Number(rowDigits);
  if (!rowAbs) row += dRow;

  if (col < 0 || row < 1) return "#REF!";
  const shiftedCol = colAbs ? colLetters : indexToCol(col);
  return `${colAbs}${shiftedCol}${rowAbs}${row}`;
}

/**
 * The formula as it would read after being filled `dRow` rows down and
 * `dCol` columns right (negative values fill up/left). The leading `=`, if
 * present, is preserved; so is every other character the shift doesn't own.
 */
export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  if (dRow === 0 && dCol === 0) return formula;

  const eq = /^=+/.exec(formula)?.[0] ?? "";
  const body = formula.slice(eq.length);

  const pieces: string[] = [];
  let cursor = 0;
  for (const token of tokenize(body)) {
    if (token.type !== "cell" || typeof token.value !== "string") continue;
    pieces.push(body.slice(cursor, token.pos));
    pieces.push(shiftCellToken(token.value, dRow, dCol));
    cursor = token.pos + token.value.length;
  }
  pieces.push(body.slice(cursor));
  return eq + pieces.join("");
}
