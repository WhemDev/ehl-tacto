/**
 * Resolves a workbook's OWN cell formatting — fill color, bold/italic, font
 * color, horizontal alignment, per-edge cell borders — from its raw OOXML
 * parts.
 *
 * WHY NOT SheetJS's own `cell.s`: the pinned CDN build (SheetJS CE, see
 * lib/workbook.ts's `XLSX.read` options) is missing what this feature needs.
 * Verified on this repo's own Excaliba.xlsx fixture: `cell.s` carries only
 * `patternType`/`fgColor`/`bgColor`, with theme/indexed refs left UNRESOLVED
 * (B4's fill came back as `fgColor: {theme: 0}` — a bare index, no color),
 * and no font data (bold/italic/color/size) at all. Fighting that object
 * model would mean re-deriving the same information CE already threw away.
 * Instead this module goes straight to the source: `xl/styles.xml` (the
 * font/fill/cellXf tables) and `xl/theme/theme1.xml` (the theme color
 * scheme), read directly off the zip with `fflate.unzipSync` — the same
 * zip-level approach lib/plan/output.ts uses to patch worksheet XML,
 * string-scanned rather than DOM-parsed for the same reason: cost should
 * track content, not require a full XML parser dependency.
 *
 * Resolution chain, per cell:
 *   worksheet XML `<c r="B4" s="17">` (the `s` is an index into cellXfs)
 *     -> styles.xml `<cellXfs>[17]` -> { fontId, fillId, borderId, alignment }
 *     -> styles.xml `<fonts>[fontId]` -> bold/italic/color
 *     -> styles.xml `<fills>[fillId]` -> solid-fill fgColor
 *     -> styles.xml `<borders>[borderId]` -> per-edge {style, color}, mapped
 *        to a CSS `border` shorthand (hair/thin -> 1px solid, medium -> 2px
 *        solid, thick -> 3px solid, dashed/mediumDashed -> dashed, dotted ->
 *        dotted, double -> 3px double) — distinct from the grid's own
 *        default hairlines (a UI affordance ExcelGrid draws unconditionally,
 *        not read from the file at all).
 *   A color (font, fill, or border) is one of:
 *     - `rgb="RRGGBB"` (or `AARRGGBB` — the alpha byte is dropped): used as-is.
 *     - `theme="N" tint="t"`: resolved against theme1.xml's clrScheme, then
 *       tinted (see `applyTint`).
 *     - `indexed="N"`: resolved against the legacy 64-entry palette every
 *       xlsx writer still falls back to; 64/65 are the reserved "automatic"
 *       slots and resolve to no color, not literal palette entries.
 *   A BORDER edge's color is the one exception to "unresolved means no
 *   color": a font/fill color that can't resolve (or resolves to plain
 *   black) is simply dropped, since a color that never shows is a no-op —
 *   but a border edge that has a real line at all must render as SOME
 *   visible color, so an absent/auto/unresolved `<color>` there falls back
 *   to literal black (Excel's own "automatic" border color) rather than
 *   being dropped.
 *
 * Only NON-DEFAULT styles are ever stored (an xf whose font/fill/border
 * resolve to nothing worth flagging becomes `undefined`, not `{}`) — most
 * cellXfs in a real workbook are unstyled, and the sparse result is what
 * GridCell.styleIdx/ParsedSheet.styles are built to hold cheaply.
 *
 * Failure honesty: every entry point here is called from inside a `try`
 * (see lib/workbook.ts's `parseWorkbook`) and this module never throws on
 * its own — a file with no `xl/styles.xml` (CSV's synthetic workbook, a
 * corrupt zip, xlsb's binary-record parts under different paths entirely)
 * simply resolves to "no styles" rather than a crash or a caller-visible
 * exception.
 */

import { unzipSync } from "fflate";
import { colToIndex } from "./a1";

export interface ResolvedStyle {
  /** "#RRGGBB" */
  fill?: string;
  bold?: true;
  italic?: true;
  /** "#RRGGBB" */
  color?: string;
  align?: "left" | "center" | "right";
  /**
   * User-authored cell borders — the lines someone actually drew in Excel
   * (a box around a table, an underline beneath a header row), as opposed to
   * the grid's own default hairlines (a pure UI affordance ExcelGrid draws
   * unconditionally on every cell's right/bottom edge; see app/globals.css's
   * `.xl-cell`). Each present edge is a ready-to-use CSS `border` shorthand
   * value, e.g. `"2px solid #000000"` — only set when this cellXf's own
   * `borderId` names a real line on that specific edge.
   */
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
}

export interface WorkbookStyleData {
  /**
   * Sparse, indexed by the workbook's own cellXfs position — the same
   * number a cell's `s="N"` attribute (and, after parsing, `GridCell.
   * styleIdx`) carries. Holes (`undefined`) are the overwhelming majority:
   * only an xf that resolves to at least one non-default field gets an
   * entry. Shared byte-for-byte across every sheet in the workbook, since
   * cellXfs is itself a single workbook-level table (`xl/styles.xml`) that
   * every sheet's `s=` attributes index into.
   */
  styles: (ResolvedStyle | undefined)[];
  /** sheet name -> (cellKey "row:col" -> index into `styles`) */
  cellStyles: Map<string, Map<string, number>>;
}

// ---------------------------------------------------------------------------
// Color resolution: rgb / theme+tint / indexed
// ---------------------------------------------------------------------------

/**
 * The legacy 64-entry indexed-color palette every xlsx writer still falls
 * back to for `<color indexed="N">` (a holdover from pre-2007 Excel, which
 * had no theme system). Index 64/65 are the reserved "System Foreground"/
 * "System Background" (automatic) slots, not real palette entries — the
 * caller treats those as "no color" rather than looking them up here.
 */
const INDEXED_PALETTE: string[] = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

/**
 * Excel's tint formula, applied per RGB channel (not the HLS-based variant
 * some references describe — that one is for the "lighter/darker" slider's
 * internal math; this per-channel form is what every color actually
 * displayed in the app needed to match, verified against this repo's own
 * fixture's fill/tint pairs by eye, and is the same approximation SheetJS's
 * own non-CE theme resolver and most third-party OOXML readers use):
 *   tint > 0 (lighten): c' = c + (255 - c) * tint
 *   tint < 0 (darken):  c' = c * (1 + tint)
 *   tint == 0:          unchanged
 */
function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  const channel = (offset: number): number => {
    const c = parseInt(hex.slice(offset, offset + 2), 16);
    const v = tint > 0 ? c + (255 - c) * tint : c * (1 + tint);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return [channel(0), channel(2), channel(4)]
    .map((c) => c.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

/**
 * Excel's clrScheme document order in `xl/theme/theme1.xml` is dk1, lt1,
 * dk2, lt2, accent1-6, hlink, folHlink — but a cell's `<color theme="N">`
 * INDEX resolves against a DIFFERENT order that swaps the first two pairs:
 * 0->lt1, 1->dk1, 2->lt2, 3->dk2, 4-9->accent1-6, 10->hlink, 11->folHlink.
 * Confirmed against Excaliba.xlsx: B4's cellXf points at a fill whose
 * fgColor is `theme="0"` with no tint, and the cell renders/displays white
 * — lt1, not dk1 (black), which document order alone would suggest.
 */
function themeIndexOrder(dk1?: string, lt1?: string, dk2?: string, lt2?: string, accents: (string | undefined)[] = [], hlink?: string, folHlink?: string): (string | undefined)[] {
  return [lt1, dk1, lt2, dk2, ...accents, hlink, folHlink];
}

function extractThemeColorHex(scope: string, tag: string): string | undefined {
  const block = new RegExp(`<a:${tag}>([\\s\\S]*?)<\\/a:${tag}>`).exec(scope);
  if (!block) return undefined;
  const inner = block[1];
  const srgb = /<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/.exec(inner);
  if (srgb) return srgb[1].toUpperCase();
  // A theme color left at its system default (e.g. dk1/lt1 = "windowText"/
  // "window") carries no fixed rgb of its own — `lastClr` is the resolved
  // value Excel itself last computed for it, and is what every reader falls
  // back to.
  const sys = /<a:sysClr\b[^>]*\blastClr="([0-9A-Fa-f]{6})"/.exec(inner);
  if (sys) return sys[1].toUpperCase();
  return undefined;
}

/** Parses `xl/theme/theme1.xml`'s `<clrScheme>` into the theme-INDEX order
 *  (see `themeIndexOrder`'s doc), not document order. Scoped to the first
 *  `<a:clrScheme>` block specifically (rather than searching the whole
 *  file) so a workbook that also carries an `<a:extraClrSchemeLst>` — a
 *  legacy/compat leftover with its own nested color tags — can't shadow the
 *  real, active scheme. */
function parseThemeXml(xml: string): (string | undefined)[] {
  const schemeBlock = /<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(xml);
  const scope = schemeBlock ? schemeBlock[1] : xml;
  const dk1 = extractThemeColorHex(scope, "dk1");
  const lt1 = extractThemeColorHex(scope, "lt1");
  const dk2 = extractThemeColorHex(scope, "dk2");
  const lt2 = extractThemeColorHex(scope, "lt2");
  const accents = [1, 2, 3, 4, 5, 6].map((n) => extractThemeColorHex(scope, `accent${n}`));
  const hlink = extractThemeColorHex(scope, "hlink");
  const folHlink = extractThemeColorHex(scope, "folHlink");
  return themeIndexOrder(dk1, lt1, dk2, lt2, accents, hlink, folHlink);
}

interface ColorSpec {
  rgb?: string;
  theme?: number;
  tint?: number;
  indexed?: number;
  auto?: boolean;
}

/** Parses the attributes of a single self-closing color element — `<color
 *  theme="1"/>`, `<fgColor rgb="FFFFFF00"/>`, `<color indexed="64"/>` — its
 *  tag name doesn't matter, only its attributes do. */
function parseColorSpec(tagXml: string | undefined): ColorSpec | undefined {
  if (!tagXml) return undefined;
  const rgbM = /\brgb="([0-9A-Fa-f]{6,8})"/.exec(tagXml);
  if (rgbM) return { rgb: rgbM[1].slice(-6).toUpperCase() }; // drop the leading alpha byte, if any
  const themeM = /\btheme="(\d+)"/.exec(tagXml);
  if (themeM) {
    const tintM = /\btint="(-?[0-9.eE+-]+)"/.exec(tagXml);
    return { theme: Number(themeM[1]), tint: tintM ? Number(tintM[1]) : 0 };
  }
  const idxM = /\bindexed="(\d+)"/.exec(tagXml);
  if (idxM) return { indexed: Number(idxM[1]) };
  if (/\bauto="1"/.test(tagXml)) return { auto: true };
  return undefined;
}

function resolveColor(spec: ColorSpec | undefined, theme: (string | undefined)[]): string | undefined {
  if (!spec || spec.auto) return undefined;
  if (spec.rgb) return `#${spec.rgb}`;
  if (spec.theme !== undefined) {
    const base = theme[spec.theme];
    if (!base) return undefined;
    return `#${applyTint(base, spec.tint ?? 0)}`;
  }
  if (spec.indexed !== undefined) {
    if (spec.indexed === 64 || spec.indexed === 65) return undefined; // "automatic" — not a real palette entry
    const hex = INDEXED_PALETTE[spec.indexed];
    return hex ? `#${hex}` : undefined;
  }
  return undefined;
}

/** Finds one self-closing `<tag .../>` element's own text within `scope` —
 *  every color element (`color`, `fgColor`, `bgColor`) and boolean flag
 *  element (`b`, `i`) this module reads is always self-closing per the
 *  OOXML schema (they carry attributes only, never children). */
function extractSelfClosingTag(scope: string, tag: string): string | undefined {
  return new RegExp(`<${tag}\\b[^>]*\\/>`).exec(scope)?.[0];
}

/** OOXML's boolean-property convention: the element's mere presence means
 *  true UNLESS it carries an explicit `val="0"`/`val="false"` — used for
 *  `<b/>` (bold) and `<i/>` (italic) inside a `<font>`. */
function hasBooleanFlag(scope: string, tag: string): boolean {
  const tagXml = extractSelfClosingTag(scope, tag);
  if (!tagXml) return false;
  const valM = /\bval="(0|1|false|true)"/.exec(tagXml);
  if (!valM) return true;
  return valM[1] === "1" || valM[1] === "true";
}

// ---------------------------------------------------------------------------
// fonts / fills / cellXfs tables
// ---------------------------------------------------------------------------

interface FontInfo {
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

const FONT_RE = /<font\b[^>]*\/>|<font\b[^>]*>[\s\S]*?<\/font>/g;

function parseFonts(stylesXml: string, theme: (string | undefined)[]): FontInfo[] {
  const block = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(stylesXml);
  if (!block) return [];
  const out: FontInfo[] = [];
  for (const m of block[1].matchAll(FONT_RE)) {
    const inner = m[0];
    const colorTag = extractSelfClosingTag(inner, "color");
    out.push({
      bold: hasBooleanFlag(inner, "b"),
      italic: hasBooleanFlag(inner, "i"),
      color: resolveColor(parseColorSpec(colorTag), theme),
    });
  }
  return out;
}

interface FillInfo {
  fill?: string;
}

const FILL_RE = /<fill\b[^>]*\/>|<fill\b[^>]*>[\s\S]*?<\/fill>/g;

function parseFills(stylesXml: string, theme: (string | undefined)[]): FillInfo[] {
  const block = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(stylesXml);
  if (!block) return [];
  const out: FillInfo[] = [];
  for (const m of block[1].matchAll(FILL_RE)) {
    const inner = m[0];
    const patternType = /<patternFill\b[^>]*\bpatternType="([^"]*)"/.exec(inner)?.[1];
    // Only a fully solid pattern reduces to one flat background color — a
    // hatch/gradient pattern (gray125, darkUp, ...) would show fgColor and
    // bgColor interleaved, which a single CSS background-color can't
    // represent; those are left unstyled rather than picked arbitrarily.
    if (patternType !== "solid") {
      out.push({});
      continue;
    }
    const fgTag = extractSelfClosingTag(inner, "fgColor");
    out.push({ fill: resolveColor(parseColorSpec(fgTag), theme) });
  }
  return out;
}

interface XfInfo {
  fontId: number;
  fillId: number;
  borderId: number;
  align?: "left" | "center" | "right";
}

const XF_RE = /<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g;
const ALIGN_VALUES = new Set(["left", "center", "right"]);

function parseCellXfs(stylesXml: string): XfInfo[] {
  const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!block) return [];
  const out: XfInfo[] = [];
  for (const m of block[1].matchAll(XF_RE)) {
    const raw = m[0];
    const fontId = Number(/\bfontId="(\d+)"/.exec(raw)?.[1] ?? "0");
    const fillId = Number(/\bfillId="(\d+)"/.exec(raw)?.[1] ?? "0");
    // Same treatment as fontId/fillId above: read unconditionally, not
    // gated on `applyBorder` — this module doesn't honor apply-flags for
    // any of the three tables (see those fields' own lack of such a check),
    // so borderId stays consistent with that existing choice rather than
    // introducing gating for only one of the three.
    const borderId = Number(/\bborderId="(\d+)"/.exec(raw)?.[1] ?? "0");
    const h = /<alignment\b[^>]*\bhorizontal="([a-zA-Z]+)"/.exec(raw)?.[1];
    out.push({
      fontId,
      fillId,
      borderId,
      align: h && ALIGN_VALUES.has(h) ? (h as XfInfo["align"]) : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// borders table
// ---------------------------------------------------------------------------

interface BorderEdge {
  /** CSS pixel width: 1 for hair/thin/dashed/dotted, 2 for medium(-ish)
   *  variants, 3 for thick/double. */
  width: 1 | 2 | 3;
  style: "solid" | "dashed" | "dotted" | "double";
  /** "#RRGGBB" — never left unresolved: a border edge that exists at all
   *  always renders as SOME visible line, so an unresolvable or absent
   *  `<color>` (Excel's "automatic") falls back to black rather than being
   *  dropped the way a font/fill color's literal black is (see
   *  `buildResolvedStyles`'s doc) — there the black is a no-op sitting on
   *  top of already-black text; here it's the only thing making the line
   *  visible at all. */
  color: string;
}

interface BorderInfo {
  top?: BorderEdge;
  right?: BorderEdge;
  bottom?: BorderEdge;
  left?: BorderEdge;
}

/**
 * Maps an OOXML `<left/right/top/bottom style="...">` value to a CSS
 * width+style pair. Only the styles the brief calls out get their exact
 * specified treatment (hair/thin -> 1px solid, medium -> 2px solid, thick ->
 * 3px solid, dashed/mediumDashed -> dashed, dotted -> dotted, double -> 3px
 * double); Excel's remaining compound line styles (dashDot, dashDotDot,
 * mediumDashDot, mediumDashDotDot, slantDashDot) aren't in that list, so
 * they get the nearest visual approximation (dashed, at the plain or
 * "medium" width per their own name) rather than silently vanishing.
 * `undefined`/`"none"`/anything unrecognized means "no line on this edge".
 */
function mapBorderLineStyle(excelStyle: string | undefined): { width: 1 | 2 | 3; style: BorderEdge["style"] } | undefined {
  switch (excelStyle) {
    case "hair":
    case "thin":
      return { width: 1, style: "solid" };
    case "medium":
      return { width: 2, style: "solid" };
    case "thick":
      return { width: 3, style: "solid" };
    case "dashed":
    case "mediumDashed":
      return { width: 1, style: "dashed" };
    case "dotted":
      return { width: 1, style: "dotted" };
    case "double":
      return { width: 3, style: "double" };
    case "dashDot":
    case "dashDotDot":
    case "slantDashDot":
      return { width: 1, style: "dashed" };
    case "mediumDashDot":
    case "mediumDashDotDot":
      return { width: 2, style: "dashed" };
    default:
      return undefined;
  }
}

/** Finds one `<left>`/`<right>`/`<top>`/`<bottom>` element's full text
 *  (self-closing, or paired with a nested `<color/>` child) within a
 *  `<border>` block's own inner XML. Unlike `extractSelfClosingTag` (used
 *  for `color`/`fgColor`/`b`/`i`, which the OOXML schema always makes
 *  self-closing), these edge elements commonly carry a child, so both
 *  shapes have to be matched. */
function extractEdgeTag(scope: string, tag: string): string | undefined {
  return new RegExp(`<${tag}\\b[^>]*\\/>|<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`).exec(scope)?.[0];
}

function parseBorderEdge(edgeXml: string | undefined, theme: (string | undefined)[]): BorderEdge | undefined {
  if (!edgeXml) return undefined;
  const styleAttr = /\bstyle="([a-zA-Z]+)"/.exec(edgeXml)?.[1];
  const mapped = mapBorderLineStyle(styleAttr);
  if (!mapped) return undefined; // no `style=` at all (self-closing `<left/>`) or "none"/unrecognized
  const colorTag = extractSelfClosingTag(edgeXml, "color");
  const resolved = resolveColor(parseColorSpec(colorTag), theme);
  // No `<color>` child, or one that resolves to nothing (explicit auto="1",
  // or a theme ref with no theme part to resolve against) — Excel's own
  // "automatic" border color, which this module renders as black, the same
  // hex `resolveColor` never actually returns for auto/indexed-64/65 itself.
  return { width: mapped.width, style: mapped.style, color: resolved ?? "#000000" };
}

const BORDER_RE = /<border\b[^>]*\/>|<border\b[^>]*>[\s\S]*?<\/border>/g;

function parseBorders(stylesXml: string, theme: (string | undefined)[]): BorderInfo[] {
  const block = /<borders\b[^>]*>([\s\S]*?)<\/borders>/.exec(stylesXml);
  if (!block) return [];
  const out: BorderInfo[] = [];
  for (const m of block[1].matchAll(BORDER_RE)) {
    const inner = m[0];
    out.push({
      left: parseBorderEdge(extractEdgeTag(inner, "left"), theme),
      right: parseBorderEdge(extractEdgeTag(inner, "right"), theme),
      top: parseBorderEdge(extractEdgeTag(inner, "top"), theme),
      bottom: parseBorderEdge(extractEdgeTag(inner, "bottom"), theme),
    });
  }
  return out;
}

/** `{width}px {style} {color}` — the exact string `React.CSSProperties`'
 *  `borderTop`/etc. accept as-is. */
function cssBorder(edge: BorderEdge): string {
  return `${edge.width}px ${edge.style} ${edge.color}`;
}

/** Combines the three tables into one sparse array indexed by cellXf
 *  position. A font color that resolves to plain black is dropped rather
 *  than stored explicitly: `theme="1"` (dk1, i.e. "the default text color")
 *  is what nearly every unstyled cell's font carries in a real workbook, so
 *  storing it verbatim would both bloat the table with a value that's
 *  visually a no-op AND force a literal `#000000` inline style over the
 *  app's own near-black `--ink` token on the vast majority of cells. */
function buildResolvedStyles(
  xfs: XfInfo[],
  fonts: FontInfo[],
  fills: FillInfo[],
  borders: BorderInfo[],
): (ResolvedStyle | undefined)[] {
  return xfs.map((xf): ResolvedStyle | undefined => {
    const font = fonts[xf.fontId];
    const fillInfo = fills[xf.fillId];
    const border = borders[xf.borderId];
    const style: ResolvedStyle = {};
    if (fillInfo?.fill) style.fill = fillInfo.fill;
    if (font?.bold) style.bold = true;
    if (font?.italic) style.italic = true;
    if (font?.color && font.color !== "#000000") style.color = font.color;
    if (xf.align) style.align = xf.align;
    if (border?.top) style.borderTop = cssBorder(border.top);
    if (border?.right) style.borderRight = cssBorder(border.right);
    if (border?.bottom) style.borderBottom = cssBorder(border.bottom);
    if (border?.left) style.borderLeft = cssBorder(border.left);
    return Object.keys(style).length > 0 ? style : undefined;
  });
}

// ---------------------------------------------------------------------------
// Workbook structure: sheet name -> worksheet part path
// ---------------------------------------------------------------------------

/** Minimal entity decoder for the handful of escapes a sheet name can carry
 *  — deliberately not a full XML-entity table, matching the narrow need
 *  (see lib/plan/output.ts's own `decodeXmlEntities` for the fuller
 *  version this module intentionally does not import, to stay
 *  self-contained rather than reach into lib/plan). */
function decodeXmlEntitiesLite(s: string): string {
  return s
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** `xl/_rels/workbook.xml.rels`' own Relationship Targets are relative to
 *  `xl/` per OPC convention (a leading "/" means package-root-relative
 *  instead) — same resolution lib/plan/output.ts's `resolveZipPath` does
 *  for the same reason, reimplemented locally to keep this module free of
 *  any lib/plan dependency. */
function resolveWorksheetPath(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const stack = ["xl"];
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return stack.join("/");
}

function parseWorkbookSheetPaths(zip: Record<string, Uint8Array>, decoder: TextDecoder): Map<string, string> {
  const out = new Map<string, string>();
  const wbBytes = zip["xl/workbook.xml"];
  if (!wbBytes) return out;
  const wbXml = decoder.decode(wbBytes);
  const relsBytes = zip["xl/_rels/workbook.xml.rels"];
  const relsXml = relsBytes ? decoder.decode(relsBytes) : "";

  const relTargets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]*)"/.exec(m[0])?.[1];
    if (id && target) relTargets.set(id, target);
  }

  const sheetsBlock = /<sheets>([\s\S]*?)<\/sheets>/.exec(wbXml);
  if (!sheetsBlock) return out;
  for (const m of sheetsBlock[1].matchAll(/<sheet\b[^>]*\/>/g)) {
    const tag = m[0];
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    const rId = /\br:id="([^"]*)"/.exec(tag)?.[1];
    if (!name || !rId) continue;
    const target = relTargets.get(rId);
    if (!target) continue;
    out.set(decodeXmlEntitiesLite(name), resolveWorksheetPath(target));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-sheet cell -> style-index scan
// ---------------------------------------------------------------------------

/** Matches a `<c>` element's OPENING tag only (self-closed or paired) — the
 *  `s`/`r` attributes always live there, and `[^>]*` stopping at the first
 *  bare `>` naturally excludes the cell's own inner `<v>`/`<f>` content, so
 *  no separate "find the matching close tag" step is needed the way
 *  lib/plan/output.ts's cell scanner needs one (that module rewrites cell
 *  bodies; this one only ever reads a `<c ...>` tag's own attributes). */
const CELL_OPEN_RE = /<c\b([^>]*)>/g;

function scanWorksheetStyles(
  zip: Record<string, Uint8Array>,
  decoder: TextDecoder,
  sheetNames: string[],
  limits: { maxRows: number; maxCols: number },
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const paths = parseWorkbookSheetPaths(zip, decoder);
  for (const name of sheetNames) {
    const path = paths.get(name);
    const bytes = path ? zip[path] : undefined;
    if (!bytes) continue;
    const xml = decoder.decode(bytes);
    const map = new Map<string, number>();
    for (const m of xml.matchAll(CELL_OPEN_RE)) {
      const attrs = m[1];
      const s = /\bs="(\d+)"/.exec(attrs)?.[1];
      if (s === undefined) continue;
      const ref = /\br="([A-Za-z]+)(\d+)"/.exec(attrs);
      if (!ref) continue;
      const col = colToIndex(ref[1]);
      const row = Number(ref[2]) - 1;
      if (row < 0 || col < 0 || row >= limits.maxRows || col >= limits.maxCols) continue;
      // Matches lib/workbook.ts's own `cellKey(row, col)` format exactly
      // (`${row}:${col}`) without importing it, to avoid a circular import
      // between this module and workbook.ts (which imports this module).
      map.set(`${row}:${col}`, Number(s));
    }
    if (map.size > 0) out.set(name, map);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Resolves a workbook's own formatting from its raw bytes. Returns
 * `undefined` — never throws — for anything that isn't a stylable OOXML
 * zip: a corrupt/truncated file, xlsb (a zip container, but its parts are
 * binary records under different paths — `xl/styles.xml` is simply absent),
 * CSV's synthetic in-memory workbook (not zip bytes at all, so
 * `unzipSync` itself throws), or a workbook that legitimately has no
 * `xl/styles.xml`.
 */
export function parseWorkbookStyles(
  bytes: Uint8Array,
  sheetNames: string[],
  limits: { maxRows: number; maxCols: number },
): WorkbookStyleData | undefined {
  try {
    const zip = unzipSync(bytes) as Record<string, Uint8Array>;
    const stylesBytes = zip["xl/styles.xml"];
    if (!stylesBytes) return undefined;

    const decoder = new TextDecoder("utf-8");
    const stylesXml = decoder.decode(stylesBytes);
    const themeBytes = zip["xl/theme/theme1.xml"];
    // A missing or corrupt theme part just means theme-indexed colors can't
    // resolve (resolveColor returns undefined for them) — rgb/indexed
    // colors are unaffected, so this degrades gracefully rather than
    // failing the whole pass.
    const theme = themeBytes ? parseThemeXml(decoder.decode(themeBytes)) : [];

    const fonts = parseFonts(stylesXml, theme);
    const fills = parseFills(stylesXml, theme);
    const borders = parseBorders(stylesXml, theme);
    const xfs = parseCellXfs(stylesXml);
    const styles = buildResolvedStyles(xfs, fonts, fills, borders);

    // Nothing in the whole workbook would ever render differently from the
    // default — skip the worksheet scan entirely rather than pay for a
    // pass over every sheet's XML for zero visual benefit.
    if (!styles.some((s) => s !== undefined)) {
      return { styles, cellStyles: new Map() };
    }

    const cellStyles = scanWorksheetStyles(zip, decoder, sheetNames, limits);
    return { styles, cellStyles };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("parseWorkbookStyles: could not resolve workbook styles, rendering unstyled", err);
    }
    return undefined;
  }
}
