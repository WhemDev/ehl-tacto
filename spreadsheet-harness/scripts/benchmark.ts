/**
 * Run SpreadsheetBench 2 against Cellwise's own pipeline and score it.
 *
 *   npm run bench -- --category Financial_Model --limit 5
 *   npm run bench -- --category all
 *   npm run bench -- --category Debugging --ids 3,17,42
 *   npm run bench -- --category Template --baseline        # no model calls
 *   npm run bench -- --category Template --score-only out/Template/output_excel
 *   npm run bench -- --category all --concurrency 4 --resume
 *
 * The dataset is NOT bundled — download it once (≈ a few GB):
 *
 *   hf download KAKA22/SpreadsheetBench-v2 --repo-type dataset \
 *      --local-dir data/spreadsheetbench-v2
 *
 * then point the runner at it with --dataset or SPREADSHEETBENCH_DIR
 * (default: data/spreadsheetbench-v2).
 *
 * Per task this parses the input workbook, builds the digest, asks the model
 * for an edit plan (validated against the workbook, one retry on validation
 * errors — the same loop /api/infer uses), applies the plan through the
 * formula engine, and scores the result against the golden file with the
 * ported official comparison. Outputs land in
 * <out>/<Category>/output_excel/{id}_output.xlsx — the exact layout the
 * official Python evaluator consumes, so every run can be independently
 * re-scored with the reference pipeline.
 *
 * Scoring matches evaluation.py; the one divergence (font-color checks on
 * Debugging "Color" tasks are skipped) is flagged per task in the report.
 * Visualization tasks are chart work judged by a VLM in the official
 * pipeline and are not attempted here.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hasCredentials, MODEL } from "../lib/anthropic/client";
import { runValidated } from "../lib/anthropic/run";
import { runAgentLoop } from "../lib/bench/agent-loop";
import { makeAgentCallTurn } from "../lib/bench/agent-infer";
import {
  aggregateScores,
  scoreTask,
  type AggregateScore,
  type TaskScore,
} from "../lib/bench/compare";
import {
  CATEGORIES,
  filterTasks,
  parseDatasetJson,
  SCOREABLE_CATEGORIES,
  type BenchTask,
  type Category,
} from "../lib/bench/dataset";
import { BENCH_PARSE_LIMITS, runBenchTask, type InferFn, type TaskRunResult } from "../lib/bench/run-task";
import { serializeTaskLog } from "../lib/bench/log";
import { workbookReader } from "../lib/bench/readers";
import { parseWorkbook } from "../lib/workbook";

export interface Options {
  datasetDir: string;
  categories: Category[];
  ids?: string[];
  limit?: number;
  concurrency: number;
  outDir: string;
  baseline: boolean;
  scoreOnly?: string;
  resume: boolean;
  effort: "low" | "medium" | "high" | "max";
  mode: "tools" | "single";
  model?: string;
}

function usage(message?: string): never {
  if (message) console.error(`\n  ${message}`);
  console.error(`
  Usage: npm run bench -- --category <name|all> [options]

  --dataset <dir>       dataset root (default: $SPREADSHEETBENCH_DIR or data/spreadsheetbench-v2)
  --category <name>     ${CATEGORIES.join(" | ")} | all
                         ("all" runs the ${SCOREABLE_CATEGORIES.join(", ")} — Visualization is
                         runnable (produces chart output files) but not scored locally, so it
                         is excluded from "all"; run it explicitly with --category Visualization)
  --ids <a,b,c>         only these task ids
  --limit <n>           at most n tasks per category
  --concurrency <n>     parallel tasks (default 1 — each task is one model call)
  --out <dir>           results root (default: bench-results)
  --baseline            no model calls: submit the input unchanged (free; shows the floor)
  --score-only <dir>    score existing {id}_output.xlsx files from <dir> instead of running
  --resume              skip tasks whose output file already exists, scoring it from disk
  --effort <level>      model effort: low | medium | high | max (default high)
  --mode <tools|single> tools: agentic loop with retrieval tools (default); single: one-shot prompt
  --model <id>          Claude model id (default: ${MODEL})
`);
  process.exit(2);
}

export function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(flag);

  // "all" stays SCOREABLE_CATEGORIES only (Visualization has no local score
  // — see dataset.ts's SCOREABLE_CATEGORIES doc — so silently including it
  // in a run someone expects to be "the scored run" would be a surprise, not
  // a convenience). Any single named category — Visualization included — is
  // runnable on its own via an explicit --category: it parses its
  // dataset.json, produces output_excel/{id}_output.xlsx files (with any
  // requested charts spliced in) and a logs/ directory exactly like a
  // scoreable category, and its report/aggregate is clearly labeled unscored
  // rather than printed as a misleading 0% (see printAggregate).
  const categoryArg = get("--category") ?? usage("--category is required");
  let categories: Category[];
  if (categoryArg === "all") {
    categories = SCOREABLE_CATEGORIES;
  } else if ((CATEGORIES as readonly string[]).includes(categoryArg)) {
    categories = [categoryArg as Category];
  } else {
    usage(`Unknown category "${categoryArg}". Use: ${CATEGORIES.join(", ")} or all.`);
  }

  const effort = (get("--effort") ?? "high") as Options["effort"];
  if (!["low", "medium", "high", "max"].includes(effort)) usage(`Bad --effort "${effort}"`);

  const mode = (get("--mode") ?? "tools") as Options["mode"];
  if (!["tools", "single"].includes(mode)) usage(`Bad --mode "${mode}"`);

  const model = get("--model");
  if (model !== undefined && model.length === 0) usage(`Bad --model "${model}"`);

  return {
    datasetDir: resolve(
      get("--dataset") ?? process.env.SPREADSHEETBENCH_DIR ?? "data/spreadsheetbench-v2",
    ),
    categories,
    ids: get("--ids")?.split(",").map((s) => s.trim()).filter(Boolean),
    limit: get("--limit") ? Number(get("--limit")) : undefined,
    concurrency: Math.max(1, Number(get("--concurrency") ?? 1)),
    outDir: resolve(get("--out") ?? "bench-results"),
    baseline: has("--baseline"),
    scoreOnly: get("--score-only"),
    resume: has("--resume"),
    effort,
    mode,
    model,
  };
}

// ---------------------------------------------------------------------------

interface TaskReportRow {
  id: string;
  regressionAccuracy: number;
  modificationAccuracy: number;
  accuracy: number;
  missing: boolean;
  errorMessage: string;
  planError?: string;
  scoreError?: string;
  fontColorSkipped?: boolean;
  editedCells?: number;
  unsupportedFunctions?: string[];
  truncatedSheets?: string[];
  attempts?: number;
  usage?: { input: number; output: number };
  elapsedMs?: number;
  notes?: string;
  turns?: number;
  toolCalls?: Record<string, number>;
  submitOutcome?: string;
  cacheRead?: number;
  cacheCreation?: number;
}

function rowFromScore(id: string, score: TaskScore | null, extra: Partial<TaskReportRow>): TaskReportRow {
  return {
    id,
    regressionAccuracy: score?.regressionAccuracy ?? 0,
    modificationAccuracy: score?.modificationAccuracy ?? 0,
    accuracy: score?.accuracy ?? 0,
    missing: false,
    errorMessage: score?.errorMessage ?? "",
    fontColorSkipped: score?.fontColorSkipped || undefined,
    ...extra,
  };
}

async function pooled<T>(items: T[], concurrency: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await run(item);
    }
  });
  await Promise.all(workers);
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`.padStart(6);
}

function printRow(category: string, row: TaskReportRow): void {
  const flags = [
    row.missing ? "MISSING" : null,
    row.planError ? "plan-error" : null,
    row.scoreError ? "score-error" : null,
    row.fontColorSkipped ? "color-skipped" : null,
    row.truncatedSheets?.length ? "TRUNCATED" : null,
    row.unsupportedFunctions?.length ? `#NAME?:${row.unsupportedFunctions.join("/")}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  console.log(
    `  [${category}] ${row.id.padEnd(12)} reg ${fmtPct(row.regressionAccuracy)}  ` +
      `mod ${fmtPct(row.modificationAccuracy)}  ${row.accuracy ? "SOLVED" : "failed"}` +
      (flags ? `  (${flags})` : ""),
  );
  if (!row.accuracy && row.errorMessage) console.log(`      first miss: ${row.errorMessage.slice(0, 160)}`);
  if (row.planError) console.log(`      plan: ${row.planError.slice(0, 160)}`);
}

// ---------------------------------------------------------------------------

async function runCategory(
  opts: Options,
  category: Category,
  infer: InferFn | null,
  agent?: Parameters<typeof runBenchTask>[0]["agent"],
): Promise<TaskReportRow[]> {
  const categoryDir = join(opts.datasetDir, category);
  const datasetJson = join(categoryDir, "dataset.json");
  if (!existsSync(datasetJson)) {
    console.error(
      `\n  No dataset at ${datasetJson}.\n` +
        `  Download it first:\n\n` +
        `    hf download KAKA22/SpreadsheetBench-v2 --repo-type dataset --local-dir ${opts.datasetDir}\n`,
    );
    process.exit(2);
  }

  const tasks = filterTasks(parseDatasetJson(readFileSync(datasetJson, "utf8"), category), {
    ids: opts.ids,
    limit: opts.limit,
  });

  const outputDir = opts.scoreOnly
    ? resolve(opts.scoreOnly)
    : join(opts.outDir, category, "output_excel");
  if (!opts.scoreOnly) mkdirSync(outputDir, { recursive: true });

  // Submission-grade inference logs (see lib/bench/log.ts) — one per task
  // actually run. Not for --score-only (no inference happens there) or
  // --baseline (no model call to log either — see the `!opts.baseline` guard
  // at the write site below).
  const logsDir = join(opts.outDir, category, "logs");
  if (!opts.scoreOnly && !opts.baseline) mkdirSync(logsDir, { recursive: true });

  console.log(`\n${category}: ${tasks.length} task(s)`);
  const rows: TaskReportRow[] = [];

  // Task families share a golden file (10 unique goldens serve Debugging's
  // 100 tasks), and the big ones take ~15s to parse — cache a few.
  const goldenCache = new Map<string, ReturnType<typeof parseWorkbook>>();
  const parsedGoldenFor = (path: string) => {
    const hit = goldenCache.get(path);
    if (hit) return hit;
    const parsed = parseWorkbook(new Uint8Array(readFileSync(path)), "answer.xlsx", BENCH_PARSE_LIMITS);
    goldenCache.set(path, parsed);
    if (goldenCache.size > 4) {
      const oldest = goldenCache.keys().next().value;
      if (oldest !== undefined) goldenCache.delete(oldest);
    }
    return parsed;
  };

  await pooled(tasks, opts.concurrency, async (task) => {
    const inputPath = join(categoryDir, task.spreadsheetPath);
    const goldenPath = join(categoryDir, task.goldenResponsePath);
    const outputPath = join(outputDir, `${task.id}_output.xlsx`);

    let row: TaskReportRow;
    try {
      if (!existsSync(inputPath) || !existsSync(goldenPath)) {
        row = rowFromScore(task.id, null, {
          missing: true,
          errorMessage: "input file not exist",
        });
      } else if (opts.scoreOnly || (opts.resume && existsSync(outputPath))) {
        // Score an existing output file, exactly like the official evaluator.
        if (!existsSync(outputPath)) {
          row = rowFromScore(task.id, null, { missing: true, errorMessage: "output file not exist" });
        } else if (!task.answerPosition) {
          row = rowFromScore(task.id, null, {
            scoreError:
              category === "Visualization"
                ? "Visualization is VLM-judged by the official evaluator; not scored locally"
                : "task has no answer_position",
          });
        } else {
          const score = scoreTask({
            input: workbookReader(parseWorkbook(new Uint8Array(readFileSync(inputPath)), "input.xlsx", BENCH_PARSE_LIMITS)),
            golden: workbookReader(parseWorkbook(new Uint8Array(readFileSync(goldenPath)), "answer.xlsx", BENCH_PARSE_LIMITS)),
            output: workbookReader(parseWorkbook(new Uint8Array(readFileSync(outputPath)), "output.xlsx", BENCH_PARSE_LIMITS)),
            answerPosition: task.answerPosition,
            mode: task.mode,
          });
          row = rowFromScore(task.id, score, {});
        }
      } else {
        const startedAt = new Date().toISOString();
        const result: TaskRunResult = await runBenchTask({
          task,
          inputBytes: new Uint8Array(readFileSync(inputPath)),
          parsedGolden: parsedGoldenFor(goldenPath),
          infer: infer ?? (async () => { throw new Error("unreachable: agent mode"); }),
          skipPrompts: opts.baseline,
          category,
          agent,
        });
        writeFileSync(outputPath, result.outputBytes);
        row = rowFromScore(task.id, result.score, {
          planError: result.planError,
          scoreError: result.scoreError,
          editedCells: result.diagnostics.editedCellCount,
          unsupportedFunctions: result.diagnostics.unsupportedFunctions.length
            ? result.diagnostics.unsupportedFunctions
            : undefined,
          truncatedSheets: result.diagnostics.truncatedSheets.length
            ? result.diagnostics.truncatedSheets
            : undefined,
          attempts: result.diagnostics.attempts,
          usage: result.diagnostics.usage,
          elapsedMs: result.diagnostics.elapsedMs,
          notes: result.diagnostics.notes || undefined,
          turns: result.diagnostics.turns,
          toolCalls: result.diagnostics.toolCalls,
          submitOutcome: result.diagnostics.submitOutcome,
          cacheRead: result.diagnostics.cacheRead,
          cacheCreation: result.diagnostics.cacheCreation,
        });

        // Submission-grade inference log — see this function's doc comment
        // on logsDir. A write failure here must never turn an otherwise-
        // scored task into an error row, so it's caught and merely printed,
        // not allowed to propagate into the outer catch below.
        if (!opts.baseline) {
          try {
            const log = serializeTaskLog({
              header: {
                taskId: task.id,
                category,
                model: opts.model ?? MODEL,
                effort: opts.effort,
                mode: opts.mode,
                startedAt,
                instruction: task.instruction,
              },
              transcript: result.transcript,
              footer: {
                plan: result.plan,
                submitOutcome: result.diagnostics.submitOutcome,
                turns: result.diagnostics.turns,
                toolCalls: result.diagnostics.toolCalls,
                usage: result.diagnostics.usage,
                elapsedMs: result.diagnostics.elapsedMs,
                score: result.score,
              },
            });
            writeFileSync(join(logsDir, `${task.id}.jsonl`), log);
          } catch (logErr) {
            console.error(
              `      log write failed for ${task.id}: ${logErr instanceof Error ? logErr.message : String(logErr)}`,
            );
          }
        }
      }
    } catch (err) {
      row = rowFromScore(task.id, null, {
        scoreError: err instanceof Error ? err.message : String(err),
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
    rows.push(row);
    printRow(category, row);
  });

  rows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return rows;
}

/**
 * `note`, when given, prints one extra line ahead of the numbers — used
 * for Visualization, where every task's score is 0 by construction (no
 * answer_position — see run-task.ts) and printing that as an unqualified
 * "ACCURACY: 0.0%" would read as "the model failed every task" rather than
 * "this category isn't scored here at all". Minimal on purpose: the numeric
 * lines below are unchanged, so a reader who already knows to ignore them
 * for this category sees exactly the same report as before.
 */
function printAggregate(label: string, agg: AggregateScore, note?: string): void {
  console.log(`\n  ${label}`);
  if (note) console.log(`    ${note}`);
  console.log(`    tasks:                  ${agg.totalTasks}${agg.missingOutputs ? ` (${agg.missingOutputs} missing)` : ""}`);
  console.log(`    regression accuracy:    ${fmtPct(agg.regressionAccuracy)}   (unchanged cells preserved)`);
  console.log(`    modification accuracy:  ${fmtPct(agg.modificationAccuracy)}   (required changes produced)`);
  console.log(`    ACCURACY:               ${fmtPct(agg.accuracy)}   (tasks fully solved — the leaderboard number)`);
}

/**
 * Builds the agentic-loop runner `main()` passes to runBenchTask as `agent`.
 * Assumes the caller already gated construction on `!opts.baseline &&
 * !opts.scoreOnly && opts.mode === "tools"`.
 */
export function buildAgent(
  opts: Options,
): NonNullable<Parameters<typeof runBenchTask>[0]["agent"]> {
  return ({ workbook, system, userMessage }) =>
    runAgentLoop({
      workbook,
      userMessage,
      callTurn: makeAgentCallTurn({ system, effort: opts.effort, model: opts.model }),
    });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let infer: InferFn | null = null;
  if (!opts.baseline && !opts.scoreOnly) {
    if (!hasCredentials()) {
      console.error(
        "\n  No Anthropic credentials found.\n" +
          "  Set ANTHROPIC_API_KEY, or use --baseline / --score-only which make no model calls.\n",
      );
      process.exit(2);
    }
    infer = ({ system, userMessage, schema }) =>
      runValidated({ system, userMessage, schema, effort: opts.effort, model: opts.model });
  } else if (opts.baseline) {
    infer = async ({ schema }) => ({
      value: schema.parse({ edits: [] }),
      attempts: 0,
      usage: { input: 0, output: 0 },
    });
  }

  let agent: Parameters<typeof runBenchTask>[0]["agent"] | undefined;
  if (!opts.baseline && !opts.scoreOnly && opts.mode === "tools") {
    agent = buildAgent(opts);
  }

  const mode = opts.scoreOnly
    ? "score-only"
    : opts.baseline
      ? "baseline (no model)"
      : `model ${opts.model ?? MODEL}, effort ${opts.effort}, mode ${opts.mode}`;
  console.log(`\nSpreadsheetBench 2 — ${mode}`);
  console.log(`dataset: ${opts.datasetDir}`);

  const perCategory = new Map<Category, TaskReportRow[]>();
  for (const category of opts.categories) {
    perCategory.set(category, await runCategory(opts, category, infer, agent));
  }

  console.log("\n" + "=".repeat(64));
  const all: TaskReportRow[] = [];
  for (const [category, rows] of perCategory) {
    printAggregate(
      category,
      aggregateScores(rows),
      category === "Visualization"
        ? "UNSCORED — VLM-judged by the official evaluator; the numbers below are not a capability score."
        : undefined,
    );
    all.push(...rows);

    const reportDir = join(opts.outDir, category);
    mkdirSync(reportDir, { recursive: true });
    const report = {
      benchmark: "SpreadsheetBench-2",
      category,
      mode,
      dataset: opts.datasetDir,
      generatedAt: new Date().toISOString(),
      aggregate: aggregateScores(rows),
      tasks: rows,
    };
    const reportPath = join(reportDir, "report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`    report: ${reportPath}`);
  }

  if (perCategory.size > 1) {
    printAggregate("OVERALL (all categories)", aggregateScores(all));
  }
  console.log();
}

// Only run the CLI when this file is the actual entrypoint (`tsx
// scripts/benchmark.ts ...` / `npm run bench`), not when it is imported,
// so parseArgs/buildAgent can be used without spinning up the whole CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
