import { describe, expect, it } from "vitest";
import {
  AGENT_TOOLS,
  SUBMIT_TOOL,
  executeReadTool,
  makeToolContext,
} from "@/lib/bench/agent-tools";
import { chainWb } from "./helpers/workbooks";

/** Every object node in a strict schema must forbid extra properties. */
function assertStrictObjects(node: unknown, path = "$"): void {
  if (typeof node !== "object" || node === null) return;
  const obj = node as Record<string, unknown>;
  if (obj.type === "object") {
    expect(obj.additionalProperties, `additionalProperties at ${path}`).toBe(false);
    expect(Array.isArray(obj.required), `required at ${path}`).toBe(true);
  }
  for (const [k, v] of Object.entries(obj)) assertStrictObjects(v, `${path}.${k}`);
}

/**
 * Counts every schema node that is "union-typed" in the sense Anthropic's
 * tool-schema validator rejected a plan against: a JSON-Schema node with an
 * `anyOf` key, or whose `type` is itself an array (the other standard
 * JSON-Schema union spelling) — see lib/agent/tools.ts's header doc on the
 * "charts" field's own comment block for the live 400 this guards against
 * ("Schemas contains too many parameters with union types"). Recurses
 * through `properties`, `items`, and each `anyOf` branch, so a union nested
 * inside another union is counted once for each level.
 */
function countUnions(node: unknown): number {
  if (node === null || typeof node !== "object") return 0;
  let count = 0;
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.anyOf)) {
    count += 1;
    for (const branch of obj.anyOf) count += countUnions(branch);
  } else if (Array.isArray(obj.type)) {
    count += 1;
  }
  if (obj.properties && typeof obj.properties === "object") {
    for (const v of Object.values(obj.properties as Record<string, unknown>)) count += countUnions(v);
  }
  if (obj.items) count += countUnions(obj.items);
  return count;
}

describe("agent tool definitions", () => {
  it("exposes exactly the five designed tools", () => {
    expect(AGENT_TOOLS.map((t) => t.name).sort()).toEqual([
      "lookup_defined_names",
      "read_range",
      "search_cells",
      SUBMIT_TOOL,
      "trace_cell",
    ].sort());
  });

  it("submit_edit_plan is strict and its schema forbids extras everywhere", () => {
    const submit = AGENT_TOOLS.find((t) => t.name === SUBMIT_TOOL)!;
    expect(submit.strict).toBe(true);
    assertStrictObjects(submit.input_schema);
  });

  it("the charts field is a plain string array — no unions, no nested object shape", () => {
    const submit = AGENT_TOOLS.find((t) => t.name === SUBMIT_TOOL)!;
    const charts = (submit.input_schema as { properties: { charts: unknown } }).properties.charts as Record<
      string,
      unknown
    >;
    expect(charts.type).toBe("array");
    expect(charts.items).toEqual({
      type: "string",
      description: expect.stringContaining("JSON object string"),
    });
  });

  it("stays comfortably under the live API's union-parameter cap that the old structured charts subtree blew past", () => {
    // Regression guard for the incident this schema was rewritten to fix: a
    // structured, strict-mode JSON-Schema mirror of chartSpecSchema (every
    // optional field a `{anyOf: [X, null]}`) pushed the whole tool's union
    // count to 61 by the live API's own count (68 by this file's countUnions,
    // which recurses into anyOf branches the API's number may not) — a
    // `400 invalid_request_error: "too many parameters with union types"`.
    // The string-transport "charts" field has zero unions of its own; only
    // "edits" (the exactly-one-of-four action shape, pre-existing and
    // unaffected by this fix) still contributes any.
    const submit = AGENT_TOOLS.find((t) => t.name === SUBMIT_TOOL)!;
    const total = countUnions(submit.input_schema);
    expect(total).toBeLessThan(15);
  });
});

describe("executeReadTool", () => {
  it("runs read_range and returns cell content", () => {
    const ctx = makeToolContext(chainWb());
    const res = executeReadTool(ctx, "read_range", { sheet: "Calc", range: "A1:C1" });
    expect(res.isError).toBe(false);
    expect(res.content).toContain("A1=10");
  });

  it("turns AnalysisError into a model-facing error result", () => {
    const ctx = makeToolContext(chainWb());
    const res = executeReadTool(ctx, "read_range", { sheet: "Nope", range: "A1" });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/must be one of: Calc/);
  });

  it("rejects malformed input without throwing", () => {
    const ctx = makeToolContext(chainWb());
    const res = executeReadTool(ctx, "read_range", { range: 42 });
    expect(res.isError).toBe(true);
  });

  it("runs trace_cell through a lazily-created simulator", () => {
    const ctx = makeToolContext(chainWb());
    const res = executeReadTool(ctx, "trace_cell", {
      sheet: "Calc", cell: "C1", direction: "precedents", depth: 2,
    });
    expect(res.isError).toBe(false);
    expect(res.content).toContain("CALC!B1");
    expect(res.content).toContain("CALC!A1");
  });
});
