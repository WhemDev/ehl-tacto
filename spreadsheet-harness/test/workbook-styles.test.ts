/**
 * lib/workbook-styles.ts: resolving a workbook's own fill/bold/italic/color/
 * alignment from its raw OOXML parts.
 *
 * Two kinds of coverage, per the module's own doc:
 *   1. Hand-built synthetic zips (via fflate's `zipSync`, mirroring
 *      lib/plan/output.ts's own zip-level approach) exercise each resolution
 *      rule in isolation with known, hand-computed expected values — theme
 *      index reordering, tint math, the indexed palette, "automatic" colors,
 *      non-solid fills, and the worksheet `<c s="...">` scan (including a
 *      cell missing `s` entirely, and one outside the parse window).
 *   2. The real Excaliba.xlsx fixture (repo root; same fixture
 *      test/formula-simulate-determinism.test.ts reads) pins a handful of
 *      cells this module was probed against by hand first (see
 *      .superpowers/sdd/reports/grid-formatting.md) — what is TRUE about
 *      that file's own formatting, not what would be convenient.
 */

import { zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { parseWorkbook, type ParsedWorkbook } from "@/lib/workbook";
import { parseWorkbookStyles } from "@/lib/workbook-styles";
import { HAVE_EXCALIBA, readExcaliba } from "./helpers/excaliba";
import { xlsxBytes } from "./helpers/workbooks";

function buildZip(parts: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const zip: Record<string, Uint8Array> = {};
  for (const [path, xml] of Object.entries(parts)) zip[path] = encoder.encode(xml);
  return zipSync(zip);
}

const WORKBOOK_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const WORKBOOK_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
  `Target="worksheets/sheet1.xml"/></Relationships>`;

/** dk1=black, lt1=white, dk2/lt2 as a real theme would carry them, accent1 a
 *  plain red (used for the tint triple below), the rest Office defaults. */
const THEME_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
  `<a:themeElements><a:clrScheme name="Office">` +
  `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
  `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="1F497D"/></a:dk2>` +
  `<a:lt2><a:srgbClr val="EEECE1"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="FF0000"/></a:accent1>` +
  `<a:accent2><a:srgbClr val="C0504D"/></a:accent2>` +
  `<a:accent3><a:srgbClr val="9BBB59"/></a:accent3>` +
  `<a:accent4><a:srgbClr val="8064A2"/></a:accent4>` +
  `<a:accent5><a:srgbClr val="4BACC6"/></a:accent5>` +
  `<a:accent6><a:srgbClr val="F79646"/></a:accent6>` +
  `<a:hlink><a:srgbClr val="0000FF"/></a:hlink>` +
  `<a:folHlink><a:srgbClr val="800080"/></a:folHlink>` +
  `</a:clrScheme></a:themeElements></a:theme>`;

/**
 * fonts[0] default (color theme=1, i.e. plain black — used to prove a
 *   literal-black font color is dropped rather than stored);
 * fonts[1] bold, no color;
 * fonts[2] italic + rgb green;
 * fonts[3] indexed=5 (the classic palette's yellow);
 * fonts[4] theme=4 (accent1, in theme-INDEX order — see the module's own
 *   `themeIndexOrder` doc) tint=0.4, a lighten triple;
 * fonts[5] indexed=64 — the reserved "automatic" slot, not a real color.
 *
 * fills[0] none; fills[1] gray125 (a non-solid pattern, no flat color);
 * fills[2] solid rgb; fills[3] solid theme=2 (lt2) tint=-0.5, a darken
 *   triple; fills[4] solid with fgColor auto="1" (no color); fills[5] solid
 *   indexed=5 (yellow again, via the fill side this time); fills[6]
 *   gray125 that ALSO carries an fgColor — proves a non-solid pattern's
 *   fgColor is ignored, not picked up as if it were a flat fill.
 *
 * cellXfs[0..11] each isolate one thing: 0 is the fully-default xf (used
 * both directly and as the "explicit black text" case via fonts[0]'s own
 * theme=1 color), 1 bold-only, 2 fill-rgb-only, 3 italic+color, 4
 * indexed-font-color, 5 theme+tint font color, 6 theme+tint fill, 7
 * alignment-only (the one paired, non-self-closing `<xf>` — every other
 * `<xf>` here is self-closing, so this also exercises both cellXfs shapes),
 * 8 indexed-auto font color (nothing stored), 9 bold + auto fill (only bold
 * shows), 10 non-solid-fill-with-fgColor (nothing stored), 11 indexed fill.
 */
const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="6">` +
  `<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
  `<font><i/><sz val="11"/><color rgb="FF00FF00"/><name val="Calibri"/></font>` +
  `<font><sz val="11"/><color indexed="5"/><name val="Calibri"/></font>` +
  `<font><sz val="11"/><color theme="4" tint="0.4"/><name val="Calibri"/></font>` +
  `<font><sz val="11"/><color indexed="64"/><name val="Calibri"/></font>` +
  `</fonts>` +
  `<fills count="7">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF336699"/><bgColor indexed="64"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor theme="2" tint="-0.5"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor auto="1"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor indexed="5"/></patternFill></fill>` +
  `<fill><patternFill patternType="gray125"><fgColor rgb="FFFF0000"/></patternFill></fill>` +
  `</fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="12">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>` +
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>` +
  `<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="6" borderId="0" xfId="0" applyFill="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>` +
  `</cellXfs></styleSheet>`;

/** One cell per cellXf, columns A..L (xf index == column index), row 1, plus
 *  an M1 with NO `s=` attribute at all (the "missing s" case). */
const WORKSHEET_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<sheetData><row r="1">` +
  Array.from({ length: 12 }, (_, i) => `<c r="${String.fromCharCode(65 + i)}1" s="${i}"><v>${i}</v></c>`).join("") +
  `<c r="M1"><v>99</v></c>` +
  `</row></sheetData></worksheet>`;

function richStylesZip(): Uint8Array {
  return buildZip({
    "xl/workbook.xml": WORKBOOK_XML,
    "xl/_rels/workbook.xml.rels": WORKBOOK_RELS,
    "xl/theme/theme1.xml": THEME_XML,
    "xl/styles.xml": STYLES_XML,
    "xl/worksheets/sheet1.xml": WORKSHEET_XML,
  });
}

describe("parseWorkbookStyles: cellXfs chain + color resolution", () => {
  const data = parseWorkbookStyles(richStylesZip(), ["Sheet1"], { maxRows: 50, maxCols: 50 });

  it("resolves without throwing and finds the one sheet", () => {
    expect(data).toBeDefined();
    expect(data!.cellStyles.has("Sheet1")).toBe(true);
  });

  it("drops a fully-default xf to undefined, including one whose font explicitly carries theme=1 (plain black)", () => {
    // cellXfs[0]: fontId 0 (color theme="1" -> black), fillId 0 (none).
    // A literal black font color is a no-op visually and is dropped by
    // design (see buildResolvedStyles's doc) — the resolved entry is
    // undefined, not `{}`.
    expect(data!.styles[0]).toBeUndefined();
  });

  it("bold-only xf", () => {
    expect(data!.styles[1]).toEqual({ bold: true });
  });

  it("solid rgb fill", () => {
    expect(data!.styles[2]).toEqual({ fill: "#336699" });
  });

  it("italic + rgb font color", () => {
    expect(data!.styles[3]).toEqual({ italic: true, color: "#00FF00" });
  });

  it("indexed font color (classic palette index 5 = yellow)", () => {
    expect(data!.styles[4]).toEqual({ color: "#FFFF00" });
  });

  it("theme + positive tint (lighten): accent1 FF0000 @ tint 0.4 -> FF6666", () => {
    // Hand-computed per the module's documented formula (tint>0: c + (255-c)*tint):
    // R: 255 + (255-255)*0.4 = 255; G/B: 0 + (255-0)*0.4 = 102 = 0x66.
    expect(data!.styles[5]).toEqual({ color: "#FF6666" });
  });

  it("theme + negative tint (darken): lt2 EEECE1 @ tint -0.5 -> 777671", () => {
    // Hand-computed per the module's documented formula (tint<0: c*(1+tint)):
    // 0xEE=238*0.5=119=0x77; 0xEC=236*0.5=118=0x76; 0xE1=225*0.5=112.5 -> round 113=0x71.
    expect(data!.styles[6]).toEqual({ fill: "#777671" });
  });

  it("alignment-only xf (the one paired, non-self-closing <xf> in the fixture)", () => {
    expect(data!.styles[7]).toEqual({ align: "center" });
  });

  it("indexed=64 (automatic) resolves to no color at all", () => {
    expect(data!.styles[8]).toBeUndefined();
  });

  it("a solid fill with fgColor auto=\"1\" contributes no fill, but a real bold on the same xf still shows", () => {
    expect(data!.styles[9]).toEqual({ bold: true });
  });

  it("a non-solid pattern's fgColor is ignored even when present", () => {
    expect(data!.styles[10]).toBeUndefined();
  });

  it("indexed fill color (classic palette index 5 = yellow, via fgColor this time)", () => {
    expect(data!.styles[11]).toEqual({ fill: "#FFFF00" });
  });
});

describe("parseWorkbookStyles: worksheet <c s=\"...\"> scanning", () => {
  const data = parseWorkbookStyles(richStylesZip(), ["Sheet1"], { maxRows: 50, maxCols: 50 });
  const cellStyles = data!.cellStyles.get("Sheet1")!;

  it("records every cell that carries an explicit s= attribute", () => {
    // A1..L1 (0-based col 0..11), row 0.
    for (let col = 0; col < 12; col++) {
      expect(cellStyles.get(`0:${col}`)).toBe(col);
    }
  });

  it("skips a cell with no s= attribute at all, rather than defaulting it to 0", () => {
    // M1 = row 0, col 12 — present in the worksheet XML but carries no `s`.
    expect(cellStyles.has("0:12")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Borders: user-authored cell borders, as distinct from the grid's own
// default hairlines (a pure UI affordance ExcelGrid draws unconditionally —
// see components/grid/ExcelGrid.tsx — never read from the file at all).
// ---------------------------------------------------------------------------

/**
 * borders[0] the fully-default "no line on any edge" border (used both
 *   directly and to prove borderId=0 contributes nothing);
 * borders[1] bottom hair, no color child at all (the "absent color" case —
 *   must default to literal black, Excel's own "automatic");
 * borders[2] top thin, explicit rgb blue;
 * borders[3] left medium, indexed=5 (classic palette yellow);
 * borders[4] right thick, theme=4 (accent1, theme-INDEX order) tint=0.4 —
 *   the same hand-computed FF0000@0.4->FF6666 triple the font-color tests
 *   above already prove, reused here to confirm border color resolution
 *   goes through the identical `resolveColor` path;
 * borders[5] bottom dashed, no color child (absent -> black again, this
 *   time on a non-solid line style);
 * borders[6] top mediumDashed, color EXPLICITLY auto="1" (distinct from
 *   "no color child at all" — both must land on the same black fallback);
 * borders[7] left dotted, no color;
 * borders[8] bottom double, explicit rgb;
 * borders[9] all four edges thin, no color — a real "box" shape, all four
 *   edges resolving independently on the same border entry;
 * borders[10] left style="none" (an explicit no-op, not merely absent —
 *   must resolve to no line, same as borders[0]'s left), right="dashDot"
 *   and top="mediumDashDot" (compound styles the brief doesn't name
 *   explicitly; both fall back to the "dashed" CSS style, at 1px/2px per
 *   their own "medium" prefix), bottom absent entirely.
 */
const BORDER_STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
  `<borders count="11">` +
  `<border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left/><right/><top/><bottom style="hair"/><diagonal/></border>` +
  `<border><left/><right/><top style="thin"><color rgb="FF0000FF"/></top><bottom/><diagonal/></border>` +
  `<border><left style="medium"><color indexed="5"/></left><right/><top/><bottom/><diagonal/></border>` +
  `<border><left/><right style="thick"><color theme="4" tint="0.4"/></right><top/><bottom/><diagonal/></border>` +
  `<border><left/><right/><top/><bottom style="dashed"/><diagonal/></border>` +
  `<border><left/><right/><top style="mediumDashed"><color auto="1"/></top><bottom/><diagonal/></border>` +
  `<border><left style="dotted"/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left/><right/><top/><bottom style="double"><color rgb="FF336699"/></bottom><diagonal/></border>` +
  `<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>` +
  `<border><left style="none"/><right style="dashDot"/><top style="mediumDashDot"/><bottom/><diagonal/></border>` +
  `</borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="12">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="4" xfId="0" applyBorder="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="5" xfId="0" applyBorder="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="6" xfId="0" applyBorder="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="7" xfId="0" applyBorder="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="8" xfId="0" applyBorder="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="9" xfId="0" applyBorder="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="10" xfId="0" applyBorder="1"/>` +
  // Same borderId as cellXfs[1] (hair-bottom), but with NO applyBorder
  // attribute at all — proves borderId is read unconditionally, the same
  // way fontId/fillId already are (see parseCellXfs's own doc), rather than
  // gated on the apply-flag.
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>` +
  `</cellXfs></styleSheet>`;

/** One cell per cellXf, columns A..L (xf index == column index), row 1. */
const BORDER_WORKSHEET_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<sheetData><row r="1">` +
  Array.from({ length: 12 }, (_, i) => `<c r="${String.fromCharCode(65 + i)}1" s="${i}"><v>${i}</v></c>`).join("") +
  `</row></sheetData></worksheet>`;

function borderStylesZip(): Uint8Array {
  return buildZip({
    "xl/workbook.xml": WORKBOOK_XML,
    "xl/_rels/workbook.xml.rels": WORKBOOK_RELS,
    "xl/theme/theme1.xml": THEME_XML,
    "xl/styles.xml": BORDER_STYLES_XML,
    "xl/worksheets/sheet1.xml": BORDER_WORKSHEET_XML,
  });
}

describe("parseWorkbookStyles: <borders> section + CSS mapping", () => {
  const data = parseWorkbookStyles(borderStylesZip(), ["Sheet1"], { maxRows: 50, maxCols: 50 });

  it("borderId=0 (fully default) contributes nothing", () => {
    expect(data!.styles[0]).toBeUndefined();
  });

  it("hair, no <color> child at all -> 1px solid, default black", () => {
    expect(data!.styles[1]).toEqual({ borderBottom: "1px solid #000000" });
  });

  it("thin, explicit rgb color", () => {
    expect(data!.styles[2]).toEqual({ borderTop: "1px solid #0000FF" });
  });

  it("medium + indexed color (classic palette index 5 = yellow) -> 2px solid", () => {
    expect(data!.styles[3]).toEqual({ borderLeft: "2px solid #FFFF00" });
  });

  it("thick + theme/tint color -> 3px solid (same resolveColor path as fonts/fills)", () => {
    expect(data!.styles[4]).toEqual({ borderRight: "3px solid #FF6666" });
  });

  it("dashed, no color child -> dashed, default black", () => {
    expect(data!.styles[5]).toEqual({ borderBottom: "1px dashed #000000" });
  });

  it("mediumDashed + explicit auto=\"1\" color -> dashed, default black (same fallback as absent color)", () => {
    expect(data!.styles[6]).toEqual({ borderTop: "1px dashed #000000" });
  });

  it("dotted, no color -> dotted, default black", () => {
    expect(data!.styles[7]).toEqual({ borderLeft: "1px dotted #000000" });
  });

  it("double + explicit rgb -> 3px double", () => {
    expect(data!.styles[8]).toEqual({ borderBottom: "3px double #336699" });
  });

  it("all four edges thin, no color -> a real box, every edge independently resolved", () => {
    expect(data!.styles[9]).toEqual({
      borderTop: "1px solid #000000",
      borderRight: "1px solid #000000",
      borderBottom: "1px solid #000000",
      borderLeft: "1px solid #000000",
    });
  });

  it('style="none" resolves to no line; unlisted compound styles (dashDot, mediumDashDot) fall back to dashed at their own width', () => {
    expect(data!.styles[10]).toEqual({
      borderRight: "1px dashed #000000", // dashDot -> dashed, plain width
      borderTop: "2px dashed #000000", // mediumDashDot -> dashed, "medium" width
    });
  });

  it("borderId is threaded through cellXfs unconditionally, same as fontId/fillId — an xf with the SAME borderId but no applyBorder attribute at all resolves identically", () => {
    expect(data!.styles[11]).toEqual(data!.styles[1]);
  });
});

describe("parseWorkbookStyles: parse-window bounds", () => {
  function boundsZip(): Uint8Array {
    const styles =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="2"><font><sz val="11"/></font><font><b/><sz val="11"/></font></fonts>` +
      `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="2">` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
      `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
      `</cellXfs></styleSheet>`;
    const worksheet =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData>` +
      `<row r="1"><c r="A1" s="1"><v>1</v></c></row>` +
      // Row 9999, column A — the same style, but far outside a small
      // maxRows/maxCols window.
      `<row r="9999"><c r="A9999" s="1"><v>2</v></c></row>` +
      `</sheetData></worksheet>`;
    return buildZip({
      "xl/workbook.xml": WORKBOOK_XML,
      "xl/_rels/workbook.xml.rels": WORKBOOK_RELS,
      "xl/styles.xml": styles,
      "xl/worksheets/sheet1.xml": worksheet,
    });
  }

  it("keeps a cell inside the window and drops one outside it", () => {
    const data = parseWorkbookStyles(boundsZip(), ["Sheet1"], { maxRows: 10, maxCols: 10 });
    const cellStyles = data!.cellStyles.get("Sheet1")!;
    expect(cellStyles.get("0:0")).toBe(1); // A1
    expect(cellStyles.has("9998:0")).toBe(false); // A9999, way past maxRows
  });
});

describe("parseWorkbookStyles: failure honesty", () => {
  it("returns undefined for bytes that are not a zip at all (e.g. CSV text)", () => {
    const bytes = new TextEncoder().encode("a,b,c\n1,2,3\n");
    expect(parseWorkbookStyles(bytes, ["Sheet1"], { maxRows: 100, maxCols: 100 })).toBeUndefined();
  });

  it("returns undefined for a zip with no xl/styles.xml at all", () => {
    const bytes = buildZip({ "xl/workbook.xml": WORKBOOK_XML });
    expect(parseWorkbookStyles(bytes, ["Sheet1"], { maxRows: 100, maxCols: 100 })).toBeUndefined();
  });

  it("degrades to no color rather than throwing when the theme part is missing", () => {
    // Same styles.xml as the rich fixture (font 5 uses theme=4), but no
    // xl/theme/theme1.xml at all — every theme-indexed color must resolve to
    // undefined instead of crashing.
    const bytes = buildZip({
      "xl/workbook.xml": WORKBOOK_XML,
      "xl/_rels/workbook.xml.rels": WORKBOOK_RELS,
      "xl/styles.xml": STYLES_XML,
      "xl/worksheets/sheet1.xml": WORKSHEET_XML,
    });
    const data = parseWorkbookStyles(bytes, ["Sheet1"], { maxRows: 50, maxCols: 50 });
    expect(data).toBeDefined();
    expect(data!.styles[5]).toBeUndefined(); // theme-color-only xf, no theme part to resolve it
    expect(data!.styles[2]).toEqual({ fill: "#336699" }); // an rgb color is unaffected
  });
});

describe("parseWorkbook integration: a plain uploaded workbook with no explicit formatting", () => {
  it("carries a real (SheetJS-written) styles.xml but resolves to zero non-default styles, and never crashes", () => {
    const wb = parseWorkbook(xlsxBytes({ Sheet1: [[1, 2, 3]] }), "plain.xlsx");
    const sheet = wb.sheets[0];
    // SheetJS's own writer always emits a valid (minimal) styles.xml, so
    // this exercises the "real styles.xml, nothing styled" path specifically
    // — distinct from the "no styles.xml at all" case covered above.
    if (sheet.styles) {
      expect(sheet.styles.every((s) => s === undefined)).toBe(true);
    }
    const a1 = sheet.cells.get("0:0");
    expect(a1?.styleIdx === undefined || sheet.styles?.[a1.styleIdx] === undefined).toBe(true);
  });
});

describe("parseWorkbook integration: CSV has no styles and never crashes", () => {
  it("parses cell values normally with sheet.styles left entirely absent", () => {
    const bytes = new TextEncoder().encode("a,b,c\n1,2,3\n");
    const wb = parseWorkbook(bytes, "plain.csv");
    expect(wb.sheets[0].cells.get("0:0")?.text).toBe("a");
    expect(wb.sheets[0].styles).toBeUndefined();
  });
});

describe.skipIf(!HAVE_EXCALIBA)("parseWorkbook integration: Excaliba.xlsx (real fixture)", () => {
  let wb: ParsedWorkbook;
  let sheet: ParsedWorkbook["sheets"][number];

  beforeAll(() => {
    wb = parseWorkbook(readExcaliba(), "Excaliba.xlsx");
    sheet = wb.sheets[0];
  });

  function styleAt(ref: string) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    let col = 0;
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    col -= 1;
    const row = Number(m[2]) - 1;
    const cell = sheet.cells.get(`${row}:${col}`);
    return cell?.styleIdx !== undefined ? sheet.styles?.[cell.styleIdx] : undefined;
  }

  it("resolves the month-axis header row (B4) to a solid white fill, bold, right-aligned, boxed on 3 sides", () => {
    // Probed by hand first (see .superpowers/sdd/reports/grid-formatting.md):
    // B4's cellXf is numFmtId=164 fontId=3(bold Arial10) fillId=2(solid,
    // fgColor theme=0 -> lt1 -> white) with an explicit right alignment.
    // Its borderId (2) carries left/right/top thin, indexed=64 ("automatic")
    // color, and NO bottom — the top edge of the box this header row draws
    // around the month columns, left open on the bottom where the box
    // continues into the row below (B5 etc., left+right only — see below).
    expect(sheet.cells.get("3:1")?.text).toBe("Jun-25"); // B4, 0-based row 3 col 1
    expect(styleAt("B4")).toEqual({
      fill: "#FFFFFF",
      bold: true,
      align: "right",
      borderTop: "1px solid #000000",
      borderRight: "1px solid #000000",
      borderLeft: "1px solid #000000",
    });
  });

  it("resolves the block-header row (A2) to bold, no fill", () => {
    expect(sheet.cells.get("1:0")?.text).toContain("Excaliba");
    expect(styleAt("A2")).toEqual({ bold: true });
  });

  it("resolves the row directly under the boxed header (B5) to left+right only — the box's sides continuing, no top/bottom", () => {
    expect(styleAt("B5")).toEqual({
      fill: "#FFFFFF",
      borderRight: "1px solid #000000",
      borderLeft: "1px solid #000000",
    });
  });

  it("resolves a real yellow-highlighted cell (B48), boxed on 3 sides (bottom of its own section, no top)", () => {
    expect(styleAt("B48")).toEqual({
      fill: "#FFFF00",
      borderRight: "1px solid #000000",
      borderBottom: "1px solid #000000",
      borderLeft: "1px solid #000000",
    });
  });

  it("resolves a real unfilled cell boxed on 3 sides with no fill at all (B7 — bottom of a section, left+right+bottom, no top)", () => {
    expect(styleAt("B7")).toEqual({
      borderRight: "1px solid #000000",
      borderBottom: "1px solid #000000",
      borderLeft: "1px solid #000000",
    });
  });

  it("leaves an unstyled cell's styleIdx pointing at nothing (or undefined outright)", () => {
    // Any cell whose xf is the workbook's own bare default resolves the
    // same way the synthetic fixture's xf0 does above.
    const withDefaultXf = [...sheet.cells.values()].find(
      (c) => c.styleIdx !== undefined && sheet.styles?.[c.styleIdx] === undefined,
    );
    expect(withDefaultXf).toBeDefined();
  });
});
