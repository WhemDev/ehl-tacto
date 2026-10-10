import { formatCell } from "@/lib/a1";
import { cellKey, type ParsedSheet } from "@/lib/workbook";

/**
 * Options for renderCellContent. `maxFormulaChars` is threaded from exactly
 * one caller — the grid appendix (lib/agent/grid-appendix.ts) — so a
 * workbook with a handful of very long per-cell formulas (nested IFs
 * hundreds to thousands of characters each, as in the Excaliba.xlsx "Stock
 * Level (Month)" rows) cannot single-handedly exhaust the appendix's
 * character budget in its first few rows and starve every table below.
 * Every other caller (lib/analysis/completeness.ts's populated-cell checks,
 * lib/analysis/tools.ts's readRange) omits this and stays fully uncapped —
 * a model that needs the exact text of one long formula can always ask for
 * it directly via read_range.
 */
export interface RenderCellContentOptions {
  /** Cap a formula's rendered length to this many characters, replacing the
   *  remainder with a `…[+N chars]` marker. The ` -> value` suffix is never
   *  truncated — the computed value is the most information-dense part of
   *  the rendering, and stays fully visible either way. Undefined (the
   *  default) renders the formula in full, unchanged from before this
   *  option existed. */
  maxFormulaChars?: number;
}

/** `formula`, capped to `maxChars` characters with a `…[+N chars]` marker
 *  for whatever was cut, or the formula unchanged when it already fits (or
 *  no cap was requested at all). */
function capFormula(formula: string, maxChars: number | undefined): string {
  if (maxChars === undefined || formula.length <= maxChars) return formula;
  const omitted = formula.length - maxChars;
  return `${formula.slice(0, maxChars)}…[+${omitted} chars]`;
}

/**
 * One cell as `A1=value` / `A1={=FORMULA -> value}` / `A1="text"`, or null
 * for cells with nothing to show. Shared by the bench grid appendix and the
 * analysis tools so the model sees one cell syntax everywhere.
 */
export function renderCellContent(
  sheet: ParsedSheet,
  row: number,
  col: number,
  options?: RenderCellContentOptions,
): string | null {
  const cell = sheet.cells.get(cellKey(row, col));
  if (!cell) return null;
  const ref = formatCell(row, col);
  if (cell.formula) {
    const shown = cell.text !== "" ? ` -> ${cell.text}` : "";
    const formula = capFormula(cell.formula, options?.maxFormulaChars);
    return `${ref}={=${formula}${shown}}`;
  }
  if (cell.value === null || cell.value === undefined || cell.text === "") return null;
  if (cell.type === "number" || cell.type === "bool") return `${ref}=${cell.text}`;
  return `${ref}=${JSON.stringify(cell.text)}`;
}
