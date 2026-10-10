import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { runAgentLoop, type AgentTurn } from "@/lib/agent/loop";
import { SUBMIT_TOOL } from "@/lib/agent/tools";
import { parseDatasetJson, type BenchTask } from "@/lib/bench/dataset";
import { runBenchTask, type InferFn } from "@/lib/bench/run-task";
import { parseWorkbook } from "@/lib/workbook";

/**
 * Phase 2 end-to-end proof: a scripted agent (the same `callTurn` seam every
 * other agent-loop test drives) submits a plan with one chart against a
 * REAL Visualization task's input file, and the whole pipeline — schema
 * validation, applyEditPlan, buildOutputXlsx, injectCharts, the first-submit
 * preview — runs exactly as it would with a real model. Same tolerance
 * test/charts-golden.test.ts already has for the dataset not being checked
 * into git (~250MB — see docs/spreadsheetbench.md): this whole suite no-ops
 * via `skipIf` when it is not present locally.
 *
 * Deliberately does NOT hardcode a specific task id or assume anything about
 * what any given task's real columns contain — Visualization tasks are not
 * scored by this harness (no answer_position), so this test only needs a
 * STRUCTURALLY valid chart against real cells, not a semantically correct
 * one. It picks the first task in the real dataset.json whose input file is
 * actually present on disk, and builds a chart from that file's own parsed
 * dimensions.
 */

const CATEGORY_DIR = join(process.cwd(), "data/spreadsheetbench-v2/Visualization");
const DATASET_JSON = join(CATEGORY_DIR, "dataset.json");
const HAVE_DATASET = existsSync(DATASET_JSON);

function firstRunnableTask(): { task: BenchTask; inputBytes: Uint8Array } | null {
  const tasks = parseDatasetJson(readFileSync(DATASET_JSON, "utf8"), "Visualization");
  for (const task of tasks) {
    const inputPath = join(CATEGORY_DIR, task.spreadsheetPath);
    if (existsSync(inputPath)) {
      return { task, inputBytes: new Uint8Array(readFileSync(inputPath)) };
    }
  }
  return null;
}

const picked = HAVE_DATASET ? firstRunnableTask() : null;

describe.skipIf(!HAVE_DATASET)("Visualization end to end: scripted agent submits a chart against a real task", () => {
  it("finds at least one runnable Visualization task on disk", () => {
    expect(picked).not.toBeNull();
  });

  it("splices a valid chart into the real output file with valid rels, and the preview shows the chart summary", async () => {
    if (!picked) throw new Error("no runnable Visualization task found — see the smoke test above");
    const { task, inputBytes } = picked;

    const workbook = parseWorkbook(inputBytes, "input.xlsx");
    const sheet = workbook.sheets[0];
    expect(sheet).toBeDefined();
    expect(sheet.cols).toBeGreaterThanOrEqual(2); // A real chart-source sheet has at least 2 columns.

    // A small, structurally valid range on the real sheet — rows 2..min(6,
    // sheet.rows), columns A (categories) and B (values). Content is
    // irrelevant: Visualization tasks are not scored by this harness, so
    // this proves the PIPELINE, not any particular chart's correctness.
    const endRow = Math.max(2, Math.min(sheet.rows, 6));
    const categoriesRef = `A2:A${endRow}`;
    const valuesRef = `B2:B${endRow}`;

    const chartPlan = {
      edits: [],
      newSheets: [],
      notes: "added a column chart per the instruction",
      charts: [
        {
          chartType: "column",
          title: "E2E Test Chart",
          sheet: sheet.name,
          anchor: { cell: "F2", widthCols: 8, heightRows: 15 },
          series: [{ name: "Series 1", categories: { ref: categoriesRef }, values: { ref: valuesRef } }],
        },
      ],
    };

    // The scripted model: first turn submits the chart plan (gets a
    // preview), second turn resubmits the identical plan to finalize — the
    // same preview-then-finalize contract every agent-loop test exercises.
    const turns: Anthropic.ContentBlock[][] = [
      [{ type: "tool_use", id: "tu_1", name: SUBMIT_TOOL, input: chartPlan } as Anthropic.ContentBlock],
      [{ type: "tool_use", id: "tu_2", name: SUBMIT_TOOL, input: chartPlan } as Anthropic.ContentBlock],
    ];
    let i = 0;
    const callTurn = async (): Promise<AgentTurn> => ({
      content: turns[i++],
      stopReason: "tool_use",
      usage: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
    });

    const goldenPath = join(CATEGORY_DIR, task.goldenResponsePath);
    const goldenBytes = existsSync(goldenPath) ? new Uint8Array(readFileSync(goldenPath)) : undefined;

    const result = await runBenchTask({
      task,
      inputBytes,
      goldenBytes,
      category: "Visualization",
      infer: (async () => { throw new Error("must not be called in agent mode"); }) as InferFn,
      agent: ({ workbook: wb, userMessage }) => {
        expect(userMessage).toContain("CHARTS");
        return runAgentLoop({ workbook: wb, userMessage, callTurn });
      },
    });

    expect(result.planError).toBeUndefined();
    expect(result.diagnostics.chartErrors).toEqual([]);
    // Visualization tasks are VLM-judged externally, never scored here.
    expect(result.score).toBeNull();
    expect(result.scoreError).toBe("Visualization is VLM-judged by the official evaluator; not scored locally");

    // 1. The output xlsx contains the chart part.
    const zip = unzipSync(result.outputBytes);
    const chartParts = Object.keys(zip).filter((k) => /^xl\/charts\/chart\d+\.xml$/.test(k));
    expect(chartParts.length).toBeGreaterThan(0);
    const chartXml = new TextDecoder().decode(zip[chartParts[0]]);
    expect(chartXml).toContain("<c:barChart>"); // "column" compiles to barChart + barDir=col
    expect(chartXml).toContain('<c:barDir val="col"/>');

    // 2. Valid rels: a drawing part's own .rels references the chart part,
    // and the chart's target sheet actually resolves to a real worksheet
    // part carrying a <drawing r:id="..."/> that in turn resolves (via the
    // sheet's own .rels) back to that same drawing part.
    const drawingRelsPaths = Object.keys(zip).filter((k) => /^xl\/drawings\/_rels\/drawing\d+\.xml\.rels$/.test(k));
    expect(drawingRelsPaths.length).toBeGreaterThan(0);
    const drawingRelsXml = new TextDecoder().decode(zip[drawingRelsPaths[0]]);
    expect(drawingRelsXml).toMatch(/Target="\.\.\/charts\/chart\d+\.xml"/);
    expect(drawingRelsXml).toContain(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
    );

    const drawingPath = drawingRelsPaths[0].replace("_rels/", "").replace(".rels", "");
    const worksheetPaths = Object.keys(zip).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
    const sheetsReferencingADrawing = worksheetPaths.filter((p) => {
      const xml = new TextDecoder().decode(zip[p]);
      const m = /<drawing\s+r:id="([^"]+)"\s*\/>/.exec(xml);
      if (!m) return false;
      const relsPath = p.replace("worksheets/", "worksheets/_rels/") + ".rels";
      const relsXml = zip[relsPath] ? new TextDecoder().decode(zip[relsPath]) : "";
      return relsXml.includes(drawingPath.split("/").pop()!);
    });
    expect(sheetsReferencingADrawing.length).toBeGreaterThan(0);

    // 3. The preview text (first-submit tool_result) included the chart
    // summary — mechanical verification the model would have seen.
    expect(result.transcript?.mode).toBe("tools");
    if (result.transcript?.mode !== "tools") throw new Error("expected a tools-mode transcript");
    // messages[0] is the initial user turn (digest+grid+task text, also
    // role "user" but NOT a tool_result) — the first REAL tool_result is the
    // second "user"-role message, right after the model's first submit.
    const userTurns = result.transcript.messages.filter((m) => m.role === "user");
    const firstPreview = userTurns[1]?.content;
    const previewText = Array.isArray(firstPreview)
      ? firstPreview.map((b) => ("content" in b ? String(b.content) : "")).join("\n")
      : String(firstPreview);
    expect(previewText).toContain("chart(s) in this plan");
    expect(previewText).toContain("column");
    expect(previewText).toContain(`${sheet.name}!F2`);
  }, 30_000);
});
