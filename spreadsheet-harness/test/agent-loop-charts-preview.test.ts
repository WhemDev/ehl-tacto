import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { runAgentLoop, type AgentTurn } from "@/lib/agent/loop";
import { SUBMIT_TOOL } from "@/lib/agent/tools";
import { xlsxBytes } from "./helpers/workbooks";
import { parseWorkbook, type ParsedWorkbook } from "@/lib/workbook";

/**
 * Fix 3: the first-submit preview's chart summary (lib/agent/loop.ts,
 * buildValuePreview/buildChartsPreviewSection). Mirrors
 * test/agent-loop-blast-radius.test.ts's own scripted-`callTurn` style —
 * this is the same "mechanical verification a model can catch a wrong range
 * with before finalizing" pattern buildBlastRadiusSection established,
 * applied to `charts` instead of collateral cell damage.
 */

function toolUse(name: string, input: unknown, id = `tu_${name}_${Math.random().toString(36).slice(2, 8)}`): Anthropic.ContentBlock {
  return { type: "tool_use", id, name, input } as Anthropic.ContentBlock;
}

const usage = { input: 10, output: 5, cacheRead: 0, cacheCreation: 0 };

function scripted(turns: Anthropic.ContentBlock[][]) {
  const sent: Anthropic.MessageParam[][] = [];
  let i = 0;
  const callTurn = async (messages: Anthropic.MessageParam[]): Promise<AgentTurn> => {
    sent.push(structuredClone(messages));
    const content = turns[Math.min(i++, turns.length - 1)];
    const stopReason = content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
    return { content, stopReason, usage };
  };
  return { callTurn, sent };
}

/** Returns the RAW tool_result text the model saw after the first submit
 *  (not JSON-stringified — unlike test/agent-loop-blast-radius.test.ts's own
 *  helper, since this section's assertions match literal double-quoted
 *  chart titles/series names, which JSON.stringify would otherwise escape). */
async function previewTextFor(workbook: ParsedWorkbook, plan: unknown): Promise<string> {
  const s = scripted([[toolUse(SUBMIT_TOOL, plan)], [toolUse(SUBMIT_TOOL, plan)]]);
  const res = await runAgentLoop({ workbook, userMessage: "task", callTurn: s.callTurn });
  expect(res.diagnostics.submitOutcome).toBe("clean");
  const afterFirstSubmit = s.sent[1];
  const content = afterFirstSubmit[afterFirstSubmit.length - 1].content as Anthropic.ToolResultBlockParam[];
  return String(content[0].content);
}

// Quarter labels in A2:A4, revenue in B2:B4 — matched 3x3 ranges, the clean
// (no-mismatch) case.
function chartWb(): ParsedWorkbook {
  return parseWorkbook(
    xlsxBytes({
      Data: [
        ["Quarter", "Revenue"],
        ["Q1", 10],
        ["Q2", 20],
        ["Q3", 30],
      ],
    }),
    "chart.xlsx",
  );
}

describe("buildValuePreview charts section", () => {
  it("summarizes type, title, series count, resolved range sizes, and target sheet+anchor", async () => {
    const plan = {
      edits: [],
      charts: [
        {
          chartType: "column",
          title: "Quarterly Revenue",
          sheet: "Data",
          anchor: { cell: "D2", widthCols: 6, heightRows: 10 },
          series: [{ name: "Revenue", categories: { ref: "A2:A4" }, values: { ref: "B2:B4" } }],
        },
      ],
      notes: "chart it",
    };
    const text = await previewTextFor(chartWb(), plan);

    expect(text).toContain("1 chart(s) in this plan:");
    expect(text).toContain('1. column "Quarterly Revenue" — 1 series, on Data!D2 (6x10 cells)');
    expect(text).toContain('"Revenue": categories 3 cells, values 3 cells');
    expect(text).not.toContain("MISMATCH");
  });

  it("flags a categories/values range-size mismatch", async () => {
    const plan = {
      edits: [],
      charts: [
        {
          chartType: "line",
          sheet: "Data",
          anchor: { cell: "D2" },
          series: [{ name: "Revenue", categories: { ref: "A2:A4" }, values: { ref: "B2:B3" } }], // 3 vs 2
        },
      ],
      notes: "mismatched ranges",
    };
    const text = await previewTextFor(chartWb(), plan);
    expect(text).toContain("categories 3 cells, values 2 cells");
    expect(text).toContain("[MISMATCH: categories 3 vs values 2]");
  });

  it("counts literal `values` arrays the same way as resolved refs, still catching a mismatch", async () => {
    const plan = {
      edits: [],
      charts: [
        {
          chartType: "bar",
          sheet: "Data",
          anchor: { cell: "D2" },
          series: [{ categories: { values: ["A", "B", "C"] }, values: { values: [1, 2] } }],
        },
      ],
      notes: "literal data",
    };
    const text = await previewTextFor(chartWb(), plan);
    expect(text).toContain("categories 3 cells, values 2 cells");
    expect(text).toContain("[MISMATCH: categories 3 vs values 2]");
  });

  it("uses xValues (not categories) as the mismatch axis for a scatter chart", async () => {
    const plan = {
      edits: [],
      charts: [
        {
          chartType: "scatter",
          sheet: "Data",
          anchor: { cell: "D2" },
          series: [{ xValues: { ref: "A2:A4" }, values: { ref: "B2:B3" } }], // 3 vs 2
        },
      ],
      notes: "scatter",
    };
    const text = await previewTextFor(chartWb(), plan);
    expect(text).toContain("xValues 3 cells, values 2 cells");
    expect(text).toContain("[MISMATCH: xValues 3 vs values 2]");
  });

  it("labels a series without a name by its 1-based position", async () => {
    const plan = {
      edits: [],
      charts: [
        {
          chartType: "column",
          sheet: "Data",
          anchor: { cell: "D2" },
          series: [{ categories: { ref: "A2:A4" }, values: { ref: "B2:B4" } }],
        },
      ],
      notes: "unnamed series",
    };
    const text = await previewTextFor(chartWb(), plan);
    expect(text).toContain('"series 1": categories 3 cells, values 3 cells');
  });

  it("adds nothing to the preview when the plan has no charts", async () => {
    const plan = { edits: [{ sheet: "Data", range: "C1", value: "x" }], newSheets: [], notes: "no chart here" };
    const text = await previewTextFor(chartWb(), plan);
    expect(text).not.toContain("chart(s) in this plan");
  });
});
