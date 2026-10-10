import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";
import { injectChart, injectCharts } from "@/lib/charts/inject";
import type { ChartSpec } from "@/lib/charts/spec";
import { xlsxBytes } from "./helpers/workbooks";

/**
 * Covers lib/charts/inject.ts's zip-splicing contract: a brand-new drawing
 * on a sheet that has none, appending into a sheet's existing drawing part
 * (with fresh numbering when charts already exist — some SpreadsheetBench
 * inputs already carry charts), and every original part surviving
 * byte-identical apart from what the injection actually needed to touch.
 * Same "assert untouched parts are byte-identical" discipline as
 * test/plan-output-patch.test.ts uses for lib/plan/output.ts.
 */

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function partSet(bytes: Uint8Array): Set<string> {
  return new Set(Object.keys(unzipSync(bytes)));
}

function decodePart(bytes: Uint8Array, path: string): string {
  const zip = unzipSync(bytes);
  const entry = zip[path];
  if (!entry) throw new Error(`part not found: ${path}`);
  return new TextDecoder().decode(entry);
}

function assertUntouchedPartsByteIdentical(before: Uint8Array, after: Uint8Array, touched: Set<string>): string[] {
  const beforeParts = unzipSync(before);
  const afterParts = unzipSync(after);
  const checked: string[] = [];
  for (const name of Object.keys(beforeParts)) {
    if (touched.has(name)) continue;
    expect(afterParts[name], `expected untouched part ${name} to still exist`).toBeDefined();
    expect(afterParts[name], `expected untouched part ${name} to be byte-identical`).toEqual(beforeParts[name]);
    checked.push(name);
  }
  return checked;
}

function lineSpec(sheet: string, cell = "D1"): ChartSpec {
  return {
    chartType: "line",
    title: "Test Chart",
    sheet,
    anchor: { cell, widthCols: 6, heightRows: 10 },
    series: [{ name: "S1", categories: { values: ["A", "B"] }, values: { values: [1, 2] } }],
  };
}

/**
 * Hand-built (not xlsxBytes()-produced — SheetJS's own writer never emits
 * chart/drawing parts, same rationale as test/plan-output-patch.test.ts's
 * own hand-built fixture) two-sheet fixture: "Sheet1" already has a drawing
 * part carrying one pre-existing chart (chart1.xml / drawing1.xml, with
 * rId1 and shapeId 1 both already taken — exercises "sheet already has a
 * drawing" AND "fresh numbering when charts already exist" together).
 * "Sheet2" has no drawing and no `.rels` file of its own at all — exercises
 * the "brand-new drawing, brand-new sheet rels" path.
 */
function fixtureWithExistingChart(): Uint8Array {
  const parts: Record<string, string> = {
    "[Content_Types].xml":
      XML_DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
      '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      "</Types>",
    "_rels/.rels":
      XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>",
    "docProps/core.xml":
      XML_DECL +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"/>',
    "docProps/app.xml":
      XML_DECL + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>',
    "xl/workbook.xml":
      XML_DECL +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/><sheet name="Sheet2" sheetId="2" r:id="rId2"/></sheets>' +
      "</workbook>",
    "xl/_rels/workbook.xml.rels":
      XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      "</Relationships>",
    "xl/worksheets/sheet1.xml":
      XML_DECL +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>' +
      '<drawing r:id="rId1"/>' +
      "</worksheet>",
    "xl/worksheets/sheet2.xml":
      XML_DECL +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetData><row r="1"><c r="A1"><v>2</v></c></row></sheetData>' +
      "</worksheet>",
    "xl/worksheets/_rels/sheet1.xml.rels":
      XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>' +
      "</Relationships>",
    "xl/drawings/drawing1.xml":
      XML_DECL +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      "<xdr:twoCellAnchor>" +
      "<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>" +
      "<xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>10</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>" +
      '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="1" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
      '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
      '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>' +
      "</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>" +
      "</xdr:wsDr>",
    "xl/drawings/_rels/drawing1.xml.rels":
      XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>' +
      "</Relationships>",
    "xl/charts/chart1.xml":
      XML_DECL +
      '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      "<c:chart><c:autoTitleDeleted val=\"1\"/><c:plotArea><c:layout/><c:pieChart><c:varyColors val=\"1\"/><c:ser><c:idx val=\"0\"/><c:order val=\"0\"/>" +
      '<c:val><c:numLit><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numLit></c:val></c:ser></c:pieChart>' +
      "<c:spPr><a:noFill/></c:spPr></c:plotArea><c:plotVisOnly val=\"1\"/><c:dispBlanksAs val=\"gap\"/></c:chart>" +
      "</c:chartSpace>",
  };

  const zippable: Zippable = {};
  for (const [name, xml] of Object.entries(parts)) zippable[name] = new TextEncoder().encode(xml);
  return zipSync(zippable);
}

// ---------------------------------------------------------------------------
// Brand-new drawing (input has no drawings at all)
// ---------------------------------------------------------------------------

describe("injectCharts: brand-new drawing (input has no drawings at all)", () => {
  const input = xlsxBytes({
    Sheet1: [
      [1, 2],
      [3, 4],
    ],
  });

  it("adds chart1.xml, drawing1.xml, and their rels", () => {
    const out = injectChart(input, lineSpec("Sheet1"));
    const parts = partSet(out);
    expect(parts.has("xl/charts/chart1.xml")).toBe(true);
    expect(parts.has("xl/drawings/drawing1.xml")).toBe(true);
    expect(parts.has("xl/drawings/_rels/drawing1.xml.rels")).toBe(true);
    expect(parts.has("xl/worksheets/_rels/sheet1.xml.rels")).toBe(true);
  });

  it("patches [Content_Types].xml with chart + drawing overrides", () => {
    const out = injectChart(input, lineSpec("Sheet1"));
    const ct = decodePart(out, "[Content_Types].xml");
    expect(ct).toContain('PartName="/xl/charts/chart1.xml"');
    expect(ct).toContain('PartName="/xl/drawings/drawing1.xml"');
  });

  it("wires sheet -> drawing -> chart through valid, matching relationship ids", () => {
    const out = injectChart(input, lineSpec("Sheet1"));

    const sheetXml = decodePart(out, "xl/worksheets/sheet1.xml");
    const drawingRef = /<drawing r:id="([^"]+)"\/>/.exec(sheetXml);
    expect(drawingRef).not.toBeNull();
    const sheetRelsXml = decodePart(out, "xl/worksheets/_rels/sheet1.xml.rels");
    expect(sheetRelsXml).toContain(`Id="${drawingRef![1]}"`);
    expect(sheetRelsXml).toContain('Target="../drawings/drawing1.xml"');

    const drawingXml = decodePart(out, "xl/drawings/drawing1.xml");
    const chartRef = /<c:chart[^>]*r:id="([^"]+)"/.exec(drawingXml);
    expect(chartRef).not.toBeNull();
    const drawingRelsXml = decodePart(out, "xl/drawings/_rels/drawing1.xml.rels");
    expect(drawingRelsXml).toContain(`Id="${chartRef![1]}"`);
    expect(drawingRelsXml).toContain('Target="../charts/chart1.xml"');
  });

  it("carries the spec's title/series structure through into chart1.xml", () => {
    const out = injectChart(input, lineSpec("Sheet1"));
    const chartXml = decodePart(out, "xl/charts/chart1.xml");
    expect(chartXml).toContain("<a:t>Test Chart</a:t>");
    expect(chartXml).toContain("<c:lineChart>");
  });

  it("leaves every original part byte-identical except the patched sheet1.xml and Content_Types", () => {
    const out = injectChart(input, lineSpec("Sheet1"));
    const checked = assertUntouchedPartsByteIdentical(input, out, new Set(["xl/worksheets/sheet1.xml", "[Content_Types].xml"]));
    expect(checked.length).toBeGreaterThan(0);
  });

  it("places multiple charts for the same sheet in ONE new drawing part, each with distinct ids", () => {
    const out = injectCharts(input, [lineSpec("Sheet1", "D1"), lineSpec("Sheet1", "D20")]);
    const parts = partSet(out);
    expect(parts.has("xl/charts/chart1.xml")).toBe(true);
    expect(parts.has("xl/charts/chart2.xml")).toBe(true);
    expect(parts.has("xl/drawings/drawing2.xml")).toBe(false); // both share drawing1

    const drawingXml = decodePart(out, "xl/drawings/drawing1.xml");
    expect((drawingXml.match(/<xdr:twoCellAnchor>/g) ?? []).length).toBe(2);
    const relIds = [...drawingXml.matchAll(/<c:chart[^>]*r:id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(relIds).size).toBe(2);
    const shapeIds = [...drawingXml.matchAll(/<xdr:cNvPr id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(shapeIds).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Existing drawing + existing chart (append, fresh numbering)
// ---------------------------------------------------------------------------

describe("injectCharts: sheet already has a drawing + chart (append, fresh numbering)", () => {
  const input = fixtureWithExistingChart();

  it("appends new anchors into the EXISTING drawing1.xml rather than creating a new one", () => {
    const out = injectCharts(input, [lineSpec("Sheet1", "H1"), lineSpec("Sheet1", "H20")]);
    const parts = partSet(out);
    expect(parts.has("xl/drawings/drawing1.xml")).toBe(true);
    expect(parts.has("xl/drawings/drawing2.xml")).toBe(false);
    const drawingXml = decodePart(out, "xl/drawings/drawing1.xml");
    expect((drawingXml.match(/<xdr:twoCellAnchor>/g) ?? []).length).toBe(3); // 1 original + 2 new
  });

  it("numbers new charts past the existing chart1.xml", () => {
    const out = injectCharts(input, [lineSpec("Sheet1", "H1"), lineSpec("Sheet1", "H20")]);
    const parts = partSet(out);
    expect(parts.has("xl/charts/chart2.xml")).toBe(true);
    expect(parts.has("xl/charts/chart3.xml")).toBe(true);
  });

  it("assigns fresh rIds/shapeIds that do not collide with the pre-existing ones", () => {
    const out = injectCharts(input, [lineSpec("Sheet1", "H1"), lineSpec("Sheet1", "H20")]);
    const drawingXml = decodePart(out, "xl/drawings/drawing1.xml");
    const shapeIds = [...drawingXml.matchAll(/<xdr:cNvPr id="(\d+)"/g)].map((m) => m[1]);
    expect(shapeIds).toEqual(["1", "2", "3"]); // 1 pre-existing + 2 new, in anchor order
    const drawingRelsXml = decodePart(out, "xl/drawings/_rels/drawing1.xml.rels");
    expect((drawingRelsXml.match(/<Relationship /g) ?? []).length).toBe(3); // trailing space excludes the <Relationships> root tag
    const relIds = [...drawingRelsXml.matchAll(/Id="(rId\d+)"/g)].map((m) => m[1]);
    expect(new Set(relIds).size).toBe(3);
  });

  it("leaves the pre-existing anchor and its chart part completely untouched", () => {
    const out = injectCharts(input, [lineSpec("Sheet1", "H1")]);
    const drawingXml = decodePart(out, "xl/drawings/drawing1.xml");
    expect(drawingXml).toContain('<xdr:cNvPr id="1" name="Chart 1"/>');
    expect(drawingXml).toContain('r:id="rId1"');
    expect(decodePart(out, "xl/charts/chart1.xml")).toBe(decodePart(input, "xl/charts/chart1.xml"));
  });

  it("does not touch sheet1.xml or its own rels file at all (the drawing was already wired)", () => {
    const out = injectCharts(input, [lineSpec("Sheet1", "H1")]);
    assertUntouchedPartsByteIdentical(
      input,
      out,
      new Set(["xl/drawings/drawing1.xml", "xl/drawings/_rels/drawing1.xml.rels", "xl/charts/chart2.xml", "[Content_Types].xml"]),
    );
  });

  it("creates a brand-new, freshly-numbered drawing for a DIFFERENT sheet with no drawing of its own", () => {
    const out = injectCharts(input, [lineSpec("Sheet2", "B2")]);
    const parts = partSet(out);
    expect(parts.has("xl/drawings/drawing2.xml")).toBe(true); // continues past the existing drawing1
    expect(parts.has("xl/worksheets/_rels/sheet2.xml.rels")).toBe(true); // sheet2 had none before
    const sheet2Xml = decodePart(out, "xl/worksheets/sheet2.xml");
    expect(sheet2Xml).toMatch(/<drawing r:id="[^"]+"\/>/);
    // Sheet1's own drawing/chart must be entirely untouched by a call that
    // only targets Sheet2.
    expect(decodePart(out, "xl/drawings/drawing1.xml")).toBe(decodePart(input, "xl/drawings/drawing1.xml"));
    expect(decodePart(out, "xl/worksheets/sheet1.xml")).toBe(decodePart(input, "xl/worksheets/sheet1.xml"));
  });
});

// ---------------------------------------------------------------------------
// Misc contract
// ---------------------------------------------------------------------------

describe("injectCharts: misc contract", () => {
  it("returns the exact same bytes (reference equality) for an empty spec list", () => {
    const input = xlsxBytes({ Sheet1: [[1]] });
    expect(injectCharts(input, [])).toBe(input);
  });

  it("throws a clear error for a sheet name that does not exist in the workbook", () => {
    const input = xlsxBytes({ Sheet1: [[1]] });
    expect(() => injectChart(input, lineSpec("NoSuchSheet"))).toThrow(/NoSuchSheet/);
  });

  it("resolves sheet names case-insensitively, matching lib/plan/edits.ts's own tolerance", () => {
    const input = xlsxBytes({ Sheet1: [[1]] });
    const out = injectChart(input, lineSpec("sheet1"));
    expect(partSet(out).has("xl/charts/chart1.xml")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Optional cross-check: python3's own zip/XML parser agrees the output is a
// well-formed zip of well-formed XML parts. openpyxl/Excel are not
// available in this environment (per this task's brief); python3's stdlib
// zipfile + xml.dom.minidom need nothing beyond that.
// ---------------------------------------------------------------------------

describe("injectCharts: python3 zip/XML sanity check", () => {
  it("produces a zip whose chart/drawing parts (and every other .xml/.rels part) parse cleanly", () => {
    const input = xlsxBytes({
      Sheet1: [
        [1, 2],
        [3, 4],
      ],
    });
    const out = injectCharts(input, [lineSpec("Sheet1", "D1"), lineSpec("Sheet1", "D20")]);

    const dir = mkdtempSync(join(tmpdir(), "charts-inject-"));
    const path = join(dir, "out.xlsx");
    try {
      writeFileSync(path, out);
      const script = [
        "import zipfile, xml.dom.minidom as md",
        `z = zipfile.ZipFile(${JSON.stringify(path)})`,
        "names = z.namelist()",
        'assert any(n.startswith("xl/charts/chart") for n in names), "no chart part"',
        'assert any(n.startswith("xl/drawings/drawing") for n in names), "no drawing part"',
        "for n in names:",
        '    if n.endswith(".xml") or n.endswith(".rels"):',
        "        md.parseString(z.read(n))",
        'print("OK")',
      ].join("\n");
      const result = execFileSync("python3", ["-c", script], { encoding: "utf-8" });
      expect(result.trim()).toBe("OK");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
