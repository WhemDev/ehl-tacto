import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  buildTaskLogLines,
  safeStringify,
  serializeTaskLog,
  transcriptMessageLines,
  type TaskLogFooter,
  type TaskLogHeader,
} from "@/lib/bench/log";
import type { TaskTranscript } from "@/lib/bench/run-task";

/**
 * The JSONL writer behind scripts/benchmark.ts's submission-grade inference
 * logs. SpreadsheetBench leaderboard submissions require "the running log
 * file generated during inference... comprehensively record[ing] the model
 * inputs, outputs, and necessary intermediate steps" — this module turns one
 * task's header/transcript/footer into that file's lines, kept pure and node-
 * testable (no fs) the same way lib/work/cli-core.ts stays pure behind
 * scripts/work-cli.ts.
 */

const header: TaskLogHeader = {
  taskId: "42",
  category: "Financial_Model",
  model: "claude-sonnet-5",
  effort: "high",
  mode: "tools",
  startedAt: "2026-08-18T00:00:00.000Z",
  instruction: "Fill the Total column.",
};

const footer: TaskLogFooter = {
  plan: { edits: [{ sheet: "Orders", range: "C2:C4", formula: "=A2*B2" }], newSheets: [], notes: "done" },
  submitOutcome: "clean",
  turns: 3,
  toolCalls: { read_range: 1, submit_edit_plan: 2 },
  usage: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
  elapsedMs: 1234,
  score: { accuracy: 1 },
};

function line(json: string): unknown {
  return JSON.parse(json);
}

const SUBMIT_TOOL_STUB = "submit_edit_plan";

describe("transcriptMessageLines", () => {
  it("returns [] for an undefined transcript", () => {
    expect(transcriptMessageLines(undefined)).toEqual([]);
  });

  it("maps a tools-mode transcript's messages straight through, role and content preserved", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: [{ type: "text", text: "task" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_range", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "A1=10" }] },
    ];
    const transcript: TaskTranscript = { mode: "tools", system: "sys", messages };
    const lines = transcriptMessageLines(transcript);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ role: "user", content: messages[0].content });
    expect(lines[1]).toEqual({ role: "assistant", content: messages[1].content });
    expect(lines[2]).toEqual({ role: "user", content: messages[2].content });
  });

  it("synthesizes a user line plus one assistant line per response for single-shot mode", () => {
    const transcript: TaskTranscript = {
      mode: "single",
      system: "sys",
      userMessage: "do the thing",
      responses: ['{"edits":[{"bad":true}]}', '{"edits":[]}'],
    };
    const lines = transcriptMessageLines(transcript);
    expect(lines).toEqual([
      { role: "user", content: "do the thing" },
      { role: "assistant", content: '{"edits":[{"bad":true}]}' },
      { role: "assistant", content: '{"edits":[]}' },
    ]);
  });

  it("still emits the user line alone when single-shot mode has no responses (e.g. --baseline)", () => {
    const transcript: TaskTranscript = { mode: "single", system: "", userMessage: "" };
    expect(transcriptMessageLines(transcript)).toEqual([{ role: "user", content: "" }]);
  });
});

describe("buildTaskLogLines / serializeTaskLog", () => {
  it("produces header, one line per message, then footer, in that order", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: [{ type: "text", text: "task" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: SUBMIT_TOOL_STUB, input: {} }] },
    ];
    const transcript: TaskTranscript = { mode: "tools", system: "sys", messages };
    const lines = buildTaskLogLines({ header, transcript, footer });

    expect(lines).toHaveLength(4); // header + 2 messages + footer
    expect(line(lines[0])).toEqual(header);
    expect(line(lines[1])).toEqual({ role: "user", content: [{ type: "text", text: "task" }] });
    expect(line(lines[2])).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: SUBMIT_TOOL_STUB, input: {} }],
    });
    expect(line(lines[3])).toEqual(footer);
  });

  it("produces just header + footer when transcript is absent (a failed-inference task, logged gracefully)", () => {
    const lines = buildTaskLogLines({ header, footer: { ...footer, plan: null, score: null } });
    expect(lines).toHaveLength(2);
    expect(line(lines[0])).toEqual(header);
    expect(line(lines[1])).toEqual({ ...footer, plan: null, score: null });
  });

  it("every line is valid, independently parseable JSON — true JSONL", () => {
    const transcript: TaskTranscript = {
      mode: "single",
      system: "sys",
      userMessage: "do it",
      responses: ["ok"],
    };
    const lines = buildTaskLogLines({ header, transcript, footer });
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  it("serializeTaskLog joins lines with newlines and ends with a trailing newline", () => {
    const out = serializeTaskLog({ header, footer });
    expect(out.endsWith("\n")).toBe(true);
    const rows = out.split("\n").filter(Boolean);
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[0])).toEqual(header);
  });
});

describe("safeStringify — odd-content safety", () => {
  it("stringifies ordinary values exactly like JSON.stringify", () => {
    expect(safeStringify({ a: 1, b: "x" })).toBe(JSON.stringify({ a: 1, b: "x" }));
  });

  it("never throws on a circular reference, and still returns valid JSON", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    let result = "";
    expect(() => {
      result = safeStringify(obj);
    }).not.toThrow();
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result).self).toBe("[Circular]");
  });

  it("never throws on a BigInt (which plain JSON.stringify does)", () => {
    expect(() => JSON.stringify({ n: 10n })).toThrow();
    let result = "";
    expect(() => {
      result = safeStringify({ n: 10n });
    }).not.toThrow();
    expect(JSON.parse(result)).toEqual({ n: "10" });
  });

  it("never throws and still returns a string for a bare top-level function (which plain JSON.stringify turns into `undefined`, not a string)", () => {
    expect(JSON.stringify(() => {})).toBeUndefined();
    let result = "";
    expect(() => {
      result = safeStringify(() => {});
    }).not.toThrow();
    expect(typeof result).toBe("string");
  });

  it("falls back to a serialization-error marker rather than throwing, for a replacer-defeating pathological value", () => {
    // An object whose own property access throws mid-serialization — the
    // WeakSet/BigInt guards in the normal replacer can't help here, so this
    // exercises the outer try/catch fallback.
    const evil = {};
    Object.defineProperty(evil, "boom", {
      enumerable: true,
      get() {
        throw new Error("nope");
      },
    });
    let result = "";
    expect(() => {
      result = safeStringify(evil);
    }).not.toThrow();
    expect(() => JSON.parse(result)).not.toThrow();
  });
});
