import type Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { runAgentLoop, type AgentTurn } from "@/lib/bench/agent-loop";
import { SUBMIT_TOOL } from "@/lib/bench/agent-tools";
import type { BenchTask } from "@/lib/bench/dataset";
import { benchAgentSystemPrompt, benchSystemPrompt } from "@/lib/bench/prompts";
import { EMPTY_PLAN, runBenchTask, type InferFn } from "@/lib/bench/run-task";
import { scoreTask } from "@/lib/bench/compare";
import { workbookReader } from "@/lib/bench/readers";
import { parseWorkbook } from "@/lib/workbook";

type CellSpec =
  | string
  | number
  | null
  | { f: string; v?: number | string }
  /** A formula cell whose source never cached a value — see
   *  test/helpers/workbooks.ts's xlsxBytes for why t:"z" (not a plain
   *  omitted v) is what survives an XLSX.write/XLSX.read round-trip as the
   *  real "uncached formula" shape. */
  | { f: string; uncalculated: true };

/** Real .xlsx bytes from a grid description, formulas with cached values. */
function xlsxBytes(sheets: Record<string, CellSpec[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const aoa = rows.map((row) =>
      row.map((c) => (typeof c === "object" && c !== null ? null : c)),
    );
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    rows.forEach((row, r) =>
      row.forEach((c, col) => {
        if (typeof c === "object" && c !== null) {
          const addr = XLSX.utils.encode_cell({ r, c: col });
          ws[addr] =
            "uncalculated" in c
              ? { t: "z", f: c.f }
              : { t: typeof c.v === "string" ? "s" : "n", f: c.f, v: c.v };
        }
      }),
    );
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

const inputBytes = xlsxBytes({
  Orders: [
    ["Qty", "Price", "Total", "Note"],
    [2, 10, null, "keep me"],
    [3, 20, null, null],
    [4, 30, null, null],
  ],
});

const goldenBytes = xlsxBytes({
  Orders: [
    ["Qty", "Price", "Total", "Note"],
    [2, 10, { f: "A2*B2", v: 20 }, "keep me"],
    [3, 20, { f: "A3*B3", v: 60 }, null],
    [4, 30, { f: "A4*B4", v: 120 }, null],
  ],
});

const task: BenchTask = {
  id: "42",
  instruction: "Fill the Total column as Qty times Price for every order row.",
  spreadsheetPath: "spreadsheet/42/input.xlsx",
  goldenResponsePath: "spreadsheet/42/answer.xlsx",
  answerPosition: "Orders!A1:D4",
  mode: { withFormula: false, withFontColor: false },
};

const stub = (plan: unknown): InferFn => async ({ schema }) => ({
  value: schema.parse(plan),
  attempts: 1,
  usage: { input: 1000, output: 100 },
});

describe("runBenchTask", () => {
  it("solves a task end to end with a correct plan", async () => {
    const result = await runBenchTask({
      task,
      inputBytes,
      goldenBytes,
      infer: stub({
        edits: [{ sheet: "Orders", range: "C2:C4", formula: "=A2*B2" }],
        notes: "filled the total column",
      }),
    });

    expect(result.planError).toBeUndefined();
    expect(result.scoreError).toBeUndefined();
    expect(result.score?.regression).toEqual({ correct: 13, total: 13 });
    expect(result.score?.modification).toEqual({ correct: 3, total: 3 });
    expect(result.score?.accuracy).toBe(1);
    expect(result.diagnostics.editedCellCount).toBe(3);
    expect(result.diagnostics.unsupportedFunctions).toEqual([]);
  });

  it("passes the prompt the instruction but never the answer_position", async () => {
    let seen = "";
    await runBenchTask({
      // A scored range the digest would never print of its own accord — the
      // sheet's used range is A1:D4, so a leak of THIS string is provable.
      task: { ...task, answerPosition: "Orders!C2:D3" },
      inputBytes,
      goldenBytes,
      infer: async ({ userMessage, schema }) => {
        seen = userMessage;
        return { value: schema.parse({ edits: [] }), attempts: 1, usage: { input: 0, output: 0 } };
      },
    });
    expect(seen).toContain(task.instruction);
    expect(seen).not.toContain("answer_position");
    expect(seen).not.toContain("C2:D3");
  });

  it("fails honestly on a wrong plan", async () => {
    const result = await runBenchTask({
      task,
      inputBytes,
      goldenBytes,
      infer: stub({ edits: [{ sheet: "Orders", range: "C2:C4", value: 999 }] }),
    });
    expect(result.score?.modification).toEqual({ correct: 0, total: 3 });
    expect(result.score?.accuracy).toBe(0);
    expect(result.score?.errorMessage).toContain("Modification error at Orders!C2");
  });

  it("scores the unchanged input when inference fails", async () => {
    const result = await runBenchTask({
      task,
      inputBytes,
      goldenBytes,
      infer: async () => {
        throw new Error("model never returned valid JSON");
      },
    });
    expect(result.planError).toContain("model never returned valid JSON");
    expect(result.plan).toEqual(EMPTY_PLAN);
    expect(result.score?.regressionAccuracy).toBe(1);
    expect(result.score?.modificationAccuracy).toBe(0);
    expect(result.score?.accuracy).toBe(0);
    // An empty plan's output is the input, byte for byte — no lossy rebuild.
    expect(result.outputBytes).toBe(inputBytes);
  });

  it("catches regression damage from an overreaching plan", async () => {
    const result = await runBenchTask({
      task,
      inputBytes,
      goldenBytes,
      infer: stub({
        edits: [
          { sheet: "Orders", range: "C2:C4", formula: "=A2*B2" },
          { sheet: "Orders", range: "D2", clear: true }, // "tidying up" the note
        ],
      }),
    });
    expect(result.score?.regression).toEqual({ correct: 12, total: 13 });
    expect(result.score?.accuracy).toBe(0);
    expect(result.score?.errorMessage).toContain("Regression error at Orders!D2");
  });

  it("writes an output file the official evaluator would score identically", async () => {
    const result = await runBenchTask({
      task,
      inputBytes,
      goldenBytes,
      infer: stub({
        edits: [{ sheet: "Orders", range: "C2:C4", formula: "=A2*B2" }],
      }),
    });

    // Re-read the emitted bytes the way the official pipeline reads any
    // output file, and score them from scratch.
    const reparsed = parseWorkbook(result.outputBytes, "42_output.xlsx");
    const fromFile = scoreTask({
      input: workbookReader(parseWorkbook(inputBytes, "input.xlsx")),
      golden: workbookReader(parseWorkbook(goldenBytes, "answer.xlsx")),
      output: workbookReader(reparsed),
      answerPosition: task.answerPosition!,
      mode: task.mode,
    });
    expect(fromFile.accuracy).toBe(1);
    expect(fromFile.regression).toEqual(result.score?.regression);
    expect(fromFile.modification).toEqual(result.score?.modification);

    // The formulas landed in the file, not just the cached values.
    const c3 = reparsed.sheets[0].cells.get("2:2"); // row 3, col C (0-based)
    expect(c3?.formula).toBe("A3*B3");
    expect(c3?.value).toBe(60);
  });

  it("leaves untouched formula cells' cached values alone in the output file", async () => {
    // D1 holds a formula whose cached value (777) disagrees with what the
    // engine computes (2). Nothing edits its precedents, so the file's own
    // cached value must survive into the output bytes.
    const staleInput = xlsxBytes({
      Orders: [
        ["Qty", "Price", "Total", { f: "A2", v: 777 }],
        [2, 10, null, null],
      ],
    });
    const staleGolden = xlsxBytes({
      Orders: [
        ["Qty", "Price", "Total", { f: "A2", v: 777 }],
        [2, 10, { f: "A2*B2", v: 20 }, null],
      ],
    });
    const result = await runBenchTask({
      task: { ...task, answerPosition: "Orders!A1:D2" },
      inputBytes: staleInput,
      goldenBytes: staleGolden,
      infer: stub({ edits: [{ sheet: "Orders", range: "C2", formula: "=A2*B2" }] }),
    });
    expect(result.score?.accuracy).toBe(1);
    const reparsed = parseWorkbook(result.outputBytes, "out.xlsx");
    const d1 = reparsed.sheets[0].cells.get("0:3");
    expect(d1?.value).toBe(777); // file cache preserved
    expect(d1?.formula).toBe("A2"); // formula untouched
  });

  it("refreshes an untouched but UNCALCULATED formula cell's cached value in the output file too", async () => {
    // D1 holds the same "=A2" formula as the test above, but its source
    // never cached a value at all (t:"z" — see GridCell.uncalculated) rather
    // than disagreeing with the engine. There is no Excel answer to defer
    // to here, so — unlike the 777 case above — the engine's own value (2)
    // is the honest one, and it must land in the output FILE's cache too
    // (lib/bench/output.ts), not just in appliedPlanReader's in-memory view,
    // so a hand rescore of this file with openpyxl agrees with scoreTask().
    const uncachedInput = xlsxBytes({
      Orders: [
        ["Qty", "Price", "Total", { f: "A2", uncalculated: true }],
        [2, 10, null, null],
      ],
    });
    const uncachedGolden = xlsxBytes({
      Orders: [
        ["Qty", "Price", "Total", { f: "A2", v: 2 }],
        [2, 10, { f: "A2*B2", v: 20 }, null],
      ],
    });
    const result = await runBenchTask({
      task: { ...task, answerPosition: "Orders!A1:D2" },
      inputBytes: uncachedInput,
      goldenBytes: uncachedGolden,
      infer: stub({ edits: [{ sheet: "Orders", range: "C2", formula: "=A2*B2" }] }),
    });
    expect(result.score?.accuracy).toBe(1); // scoreTask() already sees D1 as correct in memory
    const reparsed = parseWorkbook(result.outputBytes, "out.xlsx");
    const d1 = reparsed.sheets[0].cells.get("0:3");
    expect(d1?.value).toBe(2); // the engine's honest value, written into the file's own cache
    expect(d1?.formula).toBe("A2"); // formula untouched
  });

  it("reports a missing answer_position instead of pretending to score", async () => {
    const result = await runBenchTask({
      task: { ...task, answerPosition: undefined },
      inputBytes,
      goldenBytes,
      infer: stub({ edits: [] }),
    });
    expect(result.score).toBeNull();
    expect(result.scoreError).toContain("no answer_position");
  });

  it("supports plans that add a new sheet", async () => {
    const goldenWithSummary = xlsxBytes({
      Orders: [
        ["Qty", "Price", "Total", "Note"],
        [2, 10, { f: "A2*B2", v: 20 }, "keep me"],
        [3, 20, { f: "A3*B3", v: 60 }, null],
        [4, 30, { f: "A4*B4", v: 120 }, null],
      ],
      Summary: [[{ f: "SUM(Orders!A2:A4)", v: 9 }]],
    });
    const result = await runBenchTask({
      task: {
        ...task,
        answerPosition: "Orders!A1:D4,Summary!A1",
      },
      inputBytes,
      goldenBytes: goldenWithSummary,
      infer: stub({
        edits: [
          { sheet: "Orders", range: "C2:C4", formula: "=A2*B2" },
          { sheet: "Summary", range: "A1", formula: "=SUM(Orders!A2:A4)" },
        ],
        newSheets: ["Summary"],
      }),
    });
    expect(result.score?.accuracy).toBe(1);

    // The new sheet made it into the output file too.
    const reparsed = parseWorkbook(result.outputBytes, "out.xlsx");
    expect(reparsed.sheets.map((s) => s.name)).toContain("Summary");
    const a1 = reparsed.sheets.find((s) => s.name === "Summary")!.cells.get("0:0");
    expect(a1?.value).toBe(9);
  });

  describe("transcript (submission-grade inference logging)", () => {
    it("records a single-shot transcript: the real system prompt, the userMessage the model saw, and no responses when infer didn't supply any", async () => {
      const result = await runBenchTask({
        task,
        inputBytes,
        goldenBytes,
        infer: stub({ edits: [{ sheet: "Orders", range: "C2:C4", formula: "=A2*B2" }] }),
      });
      expect(result.transcript?.mode).toBe("single");
      if (result.transcript?.mode !== "single") throw new Error("expected single-shot transcript");
      expect(result.transcript.system).toBe(benchSystemPrompt());
      expect(result.transcript.userMessage).toContain(task.instruction);
      expect(result.transcript.responses).toBeUndefined();
    });

    it("threads runValidated-style `responses` through the single-shot transcript when infer supplies them", async () => {
      const infer: InferFn = async ({ schema }) => ({
        value: schema.parse({ edits: [] }),
        attempts: 2,
        usage: { input: 10, output: 5 },
        responses: ['{"edits":[{"bad":true}]}', '{"edits":[]}'],
      });
      const result = await runBenchTask({ task, inputBytes, goldenBytes, infer });
      if (result.transcript?.mode !== "single") throw new Error("expected single-shot transcript");
      expect(result.transcript.responses).toEqual(['{"edits":[{"bad":true}]}', '{"edits":[]}']);
    });

    it("records empty system/userMessage for a --baseline-style skipPrompts run, without crashing", async () => {
      const result = await runBenchTask({
        task,
        inputBytes,
        goldenBytes,
        infer: async ({ schema }) => ({
          value: schema.parse({ edits: [] }),
          attempts: 0,
          usage: { input: 0, output: 0 },
        }),
        skipPrompts: true,
      });
      if (result.transcript?.mode !== "single") throw new Error("expected single-shot transcript");
      expect(result.transcript.system).toBe("");
      expect(result.transcript.userMessage).toBe("");
    });

    it("leaves transcript undefined when inference throws before one can be assembled", async () => {
      const result = await runBenchTask({
        task,
        inputBytes,
        goldenBytes,
        infer: async () => {
          throw new Error("boom");
        },
      });
      expect(result.planError).toContain("boom");
      expect(result.transcript).toBeUndefined();
    });
  });
});

describe("agentic path end to end", () => {
  it("reads, submits, applies, and scores a synthetic task", async () => {
    const turns: Anthropic.ContentBlock[][] = [
      [
        { type: "tool_use", id: "tu_read", name: "read_range",
          input: { sheet: "Orders", range: "A1:D4" } } as Anthropic.ContentBlock,
      ],
      [
        { type: "tool_use", id: "tu_submit", name: SUBMIT_TOOL,
          input: {
            edits: [{ sheet: "Orders", range: "C2:C4", formula: "=A2*B2" }],
            newSheets: [], notes: "fill totals",
          } } as Anthropic.ContentBlock,
      ],
      // The first valid submit only gets a preview turn; resubmit the same
      // plan to finalize it.
      [
        { type: "tool_use", id: "tu_submit_2", name: SUBMIT_TOOL,
          input: {
            edits: [{ sheet: "Orders", range: "C2:C4", formula: "=A2*B2" }],
            newSheets: [], notes: "fill totals",
          } } as Anthropic.ContentBlock,
      ],
    ];
    let i = 0;
    const callTurn = async (): Promise<AgentTurn> => ({
      content: turns[i++],
      stopReason: "tool_use",
      usage: { input: 100, output: 50, cacheRead: 25, cacheCreation: 0 },
    });

    const result = await runBenchTask({
      task,
      inputBytes,
      goldenBytes,
      infer: (async () => { throw new Error("must not be called in agent mode"); }) as InferFn,
      agent: ({ workbook, userMessage }) => {
        expect(userMessage).toContain("THE TASK");
        return runAgentLoop({ workbook, userMessage, callTurn });
      },
    });

    expect(result.planError).toBeUndefined();
    expect(result.score?.accuracy).toBe(1);
    expect(result.diagnostics.submitOutcome).toBe("clean");
    expect(result.diagnostics.turns).toBe(3);
    // Usage accumulates once per callTurn invocation, and the preview turn
    // added by the new submit contract is a third such invocation: 3 * 25.
    expect(result.diagnostics.cacheRead).toBe(75);
    expect(result.outputBytes.length).toBeGreaterThan(0);

    // Submission-grade inference log material: the real agent system prompt
    // and the loop's own final `messages` array (see lib/agent/loop.ts),
    // threaded straight through — this is what scripts/benchmark.ts's JSONL
    // writer reads.
    expect(result.transcript?.mode).toBe("tools");
    if (result.transcript?.mode !== "tools") throw new Error("expected tools transcript");
    expect(result.transcript.system).toBe(benchAgentSystemPrompt());
    // 1 initial user + 3 assistant turns + 2 tool_results in between (the
    // read's and the first submit's preview) — the finalizing 2nd submit
    // ends the loop right after its own assistant turn is pushed.
    expect(result.transcript.messages).toHaveLength(6);
    expect(result.transcript.messages[0].role).toBe("user");
    const lastAssistant = result.transcript.messages[5];
    expect(lastAssistant.role).toBe("assistant");
    const blocks = lastAssistant.content as Anthropic.ContentBlockParam[];
    expect(blocks.some((b) => b.type === "tool_use" && (b as Anthropic.ToolUseBlock).name === SUBMIT_TOOL)).toBe(true);
  });
});
