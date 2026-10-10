# SpreadsheetBench 2 — status and next steps

Handoff note, 2026-08-14. Branch `claude/cellwise-spreadsheet-benchmark-txom5i`,
PR [#2](https://github.com/WhemDev/cellwiser/pull/2) (draft).

**Where this stands in one line:** the harness is built and its scoring is
verified against the official evaluator, but **no scored run with a real model
has happened yet** — every run so far was `--baseline`, which makes no model
calls. Getting an actual score is the next step and needs an API key.

---

## What exists

| Path | Role |
| --- | --- |
| [`lib/bench/compare.ts`](../lib/bench/compare.ts) | The scorer. Port of the official `evaluation.py` comparison semantics. |
| [`lib/bench/edits.ts`](../lib/bench/edits.ts) | The edit-plan schema (per-workbook Zod) and its application through the formula engine. |
| [`lib/bench/prompts.ts`](../lib/bench/prompts.ts) | Benchmark system prompt + user message (digest + budgeted grid listing). |
| [`lib/bench/dataset.ts`](../lib/bench/dataset.ts) | `dataset.json` parsing, category modes, task filtering. |
| [`lib/bench/run-task.ts`](../lib/bench/run-task.ts) | One task end to end. Model call is injected, so tests drive it with a stub. |
| [`lib/bench/output.ts`](../lib/bench/output.ts) | Writes `{id}_output.xlsx` in the layout the official Python evaluator consumes. |
| [`lib/bench/readers.ts`](../lib/bench/readers.ts) | Adapts a parsed workbook to the two openpyxl-style views the scorer needs. |
| [`lib/formula/shift.ts`](../lib/formula/shift.ts) | Excel-style relative-reference fill (new engine capability). |
| [`scripts/benchmark.ts`](../scripts/benchmark.ts) | The CLI (`npm run bench`). |
| [`docs/spreadsheetbench.md`](spreadsheetbench.md) | How to run it and how to read the score. |

`Simulator.setFormula` was added to [`lib/formula/simulate.ts`](../lib/formula/simulate.ts);
`parseWorkbook` now takes optional row/column limits and iterates sparsely.

## What is verified

- **Scoring parity, unit level.** 5,408 value/formula pairs pushed through both
  the official Python `compare_cell_value` / `compare_cell_formula` and this
  port: **0 mismatches**. (This caught one real bug — Python's `round()` is
  exact-decimal banker's rounding, so `pythonRound` decomposes the double with
  BigInt rather than multiplying by a power of ten.)
- **Scoring parity, whole-task level.** The official `evaluation.py` was run on
  output files this harness produced:

  | Category | Tasks | Per-task agreement with official evaluator |
  | --- | --- | --- |
  | Template | 97 | 97 / 97 exact |
  | Financial_Model | 100 | 95 / 100 — see the openpyxl note below |
  | Debugging | 100 | **not finished** — the run was killed twice by container restarts |

  The 5 Financial_Model disagreements are the `06_01`–`06_05` family, and they
  are not a defect in the port: **openpyxl cannot open those dataset files at
  all**, throwing `unbound prefix` (an XML namespace error) on the *input* file
  before any of our code runs. The official evaluator therefore scores those 5
  as zero for every model that has ever run the benchmark, while our
  SheetJS-based reader opens them normally. Expect our number to read slightly
  *higher* than an official-pipeline number on that family.
- **Pipeline, end to end.** 71 unit/e2e tests, including a full stubbed-model
  run over synthetic .xlsx tasks and a round-trip proving the emitted output
  file scores identically when re-read from disk. `npm run check`: 2,497 tests
  green.
- **Real data, no model.** A `--baseline` run over all 297 scoreable tasks
  completes cleanly: regression accuracy 100%, modification accuracy 0%,
  accuracy 0%. That is the benchmark's floor by construction (baseline submits
  each input unchanged), and it confirms the loader, parser, scorer, and writer
  survive 297 real business workbooks. **It is not a capability score.**

## What is left

### 1. Run it with a model — the actual deliverable

Nothing here has measured Cellwise's ability yet. On a machine with an API key:

```bash
export ANTHROPIC_API_KEY=...            # or: ant auth login
npm run bench -- --category Financial_Model --limit 10   # first read, ~10 calls
npm run bench -- --category all --concurrency 4 --resume # full 297-task run
```

`--resume` skips tasks whose output file already exists, so an interrupted run
continues where it stopped. Results land in `bench-results/<Category>/report.json`
plus `output_excel/{id}_output.xlsx`.

Rough cost for the full 297-task run — assumptions stated because they move the
number a lot: ~30k input tokens per task (the grid appendix is budgeted at
~120k characters and these financial models routinely fill it), ~8k output
tokens per task including adaptive thinking at `--effort high`.

| Model | Rate (per MTok in/out) | Rough full-run cost |
| --- | --- | --- |
| `claude-sonnet-4-6` (current default) | $3 / $15 | ~$60 |
| `claude-sonnet-5` | $2 / $10 intro through 2026-08-31, then $3 / $15 | ~$40 intro |
| `claude-opus-5` | $5 / $25 | ~$105 |

Start with `--limit 10` on one category before committing to the full set —
that is roughly a couple of dollars and tells you whether the edit plans are
landing at all.

### 2. Consider moving the model off `claude-sonnet-4-6`

`lib/anthropic/client.ts` still pins `claude-sonnet-4-6`, which has no
structured-output mode — the edit plan is enforced by prompt plus Zod
validation plus one retry. `claude-sonnet-5` and `claude-opus-5` both support
structured outputs (`output_config.format`), which would make the edit-plan
schema **API-enforced** and demote our retry to a safety net. That matters more
here than in the app: a schema-invalid plan currently costs a whole extra call
and, if the retry also fails, scores the task as an untouched input. This is the
single change most likely to move the benchmark number, and the README already
flagged it as the intended direction.

Note both models also drop `temperature`/`top_p` and require adaptive thinking,
which `lib/anthropic/client.ts` already uses — so the switch is close to a
model-string change. `claude-opus-5` additionally has thinking on by default.

### 3. Finish the Debugging cross-check

`Financial_Model` and `Template` agree with the official evaluator; the
Debugging run never completed here (killed by container restarts, ~30 min under
openpyxl's double workbook load). To finish it:

```bash
# from a clone of RUCKBReasoning/SpreadsheetBench-2, with data/ symlinked
python3 evaluation/evaluation.py --model cellwise-baseline --dataset Debugging \
  --outputs-dir <repo>/bench-results/Debugging/output_excel --workers 6
```

Then diff its per-task `regression_accuracy` / `modification_accuracy` /
`accuracy` against `bench-results/Debugging/report.json`. Ten of those 100 tasks
are `Color` variants where this port deliberately skips font-color comparison
(SheetJS CE does not expose per-cell font colors) — expect those to disagree,
flagged as `fontColorSkipped` in our report.

### 4. Smaller open items

- **Visualization (24 tasks) is not attempted.** The official pipeline renders
  charts and judges them with a VLM over Excel COM on Windows; Cellwise has no
  charting. The CLI refuses the category with an explanation rather than
  scoring it zero silently.
- **Function coverage is the real ceiling.** The engine knows ~105 functions.
  A golden answer needing anything else can only be matched by a precomputed
  value, and every `#NAME?` is counted per task in `report.json`. After a real
  run, that list is the highest-signal backlog the benchmark produces.
- **Diagnostics worth reading after the first scored run:** `planError`
  (model never produced a valid plan), `formulaParseFailures` (our parser
  rejected a formula the model wrote), `unsupportedFunctions`, `truncatedSheets`.

---

## Environment notes

- **The dataset is not in git** (`/data/` is ignored, 252 MB unpacked). Get it
  with `hf download KAKA22/SpreadsheetBench-v2 --repo-type dataset --local-dir
  data/spreadsheetbench-v2`, or pull `spreadsheetbench-v2.zip` (134 MB) from the
  [dataset repo](https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2/tree/main)
  and unzip it there. `bench-results/` is ignored too.
- **`npm install` works normally on a Mac.** The sandbox this was built in
  blocked `cdn.sheetjs.com`, so SheetJS was installed there from the npm mirror
  (`@e965/xlsx@0.20.3`, byte-identical build) — that workaround was **not**
  committed, and `package.json` still points at the vendor CDN as before.
- The official evaluator needs `openpyxl` and `tqdm` (`pip install openpyxl tqdm`).
