/**
 * Pure, node-testable JSONL serialization behind scripts/benchmark.ts's
 * per-task inference logs (<out>/<Category>/logs/{id}.jsonl).
 *
 * SpreadsheetBench leaderboard submissions require "the running log file
 * generated during inference... comprehensively record[ing] the model
 * inputs, outputs, and necessary intermediate steps." The benchmark harness
 * previously persisted only report.json (scores, tool-call counts, notes)
 * and the output .xlsx — no transcripts. This module turns one task's
 * header + transcript (lib/bench/run-task.ts's TaskTranscript) + footer into
 * that file's lines: one JSON object per line, in header/messages/footer
 * order. No fs here — the script owns mkdir/writeFileSync, the same split
 * lib/work/cli-core.ts uses behind scripts/work-cli.ts.
 *
 * Serialization must never throw on odd content (a circular structure, a
 * BigInt, a getter that throws) — see safeStringify. A log file existing but
 * incomplete/malformed on one odd value is a bigger loss than one ugly line,
 * so every failure mode here degrades to a fallback string rather than
 * aborting the whole task's log — or the benchmark run itself.
 */

import type { TaskTranscript } from "./run-task";

export interface TaskLogHeader {
  taskId: string;
  category: string;
  model: string;
  effort: string;
  mode: string;
  startedAt: string;
  instruction: string;
}

export interface TaskLogMessageLine {
  role: string;
  content: unknown;
}

export interface TaskLogFooter {
  plan: unknown;
  submitOutcome?: string;
  turns?: number;
  toolCalls?: Record<string, number>;
  usage: unknown;
  elapsedMs: number;
  score: unknown;
}

/**
 * One line per message, in order. Tools mode already has a real
 * `messages` array (lib/agent/loop.ts's `AgentLoopResult.messages`) — mapped
 * straight through, role and content untouched (thinking/tool_use blocks
 * included: they ARE the "necessary intermediate steps" the leaderboard
 * wants). Single-shot mode has no such array (see TaskTranscript's doc), so
 * this synthesizes the closest equivalent: the one user message actually
 * sent, then one assistant line per raw response text — empty when the
 * caller's `infer` never supplied `responses` (e.g. --baseline).
 */
export function transcriptMessageLines(transcript: TaskTranscript | undefined): TaskLogMessageLine[] {
  if (!transcript) return [];
  if (transcript.mode === "tools") {
    return transcript.messages.map((m) => ({ role: m.role, content: m.content }));
  }
  const lines: TaskLogMessageLine[] = [{ role: "user", content: transcript.userMessage }];
  for (const text of transcript.responses ?? []) {
    lines.push({ role: "assistant", content: text });
  }
  return lines;
}

/** A JSON.stringify replacer that survives what a real inference run can
 *  actually produce: a circular structure (defensive — nothing here is
 *  expected to be circular, but a log writer is exactly the wrong place to
 *  find out the hard way) and a BigInt (which plain JSON.stringify throws a
 *  TypeError on outright). Everything else — Dates, Maps, functions,
 *  undefined — already degrades gracefully under plain JSON.stringify and is
 *  left alone. */
function safeReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  };
}

/**
 * JSON.stringify, but it never throws. Falls back to a small error-marker
 * object (itself run back through safeStringify, so a pathological
 * `err.message` getter can't cause a second throw) rather than losing the
 * whole line — see this module's doc comment for why that trade is worth
 * it. Always returns a string, even for inputs (`undefined`, a bare
 * function) where plain `JSON.stringify` returns `undefined` instead of
 * throwing — a log line must always be one line.
 */
export function safeStringify(value: unknown): string {
  try {
    const out = JSON.stringify(value, safeReplacer());
    return out ?? JSON.stringify(null);
  } catch (err) {
    try {
      return JSON.stringify({
        __serializationError: err instanceof Error ? err.message : String(err),
      });
    } catch {
      return '{"__serializationError":"unserializable"}';
    }
  }
}

/**
 * Assembles one task's log lines: a header line, then one line per message
 * (transcriptMessageLines — [] when `transcript` is absent, e.g. a task
 * whose inference threw before one could be assembled), then a footer line.
 * Returns an array of JSON strings (no trailing newlines) — join with "\n"
 * to write, or use serializeTaskLog below.
 */
export function buildTaskLogLines(opts: {
  header: TaskLogHeader;
  transcript?: TaskTranscript;
  footer: TaskLogFooter;
}): string[] {
  const lines: string[] = [safeStringify(opts.header)];
  for (const m of transcriptMessageLines(opts.transcript)) {
    lines.push(safeStringify(m));
  }
  lines.push(safeStringify(opts.footer));
  return lines;
}

/** buildTaskLogLines, joined into the file's full text — one JSON object
 *  per line, trailing newline included (the conventional JSONL shape). */
export function serializeTaskLog(opts: {
  header: TaskLogHeader;
  transcript?: TaskTranscript;
  footer: TaskLogFooter;
}): string {
  return buildTaskLogLines(opts).join("\n") + "\n";
}
