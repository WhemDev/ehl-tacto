/**
 * One benchmark task, end to end: parse → digest → infer → apply → score.
 *
 * The model call is injected rather than imported so tests can drive the
 * whole pipeline with a stub, and so the CLI owns retries/concurrency. The
 * contract mirrors lib/anthropic/run.ts's runValidated — hand it a system
 * prompt, a user message, and a Zod schema; get back a validated value.
 *
 * A failed inference is not a crash: the task is scored on the unchanged
 * input (regression intact, modifications absent), which is exactly what
 * the official evaluator would see if an agent submitted its input file
 * untouched — and strictly more informative than "missing output".
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { injectCharts } from "@/lib/charts/inject";
import { buildDigests } from "@/lib/digest";
import { parseWorkbook, type ParsedWorkbook, type ParseLimits } from "@/lib/workbook";
import type { AgentLoopResult } from "./agent-loop";
import { scoreTask, AnswerPositionError, type TaskScore } from "./compare";
import type { BenchTask, Category } from "./dataset";
import {
  applyEditPlan,
  appliedPlanReader,
  makeEditPlanSchema,
  type CellEditPlan,
} from "./edits";
import { buildOutputXlsx } from "./output";
import { benchAgentSystemPrompt, benchAgentUserMessage, benchSystemPrompt, benchUserMessage } from "./prompts";
import { workbookReader } from "./readers";

export const EMPTY_PLAN: CellEditPlan = { edits: [], newSheets: [], notes: "" };

/**
 * The benchmark parses workbooks at Excel's own maxima: 251 sheets in the
 * real dataset exceed the app's 100-column rendering cap and 76 exceed its
 * 5,000-row one, and a scorer that silently clips them would mis-score the
 * corresponding tasks. Parsing cost tracks the cells actually present, so
 * the wide caps are free on sparse sheets. The structural digest is still
 * built from an app-capped parse — its dense statistics passes are budgeted
 * for that envelope, and the grid appendix (sparse, character-budgeted)
 * carries the full-size content to the model.
 */
export const BENCH_PARSE_LIMITS: ParseLimits = { maxRows: 1_048_576, maxCols: 16_384 };

export interface InferInput {
  system: string;
  userMessage: string;
  schema: z.ZodType<CellEditPlan, z.ZodTypeDef, unknown>;
}

export interface InferOutput {
  value: CellEditPlan;
  attempts: number;
  usage: { input: number; output: number };
  /** Raw per-attempt response text, when the injected `infer` came through
   *  lib/anthropic/run.ts's runValidated (real inference, and any stub that
   *  chooses to supply it) — absent for callers that never had it, e.g. the
   *  --baseline stub in scripts/benchmark.ts. Threaded straight into
   *  TaskTranscript's "single" branch below; see runValidated's RunResult
   *  for why this is text only, not full content blocks. */
  responses?: string[];
}

export type InferFn = (input: InferInput) => Promise<InferOutput>;

/**
 * Submission-grade inference log material for one task — see
 * scripts/benchmark.ts's per-task JSONL writer, which is the only consumer.
 * Two shapes because the two inference paths expose fundamentally different
 * amounts of detail: agent mode already builds a full `messages` array
 * (lib/agent/loop.ts), thinking/tool_use blocks included, since the loop
 * needs it to drive the model turn by turn — this is the shape SpreadsheetBench
 * submissions actually use. Single-shot mode has no such array; `responses`
 * is best-effort raw text per attempt (see InferOutput's doc), not a full
 * conversation transcript.
 */
export type TaskTranscript =
  | { mode: "tools"; system: string; messages: Anthropic.MessageParam[] }
  | { mode: "single"; system: string; userMessage: string; responses?: string[] };

export interface TaskRunResult {
  taskId: string;
  /** Null only when scoring itself failed (see scoreError). */
  score: TaskScore | null;
  /** Set when the answer_position could not be parsed or a file would not
   *  load — the official evaluator records these as task-level errors too. */
  scoreError?: string;
  plan: CellEditPlan;
  /** Set when the model never produced a valid plan; the task was then
   *  scored on the unchanged input. */
  planError?: string;
  outputBytes: Uint8Array;
  /** Undefined only when inference itself threw before one could be
   *  assembled (see planError on the same failure) — mirrors `plan` staying
   *  EMPTY_PLAN in that case. */
  transcript?: TaskTranscript;
  diagnostics: {
    editedCellCount: number;
    formulaParseFailures: number;
    unsupportedFunctions: string[];
    /** Sheets clamped by the 5000x100 grid cap — scores on these tasks may
     *  disagree with the official evaluator and are flagged, not hidden. */
    truncatedSheets: string[];
    attempts: number;
    usage: { input: number; output: number };
    elapsedMs: number;
    notes: string;
    /** Agentic mode only. */
    turns?: number;
    toolCalls?: Record<string, number>;
    submitOutcome?: string;
    cacheRead?: number;
    cacheCreation?: number;
    /**
     * Set when plan.charts was non-empty and lib/charts/inject.ts's
     * injectCharts threw compiling/splicing one of them — see this
     * function's doc on charts being output-only. Never thrown out of
     * runBenchTask itself: a chart failure must not cost the task its
     * (separately-scored) edits, so the un-charted output is still written
     * and this is the sole record that a chart was requested but not
     * produced. Empty (not present in practice) when charts compiled clean
     * or the plan had none.
     */
    chartErrors: string[];
  };
}

function truncatedSheetsOf(...workbooks: ParsedWorkbook[]): string[] {
  const out: string[] = [];
  for (const wb of workbooks) {
    for (const s of wb.sheets) {
      if (s.truncated) out.push(`${wb.fileName}::${s.name}`);
    }
  }
  return out;
}

function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export async function runBenchTask(opts: {
  task: BenchTask;
  inputBytes: Uint8Array;
  goldenBytes?: Uint8Array;
  /** A pre-parsed golden, when the caller already has one — benchmark task
   *  families share a single golden file (10 unique files serve Debugging's
   *  100 tasks), and re-parsing a 7 MB model per task is pure waste. */
  parsedGolden?: ParsedWorkbook;
  infer: InferFn;
  /** Skip building the digest and prompt messages. For callers whose infer
   *  never reads them (the no-model baseline); prompt text arrives empty. */
  skipPrompts?: boolean;
  /** The dataset's own category ("Financial_Model", "Template", ...) —
   *  legitimate task metadata, not a graded value (see dataset.ts). Threaded
   *  straight through to benchAgentUserMessage (agentic path only; see
   *  isCompletionScope in lib/analysis/completeness.ts), which gates
   *  whole-workbook completion mode on category AND the completion phrase,
   *  not the phrase alone — a Template instruction can legitimately reuse
   *  Financial_Model's boilerplate opener without Template's grading being
   *  whole-workbook. Optional and safe to omit: a caller that hasn't
   *  threaded it through its own category variable yet (as of this writing,
   *  scripts/benchmark.ts and scripts/bench-dry-score.ts both compute a
   *  `category` in scope at their runBenchTask call site but do not pass it
   *  here) falls back to the pre-existing, category-blind gate rather than
   *  silently losing completion mode — see isCompletionScope's doc. */
  category?: Category;
  /** Agentic path: when set, drives the tool loop instead of `infer`. */
  agent?: (opts: {
    workbook: ParsedWorkbook;
    system: string;
    userMessage: string;
  }) => Promise<AgentLoopResult>;
}): Promise<TaskRunResult> {
  const { task, inputBytes, goldenBytes, infer } = opts;
  const started = Date.now();

  const workbook = parseWorkbook(inputBytes, baseName(task.spreadsheetPath), BENCH_PARSE_LIMITS);
  const golden =
    opts.parsedGolden ??
    parseWorkbook(
      goldenBytes ?? new Uint8Array(),
      baseName(task.goldenResponsePath),
      BENCH_PARSE_LIMITS,
    );

  let plan = EMPTY_PLAN;
  let planError: string | undefined;
  let attempts = 0;
  let usage = { input: 0, output: 0 };
  let transcript: TaskTranscript | undefined;

  let agentResult: AgentLoopResult | null = null;
  try {
    if (opts.agent && !opts.skipPrompts) {
      // benchAgentUserMessage, not benchUserMessage: tools mode only gets the
      // INCOMPLETE AREAS/CANDIDATE BUGS/CHARTS/SCOPE sections (see
      // prompts.ts); single-shot mode below is untouched by this feature
      // regardless of the task's instruction or category. opts.category is
      // passed straight through to both — see this function's doc for what
      // an omitted category falls back to, and benchAgentSystemPrompt's own
      // doc for the one addition its category parameter gates (Visualization
      // chart guidance; every other category's prompt is unaffected).
      const system = benchAgentSystemPrompt(opts.category);
      const userMessage = benchAgentUserMessage(
        buildDigests([parseWorkbook(inputBytes, baseName(task.spreadsheetPath))]),
        workbook,
        task.instruction,
        opts.category,
      );
      agentResult = await opts.agent({ workbook, system, userMessage });
      plan = agentResult.plan ?? EMPTY_PLAN;
      planError = agentResult.planError;
      usage = { input: agentResult.diagnostics.usage.input, output: agentResult.diagnostics.usage.output };
      attempts = agentResult.diagnostics.turns;
      // The loop's own final `messages` — see AgentLoopResult.messages's doc
      // — is the submission-grade log this whole feature exists for.
      transcript = { mode: "tools", system, messages: agentResult.messages };
    } else {
      // The digest reads an app-capped parse (see BENCH_PARSE_LIMITS above).
      const system = opts.skipPrompts ? "" : benchSystemPrompt();
      const userMessage = opts.skipPrompts
        ? ""
        : benchUserMessage(
            buildDigests([parseWorkbook(inputBytes, baseName(task.spreadsheetPath))]),
            workbook,
            task.instruction,
          );
      const result = await infer({
        system,
        userMessage,
        schema: makeEditPlanSchema(workbook) as unknown as InferInput["schema"],
      });
      plan = result.value;
      attempts = result.attempts;
      usage = result.usage;
      transcript = { mode: "single", system, userMessage, responses: result.responses };
    }
  } catch (err) {
    planError = err instanceof Error ? err.message : String(err);
  }

  const applied = agentResult?.applied ?? (await applyEditPlan(workbook, plan));
  let outputBytes = buildOutputXlsx(inputBytes, applied);

  // Charts are output-only: injectCharts splices compiled chart/drawing XML
  // straight into the ALREADY-BUILT output .xlsx bytes, entirely at the zip
  // level (lib/charts/inject.ts) — it never touches the Simulator, never
  // re-enters applyEditPlan, and has no way to influence `applied` or
  // `score` below. A chart is exactly what the official evaluator's VLM
  // judges and this harness cannot score (see dataset.ts's answerPosition
  // doc); it exists purely so a Visualization run's output file actually
  // contains the requested chart(s) for that external judging. A compile or
  // splice failure (a chart spec is structurally valid per makeEditPlanSchema
  // but, say, names a sheet inject.ts can't resolve to a real zip part) is
  // caught rather than thrown: the task's edits (if any — a Visualization
  // plan may do genuine data-prep) already scored and wrote a valid file;
  // losing that over an unrelated chart failure would be strictly worse than
  // recording the failure and shipping the un-charted output.
  const chartErrors: string[] = [];
  if (plan.charts && plan.charts.length > 0) {
    try {
      outputBytes = injectCharts(outputBytes, plan.charts);
    } catch (err) {
      chartErrors.push(err instanceof Error ? err.message : String(err));
    }
  }

  let score: TaskScore | null = null;
  let scoreError: string | undefined;
  if (task.answerPosition) {
    try {
      score = scoreTask({
        input: workbookReader(workbook),
        golden: workbookReader(golden),
        output: appliedPlanReader(applied),
        answerPosition: task.answerPosition,
        mode: task.mode,
      });
    } catch (err) {
      scoreError =
        err instanceof AnswerPositionError
          ? `answer_position: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
    }
  } else {
    // Every task lacking answer_position in the real dataset is Visualization
    // (see dataset.ts's rawTaskSchema doc) — chart quality is judged by a VLM
    // in the official pipeline, a judge this harness does not have. Kept
    // category-aware rather than hardcoding the Visualization wording
    // unconditionally: a caller that hasn't threaded opts.category through
    // yet (or a genuinely unexpected category missing answer_position) still
    // gets an honest, if more generic, explanation instead of a
    // Visualization-specific claim that may not apply.
    scoreError =
      opts.category === "Visualization"
        ? "Visualization is VLM-judged by the official evaluator; not scored locally"
        : "task has no answer_position (this harness cannot score it)";
  }

  const editedCellCount =
    [...applied.editedFormulas.values()].reduce((n, m) => n + m.size, 0) +
    [...applied.editedValues.values()].reduce((n, m) => n + m.size, 0);

  return {
    taskId: task.id,
    score,
    scoreError,
    plan,
    planError,
    outputBytes,
    transcript,
    diagnostics: {
      editedCellCount,
      formulaParseFailures: applied.formulaParseFailures.length,
      unsupportedFunctions: applied.unsupportedFunctions,
      truncatedSheets: truncatedSheetsOf(workbook, golden),
      attempts,
      usage,
      elapsedMs: Date.now() - started,
      notes: plan.notes,
      turns: agentResult?.diagnostics.turns,
      toolCalls: agentResult?.diagnostics.toolCalls,
      submitOutcome: agentResult?.diagnostics.submitOutcome,
      cacheRead: agentResult ? agentResult.diagnostics.usage.cacheRead : undefined,
      cacheCreation: agentResult ? agentResult.diagnostics.usage.cacheCreation : undefined,
      chartErrors,
    },
  };
}
