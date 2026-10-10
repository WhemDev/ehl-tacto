import { unzipSync, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";
import { colToIndex } from "@/lib/a1";
import { applyEditPlan, type CellEditPlan } from "@/lib/plan/edits";
import { buildOutputXlsx } from "@/lib/plan/output";
import { cellKey, parseWorkbook, type ParsedWorkbook } from "@/lib/workbook";
import { HAVE_EXCALIBA, readExcaliba } from "./helpers/excaliba";
import { xlsxBytes } from "./helpers/workbooks";

/**
 * Covers the zip-level rewrite of buildOutputXlsx (lib/plan/output.ts): a
 * patch touching only the specific `<c>` elements an edit or a cached-value
 * refresh changes, everything else carried over byte-identical, rather than
 * a full XLSX.read/XLSX.write round-trip through SheetJS's object model
 * (which was dropping whole parts — see that module's header doc).
 */

// ---------------------------------------------------------------------------
// A minimal, well-formedness checker — no new dependency beyond fflate
// (fast-xml-parser is not present in this repo; see the task brief this
// test was written against). Good enough to catch a mismatched/unclosed
// tag or a stray unescaped "&", which is exactly the class of mistake a
// hand-written XML patcher can make.
// ---------------------------------------------------------------------------

function assertWellFormedXml(xml: string, label: string): void {
  const stripped = xml
    .replace(/<\?xml[\s\S]*?\?>/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "CDATA");

  const tagRe = /<(\/?)([A-Za-z_][\w.:-]*)\b[^>]*?(\/?)>/g;
  const stack: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(stripped))) {
    const [, isCloseSlash, name, selfCloseSlash] = m;
    if (isCloseSlash === "/") {
      const top = stack.pop();
      if (top !== name) throw new Error(`${label}: mismatched close tag </${name}> (expected </${top}>)`);
    } else if (selfCloseSlash !== "/") {
      stack.push(name);
    }
  }
  if (stack.length) throw new Error(`${label}: unclosed tag(s): ${stack.join(", ")}`);

  const textOnly = stripped.replace(/<[^>]*>/g, "");
  const bareAmp = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);)/.exec(textOnly);
  if (bareAmp) throw new Error(`${label}: unescaped '&' found in text content near index ${bareAmp.index}`);
}

// ---------------------------------------------------------------------------
// Zip-diff helpers
// ---------------------------------------------------------------------------

function partSet(bytes: Uint8Array): Set<string> {
  return new Set(Object.keys(unzipSync(bytes)));
}

/** Every part in `before` that's still present in `after` must be
 *  byte-identical CONTENT — re-deflation is fine, the decompressed bytes
 *  must match exactly. Returns the names actually compared, so a caller can
 *  assert the expected untouched set was non-trivial. */
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

function decodePart(bytes: Uint8Array, path: string): string {
  const zip = unzipSync(bytes);
  const entry = zip[path];
  if (!entry) throw new Error(`part not found: ${path}`);
  return new TextDecoder().decode(entry);
}

// ---------------------------------------------------------------------------
// Hand-built fixture: real sharedStrings.xml + calcChain.xml + a formula, so
// the "shared-string cell replaced by an inline value" and "calcChain
// deleted iff the calc graph changed" behavior actually has something to
// bite on. xlsxBytes() (SheetJS's own writer) never produces either part
// (see lib/plan/output.ts's header doc on why relying on SheetJS's writer
// for a test fixture would defeat the point), so this is assembled by hand
// from the same shapes verified against a real Excel-saved file.
// ---------------------------------------------------------------------------

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function fixtureXlsx(): Uint8Array {
  const parts: Record<string, string> = {
    "[Content_Types].xml":
      XML_DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>' +
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
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
      "</workbook>",
    "xl/_rels/workbook.xml.rels":
      XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/>' +
      "</Relationships>",
    "xl/styles.xml":
      XML_DECL +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      "</cellXfs>" +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      "</styleSheet>",
    "xl/sharedStrings.xml":
      XML_DECL +
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>Hello</t></si></sst>',
    "xl/calcChain.xml":
      XML_DECL +
      '<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="A2" i="1"/></calcChain>',
    // A1: shared-string "Hello" (t="s", style 1) — patched to a number in
    //     the type-change test.
    // B1: plain number 10 (style 0) — patched to 99 in the value-patch
    //     test, which also drives A2's SUM refresh.
    // A2: =SUM(B1:B1), cached 10 (style 1) — formula cached-value refresh.
    // D2: plain number 5 (style 0) — left untouched; row 2's "far" cell so
    //     inserting C2 between A2 and D2 is a genuine mid-row insertion.
    // Row 3 does not exist at all — a plan cell there is a new-row insertion.
    "xl/worksheets/sheet1.xml":
      XML_DECL +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<dimension ref="A1:D2"/>' +
      "<sheetData>" +
      '<row r="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="0"><v>10</v></c></row>' +
      '<row r="2"><c r="A2" s="1"><f>SUM(B1:B1)</f><v>10</v></c><c r="D2" s="0"><v>5</v></c></row>' +
      "</sheetData>" +
      "</worksheet>",
  };

  const zippable: Zippable = {};
  for (const [name, xml] of Object.entries(parts)) zippable[name] = new TextEncoder().encode(xml);
  return zipSync(zippable);
}

function fixtureWorkbook(): { bytes: Uint8Array; workbook: ParsedWorkbook } {
  const bytes = fixtureXlsx();
  return { bytes, workbook: parseWorkbook(bytes, "fixture.xlsx") };
}

function plan(edits: CellEditPlan["edits"], newSheets: string[] = []): CellEditPlan {
  return { edits, newSheets, notes: "test" };
}

function valueAt(wb: ParsedWorkbook, sheet: string, ref: string): unknown {
  const s = wb.sheets.find((x) => x.name === sheet);
  if (!s) return undefined;
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref)!;
  return s.cells.get(cellKey(Number(m[2]) - 1, colToIndex(m[1])))?.value ?? null;
}

// ---------------------------------------------------------------------------
// Empty plan: byte-identical passthrough (pin)
// ---------------------------------------------------------------------------

describe("buildOutputXlsx: empty plan", () => {
  it("returns the exact same bytes (identity), not just equal content", async () => {
    const { bytes, workbook } = fixtureWorkbook();
    const applied = await applyEditPlan(workbook, plan([]));
    const out = buildOutputXlsx(bytes, applied);
    expect(out).toBe(bytes); // reference equality, not just byte equality
  });
});

// ---------------------------------------------------------------------------
// Fixture-workbook cases: value patch, type change, new cell mid-row, new
// row, formula refresh — all in one plan, since they interact realistically
// (B1's value patch is what drives A2's refresh).
// ---------------------------------------------------------------------------

describe("buildOutputXlsx: fixture workbook, values-only plan", () => {
  async function run() {
    const { bytes, workbook } = fixtureWorkbook();
    const applied = await applyEditPlan(
      workbook,
      plan([
        { sheet: "Sheet1", range: "A1", value: 42 }, // shared-string -> number
        { sheet: "Sheet1", range: "B1", value: 99 }, // plain value patch; feeds A2's SUM
        { sheet: "Sheet1", range: "C2", value: "mid-row" }, // new cell, existing row, between A2 and D2
        { sheet: "Sheet1", range: "A3", value: "new row" }, // brand-new row
      ]),
    );
    const out = buildOutputXlsx(bytes, applied);
    return { bytes, out, applied };
  }

  it("re-parses with every cell showing the correct result", async () => {
    const { out } = await run();
    const reparsed = parseWorkbook(out, "fixture.xlsx");
    expect(valueAt(reparsed, "Sheet1", "A1")).toBe(42);
    expect(valueAt(reparsed, "Sheet1", "B1")).toBe(99);
    expect(valueAt(reparsed, "Sheet1", "C2")).toBe("mid-row");
    expect(valueAt(reparsed, "Sheet1", "A3")).toBe("new row");
    // The refresh: SUM(B1:B1) must track B1's new value, 99, not the stale
    // cached 10 the input file carried.
    expect(valueAt(reparsed, "Sheet1", "A2")).toBe(99);
    const a2 = reparsed.sheets[0].cells.get(cellKey(1, 0));
    expect(a2?.formula).toBe("SUM(B1:B1)"); // formula text itself is untouched by a refresh
    // D2 was never part of the plan or the refresh closure — must survive.
    expect(valueAt(reparsed, "Sheet1", "D2")).toBe(5);
  });

  it("writes the shared-string cell as inlineStr, not a grown sharedStrings table", async () => {
    const { out } = await run();
    const sheetXml = decodePart(out, "xl/worksheets/sheet1.xml");
    expect(sheetXml).toContain('<c r="A1" s="1"><v>42</v></c>'); // numeric now: no t=, style s="1" preserved
    expect(sheetXml).not.toMatch(/<c r="A1"[^>]*t="s"/);
    // sharedStrings.xml itself is untouched — no index was added or reused.
    const before = fixtureXlsx();
    assertUntouchedPartsByteIdentical(before, out, new Set(["xl/worksheets/sheet1.xml"]));
  });

  it("new cell (C2) lands between A2 and D2 in ascending column order", async () => {
    const { out } = await run();
    const sheetXml = decodePart(out, "xl/worksheets/sheet1.xml");
    const row2 = /<row r="2">(.*?)<\/row>/.exec(sheetXml)![1];
    const order = [...row2.matchAll(/<c r="([A-Z]\d+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["A2", "C2", "D2"]);
  });

  it("new row (row 3) is inserted after row 2 in the sheetData", async () => {
    const { out } = await run();
    const sheetXml = decodePart(out, "xl/worksheets/sheet1.xml");
    const rowOrder = [...sheetXml.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]));
    expect(rowOrder).toEqual([1, 2, 3]);
  });

  it("leaves every other part byte-identical, including calcChain.xml (values only)", async () => {
    const { bytes, out } = await run();
    const checked = assertUntouchedPartsByteIdentical(bytes, out, new Set(["xl/worksheets/sheet1.xml"]));
    expect(checked).toContain("xl/calcChain.xml");
    expect(checked).toContain("xl/sharedStrings.xml");
    expect(checked).toContain("xl/styles.xml");
    expect(checked.length).toBeGreaterThan(3);
    expect(partSet(out)).toEqual(partSet(bytes)); // no part added or removed
  });

  it("produces well-formed patched worksheet XML", async () => {
    const { out } = await run();
    assertWellFormedXml(decodePart(out, "xl/worksheets/sheet1.xml"), "patched sheet1.xml (values-only plan)");
  });
});

// ---------------------------------------------------------------------------
// calcChain policy
// ---------------------------------------------------------------------------

describe("buildOutputXlsx: calcChain policy", () => {
  it("is retained, byte-identical, when only values changed (no formula touched)", async () => {
    const { bytes, workbook } = fixtureWorkbook();
    const applied = await applyEditPlan(workbook, plan([{ sheet: "Sheet1", range: "B1", value: 5 }]));
    const out = buildOutputXlsx(bytes, applied);

    expect(partSet(out).has("xl/calcChain.xml")).toBe(true);
    assertUntouchedPartsByteIdentical(bytes, out, new Set(["xl/worksheets/sheet1.xml"]));
    expect(decodePart(out, "[Content_Types].xml")).toContain("calcChain.xml");
    expect(decodePart(out, "xl/_rels/workbook.xml.rels")).toContain("calcChain.xml");
  });

  it("is deleted (part + Content_Types Override + rels Relationship) when a formula is edited", async () => {
    const { bytes, workbook } = fixtureWorkbook();
    const applied = await applyEditPlan(workbook, plan([{ sheet: "Sheet1", range: "E1", formula: "=1/0" }]));
    const out = buildOutputXlsx(bytes, applied);

    expect(partSet(out).has("xl/calcChain.xml")).toBe(false);
    expect(decodePart(out, "[Content_Types].xml")).not.toContain("calcChain");
    expect(decodePart(out, "xl/_rels/workbook.xml.rels")).not.toContain("calcChain");
    // Every other original part is still there, and everything but the
    // three edited/rewritten parts is byte-identical.
    const before = partSet(bytes);
    before.delete("xl/calcChain.xml");
    expect(partSet(out)).toEqual(before);
  });

  it("is also deleted when a plan value-edit overwrites what used to be a formula cell", async () => {
    const { bytes, workbook } = fixtureWorkbook();
    // A2 was =SUM(B1:B1) in the fixture; overwriting it with a literal
    // changes the calc graph's shape just as much as editing a formula does.
    const applied = await applyEditPlan(workbook, plan([{ sheet: "Sheet1", range: "A2", value: 7 }]));
    const out = buildOutputXlsx(bytes, applied);

    expect(partSet(out).has("xl/calcChain.xml")).toBe(false);
    const reparsed = parseWorkbook(out, "fixture.xlsx");
    expect(valueAt(reparsed, "Sheet1", "A2")).toBe(7);
    expect(reparsed.sheets[0].cells.get(cellKey(1, 0))?.formula).toBeUndefined();
  });

  it("produces well-formed patched worksheet XML for the error-value case", async () => {
    const { bytes, workbook } = fixtureWorkbook();
    const applied = await applyEditPlan(workbook, plan([{ sheet: "Sheet1", range: "E1", formula: "=1/0" }]));
    const out = buildOutputXlsx(bytes, applied);
    assertWellFormedXml(decodePart(out, "xl/worksheets/sheet1.xml"), "patched sheet1.xml (error-value plan)");
  });
});

// ---------------------------------------------------------------------------
// Error value cell
// ---------------------------------------------------------------------------

describe("buildOutputXlsx: error values", () => {
  it("writes an engine error as t=\"e\" with the error's own text, and re-parses as an error", async () => {
    const { bytes, workbook } = fixtureWorkbook();
    const applied = await applyEditPlan(workbook, plan([{ sheet: "Sheet1", range: "E1", formula: "=1/0" }]));
    const out = buildOutputXlsx(bytes, applied);

    const sheetXml = decodePart(out, "xl/worksheets/sheet1.xml");
    expect(sheetXml).toMatch(/<c r="E1"[^>]*t="e"[^>]*><f>1\/0<\/f><v>#DIV\/0!<\/v><\/c>/);

    const reparsed = parseWorkbook(out, "fixture.xlsx");
    const e1 = reparsed.sheets[0].cells.get(cellKey(0, 4));
    expect(e1?.type).toBe("error");
    expect(e1?.text).toBe("#DIV/0!");
  });
});

// ---------------------------------------------------------------------------
// New sheet (registration into workbook.xml / rels / Content_Types)
// ---------------------------------------------------------------------------

describe("buildOutputXlsx: new sheet", () => {
  it("creates and registers a brand-new worksheet part with a formula cell", async () => {
    const { bytes, workbook } = fixtureWorkbook();
    const applied = await applyEditPlan(
      workbook,
      plan([{ sheet: "Extra", range: "A1", formula: "=1+1" }], ["Extra"]),
    );
    const out = buildOutputXlsx(bytes, applied);

    const reparsed = parseWorkbook(out, "fixture.xlsx");
    expect(reparsed.sheets.map((s) => s.name)).toContain("Extra");
    expect(valueAt(reparsed, "Extra", "A1")).toBe(2);

    // xl/worksheets/sheet1.xml (the original, untouched sheet) is byte-identical.
    assertUntouchedPartsByteIdentical(bytes, out, new Set(["xl/worksheets/sheet2.xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "[Content_Types].xml", "xl/calcChain.xml"]));
    assertWellFormedXml(decodePart(out, "xl/worksheets/sheet2.xml"), "new sheet2.xml");
    assertWellFormedXml(decodePart(out, "xl/workbook.xml"), "patched workbook.xml");
  });
});

// ---------------------------------------------------------------------------
// Real-file integration: repo-root Excaliba.xlsx (the SpreadsheetBench-style
// workbook the original corruption bug was diagnosed on — 24 zip parts
// including a 5-link externalLinks tree). Precedent for reading it directly
// in a test: test/formula-simulate-determinism.test.ts.
// ---------------------------------------------------------------------------

describe.skipIf(!HAVE_EXCALIBA)("buildOutputXlsx: Excaliba.xlsx integration", () => {
  it("preserves every original part except a deleted calcChain.xml, with externalLinks intact", async () => {
    const bytes = readExcaliba();
    const workbook = parseWorkbook(bytes, "Excaliba.xlsx");

    const applied = await applyEditPlan(
      workbook,
      plan([
        { sheet: "UrunPlan", range: "A200", value: "integration test" },
        { sheet: "UrunPlan", range: "A201", formula: "=1+1" },
      ]),
    );
    const out = buildOutputXlsx(bytes, applied);

    const beforeParts = partSet(bytes);
    const afterParts = partSet(out);
    const expected = new Set(beforeParts);
    expected.delete("xl/calcChain.xml"); // the plan added a formula cell
    expect(afterParts).toEqual(expected);

    for (let i = 1; i <= 5; i++) {
      expect(afterParts.has(`xl/externalLinks/externalLink${i}.xml`)).toBe(true);
      expect(afterParts.has(`xl/externalLinks/_rels/externalLink${i}.xml.rels`)).toBe(true);
    }

    assertUntouchedPartsByteIdentical(
      bytes,
      out,
      new Set(["xl/worksheets/sheet1.xml", "xl/_rels/workbook.xml.rels", "[Content_Types].xml", "xl/calcChain.xml"]),
    );

    const reparsed = parseWorkbook(out, "Excaliba.xlsx");
    expect(valueAt(reparsed, "UrunPlan", "A200")).toBe("integration test");
    expect(valueAt(reparsed, "UrunPlan", "A201")).toBe(2);

    assertWellFormedXml(decodePart(out, "xl/worksheets/sheet1.xml"), "Excaliba patched sheet1.xml");
  });

  it("(a) an empty plan against the real file returns the exact same bytes", async () => {
    const bytes = readExcaliba();
    const workbook = parseWorkbook(bytes, "Excaliba.xlsx");
    const applied = await applyEditPlan(workbook, plan([]));
    expect(buildOutputXlsx(bytes, applied)).toBe(bytes);
  });
});

// ---------------------------------------------------------------------------
// Same-fixture sanity checks for the plain xlsxBytes() house fixture (a
// SheetJS-native minimal xlsx — no sharedStrings.xml/calcChain.xml at all),
// to confirm the rewrite behaves on that shape too, matching the other
// suites (test/work-run.test.ts, test/bench-run-task.test.ts) that already
// exercise buildOutputXlsx against it.
// ---------------------------------------------------------------------------

describe("buildOutputXlsx: SheetJS-native fixture (no sharedStrings/calcChain to begin with)", () => {
  it("does not invent a calcChain.xml that never existed", async () => {
    const bytes = xlsxBytes({ Sheet1: [[1, 2]] });
    const workbook = parseWorkbook(bytes, "wb.xlsx");
    const applied = await applyEditPlan(workbook, plan([{ sheet: "Sheet1", range: "A1", formula: "=B1+1" }]));
    const out = buildOutputXlsx(bytes, applied);
    expect(partSet(out).has("xl/calcChain.xml")).toBe(false);
    const reparsed = parseWorkbook(out, "wb.xlsx");
    expect(valueAt(reparsed, "Sheet1", "A1")).toBe(3);
  });
});
