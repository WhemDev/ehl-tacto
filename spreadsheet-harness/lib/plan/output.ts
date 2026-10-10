/**
 * Writes the `{id}_output.xlsx` the official evaluator expects.
 *
 * This is a zip-level PATCH, not a re-serialization. Earlier this module ran
 * the input through `XLSX.read` then `XLSX.write` — a full SheetJS
 * round-trip that silently dropped whole parts SheetJS's object model has no
 * slot for (verified on a real workbook: the entire `xl/externalLinks/**`
 * tree — 5 links + 5 rels — vanished on write even though surviving formulas
 * still referenced them) and degraded everything else it did keep (styles,
 * theme, a stale `calcChain.xml` left untouched, `sharedStrings.xml` either
 * kept or dropped depending on incidental content shape). That mismatch
 * between "formula still points at it" and "part is gone" is exactly what
 * makes Excel refuse the file and offer to repair it.
 *
 * The fix: `unzipSync` the input, touch only the specific `<c>` elements an
 * edit or a cached-value refresh actually changes (string-replacing inside
 * the worksheet XML text), and `zipSync` everything back — every other zip
 * entry (externalLinks, theme, styles, comments, a second untouched sheet,
 * …) is carried over with byte-identical CONTENT. No SheetJS object model
 * ever sits between the input bytes and the output bytes.
 *
 * The file starts from the input's own bytes (so sheets, number formats and
 * every byte of markup this module doesn't touch survive untouched), then:
 *  - every edit from the plan is applied — formulas with their engine-computed
 *    cached value beside them, literals as literals, clears as deletions;
 *  - formula cells inside the edits' blast radius (downstream of an edit in
 *    the dependency graph), OR whose source never cached a value at all
 *    (GridCell.uncalculated — the workbook was saved without ever being
 *    recalculated), get their cached value refreshed from the engine's
 *    recalculation, so a data_only reader (openpyxl, this repo's own
 *    scorer) sees the same values scoreTask() already computed in memory
 *    without needing LibreOffice to recompute. Cells outside both of those
 *    keep the file's own cached values — the engine's opinion of a cell no
 *    edit could have changed, and that the file itself already had a real
 *    answer for, is never allowed to overwrite what Excel itself computed.
 *
 * calcChain.xml (Excel's own cache of formula recalculation order) is
 * deleted — along with its `[Content_Types].xml` Override and its
 * `xl/_rels/workbook.xml.rels` Relationship — whenever a patch changes the
 * calc graph's shape: a plan-edited formula, a brand new formula cell, or a
 * formula cell overwritten by a plain value. Excel rebuilds calcChain.xml
 * silently on open; a *stale* one (still listing cells whose formula
 * changed underneath it) is a repair trigger, exactly like the missing
 * externalLinks. A run that only refreshed cached values on unchanged
 * formulas — the common case — never touches calcChain.xml at all.
 *
 * Cell value/type convention: an existing cell's own `s` (style) attribute
 * is always preserved verbatim; only `t` (type) and the value payload
 * (`<v>`/`<is>`) are replaced, and only for cells this module actually
 * decided to touch. A literal (non-formula) string is written `t="inlineStr"`
 * with `<is><t>` — the OOXML-correct type for a string that is not a shared
 * -string reference and not a formula's cached result — which sidesteps
 * `sharedStrings.xml` entirely (no index bookkeeping, no need to touch that
 * part). A formula cell whose cached value is a string uses `t="str"` with
 * `<v>` instead, since `<is>` is specifically the *inline, not-a-formula*
 * variant and `<v>` is where a formula's cache always lives. Numbers/dates
 * omit `t` (the default, numeric, type); booleans use `t="b"`/`<v>1|0</v>`;
 * engine errors use `t="e"` with the error's own text (`#DIV/0!`, …) as
 * `<v>` — OOXML errors are literal text, not BIFF's binary numeric codes.
 *
 * Known narrow gap: a plan edit that overwrites a cell which was the MASTER
 * of a shared-formula group (`<f t="shared" ref="..." si="N">`) drops that
 * `t="shared"` declaration along with the rest of the old `<f>` — any other
 * member cell elsewhere in the sheet that only carries `<f t="shared"
 * si="N"/>` (no formula text of its own, by design) would be left pointing
 * at a group Excel can no longer resolve. This is a real but rare case
 * (a plan's edit landing exactly on a shared-formula's anchor cell); every
 * OTHER shared-formula cell — the overwhelming majority, since only cells an
 * edit or a refresh actually touches are rewritten at all — keeps its
 * original `<f t="shared" ...>` byte-for-byte, which the old whole-file
 * SheetJS round-trip never did for ANY cell (SheetJS flattens shared
 * formulas into distinct explicit ones on write). Net effect is strictly
 * better than before, not worse; the remaining gap is documented rather
 * than silently risked.
 *
 * Moved from lib/bench/output.ts in Phase A1 of the Work rework: writing an
 * edited workbook back out to xlsx bytes has no benchmark-only dependency —
 * it belongs alongside lib/plan/edits.ts for app adoption. lib/bench/output.ts
 * is now a shim re-exporting buildOutputXlsx from here.
 */

import { unzipSync, zipSync } from "fflate";
import { colToIndex, formatCell, formatRange, parseRange } from "@/lib/a1";
import { isExcelError, type CellValue } from "@/lib/formula/ast";
import { cellIsAffected, type AppliedPlan } from "@/lib/plan/edits";
import { cellKey, type ParsedWorkbook } from "@/lib/workbook";

/** OOXML's own error text, not BIFF's numeric error codes (those are for
 *  the legacy binary .xls format and have no place in a `<v>` element
 *  here — an xlsx error cell's `<v>` is the literal string "#DIV/0!" etc.). */
const VALID_ERROR_CODES = new Set(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"]);

function errorText(code: string): string {
  // #CIRCULAR! is this engine's own invention (lib/formula/ast.ts) — Excel
  // has no such code, so it's reported the same way the old SheetJS-object
  // convention did: as #VALUE!.
  return VALID_ERROR_CODES.has(code) ? code : "#VALUE!";
}

// ---------------------------------------------------------------------------
// XML text helpers
// ---------------------------------------------------------------------------

/** Escapes text for use inside XML element content (not attribute values —
 *  see escapeXmlAttr for those). Handles the three structural characters,
 *  `\r` (which a lenient XML parser would otherwise normalize away, losing
 *  a real CR the cell text had), and control characters XML 1.0 forbids
 *  outright by round-tripping them through SpreadsheetML's own `_xHHHH_`
 *  convention — the same one Excel itself uses, so a value with a stray
 *  control character survives instead of producing invalid XML. */
function escapeXmlText(s: string): string {
  let out = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  out = out.replace(/\r/g, "&#13;");
  // A literal "_xHHHH_"-shaped substring already in the string would be
  // misread as an escape on re-parse — escape its leading underscore first.
  out = out.replace(/_(x[0-9A-Fa-f]{4}_)/g, "_x005F_$1");
  // XML 1.0 forbids most C0 control characters outright (only tab/LF are
  // legal raw at this point — \r was just turned into &#13; above); they are
  // round-tripped through SpreadsheetML's own `_xHHHH_` convention instead
  // of being dropped, so a value with a stray control character survives
  // rather than silently losing it. Written as an explicit numeric-code
  // check rather than a regex character class: a source file is no place
  // for literal control bytes.
  out = [...out]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      const forbidden = code <= 31 && code !== 9 && code !== 10;
      return forbidden ? `_x${code.toString(16).padStart(4, "0").toUpperCase()}_` : ch;
    })
    .join("");
  return out;
}

function escapeXmlAttr(s: string): string {
  return escapeXmlText(s).replace(/"/g, "&quot;");
}

/** Reverses escapeXmlText/escapeXmlAttr's entity side — only ever applied to
 *  attribute values this module reads back out of the original file (sheet
 *  names, relationship targets), never to bulk XML it's about to re-scan. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0"; // guarded by serializeCellValue before this is reached
  if (Object.is(n, -0)) return "0";
  return String(n);
}

/** The real Excel epoch (1900 date system, leap-year bug included) — Dec 30
 *  1899 as day zero reproduces Excel's actual serials for every date from
 *  1900-03-01 onward (verified against Microsoft's own documented values:
 *  serial 60 = the phantom 1900-02-29, serial 61 = 1900-03-01), which is
 *  what a real xlsx file on disk needs. Deliberately NOT
 *  lib/formula/functions/date.ts's `dateToSerial`: that one intentionally
 *  reproduces the Python reference oracle's own (differently-off) date math
 *  so this repo's scorer agrees with the oracle — a fidelity target that has
 *  nothing to do with what a real xlsx file must contain to open cleanly in
 *  Excel. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function excelSerialFromDate(d: Date): number {
  return (d.getTime() - EXCEL_EPOCH_MS) / 86_400_000;
}

// ---------------------------------------------------------------------------
// Generic "find this element" helper — used for <sheetData>, and reused at
// the zip level nowhere else since workbook.xml/rels/Content_Types are all
// patched with targeted regexes instead (their shapes are simple lists of
// self-closed sibling tags, not a single nested block worth locating first).
// ---------------------------------------------------------------------------

interface LocatedElement {
  /** Attributes text exactly as written, e.g. ` r="12" spans="1:4"` (leading
   *  space included, or empty string for none) — reused verbatim so this
   *  module never has to reconstruct an attribute list it didn't invent. */
  attrs: string;
  /** True when the source was self-closed (`<tag .../>`, no children). */
  selfClosing: boolean;
  /** Offsets of the element's inner content in the original string — equal
   *  (empty range) when selfClosing. */
  innerStart: number;
  innerEnd: number;
}

function locateElement(xml: string, tag: string): LocatedElement | null {
  const openRe = new RegExp(`<${tag}\\b([^>]*)>`);
  const m = openRe.exec(xml);
  if (!m) return null;
  const openEnd = m.index + m[0].length;
  let attrs = m[1];
  if (attrs.trimEnd().endsWith("/")) {
    return { attrs: attrs.trimEnd().slice(0, -1), selfClosing: true, innerStart: openEnd, innerEnd: openEnd };
  }
  const closeTag = `</${tag}>`;
  const closeIdx = xml.indexOf(closeTag, openEnd);
  if (closeIdx === -1) return null;
  return { attrs, selfClosing: false, innerStart: openEnd, innerEnd: closeIdx };
}

// ---------------------------------------------------------------------------
// Row / cell scanning within a worksheet's <sheetData>
// ---------------------------------------------------------------------------

/** Matches one whole `<row>` element, self-closed or paired — row content
 *  never contains a literal `</row>` (any such text inside a cell's own
 *  string content is XML-escaped), so a non-greedy paired match is safe. */
const ROW_TAG_RE = /<row\b[^>]*?\/>|<row\b[^>]*?>[\s\S]*?<\/row>/g;
const CELL_TAG_RE = /<c\b[^>]*?\/>|<c\b[^>]*?>[\s\S]*?<\/c>/g;
const F_TAG_RE = /<f\b[^>]*?\/>|<f\b[^>]*?>[\s\S]*?<\/f>/;

interface RowToken {
  rowNum: number; // 1-based, as written in r="N"
  raw: string;
}

function scanRows(sheetDataInner: string): RowToken[] {
  const out: RowToken[] = [];
  for (const m of sheetDataInner.matchAll(ROW_TAG_RE)) {
    const rMatch = /\br="(\d+)"/.exec(m[0]);
    if (!rMatch) continue; // a row with no r= is not something real Excel writes; skip defensively
    out.push({ rowNum: Number(rMatch[1]), raw: m[0] });
  }
  return out;
}

function parseRowElement(raw: string): { attrs: string; inner: string } {
  const selfClose = /^<row([^>]*)\/>$/.exec(raw);
  if (selfClose) return { attrs: selfClose[1], inner: "" };
  const paired = /^<row([^>]*)>([\s\S]*)<\/row>$/.exec(raw);
  if (!paired) throw new Error(`buildOutputXlsx: malformed <row> element: ${raw.slice(0, 80)}`);
  return { attrs: paired[1], inner: paired[2] };
}

interface CellToken {
  ref: string;
  col: number;
  raw: string;
  styleAttr?: string;
  fTag?: string;
}

function parseCells(rowInner: string): CellToken[] {
  const out: CellToken[] = [];
  for (const m of rowInner.matchAll(CELL_TAG_RE)) {
    const raw = m[0];
    const refMatch = /\br="([A-Za-z]+\d+)"/.exec(raw);
    if (!refMatch) continue;
    const ref = refMatch[1];
    const colLetters = /^[A-Za-z]+/.exec(ref)![0];
    const styleMatch = /\bs="(\d+)"/.exec(raw);
    const fMatch = F_TAG_RE.exec(raw);
    out.push({ ref, col: colToIndex(colLetters), raw, styleAttr: styleMatch?.[1], fTag: fMatch?.[0] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cell actions — what buildOutputXlsx decided to do to a given ref
// ---------------------------------------------------------------------------

type CellPatchAction =
  | { kind: "clear" }
  | { kind: "refresh"; value: CellValue }
  | { kind: "formula"; formula: string; value: CellValue }
  | { kind: "value"; value: CellValue };

function refToRowCol(ref: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  return { row: Number(m[2]) - 1, col: colToIndex(m[1]) };
}

/** Looks up the raw GridCell for a single-cell ref against the ORIGINAL
 *  (pre-edit) parsed workbook — used only to ask "did this ref used to be a
 *  formula" for the calcChain policy below. Case-sensitive on purpose: every
 *  sheet name this module keys sheetActions by is already canonicalized to
 *  the workbook's own spelling (applyEditsToSim/canonicalSheet), same as
 *  lib/plan/edits.ts's own private cellAt twin. */
function originalCellHasFormula(workbook: ParsedWorkbook, sheetName: string, ref: string): boolean {
  const sheet = workbook.sheets.find((s) => s.name === sheetName);
  if (!sheet) return false;
  const { row, col } = refToRowCol(ref);
  return sheet.cells.get(cellKey(row, col))?.formula !== undefined;
}

/**
 * Same cell-selection logic buildOutputXlsx has always run (refresh pass
 * over the blast radius, then formula edits, then value edits/clears —
 * edits always win over a refresh for the same ref), just recorded as
 * per-sheet ref -> action maps instead of mutated straight into a SheetJS
 * worksheet object.
 */
function collectSheetActions(applied: AppliedPlan): Map<string, Map<string, CellPatchAction>> {
  const bySheet = new Map<string, Map<string, CellPatchAction>>();
  const actionsFor = (name: string): Map<string, CellPatchAction> => {
    let m = bySheet.get(name);
    if (!m) {
      m = new Map();
      bySheet.set(name, m);
    }
    return m;
  };

  for (const sheet of applied.workbook.sheets) {
    for (const cell of sheet.cells.values()) {
      if (!cell.formula) continue;
      const ref = formatCell(cell.row, cell.col);
      if (!cellIsAffected(applied, sheet.name, ref) && !cell.uncalculated) continue;
      if (applied.editedValues.get(sheet.name)?.has(ref)) continue;
      if (applied.editedFormulas.get(sheet.name)?.has(ref)) continue;
      const value = applied.sim.getValue(sheet.name, ref);
      actionsFor(sheet.name).set(ref, { kind: "refresh", value });
    }
  }

  for (const [sheetName, formulas] of applied.editedFormulas) {
    for (const [ref, formula] of formulas) {
      const value = applied.sim.getValue(sheetName, ref);
      actionsFor(sheetName).set(ref, { kind: "formula", formula, value });
    }
  }

  for (const [sheetName, values] of applied.editedValues) {
    for (const ref of values.keys()) {
      const value = applied.sim.getValue(sheetName, ref);
      actionsFor(sheetName).set(ref, value === null ? { kind: "clear" } : { kind: "value", value });
    }
  }

  return bySheet;
}

/** Whether any patch this run is making changes the calc GRAPH's shape
 *  (as opposed to just refreshing a cached value on an unchanged formula):
 *  a plan-edited or brand-new formula, or a formula cell overwritten by a
 *  plain value. Any of those makes xl/calcChain.xml stale — see this
 *  module's header doc. */
function formulaGraphChanged(applied: AppliedPlan): boolean {
  for (const formulas of applied.editedFormulas.values()) {
    if (formulas.size > 0) return true;
  }
  for (const [sheetName, values] of applied.editedValues) {
    for (const ref of values.keys()) {
      if (originalCellHasFormula(applied.workbook, sheetName, ref)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Cell value -> XML
// ---------------------------------------------------------------------------

function serializeCellValue(value: CellValue, isFormulaCell: boolean): { t?: string; inner: string } {
  if (isExcelError(value)) {
    return { t: "e", inner: `<v>${errorText(value.code)}</v>` };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { t: "e", inner: "<v>#NUM!</v>" };
    return { inner: `<v>${formatNumber(value)}</v>` };
  }
  if (typeof value === "boolean") {
    return { t: "b", inner: `<v>${value ? 1 : 0}</v>` };
  }
  if (value instanceof Date) {
    return { inner: `<v>${formatNumber(excelSerialFromDate(value))}</v>` };
  }
  if (typeof value === "string") {
    return isFormulaCell
      ? { t: "str", inner: `<v>${escapeXmlText(value)}</v>` }
      : { t: "inlineStr", inner: `<is><t xml:space="preserve">${escapeXmlText(value)}</t></is>` };
  }
  if (Array.isArray(value)) return serializeCellValue(value[0]?.[0] ?? null, isFormulaCell);
  // null: a formula that evaluated to blank still needs its formula kept,
  // with a numeric 0 cache — matches the pre-rewrite sheetJsCell convention
  // (see this module's git history) so a data_only reader still sees a
  // cache rather than an empty <v>. Never reached for a non-formula cell:
  // collectSheetActions turns a null literal into a "clear" action instead.
  return { inner: "<v>0</v>" };
}

function buildCellXml(
  ref: string,
  styleAttr: string | undefined,
  action: Exclude<CellPatchAction, { kind: "clear" }>,
  originalFTag: string | undefined,
): string {
  let fTag = "";
  let isFormulaCell = false;
  if (action.kind === "refresh") {
    isFormulaCell = true;
    // Preserved verbatim, shared-formula attributes (t="shared" ref= si=)
    // included — the formula text itself never changed, only its cache.
    fTag = originalFTag ?? "";
  } else if (action.kind === "formula") {
    isFormulaCell = true;
    fTag = `<f>${escapeXmlText(action.formula)}</f>`;
  }
  const { t, inner } = serializeCellValue(action.value, isFormulaCell);
  const attrs = [`r="${ref}"`, styleAttr !== undefined ? `s="${styleAttr}"` : null, t ? `t="${t}"` : null]
    .filter((x): x is string => x !== null)
    .join(" ");
  return `<c ${attrs}>${fTag}${inner}</c>`;
}

// ---------------------------------------------------------------------------
// Worksheet-level patching
// ---------------------------------------------------------------------------

function rebuildRow(rowNum1: number, existing: RowToken | undefined, rowActions: Map<string, CellPatchAction>): string {
  let attrs = ` r="${rowNum1}"`;
  const byRef = new Map<string, CellToken>();
  if (existing) {
    const parsed = parseRowElement(existing.raw);
    attrs = parsed.attrs;
    for (const c of parseCells(parsed.inner)) byRef.set(c.ref, c);
  }

  for (const [ref, action] of rowActions) {
    if (action.kind === "clear") {
      byRef.delete(ref);
      continue;
    }
    const prior = byRef.get(ref);
    const xml = buildCellXml(ref, prior?.styleAttr, action, prior?.fTag);
    const { col } = refToRowCol(ref);
    byRef.set(ref, { ref, col, raw: xml });
  }

  const cellsXml = [...byRef.values()]
    .sort((a, b) => a.col - b.col)
    .map((c) => c.raw)
    .join("");
  return `<row${attrs}>${cellsXml}</row>`;
}

/**
 * Widens (never shrinks) a worksheet's `<dimension ref="...">` — its own
 * declared used range — to cover every one of `refs`. Not cosmetic:
 * lib/workbook.ts's parseWorkbook trusts `!ref` (SheetJS's own reading of
 * this element) as the iteration bound and silently drops any cell outside
 * it (verified by hand: a cell this module patched in past the original
 * dimension came back missing on re-parse until this widening was added).
 * A cell inside the original bound never needs this; only new cells/rows
 * that land outside it do — but it costs nothing to always reconcile.
 * Excel itself does the equivalent on every save. Missing `<dimension>`
 * entirely (some writers omit it, it's optional per the schema) inserts one
 * rather than leaving it out — SheetJS recomputes a correct `!ref` by
 * scanning content when it's absent too, but writing an accurate one is
 * more honest than relying on every reader making that same choice.
 */
function widenDimension(xml: string, refs: Iterable<string>): string {
  const dimRe = /<dimension\s+ref="([^"]*)"\s*\/>/;
  const m = dimRe.exec(xml);

  let startRow: number | undefined;
  let startCol: number | undefined;
  let endRow: number | undefined;
  let endCol: number | undefined;
  if (m) {
    const box = parseRange(m[1]);
    if (box) {
      ({ startRow, startCol, endRow, endCol } = box);
    }
  }
  for (const ref of refs) {
    const { row, col } = refToRowCol(ref);
    startRow = startRow === undefined ? row : Math.min(startRow, row);
    startCol = startCol === undefined ? col : Math.min(startCol, col);
    endRow = endRow === undefined ? row : Math.max(endRow, row);
    endCol = endCol === undefined ? col : Math.max(endCol, col);
  }
  if (startRow === undefined || startCol === undefined || endRow === undefined || endCol === undefined) return xml;

  const newRef = formatRange({ startRow, startCol, endRow, endCol });
  if (m) {
    return `${xml.slice(0, m.index)}<dimension ref="${newRef}"/>${xml.slice(m.index + m[0].length)}`;
  }
  const wsOpen = /<worksheet\b[^>]*>/.exec(xml);
  if (!wsOpen) return xml;
  const insertAt = wsOpen.index + wsOpen[0].length;
  return `${xml.slice(0, insertAt)}<dimension ref="${newRef}"/>${xml.slice(insertAt)}`;
}

/** Patches an EXISTING worksheet part's XML. Only rows containing at least
 *  one touched cell are rebuilt — every other row's raw text (and every
 *  cell inside it) is carried over exactly as it appears in `xml`, so a
 *  run that edits ten cells in a ten-thousand-row sheet only ever
 *  regenerates those ten rows' markup. */
function patchExistingSheetXml(xml: string, actions: Map<string, CellPatchAction>): string {
  const sd = locateElement(xml, "sheetData");
  if (!sd) throw new Error("buildOutputXlsx: worksheet XML has no <sheetData> element");

  const actionsByRow = new Map<number, Map<string, CellPatchAction>>();
  for (const [ref, action] of actions) {
    const { row } = refToRowCol(ref);
    const rowNum1 = row + 1;
    if (!actionsByRow.has(rowNum1)) actionsByRow.set(rowNum1, new Map());
    actionsByRow.get(rowNum1)!.set(ref, action);
  }

  const existingRows = sd.selfClosing ? [] : scanRows(xml.slice(sd.innerStart, sd.innerEnd));
  const rowsByNum = new Map<number, RowToken>();
  for (const r of existingRows) rowsByNum.set(r.rowNum, r);

  for (const [rowNum1, rowActions] of actionsByRow) {
    const rebuilt = rebuildRow(rowNum1, rowsByNum.get(rowNum1), rowActions);
    rowsByNum.set(rowNum1, { rowNum: rowNum1, raw: rebuilt });
  }

  const newInner = [...rowsByNum.values()]
    .sort((a, b) => a.rowNum - b.rowNum)
    .map((r) => r.raw)
    .join("");

  const openTag = sd.selfClosing ? `<sheetData${sd.attrs}>` : xml.slice(xml.indexOf("<sheetData"), sd.innerStart);
  const before = xml.slice(0, xml.indexOf("<sheetData"));
  const after = sd.selfClosing ? xml.slice(sd.innerEnd) : xml.slice(sd.innerEnd + "</sheetData>".length);
  const patched = `${before}${openTag}${newInner}</sheetData>${after}`;
  return widenDimension(patched, actions.keys());
}

/** Builds a brand-new worksheet part from scratch — a plan-declared new
 *  sheet (CellEditPlan.newSheets / AppliedPlan.newSheets) the input file
 *  never had. Minimal but valid: `<dimension>`/`<sheetViews>` are optional
 *  per the schema and Excel fills them in on open. */
function buildNewSheetXml(actions: Map<string, CellPatchAction>): string {
  const byRow = new Map<number, Map<string, Exclude<CellPatchAction, { kind: "clear" }>>>();
  for (const [ref, action] of actions) {
    if (action.kind === "clear") continue; // clearing a cell in a sheet that never existed is a no-op
    const { row } = refToRowCol(ref);
    const rowNum1 = row + 1;
    if (!byRow.has(rowNum1)) byRow.set(rowNum1, new Map());
    byRow.get(rowNum1)!.set(ref, action);
  }

  const rowsXml = [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rowNum1, rowActions]) => {
      const cellsXml = [...rowActions.entries()]
        .sort((a, b) => refToRowCol(a[0]).col - refToRowCol(b[0]).col)
        .map(([ref, action]) => buildCellXml(ref, undefined, action, undefined))
        .join("");
      return `<row r="${rowNum1}">${cellsXml}</row>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetData>${rowsXml}</sheetData></worksheet>`
  );
}

// ---------------------------------------------------------------------------
// Workbook-level structure: xl/workbook.xml, its rels, [Content_Types].xml
// ---------------------------------------------------------------------------

interface SheetDecl {
  name: string;
  rId: string;
}

function parseWorkbookSheets(workbookXml: string): SheetDecl[] {
  const sheetsBlock = /<sheets>([\s\S]*?)<\/sheets>/.exec(workbookXml);
  if (!sheetsBlock) return [];
  const out: SheetDecl[] = [];
  for (const m of sheetsBlock[1].matchAll(/<sheet\b[^>]*\/>/g)) {
    const tag = m[0];
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    const rId = /\br:id="([^"]*)"/.exec(tag)?.[1];
    if (name !== undefined && rId !== undefined) out.push({ name: decodeXmlEntities(name), rId });
  }
  return out;
}

function parseRelationshipTargets(relsXml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const tag = m[0];
    const id = /\bId="([^"]*)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]*)"/.exec(tag)?.[1];
    if (id && target) out.set(id, decodeXmlEntities(target));
  }
  return out;
}

/** Resolves a relationship Target against the part that declared it
 *  (xl/workbook.xml -> xl/_rels/workbook.xml.rels's own targets are always
 *  relative to `xl/`, per OPC; a leading "/" means package-root-relative
 *  instead, and real files sometimes use that form too). */
function resolveZipPath(basePart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const stack = basePart.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return stack.join("/");
}

function nextWorksheetPartPath(zip: Record<string, Uint8Array>): string {
  let max = 0;
  for (const key of Object.keys(zip)) {
    const m = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `xl/worksheets/sheet${max + 1}.xml`;
}

const WORKSHEET_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const WORKSHEET_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";

/** Registers a brand-new worksheet part into workbook.xml (<sheet>),
 *  workbook.xml.rels (<Relationship>) and [Content_Types].xml (<Override>).
 *  Reads and rewrites all three from `zip` on every call (rather than
 *  threading parsed state through) so calling this in a loop for several
 *  new sheets in one run always sees the previous call's own additions when
 *  picking the next sheetId/rId. */
function registerNewSheet(
  zip: Record<string, Uint8Array>,
  decoder: TextDecoder,
  encoder: TextEncoder,
  sheetName: string,
  partPath: string,
): void {
  const wbPath = "xl/workbook.xml";
  let wb = decoder.decode(zip[wbPath]);
  const existingSheetIds = [...wb.matchAll(/\bsheetId="(\d+)"/g)].map((m) => Number(m[1]));
  const nextSheetId = existingSheetIds.length ? Math.max(...existingSheetIds) + 1 : 1;

  const relsPath = "xl/_rels/workbook.xml.rels";
  let rels = decoder.decode(zip[relsPath]);
  const existingRIds = [...rels.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]));
  const nextRId = `rId${existingRIds.length ? Math.max(...existingRIds) + 1 : 1}`;

  const sheetTag = `<sheet name="${escapeXmlAttr(sheetName)}" sheetId="${nextSheetId}" r:id="${nextRId}"/>`;
  wb = wb.replace("</sheets>", `${sheetTag}</sheets>`);
  zip[wbPath] = encoder.encode(wb);

  const target = partPath.replace(/^xl\//, "");
  const relTag = `<Relationship Id="${nextRId}" Type="${WORKSHEET_REL_TYPE}" Target="${escapeXmlAttr(target)}"/>`;
  rels = rels.replace("</Relationships>", `${relTag}</Relationships>`);
  zip[relsPath] = encoder.encode(rels);

  const ctPath = "[Content_Types].xml";
  let ct = decoder.decode(zip[ctPath]);
  const override = `<Override PartName="/${partPath}" ContentType="${WORKSHEET_CONTENT_TYPE}"/>`;
  ct = ct.replace("</Types>", `${override}</Types>`);
  zip[ctPath] = encoder.encode(ct);
}

/** Deletes xl/calcChain.xml and every reference to it, when present. A
 *  workbook that never had one (never saved+recalculated by real Excel, or
 *  already-stripped) is left alone. */
function removeCalcChain(zip: Record<string, Uint8Array>, decoder: TextDecoder, encoder: TextEncoder): void {
  const calcChainPath = "xl/calcChain.xml";
  if (!(calcChainPath in zip)) return;
  delete zip[calcChainPath];

  const ctPath = "[Content_Types].xml";
  if (zip[ctPath]) {
    const ct = decoder.decode(zip[ctPath]).replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, "");
    zip[ctPath] = encoder.encode(ct);
  }

  const relsPath = "xl/_rels/workbook.xml.rels";
  if (zip[relsPath]) {
    const rels = decoder
      .decode(zip[relsPath])
      .replace(/<Relationship\b[^>]*Target="calcChain\.xml"[^>]*\/>/, "");
    zip[relsPath] = encoder.encode(rels);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** The output workbook as xlsx bytes. */
export function buildOutputXlsx(inputBytes: Uint8Array, applied: AppliedPlan): Uint8Array {
  // A plan that edited nothing produces the input, byte for byte.
  if (
    applied.editedFormulas.size === 0 &&
    applied.editedValues.size === 0 &&
    applied.newSheets.length === 0
  ) {
    return inputBytes;
  }

  const sheetActions = collectSheetActions(applied);
  // A plan can declare newSheets that end up with no actual edits (a
  // no-op declaration) — nothing to patch or register for those.
  let anyActions = false;
  for (const m of sheetActions.values()) if (m.size > 0) anyActions = true;
  if (!anyActions) return inputBytes;

  const zip = unzipSync(inputBytes) as Record<string, Uint8Array>;
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();

  const workbookXml = decoder.decode(zip["xl/workbook.xml"]);
  const relsXml = zip["xl/_rels/workbook.xml.rels"] ? decoder.decode(zip["xl/_rels/workbook.xml.rels"]) : "";
  const sheetDecls = parseWorkbookSheets(workbookXml);
  const relTargets = parseRelationshipTargets(relsXml);

  const sheetPath = new Map<string, string>();
  for (const decl of sheetDecls) {
    const target = relTargets.get(decl.rId);
    if (target) sheetPath.set(decl.name, resolveZipPath("xl/workbook.xml", target));
  }
  const findSheetPath = (name: string): string | undefined => {
    if (sheetPath.has(name)) return sheetPath.get(name);
    const lower = name.trim().toLowerCase();
    for (const [k, v] of sheetPath) if (k.trim().toLowerCase() === lower) return v;
    return undefined;
  };

  for (const [sheetName, actions] of sheetActions) {
    if (actions.size === 0) continue;
    const path = findSheetPath(sheetName);
    if (path && zip[path]) {
      const xml = decoder.decode(zip[path]);
      zip[path] = encoder.encode(patchExistingSheetXml(xml, actions));
    } else {
      const newPath = nextWorksheetPartPath(zip);
      zip[newPath] = encoder.encode(buildNewSheetXml(actions));
      registerNewSheet(zip, decoder, encoder, sheetName, newPath);
    }
  }

  if (formulaGraphChanged(applied)) removeCalcChain(zip, decoder, encoder);

  return zipSync(zip);
}
