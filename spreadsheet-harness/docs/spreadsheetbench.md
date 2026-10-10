# SpreadsheetBench 2 harness

`npm run bench` measures Cellwise's own pipeline — SheetJS parsing, the
digest, the schema-validated model call, and the TypeScript formula engine —
against [SpreadsheetBench 2](https://spreadsheetbench.github.io/)
([paper](https://arxiv.org/abs/2606.29955)), a benchmark of 321 real business
spreadsheet tasks across four categories: `Debugging`, `Financial_Model`,
`Template`, and `Visualization`.

## Getting the dataset

The dataset is not bundled (it is several GB of real workbooks). Download it
once from [Hugging Face](https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2):

```bash
hf download KAKA22/SpreadsheetBench-v2 --repo-type dataset \
    --local-dir data/spreadsheetbench-v2
```

The runner looks in `data/spreadsheetbench-v2` by default; override with
`--dataset <dir>` or `SPREADSHEETBENCH_DIR`.

## Running

```bash
npm run bench -- --category Financial_Model --limit 5   # dip a toe (5 model calls)
npm run bench -- --category all                          # the full scoreable set
npm run bench -- --category Debugging --ids 3,17         # specific tasks
npm run bench -- --category Template --baseline          # no model calls: the floor
npm run bench -- --category all --concurrency 4 --resume # restartable long run
npm run bench -- --category Template --score-only <dir>  # score any {id}_output.xlsx set
```

Each task is one model call (`ANTHROPIC_API_KEY` required except in
`--baseline` / `--score-only`). `--resume` skips tasks whose output file
already exists and scores it from disk, so an interrupted run continues
where it stopped.

## Modes

`--mode tools` (default) runs each task as an agentic loop: the model gets
the budget-honest digest and grid listing up front, plus retrieval tools —
`read_range`, `search_cells`, `trace_cell`, `lookup_defined_names` — and
finishes by calling `submit_edit_plan`. Submitted plans are validated and
evaluated through the formula engine before acceptance; evaluation errors
(#NAME?, parse failures) are fed back once so the model can correct them.
Caps: 12 assistant turns / 40 tool calls per task, then the task falls back
to the standard planError scoring (unchanged input).

`--mode single` is the pre-tools single-shot path, kept for A/B comparison:
one prompt, one validated JSON response, one retry on validation failure.

Per-task diagnostics in `report.json` gain `turns`, `toolCalls`,
`submitOutcome` (`clean | warned | capped | planError`) and `cacheRead`
tokens in tools mode.

## What a run does

For every task the harness:

1. parses the input workbook (`lib/workbook.ts`) and builds the same digest
   the app sends to `/api/infer` (`lib/digest.ts`), plus a budgeted grid
   listing of actual cell contents;
2. asks the model for an **edit plan** — concrete cell edits (formula /
   value / grid / clear per range), validated with Zod against the actual
   workbook so a typo'd sheet or range is fed back for one correction, the
   same loop the workflow IR uses;
3. applies the plan through the formula engine (`lib/formula/simulate.ts`):
   new formulas are parsed, wired into the dependency graph, filled across
   ranges with Excel's relative-reference semantics (`lib/formula/shift.ts`),
   and the workbook recalculates. Only cells inside the edits' blast radius
   (edited, or downstream of an edit in the dependency graph) take engine
   values; untouched cells keep the file's own Excel-computed cached values,
   so an engine/Excel disagreement on a cell no edit reached is never scored
   as damage the plan did;
4. scores the result against the golden file with a verified port of the
   official evaluator (`lib/bench/compare.ts`), and writes
   `<out>/<Category>/output_excel/{id}_output.xlsx` — the exact layout the
   official Python evaluator consumes, so any run can be independently
   re-scored with the reference pipeline.

The model never sees `answer_position` (the scored ranges) — the same
information boundary the official harness gives its agents.

## Reading the score

Cells named by a task's `answer_position` split into **regression** cells
(identical in input and golden — the task must not disturb them) and
**modification** cells (changed by the golden answer — the task must produce
them). Per task:

- `regressionAccuracy` — fraction of regression cells preserved; ≥ 99.8%
  counts as 1.0 (official rule);
- `modificationAccuracy` — fraction of modification cells correct, under 1%
  numeric tolerance, date-serial equivalence, `#N/A`-style placeholder
  equivalence, and case/anchor-insensitive formula comparison;
- `accuracy` — 1 only when both of the above are 1.0.

The headline number — the one comparable to the paper's leaderboard — is the
mean `accuracy`: the fraction of tasks fully solved. `report.json` in each
category's results folder carries per-task detail: what was edited, the first
mismatching cell, formulas the engine could not parse, and functions outside
the registry (`#NAME?`).

Comparison semantics are locked to the reference implementation by a
differential test (5,408 value/formula pairs through both the official
`compare_cell_value`/`compare_cell_formula` and this port — zero mismatches)
and by running the official `evaluation.py` on harness-produced output files.

## Known limitations

- **Visualization tasks are not attempted.** They are judged on rendered
  charts by a VLM (on Windows, over Excel COM) in the official pipeline, and
  Cellwise has no charting.
- **Font-color checks are skipped** on Debugging tasks whose path contains
  `Color` — SheetJS CE does not reliably expose per-cell font colors. Those
  tasks are scored on values and flagged `fontColorSkipped` in the report;
  the official evaluator remains the authority for that slice.
- **The app's 5,000×100 grid cap does not apply to scoring.** The benchmark
  parses workbooks at Excel's own maxima (251 sheets in the dataset exceed
  100 columns), so the engine and the scorer see whole sheets; only the
  structural digest is built from an app-capped parse, with the budgeted
  grid appendix carrying full-size content to the model. A sheet that still
  overflows is flagged `TRUNCATED` rather than silently mis-scored.
- **The engine's function registry is the ceiling.** A golden answer needing
  a function outside the ~105 supported ones can only be matched by a
  precomputed value; the prompt says so and the report counts every
  `#NAME?`. This is a feature: the benchmark exists to show where the
  engine's coverage ends.
- Formula-mode comparison (Debugging `Embedded` tasks) compares the formulas
  the plan wrote; number-format-only changes are invisible to it, as they
  are to the official evaluator.
