import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { compileChart } from "@/lib/charts/compile";
import type { ChartSpec } from "@/lib/charts/spec";

/**
 * Structural (NOT byte) comparison of compileChart's output against real
 * Excel-authored chart XML in golden answer files from the SpreadsheetBench
 * v2 Visualization dataset — same root `c:*Chart` element(s), same series
 * count. That is the bar lib/charts/compile.ts's own header doc sets for
 * this phase: a real chart Excel itself produced is dramatically more
 * verbose (theme-color styling, per-run rich text, manual layout hints)
 * than anything this compiler emits or needs to, so byte/structural
 * equality beyond "the right shape of chart with the right number of data
 * series" is not a meaningful target — see compile.ts's header doc for what
 * is deliberately left out and why.
 *
 * The dataset itself is not checked into git (~250MB; see
 * docs/spreadsheetbench.md for how to fetch it into `data/`, which is
 * gitignored). This whole suite no-ops via `skipIf` when that directory is
 * not present locally, rather than failing a fresh clone or a CI run that
 * has not downloaded it — the same tolerance `npm run bench` itself has
 * for a missing dataset.
 */

const DATASET_DIR = join(process.cwd(), "data/spreadsheetbench-v2/Visualization/spreadsheet");
const HAVE_DATASET = existsSync(DATASET_DIR);

function readGoldenChartXml(task: string, chartFile = "chart1.xml"): string {
  const path = join(DATASET_DIR, task, `${task}_golden.xlsx`);
  const bytes = new Uint8Array(readFileSync(path));
  const zip = unzipSync(bytes);
  const entry = zip[`xl/charts/${chartFile}`];
  if (!entry) throw new Error(`${task}: no xl/charts/${chartFile} in the golden file`);
  return new TextDecoder().decode(entry);
}

function serCount(xml: string): number {
  return (xml.match(/<c:ser>/g) ?? []).length;
}

describe.skipIf(!HAVE_DATASET)("compileChart vs golden files: structural parity", () => {
  it("Task 1411527 (line, 2 series): same root element and series count", () => {
    const spec: ChartSpec = {
      chartType: "line",
      title: "Invoice Count Burndown August 2023",
      sheet: "Count",
      anchor: { cell: "E4" },
      categoryAxis: { dateAxis: true },
      series: [
        { name: "Count to be Collected", categories: { ref: "A4:A44" }, values: { ref: "C4:C44" } },
        { name: "Goal", categories: { ref: "A4:A44" }, values: { ref: "B4:B44" } },
      ],
    };
    const compiled = compileChart(spec);
    const golden = readGoldenChartXml("Task 1411527");

    expect(compiled.chartXml).toContain("<c:lineChart>");
    expect(golden).toContain("<c:lineChart>");
    expect(serCount(golden)).toBe(2);
    expect(serCount(compiled.chartXml)).toBe(serCount(golden));
  });

  it("Task 1417365 (stacked column, 2 series): same direction, grouping, and series count", () => {
    const categories = ["2022 Q1", "2022 Q2", "2022 Q3", "2022 Q4", "2023 Q1", "2023 Q2", "2023 Q3", "2023 Q4"];
    const spec: ChartSpec = {
      chartType: "column",
      title: "Sales Analysis",
      sheet: "Sheet1",
      anchor: { cell: "F2" },
      grouping: "stacked",
      series: [
        { name: "Type A", categories: { values: categories }, values: { values: [0, 1, 0, 1, 2, 7, 3, 2] } },
        { name: "TypeB", categories: { values: categories }, values: { values: [1, 3, 3, 3, 6, 6, 2, 7] } },
      ],
    };
    const compiled = compileChart(spec);
    const golden = readGoldenChartXml("Task 1417365");

    expect(compiled.chartXml).toContain('<c:barDir val="col"/>');
    expect(golden).toContain('<c:barDir val="col"/>');
    expect(compiled.chartXml).toContain('<c:grouping val="stacked"/>');
    expect(golden).toContain('<c:grouping val="stacked"/>');
    expect(serCount(golden)).toBe(2);
    expect(serCount(compiled.chartXml)).toBe(serCount(golden));
  });

  it("Task 95 (bubble, 1 series): same root element and series count", () => {
    const spec: ChartSpec = {
      chartType: "bubble",
      title: "Product Portfolio Analysis",
      sheet: "Strategy",
      anchor: { cell: "F2" },
      legend: { show: false },
      series: [
        {
          xValues: { values: [100000, 75000, 120000, 64451, 47493, 99139, 32416, 27173, 56889] },
          values: { values: [0.12, 0.08, 0.15, 0.13, 0.11, 0.08, 0.15, 0.03, 0.02] },
          bubbleSizes: { values: [500, 300, 1000, 781, 587, 780, 541, 765, 875] },
        },
      ],
    };
    const compiled = compileChart(spec);
    const golden = readGoldenChartXml("Task 95");

    expect(compiled.chartXml).toContain("<c:bubbleChart>");
    expect(golden).toContain("<c:bubbleChart>");
    expect(serCount(golden)).toBe(1);
    expect(serCount(compiled.chartXml)).toBe(serCount(golden));
  });

  it("Task 90 (Pareto combo, bar+line, 2 series): same sub-chart elements as the golden", () => {
    const categories = ["F", "A", "D", "E", "C", "B", "G"];
    const spec: ChartSpec = {
      chartType: "combo",
      title: "Defect Analysis",
      sheet: "Data",
      anchor: { cell: "D2" },
      series: [
        {
          type: "column",
          name: "Defect Counts",
          categories: { values: categories },
          values: { values: [60, 50, 45, 45, 40, 20, 15] },
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
    const golden = readGoldenChartXml("Task 90");

    expect(compiled.chartXml).toContain("<c:barChart>");
    expect(compiled.chartXml).toContain("<c:lineChart>");
    expect(golden).toContain("<c:barChart>");
    expect(golden).toContain("<c:lineChart>");
    expect(serCount(golden)).toBe(2);
    expect(serCount(compiled.chartXml)).toBe(serCount(golden));
  });
});
