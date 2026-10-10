import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildDigests } from "@/lib/digest";
import {
  benchAgentSystemPrompt,
  benchAgentUserMessage,
  benchUserMessage,
  gridAppendix,
} from "@/lib/bench/prompts";
import { parseWorkbook } from "@/lib/workbook";

function xlsxBytes(sheets: Record<string, (string | number | null)[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("gridAppendix budget", () => {
  it("keeps total output near the budget even with many sheets", () => {
    // A fixture where every sheet has equal weight can never overshoot: with
    // n equal-weight sheets, `Math.floor((budget * weight) / totalWeight)`
    // reduces to `Math.floor(budget / n)`, which is exactly `floor`, and
    // `floor * n <= budget` by construction. Overshoot needs skewed weights —
    // one sheet whose weight dominates `totalWeight` (so it keeps a large,
    // uncapped share) plus many small sheets that all get bumped up to the
    // shared floor. It's the sum of the one big share and the many floors
    // that exceeds the budget, matching the code's own comment about a huge
    // first sheet and many small ones.
    const sheets: Record<string, (string | number | null)[][]> = {};
    const bigRow = Array.from({ length: 40 }, (_, i) => 10_000 + i);
    sheets.Big = Array(100).fill(bigRow);
    for (let s = 0; s < 29; s++) {
      sheets[`Small${s + 1}`] = Array(30).fill([`small-cell-padding-xyz-${s}`]);
    }
    const wb = parseWorkbook(xlsxBytes(sheets), "many.xlsx");

    const budget = 20_000;
    const out = gridAppendix(wb, budget);
    // Slack: one header + one cut-note per sheet live outside the per-row
    // accounting (~160 chars each), plus the "\n\n" joins.
    expect(out.length).toBeLessThanOrEqual(budget + 30 * 200);
  });
});

describe("benchAgentUserMessage vs benchUserMessage", () => {
  const wb = parseWorkbook(xlsxBytes({ Sheet1: [["A", 1], ["B", 2]] }), "x.xlsx");
  const digests = buildDigests([wb]);

  // Fix 6 (scope modes): agent mode now diverges from single-shot mode in
  // BOTH directions — an inserted INCOMPLETE AREAS section when the
  // completion trigger is present (unchanged from before fix 6), and an
  // inserted SCOPE section when it is absent (new). Single-shot mode itself
  // never sees either section, regardless of trigger — see benchUserMessage.

  it("adds a SCOPE section, not INCOMPLETE AREAS, when the completion trigger is absent", () => {
    const instruction = "Fix the SUM formula in B2 — it should include row 3.";
    const agent = benchAgentUserMessage(digests, wb, instruction);
    const single = benchUserMessage(digests, wb, instruction);
    expect(agent).not.toBe(single);
    expect(agent).toContain("SCOPE");
    expect(agent).not.toContain("INCOMPLETE AREAS");
    expect(single).not.toContain("SCOPE");
    // Same digest, grid, and task sections either way — only the SCOPE
    // section is new, inserted exactly where INCOMPLETE AREAS goes on the
    // triggered path (see the next test). Splitting on the shared separator
    // and removing the SCOPE block should recover single-shot's exact parts.
    const SEP = "\n\n----------------------------------------\n\n";
    const agentParts = agent.split(SEP).filter((p) => !p.startsWith("SCOPE"));
    expect(agentParts).toEqual(single.split(SEP));
  });

  it("diverges from single-shot mode only by an inserted INCOMPLETE AREAS section when the trigger is present", () => {
    const instruction = "Complete the financial model based on the provided assumptions. Fill B2.";
    const agent = benchAgentUserMessage(digests, wb, instruction, "Financial_Model");
    const single = benchUserMessage(digests, wb, instruction);
    expect(agent).not.toBe(single);
    expect(agent).toContain("INCOMPLETE AREAS");
    expect(single).not.toContain("INCOMPLETE AREAS");
    // Same digest, grid, and task sections either way — only the extra
    // section is new. Splitting on the shared separator and removing the
    // INCOMPLETE AREAS block should recover single-shot's exact parts.
    const SEP = "\n\n----------------------------------------\n\n";
    const agentParts = agent.split(SEP).filter((p) => !p.startsWith("INCOMPLETE AREAS"));
    expect(agentParts).toEqual(single.split(SEP));
  });

  it("keeps the triggered-path output byte-identical to its pre-fix-6 form", () => {
    // Captured verbatim from `benchAgentUserMessage(digests, wb, instruction)`
    // at commit a945600 — HEAD before fix 6 (scope modes) touched this file,
    // i.e. before the untriggered branch below existed. Fix 6 only adds an
    // `else` arm to benchAgentUserMessage; the `if (hasCompletionTrigger(...))`
    // branch itself is untouched code. This is the snapshot-style proof of
    // that: byte-for-byte equality to the pre-fix output, not merely "still
    // contains INCOMPLETE AREAS" (the structural test above), pins down that
    // nothing in the digest/grid/INCOMPLETE-AREAS rendering shifted either.
    //
    // The fix-6 amendment (category-gated completion mode) replaced the
    // `if (hasCompletionTrigger(instruction))` condition with
    // `if (isCompletionScope(category, instruction))`, and this call passes
    // category "Financial_Model" — the one value for which isCompletionScope
    // agrees with the old, category-blind hasCompletionTrigger whenever the
    // phrase is present (see isCompletionScope's doc). So this snapshot
    // keeps proving what it always proved: the INCOMPLETE-AREAS branch's
    // rendering itself has not moved, now across BOTH fix 6 and its
    // amendment.
    const instruction = "Complete the financial model based on the provided assumptions. Fill B2.";
    const PRE_FIX6_TRIGGERED_OUTPUT =
      'FILE "x.xlsx"\n  SHEET "Sheet1"  used range A1:B2 (2 rows x 2 cols)\n    header row: not detected\n    columns:\n      A | text | nulls 0% | 2 distinct | e.g. "A", "B"\n      B | number | nulls 0% | 2 distinct | e.g. "1", "2"\n    formula patterns (row numbers of relative refs shown as {r}):\n      (none)\n    first data rows:\n      A | 1\n      B | 2\n    notes: No header row detected; column labels are unavailable.\n  notes: Conditional formatting rules are not extracted (not exposed by the parser); do not assume none exist.\n\n----------------------------------------\n\nFULL GRID CONTENT\n\nGRID "Sheet1" (2 rows x 2 cols)\n  r1: A1="A" | B1=1\n  r2: A2="B" | B2=2\n\n----------------------------------------\n\nINCOMPLETE AREAS\n\nA structural scan for cells that look unfinished relative to their own immediate row/column neighbors (blank where the rows or columns around them are not) — candidates the instruction below may not name explicitly. This is a heuristic, not a certainty: treat every id as something to account for, not necessarily something to change. List every id in submit_edit_plan\'s "coverage" field: action "edited" for one your edits cover, action "skipped" with a concrete reason for one that should legitimately stay as is.\n\nFound none beyond what the instruction already itemizes. "coverage" should be [].\n\n----------------------------------------\n\nTHE TASK\n\nComplete the financial model based on the provided assumptions. Fill B2.';
    expect(benchAgentUserMessage(digests, wb, instruction, "Financial_Model")).toBe(PRE_FIX6_TRIGGERED_OUTPUT);
  });
});

// Amendment to fix 6: the completion-mode gate is category AND phrase, not
// phrase alone — a Template instruction can legitimately reuse
// Financial_Model's boilerplate opener ("Complete the financial model based
// on the provided assumptions...") without Template's grading actually being
// whole-workbook. See lib/analysis/completeness.ts's isCompletionScope and
// .superpowers/sdd/reports/fix6-scope-modes.md for the measured cell-diff
// evidence this is based on.
describe("benchAgentUserMessage completion-scope gating (category AND phrase)", () => {
  const wb = parseWorkbook(xlsxBytes({ Sheet1: [["A", 1], ["B", 2]] }), "x.xlsx");
  const digests = buildDigests([wb]);
  const triggerInstruction = "Complete the financial model based on the provided assumptions. Fill B2.";

  it("Template category + the phrase still gets SCOPE, never INCOMPLETE AREAS", () => {
    const agent = benchAgentUserMessage(digests, wb, triggerInstruction, "Template");
    expect(agent).toContain("SCOPE");
    expect(agent).not.toContain("INCOMPLETE AREAS");
  });

  it("Financial_Model category WITHOUT the phrase still gets SCOPE — category alone is not enough", () => {
    const instruction = "Fix the SUM formula in B2 — it should include row 3.";
    const agent = benchAgentUserMessage(digests, wb, instruction, "Financial_Model");
    expect(agent).toContain("SCOPE");
    expect(agent).not.toContain("INCOMPLETE AREAS");
  });

  it("an unspecified category falls back to the pre-amendment, category-blind gate — phrase alone still gets INCOMPLETE AREAS", () => {
    // Protects real runs from a silent regression while a caller (as of this
    // writing: scripts/benchmark.ts, scripts/bench-dry-score.ts) has not yet
    // been updated to thread its own `category` variable into runBenchTask —
    // see run-task.ts's `category` option doc. Passing `undefined` here
    // explicitly (rather than omitting the argument) to make the case under
    // test unambiguous.
    const agent = benchAgentUserMessage(digests, wb, triggerInstruction, undefined);
    expect(agent).toContain("INCOMPLETE AREAS");
    expect(agent).not.toContain("SCOPE");
  });
});

describe("benchAgentSystemPrompt", () => {
  it("is a pure constant — no per-task variance, since it carries the cross-task cache breakpoint", () => {
    expect(benchAgentSystemPrompt()).toBe(benchAgentSystemPrompt());
  });
});
