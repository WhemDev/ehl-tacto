/**
 * Dry-score the "uncalculated recalc" fix with ZERO model calls: runs the
 * real scoring pipeline — runBenchTask, which itself drives applyEditPlan,
 * appliedPlanReader and scoreTask exactly as run-task.ts does for a live
 * benchmark run — against real dataset files, submitting the EMPTY edit
 * plan (`{ edits: [] }`). Nothing here reimplements scoring; the whole
 * point is that this script's scoring path IS the production path.
 *
 * Why this measures the fix in isolation: 02_Project PP, 11_Project
 * Switchgear and 16_05 (and no other Financial_Model family) ship input
 * files whose formula cells were saved with no cached value at all — see
 * .superpowers/sdd/reports/fix3-uncached-recalc.md. Scoring an untouched
 * (empty-plan) submission against those tasks isolates exactly what
 * recalculating uncached cells contributes to modification accuracy, with
 * no model behavior in the mix: every remaining mismatch is either a cell
 * the golden genuinely changed (which an empty plan can never produce, by
 * construction) or a disagreement between this engine and Excel on a
 * formula the file already had — a candidate engine bug, not a scoring bug.
 *
 *   npm run bench:dry-score
 *   npm run bench:dry-score -- --ids 02_01,02_02,11_01
 *   npm run bench:dry-score -- --dataset path/to/dataset --category Financial_Model
 *
 * Local tooling, like bench-digest-sweep.ts — the dataset is not in git, so
 * this is not a vitest test.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDatasetJson, type Category } from "../lib/bench/dataset";
import { workbookReader } from "../lib/bench/readers";
import { BENCH_PARSE_LIMITS, runBenchTask, type InferFn } from "../lib/bench/run-task";
import { parseWorkbook } from "../lib/workbook";

/** The family this fix targets, plus two fully-cached controls (01_02,
 *  01_04) that must score identically before and after the fix — see the
 *  acceptance table in fix3-uncached-recalc.md. */
const DEFAULT_IDS = [
  "02_01", "02_02", "02_03", "02_04", "02_05",
  "11_01", "11_02", "11_03", "11_04", "11_05",
  "16_05",
  "01_02", "01_04",
];

const MAX_MISMATCHES_SHOWN = 10;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`.padStart(6);
}

/** Never calls a model: parses `{ edits: [] }` through the task's own
 *  schema, exactly like scripts/benchmark.ts's `--baseline` mode. */
const emptyPlanInfer: InferFn = async ({ schema }) => ({
  value: schema.parse({ edits: [] }),
  attempts: 0,
  usage: { input: 0, output: 0 },
});

async function main() {
  const argv = process.argv.slice(2);
  const datasetDir = resolve(
    flag(argv, "dataset") ?? process.env.SPREADSHEETBENCH_DIR ?? "data/spreadsheetbench-v2",
  );
  const category = (flag(argv, "category") ?? "Financial_Model") as Category;
  const ids = flag(argv, "ids")?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_IDS;

  const categoryDir = join(datasetDir, category);
  const datasetJson = join(categoryDir, "dataset.json");
  if (!existsSync(datasetJson)) {
    console.error(
      `\n  No dataset at ${datasetJson}.\n` +
        `  Download it first:\n\n` +
        `    hf download KAKA22/SpreadsheetBench-v2 --repo-type dataset --local-dir ${datasetDir}\n`,
    );
    process.exit(2);
  }

  const byId = new Map(parseDatasetJson(readFileSync(datasetJson, "utf8"), category).map((t) => [t.id, t]));

  console.log(`\nDry-score (empty plan, zero model calls) — ${category}, ${ids.length} task(s)`);
  console.log(`dataset: ${datasetDir}\n`);

  for (const id of ids) {
    const task = byId.get(id);
    if (!task) {
      console.log(`${id.padEnd(8)} NOT FOUND in ${datasetJson}`);
      continue;
    }
    const inputPath = join(categoryDir, task.spreadsheetPath);
    const goldenPath = join(categoryDir, task.goldenResponsePath);
    if (!existsSync(inputPath) || !existsSync(goldenPath)) {
      console.log(`${id.padEnd(8)} input or golden file missing on disk`);
      continue;
    }
    const inputBytes = new Uint8Array(readFileSync(inputPath));
    const goldenBytes = new Uint8Array(readFileSync(goldenPath));

    const result = await runBenchTask({
      task,
      inputBytes,
      goldenBytes,
      infer: emptyPlanInfer,
      skipPrompts: true, // no digest, no grid appendix — nothing here reads them
      category,
    });

    if (!result.score) {
      console.log(`${id.padEnd(8)} SCORE ERROR — ${result.scoreError}`);
      continue;
    }

    const { score } = result;
    console.log(
      `${id.padEnd(8)} regression ${fmtPct(score.regressionAccuracy)} ` +
        `(${score.regression.correct}/${score.regression.total})   ` +
        `modification ${fmtPct(score.modificationAccuracy)} ` +
        `(${score.modification.correct}/${score.modification.total})`,
    );

    // Enrich the first few modification mismatches with formula text on
    // both sides. scoreTask()'s own errors[] (compare.ts) carry only
    // values — cell/formula context here is this script's own addition,
    // read through the identical CellReader machinery the scorer used, not
    // a reimplementation of the comparison itself.
    const modErrors = score.errors.filter((e) => e.startsWith("Modification error at"));
    if (modErrors.length > 0) {
      const workbook = parseWorkbook(inputBytes, "input.xlsx", BENCH_PARSE_LIMITS);
      const golden = parseWorkbook(goldenBytes, "golden.xlsx", BENCH_PARSE_LIMITS);
      const inputReader = workbookReader(workbook);
      const goldenReader = workbookReader(golden);

      for (const err of modErrors.slice(0, MAX_MISMATCHES_SHOWN)) {
        console.log(`    ${err}`);
        const m = /^Modification error at (.+)!([A-Za-z]+\d+):/.exec(err);
        if (!m) continue;
        const [, sheet, cell] = m;
        console.log(`        golden formula/value: ${String(goldenReader.formulaOrValue(sheet, cell))}`);
        console.log(`        input  formula/value: ${String(inputReader.formulaOrValue(sheet, cell))}`);
      }
      if (modErrors.length > MAX_MISMATCHES_SHOWN) {
        console.log(`    (+${modErrors.length - MAX_MISMATCHES_SHOWN} more modification mismatch(es) not shown)`);
      }
    }
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
