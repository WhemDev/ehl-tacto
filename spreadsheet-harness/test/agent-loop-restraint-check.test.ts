import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { runAgentLoop, type AgentTurn } from "@/lib/agent/loop";
import { SUBMIT_TOOL } from "@/lib/agent/tools";
import { parseWorkbook, type GridCell, type ParsedSheet, type ParsedWorkbook } from "@/lib/workbook";
import type { ResolvedStyle } from "@/lib/workbook-styles";
import { xlsxBytes } from "./helpers/workbooks";

/**
 * lib/agent/restraint-check.ts wired into lib/agent/loop.ts's first-submit
 * preview: the loop-level half of the coverage split test/agent-restraint-
 * check.test.ts's own doc describes (unit tests there for the levers
 * themselves; this file, mirroring test/agent-loop-blast-radius.test.ts's
 * own structure, for "does the warning actually reach the model and never
 * interfere with is_error/finalize").
 */

function toolUse(name: string, input: unknown, id = `tu_${name}_${Math.random().toString(36).slice(2, 8)}`): Anthropic.ContentBlock {
  return { type: "tool_use", id, name, input } as Anthropic.ContentBlock;
}

const usage = { input: 10, output: 5, cacheRead: 0, cacheCreation: 0 };

/** Scripted model: yields the queued turns; records what it was sent. */
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

/** Runs `plan` through the loop twice (first-submit preview, then the
 *  identical resubmit that finalizes) and returns both the tool_result
 *  content string AND whether that first submit's result carried is_error —
 *  the two things a purely-additive warning must never touch. */
async function firstSubmitResult(
  workbook: ParsedWorkbook,
  plan: unknown,
): Promise<{ text: string; isError: boolean; submitOutcome: string }> {
  const s = scripted([[toolUse(SUBMIT_TOOL, plan)], [toolUse(SUBMIT_TOOL, plan)]]);
  const res = await runAgentLoop({ workbook, userMessage: "task", callTurn: s.callTurn });
  const afterFirstSubmit = s.sent[1];
  const lastMsg = afterFirstSubmit[afterFirstSubmit.length - 1];
  const block = (lastMsg.content as Anthropic.ToolResultBlockParam[])[0];
  return {
    text: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
    isError: block.is_error === true,
    submitOutcome: res.diagnostics.submitOutcome,
  };
}

// A headerless block (title row 1, double-blank separator rows 2-3, a
// column-less data block at row 4) — Lever 1's own shape (see
// restraint-check.ts's doc comment on the 03_01 mechanism this mirrors).
function uncorroboratedColumnWb(): ParsedWorkbook {
  return parseWorkbook(
    xlsxBytes({
      Sheet1: [
        [null, "Section"],
        [],
        [],
        [null, "Metric X"],
      ],
    }),
    "restraint-lever1.xlsx",
  );
}

// A hand-built workbook (styles have no XLSX-round-trip test helper — see
// test/agent-restraint-check.test.ts's own doc on why direct construction is
// used instead) carrying Lever 2's shape: two section-title rows sharing a
// bold/filled style, and a THIRD row with the identical style that the plan
// writes a value into.
function headerStyledRowWb(): ParsedWorkbook {
  const headerStyle: ResolvedStyle = { fill: "#4472C4", bold: true, color: "#FFFFFF" };
  const plainStyle: ResolvedStyle = { align: "left" };
  const cells = new Map<string, GridCell>([
    ["1:1", { row: 1, col: 1, value: "Section A", text: "Section A", type: "text", styleIdx: 0 }],
    ["3:1", { row: 3, col: 1, value: "Section B", text: "Section B", type: "text", styleIdx: 0 }],
    ["5:1", { row: 5, col: 1, value: "Loan Balance at Maturity", text: "Loan Balance at Maturity", type: "text", styleIdx: 0 }],
    ["7:1", { row: 7, col: 1, value: "Outstanding Principal", text: "Outstanding Principal", type: "text", styleIdx: 1 }],
  ]);
  const sheet: ParsedSheet = {
    name: "Sheet1",
    rows: 20,
    cols: 6,
    totalRows: 20,
    totalCols: 6,
    truncated: false,
    cells,
    merges: [],
    colWidths: [],
    styles: [headerStyle, plainStyle],
  };
  return { id: "wb", fileName: "restraint-lever2.xlsx", sheets: [sheet], definedNames: [] };
}

describe("restraint checks wired into the first-submit preview", () => {
  it("Lever 1's warning lands in the first-submit tool_result text", async () => {
    const plan = { edits: [{ sheet: "Sheet1", range: "C4", value: 42 }], newSheets: [], notes: "fill metric X" };
    const { text, isError } = await firstSubmitResult(uncorroboratedColumnWb(), plan);
    expect(text).toContain("Restraint check (uncorroborated column):");
    expect(text).toContain("Sheet1 column C row 4");
    expect(isError).toBe(false);
  });

  it("Lever 2's warning lands in the first-submit tool_result text", async () => {
    // Row 6 (1-based) = 0-based row 5 in headerStyledRowWb — the header-
    // styled "Loan Balance at Maturity" row.
    const plan = { edits: [{ sheet: "Sheet1", range: "C6", value: 999 }], newSheets: [], notes: "fill loan balance" };
    const { text, isError } = await firstSubmitResult(headerStyledRowWb(), plan);
    expect(text).toContain("Restraint check (header-styled row):");
    expect(text).toContain("Sheet1 row 6's label (B6) has this sheet's section-title styling");
    expect(isError).toBe(false);
  });

  it("never flips is_error — a clean plan that only trips a restraint warning still previews without is_error", async () => {
    const plan = { edits: [{ sheet: "Sheet1", range: "C4", value: 42 }], newSheets: [], notes: "fill metric X" };
    const { isError } = await firstSubmitResult(uncorroboratedColumnWb(), plan);
    expect(isError).toBe(false);
  });

  it("never blocks finalize — the identical second submit still ends the loop cleanly", async () => {
    const plan = { edits: [{ sheet: "Sheet1", range: "C4", value: 42 }], newSheets: [], notes: "fill metric X" };
    const s = scripted([[toolUse(SUBMIT_TOOL, plan)], [toolUse(SUBMIT_TOOL, plan)]]);
    const res = await runAgentLoop({ workbook: uncorroboratedColumnWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");
    expect(res.plan).not.toBeNull();
  });

  it("consumes no extra submit — the warning appears on the FIRST submit only, exactly like the axis check", async () => {
    const plan = { edits: [{ sheet: "Sheet1", range: "C4", value: 42 }], newSheets: [], notes: "fill metric X" };
    const s = scripted([[toolUse(SUBMIT_TOOL, plan)], [toolUse(SUBMIT_TOOL, plan)]]);
    await runAgentLoop({ workbook: uncorroboratedColumnWb(), userMessage: "task", callTurn: s.callTurn });
    // Exactly 2 turns were sent to the model: the initial user message, then
    // one round-trip after the first submit's preview — never a third asking
    // for yet another correction because of the warning alone.
    expect(s.sent).toHaveLength(2);
  });

  it("says nothing extra when neither lever finds anything — a plan editing an already-corroborated column stays warning-free", async () => {
    // Give the block its own local header (row 1) naming column C, so
    // Lever 1 has nothing to flag; no styled rows exist at all, so Lever 2
    // never engages either.
    const wb = parseWorkbook(
      xlsxBytes({
        Sheet1: [
          [null, "Metric", "FY2023"],
          [null, "Costs"],
        ],
      }),
      "restraint-clean.xlsx",
    );
    const plan = { edits: [{ sheet: "Sheet1", range: "C2", value: 10 }], newSheets: [], notes: "fill costs" };
    const { text } = await firstSubmitResult(wb, plan);
    expect(text).not.toContain("Restraint check");
  });
});
