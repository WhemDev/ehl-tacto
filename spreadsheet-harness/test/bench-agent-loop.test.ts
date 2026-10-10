import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { runAgentLoop, type AgentTurn } from "@/lib/bench/agent-loop";
import { SUBMIT_TOOL } from "@/lib/bench/agent-tools";
import { benchAgentUserMessage, INCOMPLETE_AREAS_HEADER } from "@/lib/bench/prompts";
import { buildDigests } from "@/lib/digest";
import { parseWorkbook, type ParsedWorkbook } from "@/lib/workbook";
import { chainWb, xlsxBytes } from "./helpers/workbooks";

const usage = { input: 10, output: 5, cacheRead: 0, cacheCreation: 0 };

function toolUse(name: string, input: unknown, id = `tu_${name}_${Math.random().toString(36).slice(2, 8)}`): Anthropic.ContentBlock {
  return { type: "tool_use", id, name, input } as Anthropic.ContentBlock;
}
function text(t: string): Anthropic.ContentBlock {
  return { type: "text", text: t, citations: null } as Anthropic.ContentBlock;
}
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

const goodPlan = {
  edits: [{ sheet: "Calc", range: "D1", formula: "=A1+B1" }],
  newSheets: [],
  notes: "sum",
};

describe("runAgentLoop", () => {
  it("reads, submits clean, and returns the applied plan", async () => {
    // The first valid submit only ever gets a preview turn — a second,
    // identical submit is required to finalize.
    const s = scripted([
      [text("looking"), toolUse("read_range", { sheet: "Calc", range: "A1:C1" })],
      [toolUse(SUBMIT_TOOL, goodPlan)],
      [toolUse(SUBMIT_TOOL, goodPlan)],
    ]);
    const res = await runAgentLoop({ workbook: chainWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.plan).not.toBeNull();
    expect(res.applied).not.toBeNull();
    expect(res.planError).toBeUndefined();
    expect(res.diagnostics.submitOutcome).toBe("clean");
    expect(res.diagnostics.turns).toBe(3);
    expect(res.diagnostics.toolCalls).toEqual({ read_range: 1, [SUBMIT_TOOL]: 2 });
    expect(res.diagnostics.usage.input).toBe(30);
    // The read tool's result went back as a tool_result block.
    const secondSend = s.sent[1];
    const lastMsg = secondSend[secondSend.length - 1];
    expect(JSON.stringify(lastMsg.content)).toContain("A1=10");
  });

  it("feeds semantic validation errors back and accepts the corrected submit", async () => {
    const bad = { edits: [{ sheet: "Nope", range: "D1", formula: "=1" }], newSheets: [], notes: "" };
    const s = scripted([[toolUse(SUBMIT_TOOL, bad)], [toolUse(SUBMIT_TOOL, goodPlan)]]);
    const res = await runAgentLoop({ workbook: chainWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");
    // The error message named the unknown sheet.
    const secondSend = s.sent[1];
    expect(JSON.stringify(secondSend[secondSend.length - 1].content)).toContain("unknown sheet");
  });

  it("warns once on evaluation errors, then accepts a resubmission as final", async () => {
    const nameErr = {
      edits: [{ sheet: "Calc", range: "D1", formula: "=NOSUCHFN(A1)" }],
      newSheets: [], notes: "",
    };
    const s = scripted([[toolUse(SUBMIT_TOOL, nameErr)], [toolUse(SUBMIT_TOOL, nameErr)]]);
    const res = await runAgentLoop({ workbook: chainWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("warned");
    expect(res.plan).not.toBeNull();
    // The warning named the failing cell.
    expect(JSON.stringify(s.sent[1][s.sent[1].length - 1].content)).toContain("D1");
  });

  it("nudges once on end_turn without a submit, then records planError", async () => {
    const s = scripted([[text("done, I think")], [text("still nothing")]]);
    const res = await runAgentLoop({ workbook: chainWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.plan).toBeNull();
    expect(res.planError).toMatch(/without submitting/);
    expect(res.diagnostics.submitOutcome).toBe("planError");
  });

  it("uses the warned plan when the turn cap lands before a resubmission", async () => {
    const nameErr = {
      edits: [{ sheet: "Calc", range: "D1", formula: "=NOSUCHFN(A1)" }],
      newSheets: [], notes: "",
    };
    const s = scripted([
      [toolUse(SUBMIT_TOOL, nameErr)],
      [toolUse("read_range", { sheet: "Calc", range: "A1" })], // dithers instead of resubmitting
    ]);
    const res = await runAgentLoop({
      workbook: chainWb(), userMessage: "task", callTurn: s.callTurn, maxTurns: 2,
    });
    expect(res.diagnostics.submitOutcome).toBe("capped");
    expect(res.plan).not.toBeNull(); // the warned plan
    expect(res.applied).not.toBeNull();
  });

  it("previews computed cell values on the first valid submit and flags the next as final", async () => {
    const s = scripted([[toolUse(SUBMIT_TOOL, goodPlan)], [toolUse(SUBMIT_TOOL, goodPlan)]]);
    const res = await runAgentLoop({ workbook: chainWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");
    // The tool_result sent back after the FIRST submit (i.e. what's in the
    // message list going into the second callTurn) previews D1's computed
    // value (A1+B1 = 10+20 = 30) and warns that the next submit is final.
    const afterFirstSubmit = s.sent[1];
    const previewText = JSON.stringify(afterFirstSubmit[afterFirstSubmit.length - 1].content);
    expect(previewText).toContain("D1 = 30");
    expect(previewText).toContain("Your next submit is final.");
  });

  it("finalizes on the second submit even when it differs from the first", async () => {
    const otherPlan = {
      edits: [{ sheet: "Calc", range: "D1", formula: "=A1+C1" }],
      newSheets: [],
      notes: "different formula",
    };
    const s = scripted([[toolUse(SUBMIT_TOOL, goodPlan)], [toolUse(SUBMIT_TOOL, otherPlan)]]);
    const res = await runAgentLoop({ workbook: chainWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");
    // coverage defaults to [] — this task's userMessage never triggers the
    // completeness map (see the "coverage" describe block below).
    expect(res.plan).toEqual({ ...otherPlan, coverage: [], charts: [] });
  });
});

describe("runAgentLoop returned `messages`", () => {
  // Submission-grade inference logging (see scripts/benchmark.ts's JSONL
  // writer) reads AgentLoopResult.messages — the loop's own message array,
  // exposed at return time rather than rebuilt from scratch. These tests pin
  // its shape and, separately, pin that exposing it changed nothing about
  // what callTurn itself is ever handed.

  it("contains the first user message, every assistant tool_use turn, and every tool_result, in order", async () => {
    const s = scripted([
      [text("looking"), toolUse("read_range", { sheet: "Calc", range: "A1:C1" })],
      [toolUse(SUBMIT_TOOL, goodPlan)],
      [toolUse(SUBMIT_TOOL, goodPlan)],
    ]);
    const res = await runAgentLoop({ workbook: chainWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");

    // 1: initial user task message. 2: first assistant turn (text + read
    // tool_use). 3: that tool's tool_result. 4: second assistant turn (first
    // submit). 5: the preview tool_result. 6: third assistant turn (second,
    // finalizing submit) — the loop returns as soon as this submit is
    // accepted, so no seventh, trailing tool_result for it.
    expect(res.messages).toHaveLength(6);

    expect(res.messages[0]).toEqual({ role: "user", content: [{ type: "text", text: "task" }] });

    expect(res.messages[1].role).toBe("assistant");
    const firstAssistant = res.messages[1].content as Anthropic.ContentBlockParam[];
    expect(firstAssistant.some((b) => b.type === "tool_use" && (b as Anthropic.ToolUseBlock).name === "read_range")).toBe(true);

    expect(res.messages[2].role).toBe("user");
    const firstToolResult = res.messages[2].content as Anthropic.ToolResultBlockParam[];
    expect(firstToolResult[0].type).toBe("tool_result");
    expect(JSON.stringify(firstToolResult[0].content)).toContain("A1=10");

    expect(res.messages[3].role).toBe("assistant");
    const secondAssistant = res.messages[3].content as Anthropic.ContentBlockParam[];
    expect(secondAssistant.some((b) => b.type === "tool_use" && (b as Anthropic.ToolUseBlock).name === SUBMIT_TOOL)).toBe(true);

    expect(res.messages[4].role).toBe("user");
    expect((res.messages[4].content as Anthropic.ToolResultBlockParam[])[0].type).toBe("tool_result");

    expect(res.messages[5].role).toBe("assistant");
    const thirdAssistant = res.messages[5].content as Anthropic.ContentBlockParam[];
    expect(thirdAssistant.some((b) => b.type === "tool_use" && (b as Anthropic.ToolUseBlock).name === SUBMIT_TOOL)).toBe(true);
  });

  it("includes the final assistant turn even on the double-nudge exit, without changing what callTurn was ever sent", async () => {
    // Before this feature, the second (already-nudged) end_turn's own
    // assistant content was silently dropped — the loop returned without
    // ever pushing it. This is the fix's own regression test, paired with a
    // byte-identity pin on `s.sent` proving the fix only touches what gets
    // RETURNED, never what callTurn is handed (there is no third callTurn
    // call for the push to leak into).
    const turn0 = [text("done, I think")];
    const turn1 = [text("still nothing")];
    const s = scripted([turn0, turn1]);
    const res = await runAgentLoop({ workbook: chainWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("planError");

    expect(s.sent).toHaveLength(2);
    // Byte-identity pin: what the FIRST callTurn call saw — just the
    // initial user message.
    expect(s.sent[0]).toEqual([{ role: "user", content: [{ type: "text", text: "task" }] }]);
    // Byte-identity pin: what the SECOND callTurn call saw — the first
    // turn's assistant echo plus the one-time nudge. Still exactly these 3
    // messages; the second turn's own content is NOT here, because it gets
    // pushed only after this call already returned its response.
    expect(s.sent[1]).toEqual([
      { role: "user", content: [{ type: "text", text: "task" }] },
      { role: "assistant", content: turn0 },
      {
        role: "user",
        content: [{
          type: "text",
          text: `You have not submitted an edit plan. Call ${SUBMIT_TOOL} now with your final plan — the task is scored on it.`,
        }],
      },
    ]);

    // The RETURNED messages array — never sent to callTurn a third time —
    // now carries that final assistant turn too.
    expect(res.messages).toHaveLength(4);
    expect(res.messages[3]).toEqual({ role: "assistant", content: turn1 });
  });
});

describe("runAgentLoop coverage of the incomplete-areas map", () => {
  // A single genuine row-gap: "Metric"'s D2:E2 is blank while both
  // neighboring rows are fully populated across A:E. findIncompleteAreas
  // finds exactly one area here (row-gap outranks the sequence-gap that
  // also fires on "1, 2" — see analysis-completeness.test.ts's "merging"
  // case for the same tie-break) and assigns it id "A1".
  function gapWb(): ParsedWorkbook {
    return parseWorkbook(
      xlsxBytes({
        Calc: [
          ["Ref", 1, 2, 3, 4],
          ["Metric", 1, 2, null, null],
          ["Ref2", 1, 2, 3, 4],
        ],
      }),
      "gap.xlsx",
    );
  }

  // Contains both the deterministic trigger phrase (hasCompletionTrigger) AND
  // the INCOMPLETE_AREAS_HEADER, the same way benchAgentUserMessage's
  // assembled first user message would (prompts.ts only injects the section
  // when the trigger matches, so a real assembled message always carries
  // both together) — enforceCoverage now requires both, see agent-loop.ts.
  const TRIGGER_MSG =
    `${INCOMPLETE_AREAS_HEADER} (1)\n\nA1: Calc!D2:E2 [row-gap] row filled A, blank D:E\n\n` +
    "----------------------------------------\n\n" +
    "THE TASK\n\nComplete the financial model based on the provided assumptions. Fill Metric's forecast.";

  const coveredPlan = {
    edits: [{ sheet: "Calc", range: "D2:E2", value: 9 }],
    newSheets: [],
    notes: "filled the gap",
    coverage: [{ area_id: "A1", action: "edited", reason: "" }],
  };

  it("rejects a submit missing coverage for a known area, without spending the preview slot, then previews and finalizes the corrected submit", async () => {
    const uncovered = { ...coveredPlan, coverage: [] };
    const s = scripted([
      [toolUse(SUBMIT_TOOL, uncovered)], // 1: missing "A1" -> corrective feedback
      [toolUse(SUBMIT_TOOL, coveredPlan)], // 2: now covered -> first valid submit -> preview
      [toolUse(SUBMIT_TOOL, coveredPlan)], // 3: resubmit -> final
    ]);
    const res = await runAgentLoop({ workbook: gapWb(), userMessage: TRIGGER_MSG, callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");
    expect(res.diagnostics.turns).toBe(3);

    // The corrective feedback named the missing area and never touched the
    // engine — no computed values appear, proving the preview slot was not
    // spent on the bad submit.
    const afterFirst = s.sent[1][s.sent[1].length - 1];
    const firstText = JSON.stringify(afterFirst.content);
    expect(firstText).toContain("A1");
    expect(firstText).toContain("missing coverage");
    expect(firstText).not.toContain("Calc!D2");

    // The corrected (second) submit is the one that gets the values preview.
    const afterSecond = s.sent[2][s.sent[2].length - 1];
    expect(JSON.stringify(afterSecond.content)).toContain("Calc!D2 = 9");
  });

  it("rejects an unknown area id, then accepts the corrected submit", async () => {
    const bogus = { ...coveredPlan, coverage: [{ area_id: "A99", action: "edited", reason: "" }] };
    const s = scripted([[toolUse(SUBMIT_TOOL, bogus)], [toolUse(SUBMIT_TOOL, coveredPlan)]]);
    const res = await runAgentLoop({ workbook: gapWb(), userMessage: TRIGGER_MSG, callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");

    const afterFirst = s.sent[1][s.sent[1].length - 1];
    const text = JSON.stringify(afterFirst.content);
    expect(text).toContain("A99");
    expect(text).toContain("not an id");
    // "A1" is still unaccounted for in the bogus submit — both problems are reported together.
    expect(text).toContain("missing coverage");
  });

  it('rejects a "skipped" area with an empty reason, then accepts a corrected submit', async () => {
    const noReason = { ...coveredPlan, coverage: [{ area_id: "A1", action: "skipped", reason: "" }] };
    const skippedWithReason = {
      ...coveredPlan,
      edits: [],
      coverage: [{ area_id: "A1", action: "skipped", reason: "row is a subtotal the golden also leaves blank" }],
    };
    const s = scripted([[toolUse(SUBMIT_TOOL, noReason)], [toolUse(SUBMIT_TOOL, skippedWithReason)]]);
    const res = await runAgentLoop({ workbook: gapWb(), userMessage: TRIGGER_MSG, callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");

    const afterFirst = s.sent[1][s.sent[1].length - 1];
    expect(JSON.stringify(afterFirst.content)).toContain("reason");
  });

  it("ignores coverage entirely when the trigger phrase is absent from the task", async () => {
    // Same workbook (a real gap exists — findIncompleteAreas would find
    // "A1" if asked) but an instruction that never triggers the map: an
    // empty/absent coverage is not validated at all, and the submit
    // pipeline behaves exactly as it does without this feature.
    const plan = { edits: [{ sheet: "Calc", range: "D2:E2", value: 9 }], newSheets: [], notes: "", coverage: [] };
    const s = scripted([[toolUse(SUBMIT_TOOL, plan)], [toolUse(SUBMIT_TOOL, plan)]]);
    const res = await runAgentLoop({
      workbook: gapWb(),
      userMessage: "Fill Metric's forecast for the missing quarters.",
      callTurn: s.callTurn,
    });
    expect(res.diagnostics.submitOutcome).toBe("clean");
    expect(res.diagnostics.turns).toBe(2); // no corrective round — coverage was never checked
  });

  it("ignores coverage when the trigger phrase appears without the INCOMPLETE AREAS header — e.g. from grid content, not prompts.ts's own injection", async () => {
    // Same workbook (a real gap exists) and the trigger phrase IS present,
    // but the INCOMPLETE_AREAS_HEADER that prompts.ts actually injects the
    // area list under is NOT — the hardening this block exists for:
    // hasCompletionTrigger alone is not a reliable enough signal, since the
    // phrase could appear anywhere in the assembled message (a grid cell's
    // own text, say) even when benchAgentUserMessage never injected a list
    // for this task.
    const plan = { edits: [{ sheet: "Calc", range: "D2:E2", value: 9 }], newSheets: [], notes: "", coverage: [] };
    const s = scripted([[toolUse(SUBMIT_TOOL, plan)], [toolUse(SUBMIT_TOOL, plan)]]);
    const res = await runAgentLoop({
      workbook: gapWb(),
      userMessage: "Complete the financial model based on the provided assumptions.",
      callTurn: s.callTurn,
    });
    expect(res.diagnostics.submitOutcome).toBe("clean");
    expect(res.diagnostics.turns).toBe(2); // no corrective round — coverage was never checked
  });

  it("ignores coverage for a category-gated task even though the instruction carries the trigger phrase — Template reusing Financial_Model's boilerplate opener", async () => {
    // Fix 6's amendment: prompts.ts's injection gate is now category AND
    // phrase (isCompletionScope), not phrase alone — a Template instruction
    // can legitimately reuse Financial_Model's exact opener ("Complete the
    // financial model based on the provided assumptions...") without
    // Template's grading being whole-workbook (see .superpowers/sdd/reports/
    // fix6-scope-modes.md for the measured cell-diff evidence). Unlike the
    // test above, this one drives the REAL benchAgentUserMessage output —
    // category "Template" — rather than a hand-built string, so it proves
    // the amendment end to end: prompts.ts's category gate flows through to
    // agent-loop.ts's enforceCoverage purely via the header's absence from
    // the assembled message, with agent-loop.ts itself unchanged.
    const wb = gapWb();
    const digests = buildDigests([wb]);
    const instruction = "Complete the financial model based on the provided assumptions. Fill Metric's forecast.";
    const userMessage = benchAgentUserMessage(digests, wb, instruction, "Template");
    expect(userMessage).toContain("SCOPE");
    expect(userMessage).not.toContain(INCOMPLETE_AREAS_HEADER);

    const plan = { edits: [{ sheet: "Calc", range: "D2:E2", value: 9 }], newSheets: [], notes: "", coverage: [] };
    const s = scripted([[toolUse(SUBMIT_TOOL, plan)], [toolUse(SUBMIT_TOOL, plan)]]);
    const res = await runAgentLoop({ workbook: wb, userMessage, callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");
    expect(res.diagnostics.turns).toBe(2); // no corrective round — coverage was never checked
  });
});

describe("runAgentLoop axis-extension warning", () => {
  // See lib/bench/axis-check.ts and test/bench-axis-check.test.ts for the
  // orphaned-column rule these tests wire in; these only check that the
  // loop reaches into it at the right moment (the first-submit preview) and
  // appends its text.
  function d(iso: string): Date {
    return new Date(`${iso}T00:00:00Z`);
  }
  function annualAxis(startYear: number, count: number): Date[] {
    return Array.from({ length: count }, (_, i) => d(`${startYear + i}-03-31`));
  }
  /** Two sheets sharing one 3-column annual axis at row 1, A1:C1 (ends
   *  2030-03-31, endCol "C", next column "D"). Sheet1's D column has real
   *  data below the header row (D2, D3) but nothing at or above it — an
   *  orphaned column, the same shape the real Working Capital Schedule!M
   *  column has in Financial_Model/01_02. Sheet2 is a neutral cluster-mate
   *  whose D column stays empty, so it's never itself flagged. */
  function axisWb(): ParsedWorkbook {
    const dates = annualAxis(2028, 3);
    return parseWorkbook(
      xlsxBytes({
        Sheet1: [dates, [null, null, null, 10], [null, null, null, 20]],
        Sheet2: [dates, [1, 2, 3]],
      }),
      "axis.xlsx",
    );
  }

  it("appends the axis warning to the first-submit preview when an axis-sharing sheet has an orphaned column", async () => {
    // An edit unrelated to the orphan — the model is doing other work and
    // hasn't touched Sheet1's D column at all.
    const unrelated = { edits: [{ sheet: "Sheet2", range: "B2", value: 99 }], newSheets: [], notes: "" };
    const s = scripted([[toolUse(SUBMIT_TOOL, unrelated)], [toolUse(SUBMIT_TOOL, unrelated)]]);
    const res = await runAgentLoop({ workbook: axisWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");

    const afterFirst = s.sent[1][s.sent[1].length - 1];
    const block = (afterFirst.content as Anthropic.ToolResultBlockParam[])[0];
    expect(block.is_error).toBeUndefined(); // a warning, not a rejection — nothing was consumed or blocked
    const text = JSON.stringify(block.content);
    expect(text).toContain("Axis check:");
    expect(text).toContain("'Sheet1'!D1");
    expect(text).toContain("D2, D3");
    // Prescriptive wording (see axis-check.ts's doc comment on
    // axisExtensionWarning: a live-run result showed the original
    // conditional phrasing invited a model to write a text label into the
    // header cell instead of a date) reaches the model end-to-end through
    // the loop, not just in the unit-level function.
    expect(text).toContain("Write the next period into each flagged cell now");
    expect(text).toContain("never write a text label into a period-axis header cell");
    expect(text).not.toContain("If a flagged column is a live forecast period");

    // Second submit (same plan) still finalizes exactly as before — the
    // warning never touches the second-submit path.
    expect(res.plan).toEqual({ ...unrelated, coverage: [], charts: [] });
  });

  it("does not warn once the plan fills in the orphaned header cell", async () => {
    const fills = { edits: [{ sheet: "Sheet1", range: "D1", value: 99 }], newSheets: [], notes: "adds FY2031" };
    const s = scripted([[toolUse(SUBMIT_TOOL, fills)], [toolUse(SUBMIT_TOOL, fills)]]);
    const res = await runAgentLoop({ workbook: axisWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");
    const afterFirst = s.sent[1][s.sent[1].length - 1];
    expect(JSON.stringify(afterFirst.content)).not.toContain("Axis check:");
  });

  it("does not warn when the shared axis has no orphaned column", async () => {
    const dates = annualAxis(2028, 3);
    const noOrphan = parseWorkbook(
      xlsxBytes({ Sheet1: [dates, [1, 2, 3]], Sheet2: [dates, [4, 5, 6]] }), // both D columns empty
      "no-orphan.xlsx",
    );
    const edit = { edits: [{ sheet: "Sheet1", range: "B2", value: 5 }], newSheets: [], notes: "" };
    const s = scripted([[toolUse(SUBMIT_TOOL, edit)], [toolUse(SUBMIT_TOOL, edit)]]);
    const res = await runAgentLoop({ workbook: noOrphan, userMessage: "task", callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");
    const afterFirst = s.sent[1][s.sent[1].length - 1];
    expect(JSON.stringify(afterFirst.content)).not.toContain("Axis check:");
  });

  it("never warns on a workbook with no shared period axis — loop behaves exactly as before", async () => {
    const s = scripted([[toolUse(SUBMIT_TOOL, goodPlan)], [toolUse(SUBMIT_TOOL, goodPlan)]]);
    const res = await runAgentLoop({ workbook: chainWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");
    const afterFirst = s.sent[1][s.sent[1].length - 1];
    const text = JSON.stringify(afterFirst.content);
    expect(text).not.toContain("Axis check:");
    expect(text).toContain("D1 = 30"); // unchanged from the pre-existing preview test above
  });
});

describe("runAgentLoop turn budget notice", () => {
  // See agent-loop.ts's turnBudgetNotice doc comment: a 20-task
  // Financial_Model expansion run (.superpowers/sdd/fm-expand.json) showed 7
  // tasks die at the turn cap having never called submit_edit_plan even
  // once — the model was never told how much runway was left. These tests
  // pin the notice's presence, numbers, and placement through the callTurn
  // seam (the injectable boundary), not the unexported helper directly.

  it("ends a read-only turn's last tool_result with the turn/tool-call budget and the not-yet-submitted reminder", async () => {
    const s = scripted([
      [toolUse("read_range", { sheet: "Calc", range: "A1:C1" })],
      [toolUse(SUBMIT_TOOL, goodPlan)],
      [toolUse(SUBMIT_TOOL, goodPlan)],
    ]);
    const res = await runAgentLoop({ workbook: chainWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");

    // What went INTO turn 2 — i.e. turn 1's tool_result, with the notice
    // this feature appends — is the last message of s.sent[1].
    const afterTurn1 = s.sent[1][s.sent[1].length - 1];
    const noticeText = JSON.stringify(afterTurn1.content);
    expect(noticeText).toContain("Turn 1/12");
    expect(noticeText).toContain("1/40 tool calls used");
    expect(noticeText).toContain("No plan submitted yet");
    // The read tool's own result is still there — the notice is appended
    // to it, not a replacement for it.
    expect(noticeText).toContain("A1=10");
  });

  it("switches to the finalize wording once a first valid submit has produced a pending preview", async () => {
    const s = scripted([[toolUse(SUBMIT_TOOL, goodPlan)], [toolUse(SUBMIT_TOOL, goodPlan)]]);
    const res = await runAgentLoop({ workbook: chainWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");

    const afterFirstSubmit = s.sent[1][s.sent[1].length - 1];
    const noticeText = JSON.stringify(afterFirstSubmit.content);
    expect(noticeText).toContain("Turn 1/12");
    expect(noticeText).toContain("1/40 tool calls used");
    expect(noticeText).toContain("A previewed plan is pending");
    expect(noticeText).toContain(`your next ${SUBMIT_TOOL} call is final`);
    // Phase 1's reminder is gone once a preview is pending.
    expect(noticeText).not.toContain("No plan submitted yet");
  });

  it("appends the notice only to the last tool_result of a multi-call turn, never as a separate message", async () => {
    const s = scripted([
      [
        toolUse("read_range", { sheet: "Calc", range: "A1" }),
        toolUse("read_range", { sheet: "Calc", range: "B1" }),
      ],
      [toolUse(SUBMIT_TOOL, goodPlan)],
      [toolUse(SUBMIT_TOOL, goodPlan)],
    ]);
    const res = await runAgentLoop({ workbook: chainWb(), userMessage: "task", callTurn: s.callTurn });
    expect(res.diagnostics.submitOutcome).toBe("clean");
    expect(res.diagnostics.toolCalls.read_range).toBe(2);

    // Exactly one user message carries turn 1's tool results (initial user
    // task message + turn 1's assistant echo + this one) — the notice never
    // grows the message list.
    const afterTurn1Messages = s.sent[1];
    expect(afterTurn1Messages).toHaveLength(3);
    const results = afterTurn1Messages[afterTurn1Messages.length - 1].content as Anthropic.ToolResultBlockParam[];
    // Exactly one tool_result per call — the notice mutates the last
    // entry's content in place rather than growing the array.
    expect(results).toHaveLength(2);
    expect(JSON.stringify(results[0].content)).not.toContain("Turn 1/12");
    expect(JSON.stringify(results[1].content)).toContain("Turn 1/12");
  });

  it("reflects overridden maxTurns/maxToolCalls (the small caps the test suite uses) in the notice", async () => {
    const s = scripted([
      [toolUse("read_range", { sheet: "Calc", range: "A1" })],
      [toolUse(SUBMIT_TOOL, goodPlan)],
      [toolUse(SUBMIT_TOOL, goodPlan)],
    ]);
    const res = await runAgentLoop({
      workbook: chainWb(), userMessage: "task", callTurn: s.callTurn, maxTurns: 5, maxToolCalls: 9,
    });
    expect(res.diagnostics.submitOutcome).toBe("clean");
    const afterTurn1 = s.sent[1][s.sent[1].length - 1];
    const noticeText = JSON.stringify(afterTurn1.content);
    expect(noticeText).toContain("Turn 1/5");
    expect(noticeText).toContain("1/9 tool calls used");
  });
});
