# Spreadsheet analysis harness

A standalone copy of the spreadsheet-analysis engine from
[WhemDev/cellwiser](https://github.com/WhemDev/cellwiser) (commit `e88d886`),
with the Next.js app, database, auth and UI removed. What's left is the part
that **reads Excel workbooks, describes them to an LLM, lets the LLM explore
and edit them through tools, recalculates the result with a real formula
engine, and scores it**.

You can use it in three ways:

1. **As a library.** Parse `.xlsx` files, get a compact, token-budgeted
   summary of them, query cells, trace formulas, and run what-if
   recalculations. No API key needed.
2. **As an agent harness.** Give Claude a workbook and a task. It reads the
   digest, calls retrieval tools (`read_range`, `search_cells`, `trace_cell`,
   `lookup_defined_names`) and submits an edit plan. The harness validates the
   plan and evaluates it through the formula engine before accepting it.
3. **As a benchmark runner.** Score the whole pipeline against
   [SpreadsheetBench 2](https://spreadsheetbench.github.io/) (321 real
   business spreadsheet tasks), using a verified port of the official
   evaluator.

---

## Quick start

```bash
cd spreadsheet-harness
npm install          # needs network access to cdn.sheetjs.com (see Notes)
npm run example      # model-free tour on a bundled sample workbook
npm run check        # typecheck + ~2,700 unit tests
```

`npm run example` runs [`examples/analyze.ts`](examples/analyze.ts). Its
output looks like this:

```
# capacity.xlsx: 2 sheet(s), digest ≈ 1266 tokens
- Work Centers: 2 formula pattern(s)
    G2:G7 (x6)  =C{r}*D{r}*E{r}*F{r}
    I2:I7 (x6)  =G{r}*H{r}
...
what-if: WORK CENTERS!C2 := 0 → Work Centers!G2 150 → 0
```

To run it on your own file:

```bash
npx tsx examples/analyze.ts path/to/your.xlsx
```

---

## How it works

```
 .xlsx bytes
     │
     ▼
 parseWorkbook ──► ParsedWorkbook (sparse grid: values, formulas, styles, names)
     │                    │
     │                    ├──► createSimulator ──► formula engine (dependency graph,
     │                    │                        ~105 Excel functions, recalc)
     ▼                    │
 buildFileDigest          │
 (≤ 8k tokens/file)       │
     │                    │
     ▼                    ▼
 prompt + grid appendix ──► runAgentLoop ──► Claude
                               ▲   │  tool calls: read_range / search_cells /
                               │   │              trace_cell / lookup_defined_names
                               │   ▼
                               └── submit_edit_plan ──► validate (Zod, against the
                                                        real workbook) ──► apply through
                                                        the engine ──► feedback once
                                                                │
                                                                ▼
                                                  buildOutputXlsx ──► output .xlsx
                                                                │
                                                                ▼
                                                  compare.ts ──► score vs golden
```

The main design ideas:

- **The digest always fits its budget.** Real financial models can have more
  than 10,000 defined names and hundreds of columns. The digest ranks and caps
  them, tightens through a series of shrink plans, and adds a note for
  everything it left out, so the model knows to fetch it with a tool. It never
  sends more than the token budget.
- **Formula patterns are collapsed.** 42 cells of `=E2-F2`, `=E3-F3`, … become
  one line, `K2:K43 (x42) =E{r}-F{r}`. Absolute anchors such as `$B$2` are
  kept, because they show which table is the source of truth.
- **The model's edits are checked before they're accepted.** An edit plan is
  validated against the actual sheets and ranges, then executed in the formula
  engine. Errors like `#NAME?` or parse failures are sent back to the model so
  it can correct them.
- **Only cells affected by an edit take engine values.** Cells that no edit
  reached keep the values Excel cached in the file. That way, a place where
  the engine and Excel disagree is never counted as damage done by the plan.

---

## Folder map

| Path | What it is |
| --- | --- |
| [`lib/workbook.ts`](lib/workbook.ts) | SheetJS → `ParsedWorkbook` (sparse grid). `parseWorkbook(bytes, name, limits?)` |
| [`lib/workbook-styles.ts`](lib/workbook-styles.ts) | Reads cell styles/number formats from the raw xlsx |
| [`lib/digest.ts`](lib/digest.ts) | `buildFileDigest(wb, budget)`: headers, column types, sections, repeated blocks, period axes, formula patterns |
| [`lib/analysis/`](lib/analysis/) | Retrieval tools (`readRange`, `searchCells`, `traceCell`, `lookupDefinedNames`), completeness checks, formula-outlier detection |
| [`lib/agent/`](lib/agent/) | The agent loop (`runAgentLoop`), tool definitions, grid appendix, restraint/axis checks on submitted plans |
| [`lib/formula/`](lib/formula/) | TypeScript Excel formula engine: tokenizer → parser → AST → evaluator, dependency graph, fill/shift, `createSimulator` |
| [`lib/plan/`](lib/plan/) | Edit-plan schema (`makeEditPlanSchema`), `applyEditPlan`, `buildOutputXlsx` (write result back to .xlsx) |
| [`lib/charts/`](lib/charts/) | Chart spec → DrawingML compiler and xlsx injection (for Visualization tasks) |
| [`lib/anthropic/`](lib/anthropic/) | Anthropic client (`MODEL = claude-sonnet-5`), validated JSON calls with one retry |
| [`lib/bench/`](lib/bench/) | SpreadsheetBench 2: dataset parsing, prompts, per-task runner, scorer (`compare.ts`), logs |
| [`lib/ir/schema.ts`](lib/ir/schema.ts) | Shared Zod types the prompts and plans reference |
| [`scripts/benchmark.ts`](scripts/benchmark.ts) | `npm run bench`: the benchmark CLI |
| [`scripts/bench-digest-sweep.ts`](scripts/bench-digest-sweep.ts) | Measure digest size across the dataset (no model calls) |
| [`scripts/bench-dry-score.ts`](scripts/bench-dry-score.ts) | Score without a model (sanity check of the scorer) |
| [`simulation/`](simulation/) + [`scripts/dump-oracle.py`](scripts/dump-oracle.py) | Python reference formula engine used to generate the oracle fixtures the TS engine is tested against |
| [`public/samples/`](public/samples/), [`public/scenarios/`](public/scenarios/) | Small synthetic workbooks used by tests and the example |
| [`test/`](test/) | Vitest suites for everything above |
| [`docs/`](docs/) | Upstream design notes: benchmark guide, status/handoff, layered-analysis design |

---

## Using it as a library

```ts
import { readFileSync } from "node:fs";
import { parseWorkbook } from "./lib/workbook";
import { buildFileDigest } from "./lib/digest";
import { readRange, searchCells, traceCell, lookupDefinedNames } from "./lib/analysis/tools";
import { createSimulator } from "./lib/formula/simulate";

const wb = parseWorkbook(new Uint8Array(readFileSync("model.xlsx")), "model.xlsx");

const digest = buildFileDigest(wb);              // compact JSON summary, ≤ 8k tokens
readRange(wb, "Sheet1", "A1:H20").text;          // cell contents as text (formula -> value)
searchCells(wb, "revenue", { limit: 20 });       // where does a label/value appear?

const sim = createSimulator(wb);                 // live formula engine over the workbook
traceCell(sim, "Sheet1", "H20", "precedents");   // what feeds this cell?
await sim.setValue("Inputs", "B3", 0.25);        // what-if
await sim.recalculate();
sim.getValue("Sheet1", "H20");
```

To keep big files intact for full analysis, pass larger parse limits. By
default, sheets are capped at 5,000 rows × 100 columns; the benchmark uses
Excel's full maxima:

```ts
import { BENCH_PARSE_LIMITS } from "./lib/bench/run-task";
parseWorkbook(bytes, name, BENCH_PARSE_LIMITS); // 1,048,576 × 16,384
```

## Using it as an agent harness

[`lib/bench/run-task.ts`](lib/bench/run-task.ts) (`runBenchTask`) runs one
task from start to finish, and you inject the model call. That makes it the
easiest place to start wiring the harness into your own agent: reuse
`runAgentLoop` from [`lib/agent/loop.ts`](lib/agent/loop.ts) with the tool set
from [`lib/agent/tools.ts`](lib/agent/tools.ts), and swap the benchmark prompt
in [`lib/bench/prompts.ts`](lib/bench/prompts.ts) for your own task
description. Limits: 12 assistant turns and 40 tool calls per task.

Tests drive the loop with a stubbed model, so you can try new tools or prompts
without spending tokens. See
[`test/bench-agent-loop.test.ts`](test/bench-agent-loop.test.ts) and
[`test/bench-run-task.test.ts`](test/bench-run-task.test.ts).

## Running the benchmark

```bash
cp .env.example .env.local            # fill in ANTHROPIC_API_KEY
set -a; source .env.local; set +a

# one-time dataset download (several GB, kept out of git via .gitignore)
hf download KAKA22/SpreadsheetBench-v2 --repo-type dataset --local-dir data/spreadsheetbench-v2

npm run bench -- --category Template --baseline          # free: no model calls, shows the floor
npm run bench -- --category Financial_Model --limit 5    # 5 real tasks
npm run bench -- --category all --concurrency 4 --resume # full, restartable run
```

Results go to `bench-results/<Category>/`. Each category gets a
`report.json` with per-task details, plus `output_excel/{id}_output.xlsx` in
the layout the official Python evaluator reads. Run
`npx tsx scripts/benchmark.ts` for the full flag list (`--mode tools|single`,
`--effort`, `--model`, `--score-only`, …). For how to
read the score, see [docs/spreadsheetbench.md](docs/spreadsheetbench.md).

---

## Notes

- **SheetJS is installed from its vendor CDN** (`cdn.sheetjs.com`), not npm.
  The npm `xlsx` package is abandoned at 0.18.5 and has open security
  advisories.
- **The engine supports about 105 Excel functions.** Anything outside that set
  evaluates to `#NAME?`, and the benchmark report counts these.
- **Known failing tests:** 2 tests in `test/digest-period-axis.test.ts` (the
  monthly/annual period-axis grouping) fail. They fail the same way in
  upstream cellwiser at `e88d886`, so this extraction didn't cause them. The
  rest pass: 2,718 passed and 16 skipped (skipped suites need the downloaded
  dataset or a private `Excaliba.xlsx` workbook).
- **Not included:** the Next.js UI, the animation player, the Works/runs
  store, Supabase, auth/metering, the workflow-IR inference routes, and
  upstream's AWS Bedrock backend (this copy talks to Claude only through
  `ANTHROPIC_API_KEY`). For
  those, see the upstream repo.
- **Syncing with upstream:** this is a one-time copy, not a submodule. To
  pick up upstream changes, re-copy the matching paths from `WhemDev/cellwiser`
  (every file here keeps its original path).
