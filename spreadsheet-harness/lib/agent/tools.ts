/**
 * The agent's tool surface: Anthropic tool definitions over the analysis
 * layer, plus the strict terminal submit tool.
 *
 * The submit schema is hand-written JSON Schema rather than derived from
 * the Zod plan schema: `strict: true` demands `additionalProperties: false`
 * and a `required` list on every object, and the exactly-one-of-four edit
 * shape is an `anyOf` here while Zod expresses it as a superRefine. The
 * Zod schema (makeEditPlanSchema) remains the semantic authority — the
 * loop revalidates every submitted plan through it.
 *
 * Moved from lib/bench/agent-tools.ts in Phase A1 of the Work rework: this
 * tool surface has no benchmark-only dependency (the Anthropic import is
 * type-only) — app adoption needs it outside lib/bench. lib/bench/agent-tools.ts
 * is now a shim re-exporting everything from here.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  AnalysisError,
  lookupDefinedNames,
  readRange,
  searchCells,
  traceCell,
} from "@/lib/analysis/tools";
import { createSimulator, type Simulator } from "@/lib/formula/simulate";
import type { ParsedWorkbook } from "@/lib/workbook";

export const SUBMIT_TOOL = "submit_edit_plan";

/** One edit, as JSON Schema: exactly one action key via anyOf branches. */
const editBranch = (action: string, actionSchema: object) => ({
  type: "object",
  properties: {
    sheet: { type: "string", description: "A sheet name from the file, exactly as listed." },
    range: {
      type: "string",
      description: 'Bounded A1 range: "C2", "C2:C40" — never whole columns like "C:C".',
    },
    [action]: actionSchema,
  },
  required: ["sheet", "range", action],
  additionalProperties: false,
});

const literal = {
  anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }],
};

/**
 * One line of accounting for an id from the first user message's
 * "INCOMPLETE AREAS" list (see lib/analysis/completeness.ts). Always present
 * in the plan (strict schema — every property is required, same convention
 * as `notes`/`newSheets` below); an empty array is how a plan says "nothing
 * to account for," which is every plan on a task where that list was never
 * shown. reason is required either way — for "skipped" the loop rejects an
 * empty one, for "edited" it may be left as "".
 */
const coverageItemSchema = {
  type: "object",
  properties: {
    area_id: { type: "string", description: 'An id from the INCOMPLETE AREAS list, e.g. "A3".' },
    action: {
      type: "string",
      enum: ["edited", "skipped"],
      description: '"edited" if your edits above cover this area; "skipped" if you are deliberately leaving it as is.',
    },
    reason: {
      type: "string",
      description:
        'Required, non-empty, for "skipped": the concrete reason this area needs no edit. May be "" for "edited".',
    },
  },
  required: ["area_id", "action", "reason"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Chart spec transport: JSON-STRING, not structured JSON Schema.
//
// ORIGINAL DESIGN (superseded — kept here as the cautionary tale): a
// structured JSON-Schema mirror of lib/charts/spec.ts's chartSpecSchema,
// hand-written for the same strict-mode reason as the rest of this file —
// `strict: true` demands `additionalProperties: false` and a "required" list
// naming every property with no exceptions, while chartSpecSchema is
// deliberately optional-field-heavy (most top-level fields optional, and
// series/axis/dataLabels carry several more each). Every field Zod marks
// `.optional()` became "required, but its value may be null" — a
// `{anyOf: [X, {type: "null"}]}` union — to stand in for the absent-key case
// strict mode cannot express.
//
// That design shipped and failed against the live API: Anthropic's tool
// schema validator caps the number of union-typed ("type arrays or anyOf")
// parameters across a tool's whole input_schema, and the chart subtree alone
// — one union per optional field, nested through axes/series/dataLabels —
// blew past it: `400 invalid_request_error: "Schemas contains too many
// parameters with union types (61 parameters with type arrays or ...".
// A strict-mode structured object with this many optional fields is
// fundamentally incompatible with that cap, not merely close to it.
//
// FIX: transport each chart as a JSON string instead. "charts" below is
// `{type: "array", items: {type: "string"}}` — zero unions, however deep
// chartSpecSchema's real shape gets. The model writes one JSON object per
// array entry (documented with a worked example in the CHARTS section of the
// first user message — see lib/bench/prompts.ts's CHARTS_SECTION); the real
// parsing happens at lib/plan/edits.ts's makeEditPlanSchema, which
// JSON.parses each string entry and runs the result through chartSpecSchema
// exactly as before (a parse failure becomes an ordinary Zod issue at
// ["charts", i], corrected through the same retry loop as any other schema
// violation). Object-form entries are still accepted there too, for
// hand-authored callers (tests, any future non-agentic caller).
//
// This incidentally undoes the one field the structured design had to drop:
// SeriesSpec.pointColors (per-point/per-slice color overrides) is a Zod
// `z.record()` — an arbitrary-keys dictionary with no honest strict-mode
// encoding. A JSON string has no such restriction; pointColors round-trips
// through JSON.stringify/parse like any other field and chartSpecSchema
// accepts it unmodified, so a model can now ask for it through
// submit_edit_plan (previously only a hand-authored ChartSpec could).
// ---------------------------------------------------------------------------

const EDIT_PLAN_SCHEMA = {
  type: "object",
  properties: {
    edits: {
      type: "array",
      description: "The cell changes that complete the task.",
      items: {
        anyOf: [
          editBranch("formula", {
            type: "string",
            description:
              "Formula for the TOP-LEFT cell of the range, e.g. \"=A2*B2\". Filled across the range like Excel's fill handle: relative refs shift, absolute ($B$2) stay.",
          }),
          editBranch("value", { ...literal, description: "One literal written to every cell in the range." }),
          editBranch("values", {
            type: "array",
            items: { type: "array", items: literal },
            description: "Explicit row-major grid; dimensions must match the range.",
          }),
          editBranch("clear", { type: "boolean", description: "true to blank out the range." }),
        ],
      },
    },
    newSheets: {
      type: "array",
      items: { type: "string" },
      description: "Sheets to create; required before editing them.",
    },
    notes: { type: "string", description: "One or two sentences on your approach." },
    coverage: {
      type: "array",
      description:
        'One entry per id in the first user message\'s "INCOMPLETE AREAS" list, if it was given to you — [] when it was not, or once every id is accounted for. Every listed id must appear exactly once.',
      items: coverageItemSchema,
    },
    charts: {
      type: "array",
      description:
        "Charts to create — Visualization-category tasks. [] when this task needs no charts. Each array entry is ONE chart spec serialized as a JSON object string, not a nested object — see the CHARTS section of the first user message for the exact shape and a worked example.",
      items: {
        type: "string",
        description: "A chart spec as a JSON object string — see the CHARTS section of the first user message for the shape.",
      },
    },
  },
  required: ["edits", "newSheets", "notes", "coverage", "charts"],
  additionalProperties: false,
} as const;

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_range",
    description:
      "Read the actual cells of a range: values, and formulas with their current results. Use this to inspect any region the digest or grid listing compressed or cut. Results are capped — prefer precise ranges over whole sheets.",
    input_schema: {
      type: "object",
      properties: {
        sheet: { type: "string", description: "Sheet name from the file." },
        range: { type: "string", description: 'A1 range, e.g. "B2:M40".' },
      },
      required: ["sheet", "range"],
      additionalProperties: false,
    },
  },
  {
    name: "search_cells",
    description:
      "Find cells whose display text or formula contains a substring (case-insensitive). Use it to locate labels (\"Total Revenue\"), or every formula naming a function or reference. Returns up to 100 matches with addresses.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring to search for." },
        sheets: {
          type: "array",
          items: { type: "string" },
          description: "Restrict to these sheets; omit to search the whole workbook.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "trace_cell",
    description:
      "What feeds a cell (precedents) or what consumes it (dependents), one or two hops through the formula graph. Use it to understand how a computed cell gets its value before editing anything upstream of it.",
    input_schema: {
      type: "object",
      properties: {
        sheet: { type: "string" },
        cell: { type: "string", description: 'Single cell, e.g. "C22".' },
        direction: { type: "string", enum: ["precedents", "dependents"] },
        depth: { type: "integer", enum: [1, 2] },
      },
      required: ["sheet", "cell", "direction"],
      additionalProperties: false,
    },
  },
  {
    name: "lookup_defined_names",
    description:
      "Look up the workbook's defined names by substring. The digest lists only the most relevant names — when a formula references a name you have not seen, resolve it here.",
    input_schema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Substring of the name; omit to list the first 50." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: SUBMIT_TOOL,
    description:
      "Submit your final edit plan. The harness validates the plan, evaluates every formula you wrote through the spreadsheet engine, and returns the computed results of your edits once for review; your second submit is final. Expect the first submit to come back with a values preview — check it against your intent before finalizing. If the first user message included an INCOMPLETE AREAS list, `coverage` must account for every id on it.",
    strict: true,
    input_schema: EDIT_PLAN_SCHEMA as unknown as Anthropic.Tool["input_schema"],
  },
];

export interface ToolContext {
  workbook: ParsedWorkbook;
  /** Lazily-created, cached simulator over the unedited workbook. */
  sim(): Simulator;
}

export function makeToolContext(workbook: ParsedWorkbook): ToolContext {
  let sim: Simulator | null = null;
  return {
    workbook,
    sim() {
      // Bench-only opt-in — see lib/formula/simulate.ts's
      // `SimulatorOptions.iterateCycles` doc and lib/plan/edits.ts's
      // matching call in applyEditPlan.
      if (!sim) sim = createSimulator(workbook, { iterateCycles: true });
      return sim;
    },
  };
}

const readRangeInput = z.object({ sheet: z.string(), range: z.string() });
const searchInput = z.object({ query: z.string(), sheets: z.array(z.string()).optional() });
const traceInput = z.object({
  sheet: z.string(),
  cell: z.string(),
  direction: z.enum(["precedents", "dependents"]),
  depth: z.union([z.literal(1), z.literal(2)]).optional(),
});
const namesInput = z.object({ filter: z.string().optional() });

/**
 * Execute one of the four read tools. Never throws: malformed input and
 * AnalysisError both come back as model-facing error results, so the loop
 * can hand them straight back as tool_result blocks.
 */
export function executeReadTool(
  ctx: ToolContext,
  name: string,
  input: unknown,
): { content: string; isError: boolean } {
  try {
    switch (name) {
      case "read_range": {
        const p = readRangeInput.parse(input);
        const res = readRange(ctx.workbook, p.sheet, p.range);
        return { content: res.text, isError: false };
      }
      case "search_cells": {
        const p = searchInput.parse(input);
        const res = searchCells(ctx.workbook, p.query, { sheets: p.sheets });
        const lines = res.matches.map(
          (m) => `${m.sheet}!${m.cell}: ${m.formula ? `{=${m.formula}} -> ` : ""}${JSON.stringify(m.text)}`,
        );
        if (res.truncated) lines.push("(more matches exist — narrow the query)");
        return { content: lines.join("\n") || "(no matches)", isError: false };
      }
      case "trace_cell": {
        const p = traceInput.parse(input);
        const res = traceCell(ctx.sim(), p.sheet, p.cell, p.direction, p.depth ?? 1);
        const lines = res.levels.map(
          (level, i) => `${i + 1} hop${i ? "s" : ""}: ${level.join(", ") || "(none)"}`,
        );
        return { content: `${p.direction} of ${p.sheet}!${p.cell}\n${lines.join("\n")}`, isError: false };
      }
      case "lookup_defined_names": {
        const p = namesInput.parse(input);
        const res = lookupDefinedNames(ctx.workbook, p.filter);
        const lines = res.names.map((n) => `${n.name} -> ${n.ref}`);
        if (res.total > res.names.length) lines.push(`(${res.total - res.names.length} more — narrow the filter)`);
        return { content: lines.join("\n") || "(no defined names match)", isError: false };
      }
      default:
        return { content: `unknown tool "${name}"`, isError: true };
    }
  } catch (err) {
    if (err instanceof AnalysisError) return { content: err.message, isError: true };
    if (err instanceof z.ZodError) {
      return { content: `invalid input: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, isError: true };
    }
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
