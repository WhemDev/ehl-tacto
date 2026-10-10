import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { BenchTask } from "@/lib/bench/dataset";
import { runBenchTask, type InferFn } from "@/lib/bench/run-task";
import { xlsxBytes } from "./helpers/workbooks";

/**
 * Covers lib/bench/run-task.ts's chart-application step: after
 * buildOutputXlsx patches the plan's edits into the output bytes, a
 * non-empty plan.charts runs through lib/charts/inject.ts's injectCharts
 * over THOSE bytes — output-only, never touching the Simulator or the score
 * (a Visualization task has no answer_position, so score stays null/
 * scoreError regardless of what its charts do — see test/bench-run-task.test.ts's
 * "reports a missing answer_position" case for that half). A chart failure
 * is recorded into diagnostics.chartErrors and must never crash the task or
 * cost it its (separately-scored) edits.
 */

const inputBytes = xlsxBytes({
  Data: [
    ["Quarter", "Revenue"],
    ["Q1", 10],
    ["Q2", 20],
    ["Q3", 30],
  ],
});

// A real (if trivial) golden — matches how scripts/benchmark.ts always has
// one on disk for every task, Visualization included (only the answer
// position, not the golden file itself, is absent for that category).
const goldenBytes = inputBytes;

const task: BenchTask = {
  id: "viz-1",
  instruction: "Chart quarterly revenue as a column chart.",
  spreadsheetPath: "spreadsheet/viz-1/input.xlsx",
  goldenResponsePath: "spreadsheet/viz-1/answer.xlsx",
  // Visualization tasks carry no answer_position in the real dataset.
  answerPosition: undefined,
  mode: { withFormula: false, withFontColor: false },
};

const stub = (plan: unknown): InferFn => async ({ schema }) => ({
  value: schema.parse(plan),
  attempts: 1,
  usage: { input: 100, output: 50 },
});

describe("runBenchTask: chart application", () => {
  it("splices a chart into the output file and reports no chartErrors", async () => {
    const result = await runBenchTask({
      task,
      inputBytes,
      goldenBytes,
      category: "Visualization",
      infer: stub({
        edits: [],
        charts: [
          {
            chartType: "column",
            title: "Quarterly Revenue",
            sheet: "Data",
            anchor: { cell: "D2" },
            series: [{ name: "Revenue", categories: { ref: "A2:A4" }, values: { ref: "B2:B4" } }],
          },
        ],
        notes: "added a column chart",
      }),
    });

    expect(result.planError).toBeUndefined();
    expect(result.diagnostics.chartErrors).toEqual([]);
    // Visualization tasks are VLM-judged, not scored locally.
    expect(result.score).toBeNull();
    expect(result.scoreError).toBe("Visualization is VLM-judged by the official evaluator; not scored locally");

    const zip = unzipSync(result.outputBytes);
    expect(Object.keys(zip)).toContain("xl/charts/chart1.xml");
    expect(Object.keys(zip)).toContain("xl/drawings/drawing1.xml");
    expect(new TextDecoder().decode(zip["xl/charts/chart1.xml"])).toContain("<c:barChart>");
  });

  it("leaves the output bytes untouched (input unchanged) when the plan has no charts", async () => {
    const result = await runBenchTask({
      task,
      inputBytes,
      goldenBytes,
      category: "Visualization",
      infer: stub({ edits: [], charts: [], notes: "nothing to do" }),
    });
    expect(result.diagnostics.chartErrors).toEqual([]);
    const zip = unzipSync(result.outputBytes);
    expect(Object.keys(zip)).not.toContain("xl/charts/chart1.xml");
  });

  it("applies real data-prep edits AND a chart in the same plan", async () => {
    const result = await runBenchTask({
      task,
      inputBytes,
      goldenBytes,
      category: "Visualization",
      infer: stub({
        edits: [{ sheet: "Data", range: "C2:C4", formula: "=B2*1.1" }],
        charts: [
          {
            chartType: "line",
            sheet: "Data",
            anchor: { cell: "E2" },
            series: [{ categories: { ref: "A2:A4" }, values: { ref: "C2:C4" } }],
          },
        ],
        notes: "grew revenue 10% then charted it",
      }),
    });
    expect(result.diagnostics.chartErrors).toEqual([]);
    expect(result.diagnostics.editedCellCount).toBe(3);
    const zip = unzipSync(result.outputBytes);
    expect(Object.keys(zip)).toContain("xl/charts/chart1.xml");
    // The edit itself landed too — this is not an either/or path.
    const sheetXml = new TextDecoder().decode(zip["xl/worksheets/sheet1.xml"]);
    expect(sheetXml).toContain("C2");
  });

  it("records a chart failure into diagnostics.chartErrors without crashing the task or losing the un-charted output", async () => {
    // A chart declared on a brand-new sheet that no edit ever populates:
    // buildOutputXlsx's own "no actual actions" rule (lib/plan/output.ts)
    // means the new sheet never actually lands in the output zip, so
    // injectCharts — which only knows about REAL zip parts, not a plan's
    // newSheets declaration — cannot find "Chart Sheet" and throws. A real,
    // reachable failure mode, not a contrived one.
    const result = await runBenchTask({
      task,
      inputBytes,
      goldenBytes,
      category: "Visualization",
      infer: stub({
        edits: [],
        newSheets: ["Chart Sheet"],
        charts: [
          {
            chartType: "pie",
            sheet: "Chart Sheet",
            anchor: { cell: "A1" },
            series: [{ categories: { values: ["A", "B"] }, values: { values: [1, 2] } }],
          },
        ],
        notes: "chart on an empty new sheet",
      }),
    });

    expect(result.planError).toBeUndefined();
    expect(result.diagnostics.chartErrors).toHaveLength(1);
    expect(result.diagnostics.chartErrors[0]).toMatch(/Chart Sheet/);
    // The task's output is still exactly the (un-charted, unmodified) input —
    // a chart failure never costs a task its otherwise-valid output.
    expect(result.outputBytes).toBe(inputBytes);
  });
});
