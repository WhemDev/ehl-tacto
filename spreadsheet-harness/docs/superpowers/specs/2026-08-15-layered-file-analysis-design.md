# Layered file analysis: budget-honest digest + an agentic tool loop

Date: 2026-08-15

## The problem

The first real SpreadsheetBench 2 model run died before spending a token:
`Financial_Model/01_01` produced a **1,175,117-token prompt** against the
API's 1,000,000 ceiling. Measured breakdown (probe on the real file):

```
definedNames   1,610,836 chars  (~450k tok)  10,739 names, mostly legacy junk
sheet sections   289,973 chars  (~80k tok)   per-column stats × 25 sheets, up to 165 cols
grid appendix    135,341 chars  (~38k tok)   budgeted (minor ~13% overshoot)
everything else     small
```

`buildFileDigest` ([lib/digest.ts](../../../lib/digest.ts)) has a 8,000-token
budget and five shrink plans — but the plans only shrink `sampleRows` and
`formulaPatterns`, the two *smallest* fields. `definedNames` and `sections`
are never touched, so for a workbook shaped like a real 20-year-old financial
model the budget is fiction: the tightest plan still emits **554k tokens** and
the code ships it anyway. Any Cellwise user could upload this same file
tomorrow; this is a product bug the benchmark happened to catch first.

## Decisions taken (with the user)

- **Staging:** Stage 1 fixes the budget and produces a scored single-shot
  baseline; Stage 2 builds the layered tool architecture and must beat that
  baseline. Both stages ship; neither is skipped.
- **Stage 2 scope:** bench-first. The analysis tools are built as shared
  library code; the benchmark runner is the first consumer. `/api/infer`
  adoption is a follow-up project, not part of this one.
- **Interaction shape:** Approach B — rich budget-honest context up front
  *plus* retrieval tools for what the budget cut, with a strict terminal
  submit tool. Chosen over a pure agentic explorer (overhead on easy tasks,
  bigger behavioral leap from the measured baseline) and a two-phase scripted
  pipeline (no recovery, no reusable tool surface).
- **Model:** `claude-sonnet-5` (already the pinned `MODEL`), effort via the
  existing `--effort` flag.

## Stage 1 — `buildFileDigest` honors its budget, always

**Contract:** `buildFileDigest(wb, budget)` never returns a digest whose
estimate exceeds `budget`, for any input workbook.

Changes in [lib/digest.ts](../../../lib/digest.ts):

1. **Defined names: ranked, filtered, capped.** Render priority: names
   referenced by the workbook's formulas first, then valid-ref names, then
   the rest; junk refs (array literals, `#REF!`) always last. Cap by plan:
   200 → 100 → 50 → 25 → 10. Always emit one note line with the omitted
   count (`10,539 more defined names omitted`) so the model knows they exist
   and can retrieve them (Stage 2's `lookup_defined_names`).
2. **Sections join the shrink plans.** New per-plan `sectionColumns`
   dimension (60 → 40 → 25 → 12 → 6 columns per sheet), truncation noted
   per sheet.
3. **Hard floor after the tightest plan.** Degrade in order: drop sample
   rows → drop formula-pattern examples → shrink per-sheet detail
   proportionally, largest sheets first. Never dropped: the complete sheet
   list (names + dimensions) and the notes recording what was cut. A final
   explicit check enforces the post-condition; if somehow still over, the
   rendered form is truncated with a note — never shipped 70× over budget.
4. **Grid appendix share fix (minor):** the per-sheet floor
   (`min(4000, budget/sheets) × 25 sheets` plus weighted shares) can
   overshoot the 120k-char budget by ~13%. Normalize shares so the total
   respects the budget.

Not changed in Stage 1: prompts, model, scoring, the app's inference route.
Existing digest tests pass untouched (fixtures never hit the caps); new
tests cover caps and floor.

**Immediately after landing:** re-run `01_01` (expected ~50k input tokens,
was 1.17M), then `Financial_Model --limit 10` — the single-shot baseline.

## Stage 2 — shared tool layer + agentic bench loop

### Tool layer (`lib/analysis/tools.ts`)

Pure functions over a `ParsedWorkbook`. The bench consumes them now; the app
adopts them later.

| Tool | Contract |
| --- | --- |
| `read_range(sheet, range)` | Sparse cell listing (formula + computed value), grid-appendix rendering. Char-capped ~15k/call, truncation noted. |
| `search_cells(query, {sheets?})` | Substring/regex over cell text *and* formula text. Addresses + content, capped at 100 matches. |
| `trace_cell(sheet, cell, direction)` | Direct precedents or dependents (depth ≤ 2) from parsed formulas. |
| `lookup_defined_names(filter)` | Name→ref pairs matching a filter, capped — retrieval complement of the Stage 1 digest cap. |
| `submit_edit_plan(plan)` | **Terminal.** `strict: true`; input schema is the edit-plan schema (Zod union → `anyOf`, `additionalProperties: false` throughout — strict-compatible). |

The digest's truncation notes name the retrieval tool for each cut ("use
`lookup_defined_names` / `read_range` to fetch"), so the model knows exactly
how to recover what the budget removed.

### Submit pipeline — verify before accept

On `submit_edit_plan`:

1. **Semantic validation** (today's checks: sheets exist, ranges bounded).
   Failure → `tool_result` error, loop continues. This gate applies to
   every submit, including the last.
2. **Engine verification** — apply the plan through the formula engine and
   collect evaluation errors on edited cells (`#NAME?`, `#REF!`, parse
   failures). Errors return **once** as a warning `tool_result`; the model
   may revise. A second engine-warned submit (that passed step 1) is
   accepted as final — no ping-pong. A clean submit ends the loop
   immediately.

This is a scoring lever the official harness's agents don't have: the exact
errors that would zero a task come back as feedback before acceptance.

### Loop mechanics

- TS SDK beta `toolRunner` (`client.beta.messages.toolRunner`) with
  `betaTool` raw-JSON-schema definitions; run functions close over the
  parsed workbook. Streaming on; `MAX_TOKENS` 64k unchanged.
- **Caps:** 12 assistant turns / 40 tool calls. Cap with a warned-but-valid
  plan → use it; with nothing → `planError`, task scored on unchanged input
  (current fallback semantics preserved).
- **Caching (3 of 4 breakpoints):** after the system prompt (tools + system
  are byte-identical across all 297 tasks → cross-task cache); on the
  initial user message (digest + appendix, cached across turns within a
  task); a moving breakpoint on the latest turn. The tool set never changes
  mid-task, so the prefix survives. Extra turns re-read the big prefix at
  ~0.1×.

### Bench wiring

- [lib/bench/run-task.ts](../../../lib/bench/run-task.ts) gains an injected
  agentic path alongside the existing `infer` seam — tests script the
  model's turns; tool executors run real.
- [scripts/benchmark.ts](../../../scripts/benchmark.ts) gains
  `--mode tools|single` (default `tools` once Stage 2 lands; until then the
  single-shot path is the only one); `single` keeps the Stage 1 path alive
  for the A/B.
- New per-task diagnostics: turns, per-tool call counts, cache-read tokens,
  `submitOutcome` (`clean` | `warned` | `capped` | `planError`).

## Error handling — the loop never crashes a task

- Tool execution errors (unknown sheet, malformed range) →
  `tool_result` with `is_error: true` and an actionable message.
- API errors → SDK retries (429/5xx); terminal failure → `planError` →
  unchanged-input scoring.
- Submit failures → the pipeline above.
- Cap exhaustion → warned plan if any, else `planError`.

## Testing

- **Per-tool unit tests** on existing synthetic fixtures: `read_range`
  rendering + cap, `search_cells` hit sets, `trace_cell`
  precedents/dependents, defined-name lookup, and a snapshot asserting the
  submit tool's JSON schema is strict-compatible.
- **Budget tests:** a stress fixture shaped like `01_01` (thousands of junk
  defined names, a 150-column sheet) → digest ≤ budget, sheet list complete,
  omissions noted. Existing flat-table fixtures byte-unchanged.
- **Loop tests** with a scripted model stub through the injected seam (no
  API calls): `[read, read, submit-valid]` → plan applied;
  `[submit-invalid, submit-valid]` → error fed back;
  `[submit-with-#NAME?, revised]` → warning path; cap exhaustion →
  `planError`.
- **Dataset sweep script** (local, not CI — dataset is not in git): build
  digests for all 297 inputs, assert all within budget, print the worst.
- `npm run check` green throughout.

## Measurement

1. **Stage 1 baseline:** `01_01`, then `Financial_Model --limit 10
   --mode single`. Record score, tokens/task, wall-clock, `planError`s,
   `unsupportedFunctions`.
2. **Stage 2 A/B:** same 10 tasks, `--mode tools`. Compare score delta,
   cache-adjusted cost delta, `submitOutcome` distribution.
3. **Full-run gate (user decides — it costs real money):** rough estimate
   ~$0.20–0.30/task → **~$60–90 for all 297** at Sonnet 5 intro pricing.
4. **After the run:** the ranked `unsupportedFunctions` list is the
   formula-engine backlog — the benchmark feeding the product.

### Score expectations (hypothesis, not promise)

Reference point: Claude Opus 4.6 scores 35% on this benchmark via the
official harness. Against that — working against us: the ~105-function
engine ceiling (accuracy is all-or-nothing per task; one `#NAME?` in a
scored cell zeroes the task), 10 unscoreable font-color Debugging tasks,
no Visualization category (quote results as "297-task subset"). Working for
us: richer context than the official raw cell paging, strict schemas, and
verify-before-submit. Honest bands: **Stage 1 single-shot ~15–25%; Stage 2
~25–40%, with 35% a legitimate target.** Where we land inside the band is
dominated by function coverage on the actual golden formulas — which
`unsupportedFunctions` turns into data after the first run.

## Out of scope (recorded so it stays deliberate)

- `/api/infer` adoption of the tool loop — the agreed follow-up project.
  The tool layer is built as shared lib code precisely so that project is
  small.
- The Visualization category (24 tasks; needs charting + VLM judging).
- Formula-engine function additions — driven by the backlog the first real
  run produces, as separate work.
