import { describe, expect, it } from "vitest";
import { compileChart } from "@/lib/charts/compile";
import type { ChartSpec } from "@/lib/charts/spec";

/**
 * Structural assertions on compileChart's output for every chart type
 * Phase 1 covers: the right root `c:*Chart` element, the right series
 * count, `c:f` reference qualification, title text, axis number formats,
 * and the chart-type-specific patterns the golden files actually use
 * (per-point `c:dPt` colors, the football-field invisible-series trick, the
 * doughnut-gauge hole/angle, the combo secondary axis). Byte-for-byte
 * comparison against a real Excel-authored chart is deliberately NOT the
 * goal here — see test/charts-golden.test.ts for that, at the "same
 * chart-type element, same series count" level lib/charts/compile.ts's own
 * header doc says this phase targets.
 */

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("compileChart: line chart", () => {
  const spec: ChartSpec = {
    chartType: "line",
    title: "Invoice Count Burndown",
    sheet: "Count",
    anchor: { cell: "E4", widthCols: 9, heightRows: 15 },
    categoryAxis: { dateAxis: true, numberFormat: "m/d/yy" },
    valueAxis: { numberFormat: "0" },
    legend: { position: "b" },
    series: [
      { name: "Count to be Collected", categories: { ref: "A4:A44" }, values: { ref: "C4:C44" }, color: "4472C4" },
      { name: "Goal", categories: { ref: "A4:A44" }, values: { ref: "B4:B44" } },
    ],
  };
  const compiled = compileChart(spec);

  it("emits a c:lineChart with one c:ser per series", () => {
    expect(compiled.chartXml).toContain("<c:lineChart>");
    expect(occurrences(compiled.chartXml, "<c:ser>")).toBe(2);
  });

  it("qualifies bare ranges against the chart's own sheet", () => {
    expect(compiled.chartXml).toContain("<c:f>Count!A4:A44</c:f>");
    expect(compiled.chartXml).toContain("<c:f>Count!C4:C44</c:f>");
  });

  it("carries the title text", () => {
    expect(compiled.chartXml).toContain("<a:t>Invoice Count Burndown</a:t>");
    expect(compiled.chartXml).toContain('<c:autoTitleDeleted val="0"/>');
  });

  it("uses a date category axis with the requested number format", () => {
    expect(compiled.chartXml).toContain("<c:dateAx>");
    expect(compiled.chartXml).not.toContain("<c:catAx>");
    expect(compiled.chartXml).toContain('formatCode="m/d/yy"');
    expect(compiled.chartXml).toContain('formatCode="0"'); // valueAxis
  });

  it("applies a series color as a solid line fill", () => {
    expect(compiled.chartXml).toContain('<a:srgbClr val="4472C4"/>');
  });

  it("anchors at the requested cell and size", () => {
    // E4 -> 0-based col 4, row 3; width 9 cols, height 15 rows.
    expect(compiled.drawingXml).toContain("<xdr:col>4</xdr:col>");
    expect(compiled.drawingXml).toContain("<xdr:row>3</xdr:row>");
    expect(compiled.drawingXml).toContain("<xdr:col>13</xdr:col>"); // 4 + 9
    expect(compiled.drawingXml).toContain("<xdr:row>18</xdr:row>"); // 3 + 15
  });
});

describe("compileChart: stacked column chart", () => {
  const spec: ChartSpec = {
    chartType: "column",
    title: "Sales Analysis",
    sheet: "Sheet1",
    anchor: { cell: "F2" },
    grouping: "stacked",
    series: [
      { name: "Type A", categories: { values: ["Q1", "Q2", "Q3", "Q4"] }, values: { values: [0, 1, 0, 1] } },
      { name: "TypeB", categories: { values: ["Q1", "Q2", "Q3", "Q4"] }, values: { values: [1, 3, 3, 3] } },
    ],
  };
  const compiled = compileChart(spec);

  it("emits a vertical, stacked bar chart", () => {
    expect(compiled.chartXml).toContain('<c:barDir val="col"/>');
    expect(compiled.chartXml).toContain('<c:grouping val="stacked"/>');
    expect(compiled.chartXml).toContain('<c:overlap val="100"/>');
  });

  it("compiles literal category/value arrays to c:strLit/c:numLit (no c:f)", () => {
    expect(compiled.chartXml).toContain("<c:strLit>");
    expect(compiled.chartXml).toContain("<c:numLit>");
    expect(compiled.chartXml).not.toContain("<c:f>");
  });

  it("carries both legend-entry series names", () => {
    expect(compiled.chartXml).toContain("<c:v>Type A</c:v>");
    expect(compiled.chartXml).toContain("<c:v>TypeB</c:v>");
  });
});

describe("compileChart: horizontal bar chart with an invisible offset series (football field)", () => {
  const spec: ChartSpec = {
    chartType: "bar",
    title: "Project Mars - Standalone Valuation Summary",
    sheet: "Sheet1",
    anchor: { cell: "H2" },
    grouping: "stacked",
    legend: { show: false },
    series: [
      { name: "Low Value", color: "none", categories: { ref: "B3:B8" }, values: { ref: "C3:C8" } },
      {
        name: "Width",
        categories: { ref: "B3:B8" },
        values: { ref: "E3:E8" },
        pointColors: { "4": "FFC000", "5": "FFC000" },
      },
    ],
  };
  const compiled = compileChart(spec);

  it("emits a horizontal, stacked bar chart", () => {
    expect(compiled.chartXml).toContain('<c:barDir val="bar"/>');
    expect(compiled.chartXml).toContain('<c:grouping val="stacked"/>');
  });

  it("gives the offset series a no-fill (invisible) spPr", () => {
    // The FIRST c:ser (Low Value) must carry <a:noFill/> in its own spPr,
    // ahead of the second series' <c:dPt> entries.
    const firstSer = compiled.chartXml.slice(compiled.chartXml.indexOf("<c:ser>"), compiled.chartXml.indexOf("</c:ser>"));
    expect(firstSer).toContain("<a:noFill/>");
  });

  it("emits two per-point dPt color overrides on the visible series", () => {
    expect(occurrences(compiled.chartXml, "<c:dPt>")).toBe(2);
    expect(compiled.chartXml).toContain('<c:idx val="4"/>');
    expect(compiled.chartXml).toContain('<c:idx val="5"/>');
    expect(compiled.chartXml).toContain('<a:srgbClr val="FFC000"/>');
  });

  it("omits the legend entirely", () => {
    expect(compiled.chartXml).not.toContain("<c:legend>");
  });
});

describe("compileChart: pie chart", () => {
  const spec: ChartSpec = {
    chartType: "pie",
    title: "Number of Game Events",
    sheet: "Sheet1",
    anchor: { cell: "A1" },
    series: [
      {
        categories: { values: ["A", "B", "C"] },
        values: { values: [2, 5, 4] },
        pointColors: { "0": "FF0000" },
      },
    ],
  };
  const compiled = compileChart(spec);

  it("emits a c:pieChart with exactly one series and no axes", () => {
    expect(compiled.chartXml).toContain("<c:pieChart>");
    expect(occurrences(compiled.chartXml, "<c:ser>")).toBe(1);
    expect(compiled.chartXml).not.toContain("<c:catAx>");
    expect(compiled.chartXml).not.toContain("<c:valAx>");
  });

  it("colors just the requested point", () => {
    expect(occurrences(compiled.chartXml, "<c:dPt>")).toBe(1);
    expect(compiled.chartXml).toContain('<a:srgbClr val="FF0000"/>');
  });
});

describe("compileChart: doughnut gauge", () => {
  const spec: ChartSpec = {
    chartType: "doughnut",
    sheet: "Sheet1",
    anchor: { cell: "B6" },
    holeSize: 60,
    firstSliceAngle: 270,
    legend: { show: false },
    series: [
      {
        values: { values: [72, 28, 100] },
        pointColors: { "0": "2E7D32", "1": "D9D9D9", "2": "none" },
      },
    ],
  };
  const compiled = compileChart(spec);

  it("emits a c:doughnutChart with the requested hole size and start angle", () => {
    expect(compiled.chartXml).toContain("<c:doughnutChart>");
    expect(compiled.chartXml).toContain('<c:holeSize val="60"/>');
    expect(compiled.chartXml).toContain('<c:firstSliceAng val="270"/>');
  });

  it("colors the third (invisible half) point with a:noFill, not a color", () => {
    expect(occurrences(compiled.chartXml, "<c:dPt>")).toBe(3);
    expect(compiled.chartXml).toContain("<a:noFill/>");
  });
});

describe("compileChart: scatter chart", () => {
  const spec: ChartSpec = {
    chartType: "scatter",
    title: "Monthly Blood Sugar Levels",
    sheet: "Sheet1",
    anchor: { cell: "F2" },
    categoryAxis: { numberFormat: "m/d" },
    valueAxis: { numberFormat: "0" },
    series: [
      {
        name: "Readings",
        xValues: { ref: "A2:A30" },
        values: { ref: "B2:B30" },
        marker: { symbol: "circle" },
        line: false,
      },
    ],
  };
  const compiled = compileChart(spec);

  it("emits a c:scatterChart with scatterStyle lineMarker", () => {
    expect(compiled.chartXml).toContain("<c:scatterChart>");
    expect(compiled.chartXml).toContain('<c:scatterStyle val="lineMarker"/>');
  });

  it("uses xVal/yVal, not cat/val", () => {
    expect(compiled.chartXml).toContain("<c:xVal>");
    expect(compiled.chartXml).toContain("<c:yVal>");
    expect(compiled.chartXml).not.toContain("<c:cat>");
  });

  it("suppresses the connecting line when line: false", () => {
    const ser = compiled.chartXml.slice(compiled.chartXml.indexOf("<c:ser>"), compiled.chartXml.indexOf("</c:ser>"));
    expect(ser).toContain("<a:ln><a:noFill/></a:ln>");
  });

  it("has two value axes (x on the bottom, y on the left), no category axis", () => {
    expect(occurrences(compiled.chartXml, "<c:valAx>")).toBe(2);
    expect(compiled.chartXml).toContain('<c:axPos val="b"/>');
    expect(compiled.chartXml).toContain('<c:axPos val="l"/>');
  });
});

describe("compileChart: bubble chart", () => {
  const spec: ChartSpec = {
    chartType: "bubble",
    title: "Product Portfolio Analysis",
    sheet: "Strategy",
    anchor: { cell: "F2" },
    legend: { show: false },
    series: [
      {
        xValues: { ref: "N5:N13" },
        values: { ref: "O5:O13" },
        bubbleSizes: { ref: "P5:P13" },
        pointColors: { "2": "00B050", "7": "FF0000" },
      },
    ],
  };
  const compiled = compileChart(spec);

  it("emits a c:bubbleChart with xVal/yVal/bubbleSize", () => {
    expect(compiled.chartXml).toContain("<c:bubbleChart>");
    expect(compiled.chartXml).toContain("<c:xVal>");
    expect(compiled.chartXml).toContain("<c:yVal>");
    expect(compiled.chartXml).toContain("<c:bubbleSize>");
  });

  it("colors the largest/smallest bubble points distinctly", () => {
    expect(occurrences(compiled.chartXml, "<c:dPt>")).toBe(2);
    expect(compiled.chartXml).toContain('<a:srgbClr val="00B050"/>');
    expect(compiled.chartXml).toContain('<a:srgbClr val="FF0000"/>');
  });

  it("omits the legend (\"No legend needed\")", () => {
    expect(compiled.chartXml).not.toContain("<c:legend>");
  });
});

describe("compileChart: area chart", () => {
  const spec: ChartSpec = {
    chartType: "area",
    sheet: "Sheet1",
    anchor: { cell: "A1" },
    series: [{ name: "Revenue", categories: { values: ["Jan", "Feb"] }, values: { values: [10, 20] } }],
  };
  const compiled = compileChart(spec);

  it("emits a c:areaChart with a category/value axis pair", () => {
    expect(compiled.chartXml).toContain("<c:areaChart>");
    expect(compiled.chartXml).toContain("<c:catAx>");
    expect(compiled.chartXml).toContain("<c:valAx>");
  });
});

describe("compileChart: combo chart (Pareto: bars + cumulative % line on a secondary axis)", () => {
  const categories = ["F", "A", "D", "E", "C", "B", "G"];
  const spec: ChartSpec = {
    chartType: "combo",
    title: "Defect Analysis",
    sheet: "Data",
    anchor: { cell: "D2" },
    valueAxis: { title: "Count" },
    secondaryValueAxis: { numberFormat: "0%", min: 0, max: 1 },
    series: [
      {
        type: "column",
        name: "Defect Counts",
        categories: { values: categories },
        values: { values: [60, 50, 45, 45, 40, 20, 15] },
        dataLabels: { show: true, showValue: true },
      },
      {
        type: "line",
        name: "Cumulative %",
        categories: { values: categories },
        values: { values: [0.22, 0.4, 0.56, 0.73, 0.87, 0.95, 1] },
        secondaryAxis: true,
      },
    ],
  };
  const compiled = compileChart(spec);

  it("emits both a c:barChart and a c:lineChart sub-chart", () => {
    expect(compiled.chartXml).toContain("<c:barChart>");
    expect(compiled.chartXml).toContain("<c:lineChart>");
    expect(occurrences(compiled.chartXml, "<c:ser>")).toBe(2);
  });

  it("carries both legend entries", () => {
    expect(compiled.chartXml).toContain("<c:v>Defect Counts</c:v>");
    expect(compiled.chartXml).toContain("<c:v>Cumulative %</c:v>");
  });

  it("puts the bar data labels on, showing the raw value", () => {
    expect(compiled.chartXml).toContain('<c:showVal val="1"/>');
  });

  it("wires a visible secondary value axis and a hidden secondary category axis", () => {
    expect(occurrences(compiled.chartXml, "<c:valAx>")).toBe(2);
    expect(occurrences(compiled.chartXml, "<c:catAx>")).toBe(2);
    expect(compiled.chartXml).toContain('<c:axPos val="r"/>'); // secondary value axis
    expect(compiled.chartXml).toContain('<c:delete val="1"/>'); // hidden secondary category axis
    expect(compiled.chartXml).toContain('formatCode="0%"');
  });

  it("declares four distinct axId values (two axis pairs)", () => {
    const ids = new Set([...compiled.chartXml.matchAll(/<c:axId val="(\d+)"\/>/g)].map((m) => m[1]));
    expect(ids.size).toBe(4);
  });
});

describe("compileChart: reference qualification", () => {
  it("leaves an already-qualified ref (containing '!') untouched", () => {
    const spec: ChartSpec = {
      chartType: "line",
      sheet: "Sheet1",
      anchor: { cell: "A1" },
      series: [{ values: { ref: "Data!F2:F8" } }],
    };
    expect(compileChart(spec).chartXml).toContain("<c:f>Data!F2:F8</c:f>");
  });

  it("quotes a sheet name that needs quoting when qualifying a bare ref", () => {
    const spec: ChartSpec = {
      chartType: "pie",
      sheet: "Pie Charts",
      anchor: { cell: "A1" },
      series: [{ categories: { ref: "A4:A11" }, values: { ref: "B4:B11" } }],
    };
    expect(compileChart(spec).chartXml).toContain("<c:f>'Pie Charts'!A4:A11</c:f>");
  });
});

describe("compileChart: relId/shapeId options", () => {
  it("bakes a custom relId and shapeId into the anchor fragment", () => {
    const spec: ChartSpec = {
      chartType: "line",
      sheet: "Sheet1",
      anchor: { cell: "A1" },
      series: [{ values: { values: [1, 2, 3] } }],
    };
    const compiled = compileChart(spec, { relId: "rId7", shapeId: 42 });
    expect(compiled.drawingXml).toContain('r:id="rId7"');
    expect(compiled.drawingXml).toContain('<xdr:cNvPr id="42"');
  });

  it("defaults to rId1 / shapeId 1", () => {
    const spec: ChartSpec = {
      chartType: "line",
      sheet: "Sheet1",
      anchor: { cell: "A1" },
      series: [{ values: { values: [1] } }],
    };
    const compiled = compileChart(spec);
    expect(compiled.drawingXml).toContain('r:id="rId1"');
    expect(compiled.drawingXml).toContain('<xdr:cNvPr id="1"');
  });
});
