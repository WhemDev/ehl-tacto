import { describe, expect, it } from "vitest";
import { makeEditPlanSchema, MAX_CHARTS } from "@/lib/plan/edits";
import { cellKey, type GridCell, type ParsedSheet, type ParsedWorkbook } from "@/lib/workbook";

/**
 * Covers the "charts" field makeEditPlanSchema (lib/plan/edits.ts) gained
 * for Visualization-category tasks: chartSpecSchema (lib/charts/spec.ts) run
 * as the semantic authority, fed through chartEntrySchema first, which
 * accepts either form an entry can arrive in —
 *
 *  - a JSON-encoded STRING, the live tool's transport (lib/agent/tools.ts's
 *    EDIT_PLAN_SCHEMA "charts" property is `string[]`, zero unions — see its
 *    header doc for the live-API union-cap incident this fixes) — parsed
 *    here, a syntax error becoming a Zod issue at the entry's own path;
 *  - a plain OBJECT, for hand-authored callers — including the OLD
 *    strict-tool shape with every optional field present as an explicit
 *    `null`, still accepted via stripNullsDeep so it parses exactly like a
 *    hand-authored ChartSpec that simply omits those fields.
 */

function sheetOf(name: string, cells: Record<string, { v?: unknown; f?: string }>): ParsedSheet {
  const map = new Map<string, GridCell>();
  let rows = 1;
  let cols = 1;
  for (const [ref, spec] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    const col = m[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const row = Number(m[2]) - 1;
    rows = Math.max(rows, row + 1);
    cols = Math.max(cols, col + 1);
    map.set(cellKey(row, col), {
      row,
      col,
      value: spec.v ?? null,
      text: String(spec.v ?? ""),
      type: typeof spec.v === "number" ? "number" : "text",
      formula: spec.f,
    });
  }
  return { name, rows, cols, totalRows: rows, totalCols: cols, truncated: false, cells: map, merges: [], colWidths: [] };
}

function workbookOf(sheets: ParsedSheet[]): ParsedWorkbook {
  return { id: "wb", fileName: "wb.xlsx", sheets, definedNames: [] };
}

const wb = () =>
  workbookOf([
    sheetOf("Data", {
      A1: { v: "Quarter" }, B1: { v: "Revenue" },
      A2: { v: "Q1" }, B2: { v: 10 },
      A3: { v: "Q2" }, B3: { v: 20 },
    }),
  ]);

/** A minimal, fully-null-padded chart — the exact shape a strict tool
 *  submission sends when every optional field is omitted. */
function nullPaddedChart(overrides: Record<string, unknown> = {}) {
  return {
    chartType: "column",
    title: null,
    sheet: "Data",
    anchor: { cell: "D2", widthCols: null, heightRows: null },
    series: [
      {
        name: "Revenue",
        nameRef: null,
        type: null,
        categories: { ref: "A2:A3", cache: null },
        xValues: null,
        values: { ref: "B2:B3", cache: null },
        bubbleSizes: null,
        color: null,
        marker: null,
        smooth: null,
        line: null,
        secondaryAxis: null,
        dataLabels: null,
      },
    ],
    grouping: null,
    categoryAxis: null,
    valueAxis: null,
    secondaryValueAxis: null,
    legend: null,
    dataLabels: null,
    varyColors: null,
    holeSize: null,
    firstSliceAngle: null,
    ...overrides,
  };
}

describe("makeEditPlanSchema: charts field", () => {
  const schema = makeEditPlanSchema(wb());

  it("defaults to [] when the plan never mentions charts", () => {
    const parsed = schema.parse({ edits: [] });
    expect(parsed.charts).toEqual([]);
  });

  it("accepts a strict-tool-shaped chart (every optional field an explicit null) and resolves it to a clean ChartSpec", () => {
    const parsed = schema.parse({ edits: [], charts: [nullPaddedChart()] });
    expect(parsed.charts).toHaveLength(1);
    const chart = parsed.charts[0];
    expect(chart.chartType).toBe("column");
    expect(chart.title).toBeUndefined();
    expect(chart.sheet).toBe("Data");
    // anchor defaults applied by chartSpecSchema itself (widthCols/heightRows).
    expect(chart.anchor).toEqual({ cell: "D2", widthCols: 8, heightRows: 15 });
    expect(chart.series[0]).toEqual({
      name: "Revenue",
      categories: { ref: "A2:A3" },
      values: { ref: "B2:B3" },
    });
  });

  it("also accepts a hand-authored ChartSpec that simply omits optional fields (undefined, not null)", () => {
    const parsed = schema.safeParse({
      edits: [],
      charts: [
        {
          chartType: "line",
          sheet: "Data",
          anchor: { cell: "D2" },
          series: [{ categories: { values: ["a", "b"] }, values: { values: [1, 2] } }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("resolves chart sheet names case-insensitively but rejects unknown ones", () => {
    expect(schema.safeParse({ edits: [], charts: [nullPaddedChart({ sheet: "data" })] }).success).toBe(true);
    const bad = schema.safeParse({ edits: [], charts: [nullPaddedChart({ sheet: "Nope" })] });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.success ? "" : bad.error.issues)).toContain("unknown sheet");
  });

  it("allows a chart on a declared new sheet", () => {
    const parsed = schema.safeParse({
      edits: [],
      newSheets: ["Charts"],
      charts: [nullPaddedChart({ sheet: "Charts" })],
    });
    expect(parsed.success).toBe(true);
  });

  it("still enforces chartSpecSchema's own structural rules (combo needs series.type)", () => {
    const bad = schema.safeParse({
      edits: [],
      charts: [nullPaddedChart({ chartType: "combo" })], // series.type left null
    });
    expect(bad.success).toBe(false);
  });

  it("still enforces chartSpecSchema's own structural rules (scatter needs series.xValues)", () => {
    const bad = schema.safeParse({
      edits: [],
      charts: [nullPaddedChart({ chartType: "scatter" })], // xValues left null
    });
    expect(bad.success).toBe(false);
  });

  it("caps the number of charts at MAX_CHARTS", () => {
    const many = Array.from({ length: MAX_CHARTS + 1 }, () => nullPaddedChart());
    expect(schema.safeParse({ edits: [], charts: many }).success).toBe(false);
    expect(schema.safeParse({ edits: [], charts: many.slice(0, MAX_CHARTS) }).success).toBe(true);
  });

  it("never strips a legitimate null out of an ordinary edit's literal value", () => {
    // Regression guard: stripNullsDeep is scoped to the "charts" field only —
    // an edit's own `value: null` (write-a-blank-cell) must survive untouched.
    const parsed = schema.parse({ edits: [{ sheet: "Data", range: "C1", value: null }] });
    expect(parsed.edits[0].value).toBeNull();
  });

  describe("string-form entries (the live tool's transport)", () => {
    it("accepts a valid JSON string entry, resolving it identically to the equivalent object", () => {
      const objForm = schema.parse({ edits: [], charts: [nullPaddedChart()] });
      const strForm = schema.parse({ edits: [], charts: [JSON.stringify(nullPaddedChart())] });
      expect(strForm.charts).toEqual(objForm.charts);
    });

    it("an invalid JSON string yields a Zod issue at the entry's own path, not a thrown exception", () => {
      const result = schema.safeParse({ edits: [], charts: ["{not valid json"] });
      expect(result.success).toBe(false);
      if (result.success) return;
      const issue = result.error.issues.find((i) => i.path.join(".") === "charts.0");
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(/not valid JSON/);
    });

    it("reports the path-correct issue for the offending entry when other entries in the array are valid", () => {
      const result = schema.safeParse({
        edits: [],
        charts: [JSON.stringify(nullPaddedChart()), "{broken", JSON.stringify(nullPaddedChart({ sheet: "data" }))],
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const issue = result.error.issues.find((i) => i.path.join(".") === "charts.1");
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(/not valid JSON/);
    });

    it("a syntactically valid JSON string that still fails chartSpecSchema's own rules surfaces at the nested field path", () => {
      // combo requires series.type; the string form must still route through
      // chartSpecSchema's structural checks, not just JSON.parse.
      const result = schema.safeParse({
        edits: [],
        charts: [JSON.stringify(nullPaddedChart({ chartType: "combo" }))],
      });
      expect(result.success).toBe(false);
    });

    it("mixes string and object entries in the same plan", () => {
      const parsed = schema.parse({
        edits: [],
        charts: [JSON.stringify(nullPaddedChart()), nullPaddedChart({ sheet: "data" })],
      });
      expect(parsed.charts).toHaveLength(2);
      expect(parsed.charts[0].chartType).toBe("column");
      // Sheet-name casing isn't canonicalized by chartSpecSchema (only
      // resolved case-insensitively by makeEditPlanSchema's superRefine, and
      // then only to check it exists) — "data" comes through as submitted.
      expect(parsed.charts[1].sheet).toBe("data");
    });

    it("a string entry carrying pointColors round-trips through chartSpecSchema (unavailable to the old object-only encoding)", () => {
      const chart = nullPaddedChart({
        series: [
          {
            name: "Revenue",
            nameRef: null,
            type: null,
            categories: { ref: "A2:A3", cache: null },
            xValues: null,
            values: { ref: "B2:B3", cache: null },
            bubbleSizes: null,
            color: null,
            pointColors: { "0": "00B050", "1": "FF0000" },
            marker: null,
            smooth: null,
            line: null,
            secondaryAxis: null,
            dataLabels: null,
          },
        ],
      });
      const parsed = schema.parse({ edits: [], charts: [JSON.stringify(chart)] });
      expect(parsed.charts[0].series[0].pointColors).toEqual({ "0": "00B050", "1": "FF0000" });
    });
  });
});
