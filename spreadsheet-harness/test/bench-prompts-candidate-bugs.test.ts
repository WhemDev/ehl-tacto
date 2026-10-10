import { describe, expect, it } from "vitest";
import { buildDigests } from "@/lib/digest";
import { benchAgentUserMessage } from "@/lib/bench/prompts";
import { hasAuditTrigger, isDebuggingAuditScope } from "@/lib/analysis/formula-outliers";
import { parseWorkbook } from "@/lib/workbook";
import { xlsxBytes, type CellSpec } from "./helpers/workbooks";

const AUDIT_INSTRUCTION =
  "Please audit and fix this file thoroughly. Errors may include but are not limited to: formula logic " +
  "errors or inconsistencies, hardcoded values, and broken references.";

const FM_INSTRUCTION =
  "Complete the financial model based on the provided assumptions. Ensure the existing structure, layout, " +
  "and formatting of the model are preserved throughout.";

function wbOf(sheets: Record<string, CellSpec[][]>) {
  return parseWorkbook(xlsxBytes(sheets), "candidate-bugs.xlsx");
}

// A row containing an unmistakable pattern-break: three SUM-shaped siblings
// and one AVERAGE outlier, so findCandidateBugs is guaranteed non-empty.
const BUGGY_SHEET = {
  S: [
    [
      { f: "SUM(A2:A5)", v: 1 },
      { f: "SUM(B2:B5)", v: 1 },
      { f: "AVERAGE(C2:C5)", v: 1 },
      { f: "SUM(D2:D5)", v: 1 },
    ],
  ],
};

describe("isDebuggingAuditScope / hasAuditTrigger", () => {
  it("matches the dataset's real audit phrasing, case-insensitively", () => {
    expect(hasAuditTrigger(AUDIT_INSTRUCTION)).toBe(true);
    expect(hasAuditTrigger("PLEASE AUDIT AND FIX this file.")).toBe(true);
  });

  it("does not match unrelated instructions", () => {
    expect(hasAuditTrigger(FM_INSTRUCTION)).toBe(false);
    expect(hasAuditTrigger("Build a chart of monthly revenue.")).toBe(false);
  });

  it("requires both category and phrase", () => {
    expect(isDebuggingAuditScope("Debugging", AUDIT_INSTRUCTION)).toBe(true);
    expect(isDebuggingAuditScope("Financial_Model", AUDIT_INSTRUCTION)).toBe(false);
    expect(isDebuggingAuditScope("Template", AUDIT_INSTRUCTION)).toBe(false);
    expect(isDebuggingAuditScope("Debugging", "Fix the SUM formula in B2.")).toBe(false);
  });

  it("falls back to phrase-only when category is unspecified", () => {
    expect(isDebuggingAuditScope(undefined, AUDIT_INSTRUCTION)).toBe(true);
  });
});

describe("benchAgentUserMessage: CANDIDATE BUGS gating", () => {
  const wb = wbOf(BUGGY_SHEET);
  const digests = buildDigests([wb]);

  it("Debugging category + audit phrase injects CANDIDATE BUGS, replacing SCOPE", () => {
    const agent = benchAgentUserMessage(digests, wb, AUDIT_INSTRUCTION, "Debugging");
    expect(agent).toContain("CANDIDATE BUGS");
    expect(agent).not.toContain("SCOPE");
    expect(agent).not.toContain("INCOMPLETE AREAS");
    expect(agent).toMatch(/B1: S!C1 /);
  });

  it("an unspecified category falls back to phrase-only and still injects CANDIDATE BUGS", () => {
    const agent = benchAgentUserMessage(digests, wb, AUDIT_INSTRUCTION, undefined);
    expect(agent).toContain("CANDIDATE BUGS");
    expect(agent).not.toContain("SCOPE");
  });

  it("Financial_Model category never gets CANDIDATE BUGS, even with the audit phrase", () => {
    const agent = benchAgentUserMessage(digests, wb, AUDIT_INSTRUCTION, "Financial_Model");
    expect(agent).not.toContain("CANDIDATE BUGS");
    expect(agent).toContain("SCOPE");
  });

  it("Template category never gets CANDIDATE BUGS, even with the audit phrase", () => {
    const agent = benchAgentUserMessage(digests, wb, AUDIT_INSTRUCTION, "Template");
    expect(agent).not.toContain("CANDIDATE BUGS");
    expect(agent).toContain("SCOPE");
  });

  it("Debugging category WITHOUT the audit phrase never gets CANDIDATE BUGS", () => {
    const agent = benchAgentUserMessage(digests, wb, "Fix the SUM formula in B2.", "Debugging");
    expect(agent).not.toContain("CANDIDATE BUGS");
    expect(agent).toContain("SCOPE");
  });

  it("never fires on the completion-scope (INCOMPLETE AREAS) path, regardless of category", () => {
    // isCompletionScope is checked first; a Financial_Model completion task
    // never falls through to the audit-scope branch even though it shares
    // no phrase overlap with hasAuditTrigger here (belt and suspenders: the
    // two triggers are disjoint phrases, so this also can't happen via
    // phrase collision).
    const agent = benchAgentUserMessage(digests, wb, FM_INSTRUCTION, "Financial_Model");
    expect(agent).toContain("INCOMPLETE AREAS");
    expect(agent).not.toContain("CANDIDATE BUGS");
    expect(agent).not.toContain("SCOPE");
  });

  it("renders a 'found none' message, still under the header, when the workbook has no candidates", () => {
    const cleanWb = wbOf({ S: [["just", "text", "values"]] });
    const cleanDigests = buildDigests([cleanWb]);
    const agent = benchAgentUserMessage(cleanDigests, cleanWb, AUDIT_INSTRUCTION, "Debugging");
    expect(agent).toContain("CANDIDATE BUGS");
    expect(agent).toMatch(/Found none\. Audit the file on your own judgment\./);
  });

  it("real FM sentinel phrasing (dataset ids 01_02, 02_01, 02_02, 02_04, 02_05 all share this opener) never triggers CANDIDATE BUGS", () => {
    // hasAuditTrigger and hasCompletionTrigger match disjoint phrases (the
    // dataset's own Debugging instructions are 100% "audit and fix this
    // file thoroughly"; every Financial_Model instruction, these five
    // included, opens with "Complete the financial model based on the
    // provided assumptions" and never contains "audit and fix" or "errors
    // may include" — confirmed against the live dataset files) — so this is
    // guaranteed by construction, not merely by category. Both assertions
    // below exercise that guarantee explicitly.
    expect(hasAuditTrigger(FM_INSTRUCTION)).toBe(false);
    const agent = benchAgentUserMessage(digests, wb, FM_INSTRUCTION, "Financial_Model");
    expect(agent).not.toContain("CANDIDATE BUGS");
  });
});
