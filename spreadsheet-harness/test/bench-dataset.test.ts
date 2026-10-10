import { describe, expect, it } from "vitest";
import { filterTasks, parseDatasetJson, SCOREABLE_CATEGORIES } from "@/lib/bench/dataset";
import { benchSystemPrompt, benchUserMessage, gridAppendix } from "@/lib/bench/prompts";
import { buildDigests } from "@/lib/digest";
import { cellKey, type GridCell, type ParsedSheet, type ParsedWorkbook } from "@/lib/workbook";

const SAMPLE = JSON.stringify([
  {
    id: 17,
    instruction: "Fill the Total column.",
    spreadsheet_path: "spreadsheet/17/input.xlsx",
    golden_response_path: "spreadsheet/17/answer.xlsx",
    answer_position: "Sheet1!C2:C10",
    extra_field: "kept but unused",
  },
  {
    id: "viz-3",
    instruction: "Chart the totals.",
    spreadsheet_path: "spreadsheet/viz-3/input.xlsx",
    golden_response_path: "spreadsheet/viz-3/answer.xlsx",
  },
]);

describe("parseDatasetJson", () => {
  it("parses tasks, stringifies numeric ids, tolerates extra fields", () => {
    const tasks = parseDatasetJson(SAMPLE, "Financial_Model");
    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe("17");
    expect(tasks[0].answerPosition).toBe("Sheet1!C2:C10");
    expect(tasks[0].mode).toEqual({ withFormula: false, withFontColor: false });
    expect(tasks[1].answerPosition).toBeUndefined();
  });

  it("sniffs Debugging Color/Embedded modes from the path", () => {
    const tasks = parseDatasetJson(
      JSON.stringify([
        {
          id: 1,
          instruction: "x",
          spreadsheet_path: "spreadsheet/Embedded_4/input.xlsx",
          golden_response_path: "spreadsheet/Embedded_4/answer.xlsx",
          answer_position: "A1",
        },
      ]),
      "Debugging",
    );
    expect(tasks[0].mode.withFormula).toBe(true);
  });

  it("rejects malformed JSON and missing required fields", () => {
    expect(() => parseDatasetJson("not json", "Template")).toThrow(/valid JSON/);
    expect(() => parseDatasetJson(JSON.stringify([{ id: 1 }]), "Template")).toThrow();
  });

  it("filters by id and limit", () => {
    const tasks = parseDatasetJson(SAMPLE, "Template");
    expect(filterTasks(tasks, { ids: ["viz-3"] })).toHaveLength(1);
    expect(filterTasks(tasks, { limit: 1 })[0].id).toBe("17");
    expect(filterTasks(tasks, { ids: ["17", "viz-3"], limit: 1 })).toHaveLength(1);
  });

  it("names the three scoreable categories", () => {
    expect(SCOREABLE_CATEGORIES).toEqual(["Debugging", "Financial_Model", "Template"]);
  });
});

function sheetOf(name: string, cells: Record<string, { v?: unknown; f?: string }>): ParsedSheet {
  const map = new Map<string, GridCell>();
  let rows = 1;
  let cols = 1;
  for (const [ref, spec] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    const col = m[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const row = Number(m[2]) - 1;
    rows = Math.max(rows, row + 1);
    cols = Math.max(cols, col + 1);
    map.set(cellKey(row, col), {
      row,
      col,
      value: spec.v ?? null,
      text: String(spec.v ?? ""),
      type: typeof spec.v === "number" ? "number" : "text",
      formula: spec.f,
    });
  }
  return {
    name, rows, cols, totalRows: rows, totalCols: cols,
    truncated: false, cells: map, merges: [], colWidths: [],
  };
}

const workbook: ParsedWorkbook = {
  id: "wb",
  fileName: "input.xlsx",
  sheets: [
    sheetOf("Data", {
      A1: { v: "Qty" }, B1: { v: "Price" }, C1: { v: "Total" },
      A2: { v: 2 }, B2: { v: 10 }, C2: { v: 20, f: "A2*B2" },
      A5: { v: "after a gap" },
    }),
  ],
  definedNames: [],
};

describe("gridAppendix", () => {
  it("renders values and formulas row by row, skipping empty rows", () => {
    const text = gridAppendix(workbook);
    expect(text).toContain('GRID "Data"');
    expect(text).toContain('r1: A1="Qty" | B1="Price" | C1="Total"');
    expect(text).toContain("C2={=A2*B2 -> 20}");
    expect(text).toContain('r5: A5="after a gap"');
    expect(text).not.toContain("r3:");
    expect(text).not.toContain("r4:");
  });

  it("cuts at the budget and says so", () => {
    const cells: Record<string, { v: unknown }> = {};
    for (let r = 1; r <= 300; r++) cells[`A${r}`] = { v: `row number ${r} content` };
    const big: ParsedWorkbook = {
      ...workbook,
      sheets: [sheetOf("Big", cells)],
    };
    const text = gridAppendix(big, 2000);
    expect(text).toContain("cut for length");
    expect(text.length).toBeLessThan(3000);
  });
});

describe("bench prompts", () => {
  it("describes the plan shape and the supported functions", () => {
    const system = benchSystemPrompt();
    expect(system).toContain('"edits"');
    expect(system).toContain("newSheets");
    expect(system).toContain("VLOOKUP");
    expect(system).toContain("SUMIFS");
    expect(system).toContain("#NAME?");
    expect(system).toContain("Return ONLY the JSON object");
  });

  it("assembles digest, grid, and instruction into the user message", () => {
    const digests = buildDigests([workbook]);
    const msg = benchUserMessage(digests, workbook, "Fill the Total column for all rows.");
    expect(msg).toContain('FILE "input.xlsx"');
    expect(msg).toContain("FULL GRID CONTENT");
    expect(msg).toContain("THE TASK");
    expect(msg).toContain("Fill the Total column for all rows.");
  });
});
