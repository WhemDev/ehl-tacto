/**
 * Analysis tools: pure retrieval functions over a ParsedWorkbook.
 *
 * These are the layer the benchmark's agentic loop exposes to the model as
 * tools, and the layer the app's inference route is intended to adopt.
 * Every function is model-facing: errors are AnalysisError with messages a
 * model can act on, results are plain text or small JSON-able shapes, and
 * every result is capped — a tool that can return megabytes reintroduces
 * the budget bug these tools exist to solve.
 */
import { formatCell, parseRange } from "@/lib/a1";
import type { CellKey } from "@/lib/formula/graph";
import type { Simulator } from "@/lib/formula/simulate";
import type { ParsedSheet, ParsedWorkbook } from "@/lib/workbook";
import { renderCellContent } from "./render";

/** Model-facing failure: the message is returned to the model verbatim. */
export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisError";
  }
}

export function resolveSheet(wb: ParsedWorkbook, name: string): ParsedSheet {
  const target = name.trim().toLowerCase();
  const sheet = wb.sheets.find((s) => s.name.trim().toLowerCase() === target);
  if (!sheet) {
    throw new AnalysisError(
      `unknown sheet "${name}" — must be one of: ${wb.sheets.map((s) => s.name).join(", ")}`,
    );
  }
  return sheet;
}

export interface ReadRangeResult {
  text: string;
  truncated: boolean;
}

const READ_RANGE_MAX_CHARS = 15_000;

/** Sparse cell listing for a range, in the grid-appendix syntax. */
export function readRange(
  wb: ParsedWorkbook,
  sheetName: string,
  range: string,
  maxChars = READ_RANGE_MAX_CHARS,
): ReadRangeResult {
  const sheet = resolveSheet(wb, sheetName);
  const box = parseRange(range, { rows: sheet.rows, cols: sheet.cols });
  if (!box) {
    throw new AnalysisError(
      `"${range}" is not an A1 range — use forms like "B2", "B2:D10", or "A1:T200"`,
    );
  }

  const lines: string[] = [`RANGE ${sheet.name}!${range}`];
  let used = lines[0].length;
  let truncated = false;
  for (let r = box.startRow; r <= box.endRow && !truncated; r++) {
    const parts: string[] = [];
    for (let c = box.startCol; c <= box.endCol; c++) {
      const rendered = renderCellContent(sheet, r, c);
      if (rendered) parts.push(rendered);
    }
    if (parts.length === 0) continue;
    const line = `  r${r + 1}: ${parts.join(" | ")}`;
    if (used + line.length > maxChars) {
      lines.push(`  (cut for length at row ${r + 1} — request a narrower range for the rest)`);
      truncated = true;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 1) lines.push("  (no populated cells in this range)");
  return { text: lines.join("\n"), truncated };
}

export interface CellMatch {
  sheet: string;
  cell: string;
  text: string;
  formula?: string;
}

const SEARCH_LIMIT = 100;

/** Case-insensitive substring match over display text and formula text. */
export function searchCells(
  wb: ParsedWorkbook,
  query: string,
  opts?: { sheets?: string[]; limit?: number },
): { matches: CellMatch[]; truncated: boolean } {
  if (!query.trim()) throw new AnalysisError("search query must not be empty");
  const needle = query.toLowerCase();
  const limit = opts?.limit ?? SEARCH_LIMIT;
  const sheets = opts?.sheets?.length ? opts.sheets.map((n) => resolveSheet(wb, n)) : wb.sheets;

  const matches: CellMatch[] = [];
  let truncated = false;
  outer: for (const sheet of sheets) {
    for (const cell of sheet.cells.values()) {
      const inText = cell.text.toLowerCase().includes(needle);
      const inFormula = cell.formula?.toLowerCase().includes(needle) ?? false;
      if (!inText && !inFormula) continue;
      if (matches.length >= limit) {
        truncated = true;
        break outer;
      }
      matches.push({
        sheet: sheet.name,
        cell: formatCell(cell.row, cell.col),
        text: cell.text,
        ...(cell.formula ? { formula: cell.formula } : {}),
      });
    }
  }
  return { matches, truncated };
}

const NAME_LIMIT = 50;

/** Defined-name lookup — the retrieval complement of the digest's cap. */
export function lookupDefinedNames(
  wb: ParsedWorkbook,
  filter?: string,
  limit = NAME_LIMIT,
): { names: { name: string; ref: string; sheet?: string }[]; total: number } {
  const needle = filter?.toLowerCase() ?? "";
  const all = needle
    ? wb.definedNames.filter((n) => n.name.toLowerCase().includes(needle))
    : wb.definedNames;
  return { names: all.slice(0, limit), total: all.length };
}

const TRACE_LEVEL_CAP = 100;

/**
 * Direct precedents or dependents of a cell, one or two hops out. Keys are
 * the engine's "SHEET!B12" form, deduplicated per level; a second level
 * never repeats a first-level entry (the origin can reappear only under a
 * circular-reference chain).
 */
export function traceCell(
  sim: Simulator,
  sheetName: string,
  cell: string,
  direction: "precedents" | "dependents",
  depth: 1 | 2 = 1,
): { levels: string[][] } {
  if (direction !== "precedents" && direction !== "dependents") {
    throw new AnalysisError(`direction must be "precedents" or "dependents", got "${direction}"`);
  }
  const step = (s: string, c: string): CellKey[] =>
    direction === "precedents" ? sim.precedentsOf(s, c) : sim.dependentsOf(s, c);

  const first = step(sheetName, cell).slice(0, TRACE_LEVEL_CAP);
  const levels: string[][] = [first];

  if (depth === 2 && first.length) {
    const seen = new Set<string>(first);
    const second: string[] = [];
    for (const key of first) {
      const bang = key.lastIndexOf("!");
      const [s, c] = [key.slice(0, bang), key.slice(bang + 1)];
      for (const next of step(s, c)) {
        if (seen.has(next) || second.length >= TRACE_LEVEL_CAP) continue;
        seen.add(next);
        second.push(next);
      }
    }
    levels.push(second.sort());
  }
  return { levels };
}
