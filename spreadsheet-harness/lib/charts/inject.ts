/**
 * Splices one or more compiled charts into a real .xlsx package's zip parts.
 *
 * Same zip-patch philosophy as lib/plan/output.ts (READ ITS HEADER DOC
 * FIRST): `unzipSync` the input, touch only the specific parts a chart
 * actually needs (new `xl/charts/chartN.xml`, a new-or-extended
 * `xl/drawings/drawingN.xml`, the target sheet's own `.rels` and worksheet
 * XML, `[Content_Types].xml`), and `zipSync` everything back — every other
 * zip entry (styles, theme, other sheets, externalLinks, …) is carried over
 * with byte-identical content. No SheetJS object model ever sits between
 * the input bytes and the output bytes; SheetJS's own writer is exactly
 * what lib/plan/output.ts's header doc documents dropping whole parts
 * (verified there on a real workbook: the entire `xl/externalLinks/**`
 * tree vanished on a full read/write round-trip), and there is no reason a
 * chart-adding patch would fare any better going through the same object
 * model.
 *
 * Public API takes `ChartSpec[]`, not pre-compiled `CompiledChart[]` —
 * this is a deliberate departure worth explaining. lib/charts/compile.ts's
 * `compileChart` is a pure function that bakes a relationship id
 * (`opts.relId`, default `"rId1"`) and a shape id (`opts.shapeId`, default
 * `1`) directly into the chart's anchor XML text, because compile.ts has no
 * visibility into what else might already share the same drawing part —
 * see compile.ts's header doc. Only THIS module, which actually reads the
 * target package's existing parts, can know the real ids two charts landing
 * on the same sheet need (each must get its own relationship id and shape
 * id, and both must avoid colliding with whatever the sheet's drawing
 * already contains). Accepting pre-compiled objects here would mean either
 * (a) requiring the caller to somehow predict numbering it cannot know
 * without duplicating this module's own bookkeeping, or (b) this module
 * doing brittle regex surgery on another module's already-serialized XML
 * output to overwrite a baked-in `"rId1"`. Calling `compileChart` internally
 * — once per spec, with the real ids this module just resolved — is the one
 * design that keeps both modules honest about what they can and cannot know.
 * `injectChart` below is the single-spec convenience wrapper for the common
 * case and reads closest to the "(bytes, compiled chart, targetSheetName)"
 * shape a caller expects; each `ChartSpec` already carries its own target
 * sheet (`spec.sheet`), so there is no separate sheet-name parameter to keep
 * in sync with it.
 *
 * Two structural cases this module has to get right, both exercised by
 * test/charts-inject.test.ts:
 *
 *  - The target sheet already has a drawing (a real workbook can already
 *    carry one — comments' VML aside, or a chart from a previous run).
 *    New charts get new `<xdr:twoCellAnchor>` fragments appended into that
 *    SAME `xl/drawings/drawingN.xml`, with new relationships appended into
 *    that drawing's own `_rels` file — the worksheet's `<drawing r:id=.../>`
 *    element and its own `.rels` entry are untouched, because they already
 *    point at the right part.
 *  - The target sheet has no drawing yet. A brand-new `xl/drawings/drawingN.xml`
 *    is created (next free N across the whole package), a new relationship
 *    is added to the sheet's own `.rels` file (created from scratch if the
 *    sheet had none at all), and a `<drawing r:id="..."/>` element is
 *    inserted into the worksheet XML at the correct CT_Worksheet schema
 *    position — immediately before whichever of `legacyDrawing`,
 *    `legacyDrawingHF`, `drawingHF`, `picture`, `oleObjects`, `controls`,
 *    `webPublishItems`, `tableParts`, `extLst` appears first (all of them
 *    are required to come AFTER `drawing` and are all optional — the first
 *    one actually present in a given file is where `drawing` has to land),
 *    or right before `</worksheet>` when none of those are present.
 *
 * Chart/drawing part numbering always continues past whatever the input
 * file already has (`xl/charts/chart7.xml` already exists -> the next one
 * this module writes is `chart8.xml`), never reusing or renumbering an
 * existing part — some SpreadsheetBench inputs already carry charts, and
 * this module must never touch what it did not add.
 */

import { unzipSync, zipSync } from "fflate";
import { CHART_CONTENT_TYPE, compileChart, DRAWING_CONTENT_TYPE } from "@/lib/charts/compile";
import { chartSpecSchema, type ChartSpec } from "@/lib/charts/spec";

// ---------------------------------------------------------------------------
// XML helpers — small, self-contained re-implementations of the same
// primitives lib/plan/output.ts keeps private to itself (escapeXmlAttr,
// decodeXmlEntities, resolveZipPath, parseWorkbookSheets,
// parseRelationshipTargets). Duplicated rather than imported: this phase's
// brief is "no changes to existing modules", and none of these ~10-line
// helpers are exported from that module anyway — reimplementing them here
// keeps this module self-contained and independently testable, the same
// tradeoff lib/plan/output.ts itself makes relative to its own callers.
// ---------------------------------------------------------------------------

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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

/** Resolves a relationship Target against the part that declared it, per
 *  OPC: targets are relative to the declaring part's own directory unless
 *  they start with "/" (package-root-relative). Mirrors
 *  lib/plan/output.ts's own `resolveZipPath`. */
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

interface SheetDecl {
  name: string;
  rId: string;
}

function parseWorkbookSheets(workbookXml: string): SheetDecl[] {
  const block = /<sheets>([\s\S]*?)<\/sheets>/.exec(workbookXml);
  if (!block) return [];
  const out: SheetDecl[] = [];
  for (const m of block[1].matchAll(/<sheet\b[^>]*\/>/g)) {
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

function partDir(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function partFile(path: string): string {
  return path.split("/").pop()!;
}

/** The highest N already used by `xl/.../<prefix>N.xml`, so a fresh part
 *  always continues past whatever the input file already has — see this
 *  module's header doc on never renumbering an existing chart/drawing. */
function highestExistingIndex(zip: Record<string, Uint8Array>, pattern: RegExp): number {
  let max = 0;
  for (const key of Object.keys(zip)) {
    const m = pattern.exec(key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function highestRelId(relsXml: string): number {
  let max = 0;
  for (const m of relsXml.matchAll(/\bId="rId(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max;
}

function highestShapeId(drawingXml: string): number {
  let max = 0;
  for (const m of drawingXml.matchAll(/<xdr:cNvPr\s+id="(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max;
}

const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
function emptyRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${RELS_NS}"></Relationships>`;
}

function addRelationship(relsXml: string, id: string, type: string, target: string): string {
  const rel = `<Relationship Id="${id}" Type="${type}" Target="${escAttr(target)}"/>`;
  return relsXml.replace("</Relationships>", `${rel}</Relationships>`);
}

function addContentTypeOverride(contentTypesXml: string, partPath: string, contentType: string): string {
  const override = `<Override PartName="/${partPath}" ContentType="${contentType}"/>`;
  return contentTypesXml.replace("</Types>", `${override}</Types>`);
}

const DRAWING_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
const CHART_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";

const WSDR_HEADER =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">';
const WSDR_FOOTER = "</xdr:wsDr>";

function appendAnchorsToDrawing(existingDrawingXml: string, anchorsXml: string): string {
  const closeIdx = existingDrawingXml.lastIndexOf(WSDR_FOOTER);
  if (closeIdx === -1) throw new Error("injectCharts: existing drawing part has no </xdr:wsDr> closing tag");
  return existingDrawingXml.slice(0, closeIdx) + anchorsXml + existingDrawingXml.slice(closeIdx);
}

/** CT_Worksheet elements that are legal AFTER `drawing` and are all
 *  optional — see this module's header doc. Insertion lands right before
 *  the first of these actually present, or before `</worksheet>` when none
 *  of them are. */
const AFTER_DRAWING_TAGS = [
  "legacyDrawing",
  "legacyDrawingHF",
  "drawingHF",
  "picture",
  "oleObjects",
  "controls",
  "webPublishItems",
  "tableParts",
  "extLst",
];

function insertDrawingElement(sheetXml: string, relId: string): string {
  const tag = `<drawing r:id="${relId}"/>`;
  for (const name of AFTER_DRAWING_TAGS) {
    const m = new RegExp(`<${name}\\b`).exec(sheetXml);
    if (m) return sheetXml.slice(0, m.index) + tag + sheetXml.slice(m.index);
  }
  const closeIdx = sheetXml.lastIndexOf("</worksheet>");
  if (closeIdx === -1) throw new Error("injectCharts: worksheet XML has no </worksheet> closing tag");
  return sheetXml.slice(0, closeIdx) + tag + sheetXml.slice(closeIdx);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Injects every chart in `specs` into `inputXlsxBytes`, returning new xlsx
 * bytes. Each spec's own `sheet` field says where it lands; specs for the
 * same sheet share one drawing part (existing or newly created — see this
 * module's header doc), specs for different sheets get independent ones.
 *
 * An empty `specs` array returns `inputXlsxBytes` itself (reference
 * equality, matching lib/plan/output.ts's own no-op convention) — no zip
 * round-trip for a no-op call.
 *
 * Throws if a spec's `sheet` does not match any sheet in the input workbook
 * (case-insensitively, same tolerance lib/plan/edits.ts's sheet resolution
 * extends elsewhere in this codebase) — a silently-dropped chart would be a
 * much worse failure mode than a thrown error a caller can catch and
 * surface as a validation problem.
 */
export function injectCharts(inputXlsxBytes: Uint8Array, specs: ChartSpec[]): Uint8Array {
  if (specs.length === 0) return inputXlsxBytes;

  const zip = unzipSync(inputXlsxBytes) as Record<string, Uint8Array>;
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();

  const workbookXml = decoder.decode(zip["xl/workbook.xml"]);
  const workbookRelsXml = zip["xl/_rels/workbook.xml.rels"] ? decoder.decode(zip["xl/_rels/workbook.xml.rels"]) : "";
  const sheetDecls = parseWorkbookSheets(workbookXml);
  const workbookRelTargets = parseRelationshipTargets(workbookRelsXml);

  const sheetPathByName = new Map<string, string>();
  for (const decl of sheetDecls) {
    const target = workbookRelTargets.get(decl.rId);
    if (target) sheetPathByName.set(decl.name, resolveZipPath("xl/workbook.xml", target));
  }
  const findSheetPath = (name: string): string | undefined => {
    if (sheetPathByName.has(name)) return sheetPathByName.get(name);
    const lower = name.trim().toLowerCase();
    for (const [k, v] of sheetPathByName) if (k.trim().toLowerCase() === lower) return v;
    return undefined;
  };

  // Validate + group up front, before any zip mutation, so a bad sheet name
  // anywhere in the batch fails the whole call rather than leaving a
  // half-patched file behind.
  const validatedSpecs = specs.map((s) => chartSpecSchema.parse(s));
  const bySheetPath = new Map<string, ChartSpec[]>();
  for (const spec of validatedSpecs) {
    const path = findSheetPath(spec.sheet);
    if (!path || !zip[path]) {
      throw new Error(`injectCharts: sheet "${spec.sheet}" was not found in the input workbook`);
    }
    if (!bySheetPath.has(path)) bySheetPath.set(path, []);
    bySheetPath.get(path)!.push(spec);
  }

  let nextChartIdx = highestExistingIndex(zip, /^xl\/charts\/chart(\d+)\.xml$/) + 1;
  let nextDrawingIdx = highestExistingIndex(zip, /^xl\/drawings\/drawing(\d+)\.xml$/) + 1;
  const contentTypesPath = "[Content_Types].xml";
  let contentTypesXml = decoder.decode(zip[contentTypesPath]);

  for (const [sheetPath, sheetSpecs] of bySheetPath) {
    const sheetXml = decoder.decode(zip[sheetPath]);
    const sheetRelsPath = `${partDir(sheetPath)}/_rels/${partFile(sheetPath)}.rels`;
    const existingSheetRelsXml = zip[sheetRelsPath] ? decoder.decode(zip[sheetRelsPath]) : undefined;

    const drawingRefMatch = /<drawing\s+r:id="([^"]+)"\s*\/>/.exec(sheetXml);
    let existingDrawingPath: string | undefined;
    if (drawingRefMatch && existingSheetRelsXml) {
      const target = parseRelationshipTargets(existingSheetRelsXml).get(drawingRefMatch[1]);
      if (target) existingDrawingPath = resolveZipPath(sheetPath, target);
    }

    let drawingPath: string;
    let drawingXmlBase: string;
    let drawingRelsPath: string;
    let drawingRelsXml: string;
    let nextRelIdNum: number;
    let nextShapeIdNum: number;
    const creatingNewDrawing = !(existingDrawingPath && zip[existingDrawingPath]);

    if (!creatingNewDrawing) {
      drawingPath = existingDrawingPath!;
      drawingXmlBase = decoder.decode(zip[drawingPath]);
      drawingRelsPath = `${partDir(drawingPath)}/_rels/${partFile(drawingPath)}.rels`;
      drawingRelsXml = zip[drawingRelsPath] ? decoder.decode(zip[drawingRelsPath]) : emptyRelsXml();
      nextRelIdNum = highestRelId(drawingRelsXml) + 1;
      nextShapeIdNum = highestShapeId(drawingXmlBase) + 1;
    } else {
      const drawingIdx = nextDrawingIdx++;
      drawingPath = `xl/drawings/drawing${drawingIdx}.xml`;
      drawingXmlBase = WSDR_HEADER + WSDR_FOOTER;
      drawingRelsPath = `xl/drawings/_rels/drawing${drawingIdx}.xml.rels`;
      drawingRelsXml = emptyRelsXml();
      nextRelIdNum = 1;
      nextShapeIdNum = 1;
      contentTypesXml = addContentTypeOverride(contentTypesXml, drawingPath, DRAWING_CONTENT_TYPE);
    }

    let anchorsXml = "";
    for (const spec of sheetSpecs) {
      const chartIdx = nextChartIdx++;
      const chartRelId = `rId${nextRelIdNum++}`;
      const shapeId = nextShapeIdNum++;
      const compiled = compileChart(spec, { relId: chartRelId, shapeId });

      const chartPath = `xl/charts/chart${chartIdx}.xml`;
      zip[chartPath] = encoder.encode(compiled.chartXml);
      contentTypesXml = addContentTypeOverride(contentTypesXml, chartPath, CHART_CONTENT_TYPE);

      drawingRelsXml = addRelationship(drawingRelsXml, chartRelId, CHART_REL_TYPE, `../charts/chart${chartIdx}.xml`);
      anchorsXml += compiled.drawingXml;
    }

    zip[drawingPath] = encoder.encode(appendAnchorsToDrawing(drawingXmlBase, anchorsXml));
    zip[drawingRelsPath] = encoder.encode(drawingRelsXml);

    if (creatingNewDrawing) {
      let sheetRelsXmlNext = existingSheetRelsXml ?? emptyRelsXml();
      const sheetRelId = `rId${highestRelId(sheetRelsXmlNext) + 1}`;
      const drawingTarget = `../drawings/${partFile(drawingPath)}`;
      sheetRelsXmlNext = addRelationship(sheetRelsXmlNext, sheetRelId, DRAWING_REL_TYPE, drawingTarget);
      zip[sheetRelsPath] = encoder.encode(sheetRelsXmlNext);
      zip[sheetPath] = encoder.encode(insertDrawingElement(sheetXml, sheetRelId));
    }
    // Sheet already referenced this drawing part: its own XML and .rels
    // need no change at all — the existing <drawing r:id="..."/> already
    // points at the (now-extended) right part.
  }

  zip[contentTypesPath] = encoder.encode(contentTypesXml);
  return zipSync(zip);
}

/** Single-chart convenience wrapper — see this module's header doc for why
 *  `injectCharts` takes specs, not pre-compiled charts, and why there is no
 *  separate `targetSheetName` parameter (`spec.sheet` already says where it
 *  goes). */
export function injectChart(inputXlsxBytes: Uint8Array, spec: ChartSpec): Uint8Array {
  return injectCharts(inputXlsxBytes, [spec]);
}
