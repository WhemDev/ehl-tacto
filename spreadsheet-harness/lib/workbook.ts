import * as XLSX from "xlsx";
import { colToIndex, formatCell, indexToCol } from "./a1";
import { parseWorkbookStyles, type ResolvedStyle } from "./workbook-styles";

/**
 * Workbook parsing. Runs in the browser (files never leave the machine) and in
 * Node for the unit tests, so nothing here may touch `window` or `fs`.
 *
 * The output is a sparse grid model: a Map keyed by "row:col" rather than a
 * dense 2D array, because a 5,000 x 100 sheet would otherwise allocate half a
 * million objects for a file that is mostly empty.
 */

export const MAX_ROWS = 5000;
export const MAX_COLS = 100;

export type CellType = "number" | "text" | "date" | "bool" | "error" | "empty";

export interface GridCell {
  row: number;
  col: number;
  /** Raw value: number, string, boolean or Date. */
  value: unknown;
  /** Display text, honouring the cell's number format. */
  text: string;
  type: CellType;
  /** Raw formula without the leading `=`, when the cell has one. */
  formula?: string;
  /** Excel number-format code, e.g. `0.00%` or `mm/dd/yyyy`. */
  numFmt?: string;
  /**
   * True when this is a formula cell whose source file never cached a
   * value for it (an empty or absent `<v>` in the sheet XML) — the
   * workbook was saved without being recalculated, as opposed to a formula
   * that genuinely evaluates to 0. SheetJS types such a cell "z" (its own
   * "Empty" bucket, see `ExcelDataType`) rather than the cached value's
   * real type; a formula cell whose cache WAS populated always comes back
   * typed "n"/"s"/"d"/"b"/"e", including one that genuinely caches 0 —
   * confirmed against both a real 100%-uncached SpreadsheetBench workbook
   * (1,134/1,134 formula cells typed "z") and a fully-cached one (3,991
   * formula cells, 362 of them caching exactly 0, none typed "z"). `value`
   * and `text` are untouched by this flag — they stay whatever
   * classify()/displayText() already produce below (0/"0" here), so every
   * existing consumer keeps reading exactly what it always has. Undefined
   * for a non-formula cell, or a formula cell whose cache WAS populated.
   * See lib/bench/edits.ts's appliedPlanReader for the one place this
   * changes behavior: scoring an untouched cell like this must not read
   * the input's own "0" as if it were Excel's answer.
   */
  uncalculated?: boolean;
  /**
   * Index into the sheet's `styles` table (see `ParsedSheet.styles`) for
   * this cell's own formatting — the same number the source file's
   * worksheet XML carried as `<c s="N">`. Undefined for a cell with no
   * explicit style, OR whose style resolved to nothing worth flagging
   * (see lib/workbook-styles.ts's `buildResolvedStyles`), OR when the file
   * had no resolvable styles at all (`ParsedSheet.styles` itself absent).
   */
  styleIdx?: number;
}

export interface ParsedSheet {
  name: string;
  /** Rows/cols actually present after clamping. */
  rows: number;
  cols: number;
  /** Rows/cols before clamping, so the UI can say what it hid. */
  totalRows: number;
  totalCols: number;
  truncated: boolean;
  cells: Map<string, GridCell>;
  merges: { startRow: number; startCol: number; endRow: number; endCol: number }[];
  /** Column widths in characters, as authored. Used only as a rendering hint. */
  colWidths: (number | undefined)[];
  /**
   * The file's own resolved cell formatting, sparse and indexed by cellXf
   * position — see lib/workbook-styles.ts's `WorkbookStyleData.styles` doc.
   * The SAME array reference is shared by every sheet in the workbook (it's
   * a workbook-level table; sheets only differ in which indices their own
   * cells reference via `GridCell.styleIdx`). Absent entirely when the file
   * had no resolvable styles (no `xl/styles.xml`, a corrupt zip, CSV, ...).
   */
  styles?: (ResolvedStyle | undefined)[];
}

export interface ParsedWorkbook {
  /** Stable id derived from the file name; used as the `sourceId` prefix. */
  id: string;
  fileName: string;
  sheets: ParsedSheet[];
  definedNames: { name: string; ref: string; sheet?: string }[];
  /**
   * The file's own `<calcPr>` settings, when SheetJS found one. `iterate`
   * reflects whatever the authoring session left behind — often `false` even
   * on a workbook whose cached values were only ever correct because Excel
   * iterated to produce them — so no code here may treat this as permission
   * to iterate. It's a caller's opt-in (see `createSimulator`'s
   * `iterateCycles` option) that decides whether to enable iteration at all;
   * this field only supplies the file's own count/delta once a caller has
   * already opted in. Omitted entirely when the file has no CalcPr.
   */
  calcPr?: { iterate: boolean; iterateCount: number; iterateDelta: number };
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function slugify(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "file"
  );
}

function classify(cell: XLSX.CellObject): CellType {
  switch (cell.t) {
    case "n":
      return "number";
    case "d":
      return "date";
    case "b":
      return "bool";
    case "e":
      return "error";
    case "s":
      return "text";
    default:
      return "empty";
  }
}

function displayText(cell: XLSX.CellObject): string {
  if (typeof cell.w === "string") return cell.w;
  if (cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
  if (cell.v === null || cell.v === undefined) return "";
  return String(cell.v);
}

/**
 * Optional overrides for the row/column caps. The defaults (MAX_ROWS x
 * MAX_COLS) are the app's rendering envelope; the benchmark harness passes
 * Excel's own maxima so scoring sees whole workbooks. Parsing cost tracks
 * the cells actually present in the file, not the cap.
 */
export interface ParseLimits {
  maxRows?: number;
  maxCols?: number;
}

export function parseWorkbook(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  limits?: ParseLimits,
): ParsedWorkbook {
  const rawBytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;

  const wb = XLSX.read(rawBytes, {
    type: "array",
    cellFormula: true,
    cellNF: true,
    cellDates: true,
    cellText: true,
    // Needed for `!cols`: without it SheetJS drops authored column widths and
    // every sheet renders at the default width, which reads as a data table
    // rather than the user's actual spreadsheet.
    cellStyles: true,
  });

  const maxRows = limits?.maxRows ?? MAX_ROWS;
  const maxCols = limits?.maxCols ?? MAX_COLS;

  const sheets: ParsedSheet[] = wb.SheetNames.map((name) =>
    parseSheet(wb.Sheets[name], name, maxRows, maxCols),
  );

  // Real Excel formatting (fill/bold/italic/color/alignment) — SheetJS CE's
  // own `cell.s` is insufficient (see lib/workbook-styles.ts's header doc),
  // so this reads the file's own OOXML parts directly off the same raw
  // bytes SheetJS just parsed. Wrapped so a corrupt zip, a missing
  // styles.xml, or a completely unstyled input (csv, xlsb) degrades to
  // "no styles" rather than ever failing the whole parse.
  const styleData = parseWorkbookStyles(rawBytes, wb.SheetNames, { maxRows, maxCols });
  if (styleData) {
    for (const sheet of sheets) {
      sheet.styles = styleData.styles;
      const cellStyleIdx = styleData.cellStyles.get(sheet.name);
      if (!cellStyleIdx) continue;
      for (const [key, styleIdx] of cellStyleIdx) {
        const cell = sheet.cells.get(key);
        // A styled-but-otherwise-empty cell (no value, no formula) was
        // never added to `cells` in the first place (see parseSheet's own
        // `continue` above) — nothing renders there anyway, so there is no
        // GridCell to attach the style to.
        if (cell) cell.styleIdx = styleIdx;
      }
    }
  }

  const definedNames = (wb.Workbook?.Names ?? []).map((n) => ({
    name: n.Name,
    ref: n.Ref,
    sheet: typeof n.Sheet === "number" ? wb.SheetNames[n.Sheet] : undefined,
  }));

  const calcPr = parseCalcPr((wb.Workbook as WorkbookWithCalcPr | undefined)?.CalcPr);

  return {
    id: slugify(fileName),
    fileName,
    sheets,
    definedNames,
    ...(calcPr ? { calcPr } : {}),
  };
}

/**
 * SheetJS's own `.d.ts` (`WBProps`, xlsx/types/index.d.ts) has no `CalcPr`
 * field at all, but the runtime object carries one — confirmed against a
 * real SpreadsheetBench workbook's `<calcPr iterate="false" .../>`. This is
 * the shape read off it, typed as `unknown` per field since XML attributes
 * come back as strings ("true"/"false"/"1"/"0", "100", "0.001") rather than
 * the native types the field names might suggest.
 */
interface WorkbookWithCalcPr {
  CalcPr?: { iterate?: unknown; iterateCount?: unknown; iterateDelta?: unknown };
}

/**
 * Coerces the raw `CalcPr` XML-attribute strings defensively rather than
 * trusting a type. Absent entirely (no `<calcPr>` in the file) stays absent
 * rather than becoming a fabricated all-defaults object.
 */
function parseCalcPr(
  raw: WorkbookWithCalcPr["CalcPr"],
): { iterate: boolean; iterateCount: number; iterateDelta: number } | undefined {
  if (!raw) return undefined;
  return {
    iterate: calcPrBool(raw.iterate),
    iterateCount: calcPrNumber(raw.iterateCount, 100),
    iterateDelta: calcPrNumber(raw.iterateDelta, 0.001),
  };
}

function calcPrBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v === "true" || v === "1";
  return false;
}

function calcPrNumber(v: unknown, fallback: number): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function parseSheet(
  ws: XLSX.WorkSheet | undefined,
  name: string,
  maxRows: number,
  maxCols: number,
): ParsedSheet {
  const empty: ParsedSheet = {
    name,
    rows: 0,
    cols: 0,
    totalRows: 0,
    totalCols: 0,
    truncated: false,
    cells: new Map(),
    merges: [],
    colWidths: [],
  };
  if (!ws || !ws["!ref"]) return empty;

  const ref = XLSX.utils.decode_range(ws["!ref"]);
  const totalRows = ref.e.r + 1;
  const totalCols = ref.e.c + 1;
  const rows = Math.min(totalRows, maxRows);
  const cols = Math.min(totalCols, maxCols);

  // Iterate the cells the file actually contains rather than scanning the
  // full rows x cols rectangle: a financial model styled out to column XFD
  // has a vast declared range but only thousands of real cells, and the
  // dense scan made the cap load-bearing for performance. Sparse iteration
  // makes cost track content, which is what lets callers raise the caps.
  const cells = new Map<string, GridCell>();
  for (const addr of Object.keys(ws)) {
    if (addr.charCodeAt(0) === 33 /* "!" */) continue;
    const pos = XLSX.utils.decode_cell(addr);
    if (pos.r < 0 || pos.c < 0 || pos.r >= rows || pos.c >= cols) continue;
    const cell = ws[addr] as XLSX.CellObject;
    const type = classify(cell);
    const text = displayText(cell);
    if (type === "empty" && text === "" && !cell.f) continue;
    cells.set(cellKey(pos.r, pos.c), {
      row: pos.r,
      col: pos.c,
      value: cell.v ?? null,
      text,
      type,
      formula: cell.f ? String(cell.f) : undefined,
      numFmt: typeof cell.z === "string" ? cell.z : undefined,
      // See GridCell.uncalculated's doc: "z" is SheetJS's own signal for
      // "no cached value to type", independent of cellFormula/cellNF/
      // cellDates/cellText/cellStyles (the options parseWorkbook already
      // passes to XLSX.read above) — no extra parse option is needed.
      uncalculated: cell.f && cell.t === "z" ? true : undefined,
    });
  }

  const merges = (ws["!merges"] ?? [])
    .filter((m) => m.s.r < rows && m.s.c < cols)
    .map((m) => ({
      startRow: m.s.r,
      startCol: m.s.c,
      endRow: Math.min(m.e.r, rows - 1),
      endCol: Math.min(m.e.c, cols - 1),
    }));

  const colWidths = (ws["!cols"] ?? [])
    .slice(0, cols)
    .map((c) => (c && typeof c.wch === "number" ? c.wch : undefined));

  return {
    name,
    rows,
    cols,
    totalRows,
    totalCols,
    truncated: totalRows > maxRows || totalCols > maxCols,
    cells,
    merges,
    colWidths,
  };
}

/** Row-major values for a rectangular window. Missing cells become `undefined`. */
export function readWindow(
  sheet: ParsedSheet,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
): (GridCell | undefined)[][] {
  const out: (GridCell | undefined)[][] = [];
  for (let r = startRow; r <= endRow; r++) {
    const row: (GridCell | undefined)[] = [];
    for (let c = startCol; c <= endCol; c++) {
      row.push(sheet.cells.get(cellKey(r, c)));
    }
    out.push(row);
  }
  return out;
}

export function sheetHasFormulas(sheet: ParsedSheet): number {
  let n = 0;
  for (const cell of sheet.cells.values()) if (cell.formula) n++;
  return n;
}

export { formatCell, indexToCol, colToIndex };
