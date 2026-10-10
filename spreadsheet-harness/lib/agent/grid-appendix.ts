/**
 * The grid appendix: actual cell contents, sheet by sheet, within a
 * character budget — the role the official SpreadsheetBench harness's
 * `view_xlsx` tool plays for its agents, and the same appendix the app's
 * own agent can show a model of any workbook. Empty rows are skipped;
 * formulas render as `{=A2*B2 -> 20}` so both the rule and its current
 * value are visible.
 *
 * Extracted from lib/bench/prompts.ts in Phase A1 of the Work rework: this
 * has no benchmark-only dependency (just renderCellContent and workbook
 * types, both already app-safe) — app adoption needs it outside lib/bench.
 * lib/bench/prompts.ts imports it back and re-exports it so its own
 * existing importers are unaffected.
 */

import { renderCellContent } from "@/lib/analysis/render";
import type { ParsedSheet, ParsedWorkbook } from "@/lib/workbook";

/** Character budget for the whole appendix — roughly 30k tokens. Split across
 *  sheets proportionally to how much content each one has. */
export const GRID_APPENDIX_BUDGET = 120_000;

/**
 * Cap on a single formula's rendered length within the appendix (see
 * renderCellContent's `maxFormulaChars` option, lib/analysis/render.ts). A
 * handful of cells with 800-1,500+ character nested-IF formulas — real
 * shapes, not hypothetical: Excaliba.xlsx's "Stock Level (Month)" rows carry
 * exactly this — can otherwise burn tens of thousands of characters of the
 * whole-appendix budget in the first few rows, cutting the appendix off long
 * before it reaches the sheet's lower tables. Only this module passes a cap;
 * every other renderCellContent caller (completeness.ts, tools.ts's
 * readRange) stays uncapped, so a model that needs one formula's exact text
 * can still get it via read_range.
 */
export const GRID_APPENDIX_FORMULA_CAP = 240;

function renderSheet(sheet: ParsedSheet, budget: number): string {
  const header = `GRID "${sheet.name}" (${sheet.rows} rows x ${sheet.cols} cols${
    sheet.truncated ? `, TRUNCATED from ${sheet.totalRows}x${sheet.totalCols}` : ""
  })`;

  // Group the sparse cell map by row rather than scanning rows x cols — a
  // financial model styled out to column XFD has a vast declared range but
  // only thousands of real cells.
  const byRow = new Map<number, number[]>();
  for (const cell of sheet.cells.values()) {
    let cols = byRow.get(cell.row);
    if (!cols) {
      cols = [];
      byRow.set(cell.row, cols);
    }
    cols.push(cell.col);
  }
  const rowNumbers = [...byRow.keys()].sort((a, b) => a - b);

  const lines: string[] = [];
  let used = header.length;
  let lastRenderedRow = -1;
  let cut = false;

  for (const r of rowNumbers) {
    const parts: string[] = [];
    for (const c of byRow.get(r)!.sort((a, b) => a - b)) {
      const rendered = renderCellContent(sheet, r, c, { maxFormulaChars: GRID_APPENDIX_FORMULA_CAP });
      if (rendered) parts.push(rendered);
    }
    if (parts.length === 0) continue;
    const line = `  r${r + 1}: ${parts.join(" | ")}`;
    if (used + line.length > budget) {
      cut = true;
      break;
    }
    lines.push(line);
    used += line.length + 1;
    lastRenderedRow = r;
  }

  if (cut) {
    lines.push(
      `  (cut for length at row ${lastRenderedRow + 1} of ${sheet.rows} — rely on the digest's column statistics and formula patterns for the rest)`,
    );
  }
  if (lines.length === 0) lines.push("  (sheet is empty)");
  return [header, ...lines].join("\n");
}

/**
 * Actual cell contents, sheet by sheet, within a character budget. Empty
 * rows are skipped; formulas render as `{=A2*B2 -> 20}` so both the rule and
 * its current value are visible.
 */
export function gridAppendix(workbook: ParsedWorkbook, budget = GRID_APPENDIX_BUDGET): string {
  const sheets = workbook.sheets;
  if (sheets.length === 0) return "(workbook has no sheets)";

  const weight = (s: ParsedSheet) => Math.max(1, s.cells.size);
  const totalWeight = sheets.reduce((n, s) => n + weight(s), 0);
  // Every sheet gets a floor so a huge first sheet cannot starve a small
  // final one — the output sheet is often the small one that matters most.
  const floor = Math.min(4000, Math.floor(budget / sheets.length));

  let shares = sheets.map((s) =>
    Math.max(floor, Math.floor((budget * weight(s)) / totalWeight)),
  );
  // Floors can push the sum past the budget; scale everything back down so
  // the total honors it (each sheet keeps at least room for its header).
  const total = shares.reduce((a, b) => a + b, 0);
  if (total > budget) {
    const scale = budget / total;
    shares = shares.map((sh) => Math.max(120, Math.floor(sh * scale)));
  }

  const parts = sheets.map((s, i) => renderSheet(s, shares[i]));
  return parts.join("\n\n");
}
