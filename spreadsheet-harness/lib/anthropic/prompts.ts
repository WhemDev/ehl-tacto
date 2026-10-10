import { OPERATIONS, SOURCE_ROLES, type WorkflowIR } from "@/lib/ir/schema";
import type { FileDigest } from "@/lib/digest";
import { indexToCol, parseRange, type ClampBounds } from "@/lib/a1";
import { FUNCTION_REGISTRY } from "@/lib/formula/functions";

/** The IR shape, written for the model rather than for a validator. */
const IR_SHAPE = `{
  "version": "1.0",
  "title": string,                       // short name for the whole process
  "summary": string,                     // 2-3 sentences of plain language
  "sources": [
    {
      "id": string,                      // your own id, e.g. "src_orders"
      "fileName": string,                // must match a file name from the digest exactly
      "sheet": string,                   // must match a sheet name from that file exactly
      "role": ${SOURCE_ROLES.map((r) => `"${r}"`).join(" | ")}
    }
  ],
  "steps": [
    {
      "id": string,                      // "step_1", "step_2", ...
      "order": number,                   // 1-based, unique, no gaps
      "title": string,                   // 3-6 words
      "explanation": string,             // ONE sentence, for a factory planner
      "operation": ${OPERATIONS.map((o) => `"${o}"`).join(" | ")},
      "reads": [
        {
          "sourceId": string,            // must be one of your sources[].id
          "range": string,               // A1 only: "B2:F250", "D:D", "M1"
          "label": string,               // what this data is, in the planner's words
          "why": string                  // why this step needs it
        }
      ],
      "writes": [
        { "sourceId": string, "range": string, "label": string }
      ],
      "params": object,                  // operation-specific; {} when nothing to say
      "assumptions": string[],           // what you guessed rather than observed
      "unknowns": string[],              // questions only a human can answer
      "confidence": number,              // 0..1
      "solve": {                         // OPTIONAL — only for a search step, see WHEN TO SOLVE
        "write":  { "sourceId": string, "range": string },   // the empty cells to fill, e.g. "B6:BD6"
        "candidates":
            { "kind": "multiples", "ofCell": string, "maxMultiplier": number }  // 1..1000, e.g. batch sizes
          | { "kind": "range", "min": number, "max": number, "step": number },
        "target": { "sourceId": string, "rowOffset": number },  // cell to check, N rows below each written cell
        "constraint": { "min": number, "max": number, "hardMin": number, "hardMax": number },  // all optional
        "direction": "sequential" | "independent"
      }
    }
  ],
  "openQuestions": [
    {
      "id": string,                      // "q1", "q2", ... unique across the model
      "question": string,                // phrased so a planner can answer it directly
      "stepId": string,                  // optional; the step it came from
      "why": string,                     // what changes once it is answered
      "choices": string[]                // optional; 2-4 answers, ONLY for a real closed choice
    }
  ]
}`;

const SHARED_RULES = `HOW TO DECOMPOSE

Produce between 4 and 12 steps. Fewer than 4 is too coarse to be worth animating; more than 12 is unreadable. Each step should be one thing the planner would recognise as a distinct move: "pull the open orders", "look up the build hours", "decide what fits this week".

WHEN TO SOLVE

Some routines do not just compute a value — they search for one. The planner tries a number, looks at what it does to a downstream figure, and adjusts until that figure sits in an acceptable band. If the files show that shape, emit the step with a "solve" block instead of describing the trial-and-error in prose.

The shape to look for, all four parts present:
1. A row or column of empty cells someone fills in by hand (the thing being decided).
2. A downstream formula that reacts to those cells (stock level, coverage, utilisation, margin).
3. A stated or clearly implied acceptable band for that downstream figure.
4. A constraint on what values are even allowed — usually a batch/pack/pallet size, so only multiples of it are orderable.

Worked example. A production plan has Purchase Order cells empty across B6:BD6 (one per month), Stock Level three rows below in B9:BD9, a batch size in A10, and the planner says they keep stock between 2 and 2.5 months of cover and never let it go negative:

  "solve": {
    "write": { "sourceId": "src_plan", "range": "B6:BD6" },
    "candidates": { "kind": "multiples", "ofCell": "A10", "maxMultiplier": 12 },
    "target": { "sourceId": "src_plan", "rowOffset": 3 },
    "constraint": { "min": 2, "max": 2.5, "hardMin": 0 },
    "direction": "sequential"
  }

Field by field:
- "write" is the range of cells to fill. One row or one column.
- "candidates" is what values are allowed. Use "multiples" when a cell holds the batch/pack size — "ofCell" points at that cell and every multiple of it up to "maxMultiplier" is tried. maxMultiplier must be between 1 and 1000; pick the smallest number that plausibly covers demand. Use "range" only when the value is genuinely continuous.
- "target" is the figure being kept in band. "rowOffset" is how many rows BELOW each written cell it sits — 3 means writing B6 is judged by B9. A negative offset means above.
- "constraint": "min"/"max" are the band you are aiming for, "hardMin"/"hardMax" are lines that must not be crossed even if the band cannot be hit. All four are optional, but state at least one.
- "direction" is "sequential" when each cell's result feeds the next (a running stock balance almost always is) and "independent" when every cell stands alone.

Do NOT invent a constraint band. If the files and the description do not tell you what "good" looks like — the acceptable range, or which cell holds the batch size — then emit the step WITHOUT a "solve" block, put the specific missing fact in "unknowns", and add an entry to "openQuestions" asking for it. A solve block built on a guessed band produces confident, authoritative, wrong numbers, which is far worse than saying you need one more fact. Once the planner answers, a later pass can add the block.

A step with a "solve" block should use "operation": "compute" or "allocate", never "manual_judgment" — the whole point is that it is no longer a judgement call.

RANGES MUST BE REAL

Every "range" you write is going to be highlighted on an actual grid, so it has to exist:
- Use A1 notation only: "B2:F250", "D:D", "M1". Never prose, never "the quantity column".
- Only reference file names and sheet names that appear verbatim in the digest below.
- Only reference columns that the digest actually lists for that sheet, and stay inside the reported used range.
- If a step reads a whole column of data, prefer the bounded form ("E2:E43") over the open form ("E:E") when the digest tells you where the data ends.
- Never invent a sheet, a column, or a file that is not in the digest.

WHEN THE RULE IS NOT IN THE FILES

This is the most important instruction here. Some of what the planner does is not written down anywhere — it lives in their experience. A priority ordering with no formula behind it, an unwritten rule about which customer waits, a constraint that exists only because of something on the shop floor.

When you hit one of those, emit a step with "operation": "manual_judgment" and put the specific question in "unknowns". Do NOT invent a plausible-looking rule and present it as fact. A wrong rule stated confidently is worse than an honest question — the whole point of this output is to show the planner what the software does not know, so they can tell us.

Signals that you are looking at manual judgment: a column with typed-in values and no formula; a column that is only partly filled in; a description that says "I decide", "depends", "usually", or "I keep an eye on"; an output that cannot be derived from any input in the files.

SHEETS THAT ARE BLOCKS, NOT TABLES

Some sheets are several labelled blocks of rows stacked under one shared header row — a "FORECAST" block, a "PRODUCTION" block, a "STOCK" block. Where the digest lists blocks for a sheet, treat each one as a separate thing with its own meaning, and write ranges that cover a single block rather than the whole column.

A block whose columns are marked COMPLETELY EMPTY is almost always the thing being produced: someone fills it in, and doing so is the point of the whole routine. Make that explicit — a step that writes to it, with the emptiness noted in "assumptions". If the files do not say how the values are worked out, that step is a "manual_judgment" and the question goes in "unknowns".

Be careful with the sheet-level column statistics on such a sheet: they blend every block together, so a column can look half-empty when in truth one block is full and another is empty. Use each block's own figures.

CONFIDENCE, ASSUMPTIONS AND UNKNOWNS

These three fields are mandatory on every step and they are read by a human, so mean them:
- "confidence" near 0.9 when the step comes straight off an explicit formula you can see in the digest.
- Around 0.5-0.7 when it is implied by the data shape plus the user's description.
- Below 0.4 when you are inferring it only from the user's sentence, or guessing. A step below 0.4 MUST have at least one entry in "unknowns", and so must every "manual_judgment" step.
- "assumptions" is what you filled in yourself and could be wrong about.
- "unknowns" are questions phrased so a planner can answer them directly — "Do orders on hold still get planned?" not "Clarify status filtering semantics."

WRITING FOR THE READER

"explanation" is read by a production planner, not a developer. One sentence, plain language, no jargon, no formula syntax, no column letters. Say "count the days between today and the due date", not "compute DATEDIF on column F". Formula details belong in "params".

QUESTIONS THE PLANNER WILL ANSWER

"openQuestions" is a list the planner sees as a form, one box per question, so each entry must stand on its own:
- Give every question a stable id ("q1", "q2"). When you rewrite the model later, keep the id of any question that is still open — a reworded question with a new id looks to the planner like a question they already answered coming back.
- Set "stepId" when the question came from a particular step, so it can be shown beside it.
- "why" is one short sentence saying what changes once they answer. "Decides whether held orders are planned at all", not "for clarification".
- Ask about one thing per question. Two questions in one box get one muddled answer.

Most questions get a blank box. A few are genuinely a pick between named things, and those may carry "choices" — between two and four mutually exclusive answers, each written the way the planner would say it, not as a label.

Add "choices" only when you can name the full set from what is in the files: which of three columns carries a flag, which of two tables is authoritative, whether a status is included or excluded. Leave it out for a threshold, a number, a priority rule, or anything whose honest answer is a sentence. A planner nudged toward a nearly-right option answers worse than one given a blank box, so inventing choices to look helpful is a failure, not a nicety.

Never include an "other" or "something else" choice. The planner always has a free-text box, and they can edit any choice after picking it.

OUTPUT FORMAT

Return ONLY the JSON object. No prose before it, no prose after it, no markdown code fences, no comments. Your entire response must parse as JSON.`;

export function inferSystemPrompt(): string {
  return `You reconstruct manual spreadsheet workflows.

A production planner at a small manufacturer has a set of Excel files and a routine they run by hand — reading certain cells, applying rules they know by heart, and typing results into an output file. You are given a compact digest of their files and a description of the routine in their own words. Your job is to reconstruct that routine as a precise, machine-readable model.

The result is replayed as an animation on top of a spreadsheet grid, and the planner watches it and says either "yes, that is roughly what I do" or "no, you've got that bit wrong". Optimise for them being able to make that judgement.

Read the formulas in the digest closely. Formulas are the planner's real rules, written down — a VLOOKUP tells you which table is authoritative, a SUMIF tells you what gets grouped, an IF tells you where the exceptions are. Where a formula exists, follow it rather than the prose description. Where the prose and the formulas disagree, trust the formulas and record the discrepancy in "assumptions" or "unknowns".

Return a single JSON object of exactly this shape:

${IR_SHAPE}

${SHARED_RULES}`;
}

export function refineSystemPrompt(): string {
  return `You maintain a machine-readable model of a manual spreadsheet workflow.

You are given the current model, the digest of the underlying files, and a message from the production planner who actually runs the process. The planner is correcting or answering you. Apply what they said and return the updated model.

Rules for updating:
- Return the COMPLETE updated model, not a patch or a diff.
- Preserve the "id" of every step you did not change. The animation player holds its position by step id, and renumbering unchanged steps throws the planner out of the replay they were watching.
- Only change what the message actually bears on. Resist the urge to tidy up steps that were not mentioned.
- When the planner answers an open question, remove it from that step's "unknowns" and from "openQuestions", fold the answer into "params" or "explanation", and raise "confidence" to reflect that you now know.
- When the planner tells you a step is wrong, fix it rather than adding a caveat beside it.
- A "manual_judgment" step whose rule the planner has now spelled out should become a concrete operation, with the rule captured in "params".
- When an answer supplies the missing band, batch-size cell, or acceptable range that a step was waiting on, add the "solve" block to that step now and raise its confidence. This is the most common way a solve block should appear: asked first, added once answered.
- If the planner's message contradicts a formula in the files, follow the planner and note the discrepancy in that step's "assumptions".
- If the message is ambiguous, make the smallest reasonable change and add a specific follow-up question to that step's "unknowns".

The model has exactly this shape:

${IR_SHAPE}

${SHARED_RULES}

Return ONLY a single JSON object with these two keys and nothing else:

{
  "ir":            <the complete updated model, in the shape above>,
  "changeSummary": <one or two sentences, addressed to the planner, saying what you changed>
}`;
}

/**
 * System prompt for `POST /api/agent-turn` in `mode: "generate-work"` (see
 * app/api/agent-turn/route.ts and lib/work/generate.ts). Server-side rather
 * than lib/work/prompts.ts (which builds the per-generation USER message,
 * client-side, from the digest/IR/grid — see that file) because this text
 * has no per-request interpolation beyond the supported-function list and
 * is what agent-infer.ts's cache-layout convention expects to breakpoint
 * on: static system content that repeats byte for byte across every turn of
 * a generation and every generation the app ever runs.
 */
export function workGenerationSystemPrompt(): string {
  const functions = Object.keys(FUNCTION_REGISTRY).sort().join(", ");
  return `You are generating a Work for Cellwise — a saved, reusable, deterministic automation for one spreadsheet workbook. Unlike a one-off edit, a Work is not run by you: once you submit it, it replays with NO further AI involvement, today and every time the user re-runs it on a later version of the same file. Everything a future run needs to behave correctly must be in what you submit now.

You have a structural digest of the workbook, a full grid listing of its actual cell contents, and the approved workflow model the user already confirmed describes their routine (its steps, sources, and any solve blocks). You also have TOOLS to inspect anything the digest or listing compressed: read_range for exact cells, search_cells to locate labels or formulas, trace_cell for what feeds or consumes a cell, lookup_defined_names for names the digest omitted.

When you know exactly what the Work should do, call submit_work with:

OPS — the ordered steps the Work executes, each either:
- "edits": a batch of cell writes. A "formula" edit gives the TOP-LEFT cell's formula, filled across the rest of the range the way Excel's fill handle would — relative references shift row by row and column by column, absolute ones ($B$2) stay put. Prefer formulas over precomputed "values" wherever the sheet's own logic can produce the result; formulas are re-evaluated by the engine every run, so they stay correct as inputs change. The engine supports exactly these functions: ${functions}. A function outside this list evaluates to #NAME? and fails the Work. To write to a sheet that does not exist yet, declare its name in "newSheets" first.
- "solve": a search step, for the same shape the approved model's "solve" blocks describe — a cell or row/column of cells decided by trial and error against a downstream target and a constraint band, not a formula. "candidates" is what values are tried ("multiples" of a batch/pack-size cell, or a continuous "range"); "constraint" is the band the target should land in (send null for any bound that does not apply, but state at least one); "direction" is "sequential" when each write feeds the next (a running balance almost always is) or "independent" when each stands alone. Only emit a solve op when the approved model's own step said to — do not invent a search where the model described a formula, and do not turn a solve step into precomputed formulas either; the whole point of a solve op is that the Work re-runs the search fresh every time on whatever numbers the new file has. When the user's own words state an explicit floor or ceiling ("never let it go under 2", "must not exceed 500 units", "can't go negative") rather than just a target, encode that as "hardMin"/"hardMax" too, not only the soft "min"/"max" band — "min"/"max" is the preference the solver aims for and may miss under a compromise, "hardMin"/"hardMax" is a stated invariant the result must never cross even then. When this op's writes draw down a resource tracked ELSEWHERE in the workbook — raw materials, production capacity, a budget line a purchase order or allocation consumes — add "guards" to the solve op: each guard names the sheet/range holding that resource and the min/max it must never leave, so the search itself rejects any candidate that would drive it out of bounds instead of writing the violation and hoping a post-check catches it afterward. A guard proves nothing about the FINAL state on its own, though — it only shapes what the search is willing to write — so always pair a guard with a matching "post" check on that same resource range: the guard prevents the violation during the search, the check proves the run actually landed clean.

CHECKS — pre/post assertions the runner enforces every time the Work runs, not just now:
- "pre" checks are data preconditions — the anchors and shapes this Work's ops assume are true before touching anything (an id cell reads what you expect, a required input is not blank). A failing "error"-severity pre-check stops the run before op 1 and reports why, rather than writing wrong values against a file that has drifted.
- "post" checks encode the task's OWN stated constraints as machine-checkable assertions — a band a solved value must land in, a total that must tie out, a range that must contain no formula errors. If the user's description or the approved model states a concrete constraint, check it; do not invent bands or thresholds nobody stated. Set "severity": "error" for a constraint that makes the result wrong if violated, "warning" for one worth flagging but not blocking on.

Both bindings (which repeated block each op/check belongs to) and provenance are computed automatically after you finalize — never something you author.

VERIFICATION: your first submit_work call runs every op through the real engine and every check against the result, and reports back what happened — read it. Your second submit (once nothing error-severity is failing) finalizes the Work; a submission that still has a failing error-severity check is never accepted as final, however many times you resubmit it, so fix what the results show rather than resubmitting unchanged.

RESTRAINT: touch only the cells the task actually requires. A Work that quietly rewrites or clears data outside its stated purpose is a worse outcome than one that does slightly less — every other cell in the workbook must be exactly as valuable to leave alone on every future run as it is on this one.

Ranges must be bounded rectangles that exist on the sheet ("C2:C40"), never whole columns ("C:C"). Write dates as Excel serial numbers or DATE(y,m,d) inside a formula, never as text. Percentages and currency are plain numbers — write 0.15, not "15%".`;
}

/**
 * A repeated block's `range` already spans its populated columns (e.g.
 * `A5:AB12`), but column A holds the field labels, not data — so the data
 * span is everything after it.
 *
 * `bounds` must come from the sheet's own dimensions: parseRange's default
 * (5000 x 100) silently clamps a sheet wider than column CV, which a 10-year
 * monthly plan can exceed.
 */
function dataColumnSpan(range: string, bounds: ClampBounds): string | null {
  const box = parseRange(range, bounds);
  if (!box) return null;
  const startCol = box.startCol + 1;
  if (startCol > box.endCol) return null;
  return startCol === box.endCol
    ? indexToCol(startCol)
    : `${indexToCol(startCol)}:${indexToCol(box.endCol)}`;
}

const PERIOD_AXIS_INLINE_CAP = 24;
const PERIOD_AXIS_HEAD = 6;

/** Prints every column while the axis is short; a wide sheet gets head + tail so the prompt can't blow up. */
function renderPeriodAxis(axis: { column: string; label: string }[]): string {
  const entries = axis.map((e) => `${e.column}=${e.label}`);
  if (entries.length <= PERIOD_AXIS_INLINE_CAP) return entries.join(", ");
  return `${entries.slice(0, PERIOD_AXIS_HEAD).join(", ")}, …, ${entries.at(-1)}`;
}

/** Render the digests as the compact block the model reads. */
export function digestBlock(digests: FileDigest[]): string {
  const parts = digests.map((d) => {
    const sheets = d.sheets
      .map((s) => {
        const cols = s.columns
          .map((c) => {
            const bits = [
              `${c.column}${c.header ? ` "${c.header}"` : ""}`,
              c.type,
              `nulls ${Math.round(c.nullRatio * 100)}%`,
              `${c.distinctCount}${c.distinctCapped ? "+" : ""} distinct`,
            ];
            if (c.sampleValues.length) {
              bits.push(`e.g. ${c.sampleValues.map((v) => JSON.stringify(v)).join(", ")}`);
            }
            return `      ${bits.join(" | ")}`;
          })
          .join("\n");

        const formulas = s.formulaPatterns.length
          ? s.formulaPatterns
              .map((f) => {
                const line = `      ${f.range} (x${f.count})  ${f.pattern}`;
                // A row-oriented sheet collapses distinct rows to the same {r} token,
                // so the pattern alone can be ambiguous — the example, anchored to the
                // real cell it came from, disambiguates it.
                return f.example ? `${line}\n        e.g. ${f.exampleCell} = ${f.example}` : line;
              })
              .join("\n")
          : "      (none)";

        const rows = s.sampleRows.length
          ? s.sampleRows.map((r) => `      ${r.map((v) => v || "·").join(" | ")}`).join("\n")
          : "      (no data rows)";

        // A sectioned sheet is described block by block. The sheet-level column
        // stats blend the blocks, so they are labelled as such rather than
        // presented as if they described a single table.
        const sections = s.sections.length
          ? s.sections
              .map((sec) => {
                const secCols = sec.columns
                  .map((c) => {
                    const bits = [
                      `${c.column}${c.header ? ` "${c.header}"` : ""}`,
                      c.type,
                      `${Math.round((1 - c.nullRatio) * 100)}% filled`,
                    ];
                    if (c.sampleValues.length) {
                      bits.push(`e.g. ${c.sampleValues.slice(0, 3).map((v) => JSON.stringify(v)).join(", ")}`);
                    }
                    return `        ${bits.join(" | ")}`;
                  })
                  .join("\n");
                const secRows = sec.sampleRows.length
                  ? sec.sampleRows
                      .map((r) => `        ${r.map((v) => v || "·").join(" | ")}`)
                      .join("\n")
                  : "        (no rows)";
                return [
                  `      BLOCK "${sec.label}"  label on row ${sec.labelRow}, data ${sec.range} (${sec.rowCount} rows)`,
                  sec.emptyColumns.length
                    ? `        COMPLETELY EMPTY in this block: ${sec.emptyColumns.join(", ")}`
                    : null,
                  `        columns within this block:`,
                  secCols || "        (none)",
                  `        rows:`,
                  secRows,
                ]
                  .filter(Boolean)
                  .join("\n");
              })
              .join("\n\n")
          : null;

        // A row-oriented sheet: fields run down the left, periods across the
        // top, and the whole little table repeats once per item.
        const blocks = s.blockLayout
          ? s.repeatedBlocks
              .map((b, i) => {
                const detail = i === 0; // first repetition in full, rest compact
                const rows = b.fields
                  .map((f) => {
                    const bits = [
                      `          ${f.label}`,
                      `row ${f.row}`,
                      `${Math.round(f.filledRatio * 100)}% filled`,
                      f.type,
                    ];
                    if (f.formulaCount) bits.push(`${f.formulaCount} formulas`);
                    if (f.sampleValues.length) {
                      const n = detail ? 3 : 1;
                      bits.push(
                        `e.g. ${f.sampleValues.slice(0, n).map((v) => JSON.stringify(v)).join(", ")}`,
                      );
                    }
                    return bits.join(" | ");
                  })
                  .join("\n");
                const span = dataColumnSpan(b.range, { rows: s.rows, cols: s.cols });
                return [
                  `      [${i + 1}] "${b.title}"  rows ${b.range}${span ? `  data columns ${span}` : ""}`,
                  // Isolated on purpose in lib/digest.ts (detectDerivedBlocks) — this
                  // is the one line in the digest that names it, so it can be pulled
                  // just as easily.
                  b.derivedFrom
                    ? `          DERIVED — appears to total blocks ${b.derivedFrom.map((n) => `[${n}]`).join("")}, not an independent input`
                    : null,
                  rows,
                  b.emptyFields.length
                    ? `          (entirely empty here: ${b.emptyFields.join(", ")})`
                    : null,
                ]
                  .filter(Boolean)
                  .join("\n");
              })
              .join("\n\n")
          : null;

        return [
          `  SHEET "${s.name}"  used range ${s.usedRange} (${s.rows} rows x ${s.cols} cols)`,
          s.blockLayout
            ? `    LAYOUT: ${s.blockLayout.count} repetitions of the same small table, about ${s.blockLayout.stride} rows each. The ROWS are the fields and the COLUMNS are the periods — this is not a flat table with one header row.\n    field rows shared by the repetitions: ${s.blockLayout.fieldLabels.join(", ")}`
            : null,
          s.periodAxis && s.periodAxis.length
            ? `    period axis: ${renderPeriodAxis(s.periodAxis)}`
            : null,
          `    header row: ${s.headerRow ?? "not detected"}`,
          s.blockLayout
            ? null
            : s.sections.length
              ? `    columns (shared header; statistics below BLEND all blocks — prefer each block's own figures):`
              : `    columns:`,
          s.blockLayout ? null : cols || "      (none)",
          `    formula patterns (row numbers of relative refs shown as {r}):`,
          formulas,
          s.anchors.length
            ? `    anchors: ${s.anchors.map((a) => `${a.cell} = ${a.value} (used in ${a.usedIn.join(", ")} formulas)`).join("; ")}`
            : null,
          s.crossSheetRefs.length
            ? `    references other sheets/files: ${s.crossSheetRefs.join(", ")}`
            : null,
          s.merges.length ? `    merged cells: ${s.merges.slice(0, 20).join(", ")}` : null,
          blocks
            ? `    repetitions:\n${blocks}`
            : sections
              ? `    blocks:\n${sections}`
              : `    first data rows:\n${rows}`,
          s.notes.length ? `    notes: ${s.notes.join(" ")}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");

    const omitted = d.omittedDefinedNames
      ? ` (+ ${d.omittedDefinedNames.toLocaleString("en-US")} more omitted)`
      : "";
    const names = d.definedNames.length
      ? `  defined names: ${d.definedNames.map((n) => `${n.name} -> ${n.ref}`).join(", ")}${omitted}`
      : d.omittedDefinedNames
        ? `  defined names: (all ${d.omittedDefinedNames.toLocaleString("en-US")} omitted for budget)`
        : null;

    return [`FILE "${d.fileName}"`, sheets, names, `  notes: ${d.notes.join(" ")}`]
      .filter(Boolean)
      .join("\n");
  });

  return parts.join("\n\n----------------------------------------\n\n");
}

export interface AnswerInput {
  questionId: string;
  question: string;
  answer: string;
}

/** The planner's answers, paired to the questions they answered. */
export function answersBlock(answers: AnswerInput[]): string {
  if (answers.length === 0) return "";
  const lines = answers.map(
    (a) => `[${a.questionId}] ${a.question}\n     → ${a.answer}`,
  );
  return `THE PLANNER ANSWERED\n\n${lines.join("\n\n")}`;
}

/**
 * What is actually in the cells the planner pointed at.
 *
 * The digest is structural, so a reference alone tells the model where to look
 * but not what is there. This closes that gap without shipping the workbook.
 */
export function referenceAppendix(
  entries: { ref: string; resolved: string }[],
  omitted: number,
): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => `  ${e.ref} → ${e.resolved}`);
  const tail = omitted > 0 ? `\n  (and ${omitted} more, not shown)` : "";
  return `CELLS THE PLANNER POINTED AT\n\nThese are ranges the planner selected on the grid. Treat them as authoritative about where to look.\n\n${lines.join("\n")}${tail}`;
}

/**
 * What the planner says each file is for.
 *
 * This is knowledge the digest cannot carry: which file someone types into is
 * a fact about their job, not about the bytes. Where they have told us, it
 * outranks anything inferred from emptiness or formula counts.
 */
export function rolesBlock(
  roles: { fileName: string; role: string }[],
  singleStructure: boolean,
  fileCount: number,
): string {
  if (singleStructure && fileCount <= 1) {
    return `ONE FILE

There is a single file structure here. The planner reads from it and writes their results back into it — the same sheet is both the thing consulted and the thing filled in. Do not look for a separate output file; expect at least one step that writes into a range of this file, and say which range.`;
  }

  if (singleStructure) {
    return `${fileCount} FILES, ONE STRUCTURE

These are ${fileCount} separate files that all share the same structure. The planner runs the same routine on each file independently — nothing passes between files. Each file is, on its own, both the thing consulted and the thing filled in: read from and written back into within that same file. Describe the routine once; it applies the same way to all ${fileCount} of them. Expect at least one step per file that writes into a range of that same file, and say which file and which range.`;
  }

  if (roles.length === 0) return "";

  const lines = roles.map((r) => `  ${r.fileName} — ${r.role}`);
  return `WHAT EACH FILE IS FOR

The planner labelled these themselves. Trust these over your own inference from emptiness or formula counts, and use them for "role" on the matching entries in "sources".

${lines.join("\n")}`;
}

export function inferUserMessage(
  digests: FileDigest[],
  userDescription: string,
  references: { ref: string; resolved: string }[] = [],
  roles: { fileName: string; role: string }[] = [],
  singleStructure = false,
  fileCount: number = digests.length,
  /** How many more references were found but dropped past the 40 cap. */
  referencesOmitted = 0,
): string {
  return [
    digestBlock(digests),
    rolesBlock(roles, singleStructure, fileCount),
    `WHAT THE PLANNER SAYS THEY DO\n\n${userDescription}`,
    referenceAppendix(references, referencesOmitted),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function refineUserMessage(
  digests: FileDigest[],
  currentIR: WorkflowIR,
  input: {
    answers: AnswerInput[];
    note: string;
    references: { ref: string; resolved: string }[];
    /** How many more references were found but dropped past the 40 cap. */
    referencesOmitted?: number;
  },
): string {
  return [
    digestBlock(digests),
    `THE CURRENT MODEL\n\n${JSON.stringify(currentIR, null, 2)}`,
    answersBlock(input.answers),
    input.note.trim() ? `THE PLANNER ALSO SAYS\n\n${input.note.trim()}` : "",
    referenceAppendix(input.references, input.referencesOmitted ?? 0),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function retryMessage(errors: string): string {
  return `That response did not validate. The problems were:

${errors}

Fix exactly these problems and return the corrected JSON. Keep everything that was already valid unchanged. Remember: every "sourceId" must match one of your own "sources[].id" (including the two inside a "solve" block, "solve.write.sourceId" and "solve.target.sourceId"); every "range" must be A1 notation for a range that exists in the digest; every "manual_judgment" step and every step with confidence below 0.4 needs at least one entry in "unknowns". Return ONLY the JSON object — no fences, no prose.`;
}
