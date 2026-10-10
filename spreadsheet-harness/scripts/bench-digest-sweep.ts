/**
 * Sweep every scoreable task input in the local dataset through
 * buildFileDigest and report budget violations. Local tooling — the dataset
 * (252 MB) is not in git, so this is not a vitest test.
 *
 *   npm run bench:digest-sweep            # default dataset dir
 *   npm run bench:digest-sweep -- --dataset path/to/dataset
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDatasetJson, SCOREABLE_CATEGORIES } from "../lib/bench/dataset";
import { buildFileDigest, TOKEN_BUDGET_PER_FILE } from "../lib/digest";
import { parseWorkbook } from "../lib/workbook";

const argv = process.argv.slice(2);
const flagIdx = argv.indexOf("--dataset");
const datasetDir = resolve(
  (flagIdx !== -1 ? argv[flagIdx + 1] : undefined) ??
    process.env.SPREADSHEETBENCH_DIR ??
    "data/spreadsheetbench-v2",
);

let checked = 0;
let over = 0;
const largest: { id: string; tokens: number }[] = [];

for (const category of SCOREABLE_CATEGORIES) {
  const datasetJson = join(datasetDir, category, "dataset.json");
  if (!existsSync(datasetJson)) {
    console.error(`skip ${category}: no dataset.json at ${datasetJson}`);
    continue;
  }
  const tasks = parseDatasetJson(readFileSync(datasetJson, "utf8"), category);
  for (const task of tasks) {
    const inputPath = join(datasetDir, category, task.spreadsheetPath);
    if (!existsSync(inputPath)) continue;
    const wb = parseWorkbook(new Uint8Array(readFileSync(inputPath)), "input.xlsx");
    const digest = buildFileDigest(wb);
    checked++;
    largest.push({ id: `${category}/${task.id}`, tokens: digest.approxTokens });
    if (digest.approxTokens > TOKEN_BUDGET_PER_FILE) {
      over++;
      console.error(`OVER BUDGET  ${category}/${task.id}: ${digest.approxTokens} tokens`);
    }
  }
}

largest.sort((a, b) => b.tokens - a.tokens);
console.log(`\nchecked ${checked} inputs against a ${TOKEN_BUDGET_PER_FILE}-token budget`);
console.log(`largest digests:`);
for (const l of largest.slice(0, 10)) console.log(`  ${l.id}: ${l.tokens} tokens`);
console.log(over === 0 ? `\nall within budget` : `\n${over} OVER BUDGET`);
process.exit(over === 0 ? 0 : 1);
