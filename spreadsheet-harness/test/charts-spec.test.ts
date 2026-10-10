import { describe, expect, it } from "vitest";
import { chartSpecSchema, type ChartSpec } from "@/lib/charts/spec";

/**
 * Covers lib/charts/spec.ts's own contract: defaults, and the cross-field
 * validation `superRefine` enforces that a plain per-field Zod shape cannot
 * (combo series needing a `type`, scatter/bubble series needing `xValues`,
 * pie/doughnut being single-series, holeSize/firstSliceAngle being
 * chart-type-scoped). Structural XML output is covered separately in
 * test/charts-compile.test.ts.
 */

function baseLine(): ChartSpec {
  return {
    chartType: "line",
    sheet: "Sheet1",
    anchor: { cell: "E2" },
    series: [{ name: "Series A", values: { ref: "B2:B10" } }],
  };
}

describe("chartSpecSchema: defaults", () => {
  it("fills in anchor.widthCols/heightRows when omitted", () => {
    const parsed = chartSpecSchema.parse(baseLine());
    expect(parsed.anchor.widthCols).toBe(8);
    expect(parsed.anchor.heightRows).toBe(15);
  });

  it("accepts an explicit anchor size", () => {
    const parsed = chartSpecSchema.parse({ ...baseLine(), anchor: { cell: "A1", widthCols: 12, heightRows: 20 } });
    expect(parsed.anchor).toEqual({ cell: "A1", widthCols: 12, heightRows: 20 });
  });
});

describe("chartSpecSchema: combo requires a per-series type", () => {
  it("rejects a combo series with no `type`", () => {
    const spec = {
      chartType: "combo" as const,
      sheet: "Sheet1",
      anchor: { cell: "A1" },
      series: [{ values: { values: [1, 2, 3] } }],
    };
    const result = chartSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "series.0.type")).toBe(true);
    }
  });

  it("accepts a combo spec where every series has a type", () => {
    const spec = {
      chartType: "combo" as const,
      sheet: "Sheet1",
      anchor: { cell: "A1" },
      series: [
        { type: "column" as const, name: "Bars", values: { values: [1, 2, 3] } },
        { type: "line" as const, name: "Line", values: { values: [4, 5, 6] }, secondaryAxis: true },
      ],
    };
    expect(chartSpecSchema.safeParse(spec).success).toBe(true);
  });
});

describe("chartSpecSchema: scatter/bubble require xValues", () => {
  it("rejects a scatter series with no xValues", () => {
    const result = chartSpecSchema.safeParse({
      chartType: "scatter",
      sheet: "Sheet1",
      anchor: { cell: "A1" },
      series: [{ values: { values: [1, 2] } }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "series.0.xValues")).toBe(true);
    }
  });

  it("rejects a bubble series with no bubbleSizes (even with xValues present)", () => {
    const result = chartSpecSchema.safeParse({
      chartType: "bubble",
      sheet: "Sheet1",
      anchor: { cell: "A1" },
      series: [{ xValues: { values: [1] }, values: { values: [2] } }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "series.0.bubbleSizes")).toBe(true);
    }
  });

  it("accepts a fully-specified bubble series", () => {
    const result = chartSpecSchema.safeParse({
      chartType: "bubble",
      sheet: "Sheet1",
      anchor: { cell: "A1" },
      series: [{ xValues: { values: [1] }, values: { values: [2] }, bubbleSizes: { values: [3] } }],
    });
    expect(result.success).toBe(true);
  });
});

describe("chartSpecSchema: pie/doughnut are single-series", () => {
  it("rejects a pie spec with two series", () => {
    const result = chartSpecSchema.safeParse({
      chartType: "pie",
      sheet: "Sheet1",
      anchor: { cell: "A1" },
      series: [{ values: { values: [1] } }, { values: { values: [2] } }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "series")).toBe(true);
    }
  });
});

describe("chartSpecSchema: holeSize/firstSliceAngle are chart-type-scoped", () => {
  it("rejects holeSize on a non-doughnut chart", () => {
    const result = chartSpecSchema.safeParse({ ...baseLine(), holeSize: 50 });
    expect(result.success).toBe(false);
  });

  it("rejects firstSliceAngle on a line chart", () => {
    const result = chartSpecSchema.safeParse({ ...baseLine(), firstSliceAngle: 90 });
    expect(result.success).toBe(false);
  });

  it("accepts holeSize + firstSliceAngle together on a doughnut (the gauge pattern)", () => {
    const result = chartSpecSchema.safeParse({
      chartType: "doughnut",
      sheet: "Sheet1",
      anchor: { cell: "A1" },
      holeSize: 60,
      firstSliceAngle: 270,
      series: [{ values: { values: [72, 28, 100] } }],
    });
    expect(result.success).toBe(true);
  });
});

describe("chartSpecSchema: color validation", () => {
  it("accepts a 6-digit hex color and the literal \"none\"", () => {
    const spec = baseLine();
    spec.series[0] = { ...spec.series[0], color: "FF0000" } as (typeof spec.series)[0];
    expect(chartSpecSchema.safeParse(spec).success).toBe(true);
    spec.series[0] = { ...spec.series[0], color: "none" } as (typeof spec.series)[0];
    expect(chartSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("rejects a color with a leading '#' or the wrong length", () => {
    const spec = baseLine();
    spec.series[0] = { ...spec.series[0], color: "#FF0000" } as (typeof spec.series)[0];
    expect(chartSpecSchema.safeParse(spec).success).toBe(false);
    spec.series[0] = { ...spec.series[0], color: "FF00" } as (typeof spec.series)[0];
    expect(chartSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rejects a pointColors key that is not a plain non-negative integer", () => {
    const spec = baseLine();
    spec.series[0] = { ...spec.series[0], pointColors: { "0": "FF0000", "-1": "00FF00" } } as (typeof spec.series)[0];
    expect(chartSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("accepts sparse pointColors keyed by valid indices", () => {
    const spec = baseLine();
    spec.series[0] = { ...spec.series[0], pointColors: { "0": "FF0000", "3": "00B050" } } as (typeof spec.series)[0];
    expect(chartSpecSchema.safeParse(spec).success).toBe(true);
  });
});

describe("chartSpecSchema: DataRef union", () => {
  it("accepts a ref with an optional literal cache", () => {
    const spec = baseLine();
    spec.series[0].values = { ref: "B2:B4", cache: [1, 2, 3] };
    expect(chartSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("accepts a fully-literal values array with no ref", () => {
    const spec = baseLine();
    spec.series[0].values = { values: [1, 2, 3] };
    expect(chartSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("rejects a DataRef with neither ref nor values", () => {
    const spec = baseLine();
    // @ts-expect-error deliberately invalid for the test
    spec.series[0].values = {};
    expect(chartSpecSchema.safeParse(spec).success).toBe(false);
  });
});
