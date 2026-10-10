import { describe, expect, it } from "vitest";
import { buildDigests } from "@/lib/digest";
import { CHARTS_HEADER, benchAgentSystemPrompt, benchAgentUserMessage } from "@/lib/bench/prompts";
import { CATEGORIES } from "@/lib/bench/dataset";
import { parseWorkbook } from "@/lib/workbook";
import { xlsxBytes, type CellSpec } from "./helpers/workbooks";

/**
 * Covers the Visualization-category prompt additions:
 *  - benchAgentUserMessage appends a CHARTS section (instead of SCOPE)
 *    whenever category === "Visualization" — the fourth mutually exclusive
 *    section alongside INCOMPLETE AREAS / CANDIDATE BUGS / SCOPE.
 *  - benchAgentSystemPrompt gains a `category` parameter that appends chart
 *    guidance ONLY for that category; every other category's prompt (and
 *    the historical no-argument call) must stay byte-identical — pinned
 *    here as the FINAL GATE requires.
 */

function wbOf(sheets: Record<string, CellSpec[][]>) {
  return parseWorkbook(xlsxBytes(sheets), "viz.xlsx");
}

const SIMPLE_SHEET = { Data: [["Quarter", "Revenue"], ["Q1", 10], ["Q2", 20]] };
const CHART_INSTRUCTION = "Create a column chart of quarterly revenue with a legend at the bottom.";

describe("benchAgentUserMessage: CHARTS gating", () => {
  const wb = wbOf(SIMPLE_SHEET);
  const digests = buildDigests([wb]);

  it("Visualization category injects CHARTS, replacing SCOPE", () => {
    const msg = benchAgentUserMessage(digests, wb, CHART_INSTRUCTION, "Visualization");
    expect(msg).toContain(CHARTS_HEADER);
    expect(msg).toContain('"charts" array');
    expect(msg).not.toContain("SCOPE\n\nEdit ONLY the cells");
    expect(msg).not.toContain("INCOMPLETE AREAS");
    expect(msg).not.toContain("CANDIDATE BUGS");
  });

  it("documents the JSON-string encoding explicitly: each array entry is one JSON object, serialized as a string", () => {
    const msg = benchAgentUserMessage(digests, wb, CHART_INSTRUCTION, "Visualization");
    expect(msg).toContain("serialized as a STRING");
    expect(msg).toContain("JSON.stringify");
    // The worked example must still show the bare-object shape (type/title/
    // series with range refs/anchor) — the string-encoding instruction wraps
    // it, it does not replace it.
    expect(msg).toContain('"chartType": "line" | "column"');
    expect(msg).toContain('"title": "..."');
    expect(msg).toContain('"anchor": { "cell": "F2"');
    expect(msg).toContain('"categories": { "ref": "A2:A10" }');
  });

  it("mentions pointColors availability", () => {
    const msg = benchAgentUserMessage(digests, wb, CHART_INSTRUCTION, "Visualization");
    expect(msg).toContain("pointColors");
  });

  it("every non-Visualization category still gets SCOPE, never CHARTS", () => {
    for (const category of ["Debugging", "Financial_Model", "Template"] as const) {
      const msg = benchAgentUserMessage(digests, wb, "Fix the totals column.", category);
      expect(msg).not.toContain(CHARTS_HEADER);
      expect(msg).toContain("SCOPE");
    }
  });

  it("an unspecified category never injects CHARTS (no phrase-based fallback, unlike INCOMPLETE AREAS/CANDIDATE BUGS)", () => {
    const msg = benchAgentUserMessage(digests, wb, CHART_INSTRUCTION, undefined);
    expect(msg).not.toContain(CHARTS_HEADER);
    expect(msg).toContain("SCOPE");
  });

  it("INCOMPLETE AREAS still takes priority when both a completion phrase AND category collide (defensive; not a real dataset case)", () => {
    const fmInstruction =
      "Complete the financial model based on the provided assumptions. Ensure the existing structure is preserved.";
    const msg = benchAgentUserMessage(digests, wb, fmInstruction, "Financial_Model");
    expect(msg).toContain("INCOMPLETE AREAS");
    expect(msg).not.toContain(CHARTS_HEADER);
  });

  it("covers every dataset category exactly once with a section", () => {
    // Every real category must get exactly one of the four headers — a
    // structural sanity check that stays true even as new categories or
    // instructions are added.
    for (const category of CATEGORIES) {
      const msg = benchAgentUserMessage(digests, wb, "Do the task.", category);
      const headers = ["INCOMPLETE AREAS", "CANDIDATE BUGS", CHARTS_HEADER, "SCOPE"].filter((h) => msg.includes(h));
      expect(headers.length, `category ${category} matched ${JSON.stringify(headers)}`).toBe(1);
    }
  });
});

describe("benchAgentSystemPrompt: category parameter", () => {
  it("appends chart guidance only for category === \"Visualization\"", () => {
    const viz = benchAgentSystemPrompt("Visualization");
    expect(viz).toContain("CHART GUIDANCE");
    expect(viz).toContain('"charts" array');
  });

  it("is byte-identical across every non-Visualization category, undefined, and the historical no-argument call", () => {
    const baseline = benchAgentSystemPrompt();
    expect(benchAgentSystemPrompt(undefined)).toBe(baseline);
    for (const category of ["Debugging", "Financial_Model", "Template"] as const) {
      expect(benchAgentSystemPrompt(category)).toBe(baseline);
    }
    expect(baseline).not.toContain("CHART GUIDANCE");
  });

  it("the Visualization prompt is a strict superset: everything else stays, guidance is appended at the end", () => {
    const baseline = benchAgentSystemPrompt();
    const viz = benchAgentSystemPrompt("Visualization");
    expect(viz.startsWith(baseline)).toBe(true);
    expect(viz.length).toBeGreaterThan(baseline.length);
  });
});
