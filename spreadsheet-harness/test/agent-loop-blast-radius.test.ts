import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { runAgentLoop, type AgentTurn } from "@/lib/agent/loop";
import { SUBMIT_TOOL } from "@/lib/agent/tools";
import { parseWorkbook, type ParsedWorkbook } from "@/lib/workbook";
import { chainWb, xlsxBytes } from "./helpers/workbooks";

/**
 * Fix 1: the first-submit preview's blast-radius section (lib/agent/loop.ts,
 * buildValuePreview/buildBlastRadiusSection). Before this, the preview only
 * ever sampled the plan's OWN edited cells — the tally at the bottom
 * ("N cells edited; M evaluate to 0 or empty; K errors") iterated
 * applied.editedFormulas/editedValues alone, never applied.affectedKeys (see
 * lib/plan/edits.ts's doc: affectedKeys is the edit's full downstream
 * closure through the dependency graph). Real failure this caused: bench
 * task 20_02, where an edit rippled through a SUMIF into an equity-plug
 * formula and silently rewrote 479 untouched cells — including
 * Summary!C62 from 1,207,046 to 0 — with nothing in the preview to show it.
 *
 * These tests script model turns through the same `callTurn` seam
 * test/bench-agent-loop.test.ts uses, in the same style, but import
 * lib/agent/loop.ts directly (this feature's actual home) rather than the
 * lib/bench/ historical shim.
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
 *  identical resubmit that finalizes) and returns the tool_result text the
 *  model saw after the FIRST submit — the preview under test. */
async function previewTextFor(workbook: ParsedWorkbook, plan: unknown): Promise<string> {
  const s = scripted([[toolUse(SUBMIT_TOOL, plan)], [toolUse(SUBMIT_TOOL, plan)]]);
  const res = await runAgentLoop({ workbook, userMessage: "task", callTurn: s.callTurn });
  expect(res.diagnostics.submitOutcome).toBe("clean");
  const afterFirstSubmit = s.sent[1];
  return JSON.stringify(afterFirstSubmit[afterFirstSubmit.length - 1].content);
}

// A1=100 (value), B1=A1*2 (cached 200, real), C1=A1+5 (cached 105, real) —
// two real downstream formulas, neither part of any edit.
function blastWb(): ParsedWorkbook {
  return parseWorkbook(
    xlsxBytes({
      Calc: [[100, { f: "A1*2", v: 200 }, { f: "A1+5", v: 105 }]],
    }),
    "blast.xlsx",
  );
}

// Same shape as blastWb, but C1 is uncalculated in the input (never cached a
// value — see test/helpers/workbooks.ts's CellSpec doc) rather than caching
// a real 105. It still recomputes to 0 post-edit, same as B1, but has no
// honest "was" value to report.
function blastWbWithUncalculated(): ParsedWorkbook {
  return parseWorkbook(
    xlsxBytes({
      Calc: [[100, { f: "A1*2", v: 200 }, { f: "A1*3", uncalculated: true }]],
    }),
    "blast-uncalculated.xlsx",
  );
}

describe("buildValuePreview blast-radius section", () => {
  it("shows a downstream cell that goes from a real value to 0, not itself in the plan", async () => {
    const plan = { edits: [{ sheet: "Calc", range: "A1", value: 0 }], newSheets: [], notes: "zero the input" };
    const text = await previewTextFor(blastWb(), plan);

    // Both B1 and C1 recomputed (neither was directly edited), so the total
    // count covers both even though only B1 is "alarming".
    expect(text).toContain("Beyond your edits, 2 downstream cells recomputed.");
    expect(text).toContain("Calc!B1: was 200 -> now 0");
    // C1 went from 105 to 5 — still a real, non-zero value — so it never
    // qualifies as "likely damage" and must not appear as a was/now line.
    expect(text).not.toContain("Calc!C1:");
  });

  it("says nothing when downstream cells recompute but none go to 0/empty/error (the 'prefer nothing' rule)", async () => {
    // chainWb: A1=10, B1=A1*2 (20), C1=B1+5 (25). Editing A1 up to 50
    // recomputes both B1 (100) and C1 (105) — real downstream recompute,
    // but neither empties out, so the whole section is omitted rather than
    // printing a bare, unhelpful count line.
    const plan = { edits: [{ sheet: "Calc", range: "A1", value: 50 }], newSheets: [], notes: "bump the input" };
    const text = await previewTextFor(chainWb(), plan);

    expect(text).not.toContain("Beyond your edits");
    expect(text).not.toContain("downstream cells recomputed");
    // The existing sampled-edit preview is untouched by this feature.
    expect(text).toContain("Calc!A1 = 50");
  });

  it("excludes an uncalculated downstream cell from the was/now list even though it also zeroes out", async () => {
    // C1 is uncalculated in the input (GridCell.uncalculated) — there is no
    // honest "was" value to show for it, so it must be left out of the
    // alarming list even though it recomputes to 0 exactly like B1 does.
    const plan = { edits: [{ sheet: "Calc", range: "A1", value: 0 }], newSheets: [], notes: "zero the input" };
    const text = await previewTextFor(blastWbWithUncalculated(), plan);

    // Both cells are still counted in the downstream total...
    expect(text).toContain("Beyond your edits, 2 downstream cells recomputed.");
    // ...but only the honestly-cached B1 gets a was/now line.
    expect(text).toContain("Calc!B1: was 200 -> now 0");
    expect(text).not.toContain("Calc!C1:");
  });

  it("leaves the existing preview byte-identical when the edit has no downstream cells at all", async () => {
    // The pre-existing coverage (test/bench-agent-loop.test.ts) already pins
    // this shape (goodPlan editing chainWb's leaf D1, nothing depends on
    // it) — restated here as this feature's own regression guard, so a
    // change to buildBlastRadiusSection can never silently start appending
    // text to a plan with a genuinely empty blast radius.
    const goodPlan = { edits: [{ sheet: "Calc", range: "D1", formula: "=A1+B1" }], newSheets: [], notes: "sum" };
    const text = await previewTextFor(chainWb(), goodPlan);
    expect(text).not.toContain("Beyond your edits");
    expect(text).toContain("D1 = 30");
    expect(text).toContain("Your next submit is final.");
  });
});
