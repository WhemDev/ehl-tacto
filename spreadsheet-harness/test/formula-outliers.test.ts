import { describe, expect, it } from "vitest";
import { duplicateHardcodes, findCandidateBugs, patternBreakOutliers } from "@/lib/analysis/formula-outliers";
import { parseWorkbook } from "@/lib/workbook";
import { xlsxBytes, type CellSpec } from "./helpers/workbooks";

function wbOf(sheets: Record<string, CellSpec[][]>) {
  return parseWorkbook(xlsxBytes(sheets), "outliers.xlsx");
}

describe("patternBreakOutliers", () => {
  it("stays silent on a fully consistent fill-down run", () => {
    const wb = wbOf({
      S: [
        [{ f: "A1*2", v: 2 }],
        [{ f: "A2*2", v: 2 }],
        [{ f: "A3*2", v: 2 }],
        [{ f: "A4*2", v: 2 }],
      ],
    });
    expect(patternBreakOutliers(wb)).toHaveLength(0);
  });

  it("stays silent on a fully consistent fill-right run", () => {
    const wb = wbOf({
      S: [[{ f: "A1*2", v: 2 }, { f: "B1*2", v: 2 }, { f: "C1*2", v: 2 }, { f: "D1*2", v: 2 }]],
    });
    expect(patternBreakOutliers(wb)).toHaveLength(0);
  });

  it("stays silent when a run is shorter than the minimum length", () => {
    const wb = wbOf({
      S: [[{ f: "A1*2", v: 2 }, { f: "SUM(B1)", v: 2 }]],
    });
    expect(patternBreakOutliers(wb)).toHaveLength(0);
  });

  it("flags a reference offset that doesn't follow the run's own progression", () => {
    // Comps + Beta!H15 shape (Debugging 06_05): every sibling in the row
    // computes MEDIAN over rows 5:9 relative to a shared header block; one
    // cell instead reads rows 6:9 — an off-by-one range start. A single
    // blank spacer column sits between B/C and E/F (gap-tolerant runs).
    const wb = wbOf({
      Comps: [
        [], [], [], [], [],
        ["", "5.0", "6.0", "", "7.0", "8.0"],
        ["", "5.1", "6.1", "", "7.1", "8.1"],
        ["", "5.2", "6.2", "", "7.2", "8.2"],
        ["", "5.3", "6.3", "", "7.3", "8.3"],
        [
          "Median",
          { f: "MEDIAN(B5:B9)", v: 1 },
          { f: "MEDIAN(C5:C9)", v: 1 },
          null,
          { f: "MEDIAN(E6:E9)", v: 1 }, // BUG: off-by-one range start
          { f: "MEDIAN(F5:F9)", v: 1 },
        ],
      ],
    });
    const hits = patternBreakOutliers(wb);
    const cells = hits.map((h) => h.cell);
    expect(cells).toContain("E10");
    expect(cells).not.toContain("B10");
    expect(cells).not.toContain("C10");
    expect(cells).not.toContain("F10");
    const hit = hits.find((h) => h.cell === "E10")!;
    expect(hit.sheet).toBe("Comps");
    expect(hit.formula).toBe("=MEDIAN(E6:E9)");
    expect(hit.evidence).toMatch(/E6:E9/);
  });

  it("flags a differing anchor where a sibling demonstrates the fixed reference", () => {
    // Debugging 10_09's CHOOSE($C$2,...) family: one cell anchors the
    // selector cell, five siblings lost the "$" when the formula was
    // dragged right — the buggy shape is the majority, so this must NOT
    // depend on majority vote to catch it. Preceded by a couple of
    // unrelated-shape cells (the real row's own historical/ratio columns)
    // so the anchored demo cell (C1) sits INTERIOR to the run, not at its
    // edge — a lone anchored cell at the very edge of a run is a stub-period
    // shape (see the next test) and is deliberately not trusted alone.
    const row: CellSpec[] = [
      { f: "A1+1", v: 1 },
      { f: "B1+1", v: 1 },
      { f: "CHOOSE($C$2,O1,W1,AE1)", v: 1 },
      { f: "CHOOSE(C2,Q1,Y1,AG1)", v: 1 },
      { f: "CHOOSE(D2,R1,Z1,AH1)", v: 1 },
      { f: "CHOOSE(E2,S1,AA1,AI1)", v: 1 },
      { f: "CHOOSE(F2,T1,AB1,AJ1)", v: 1 },
    ];
    const wb = wbOf({ Model: [row] });
    const hits = patternBreakOutliers(wb);
    const flaggedCells = hits.map((h) => h.cell);
    // The anchored cell (C1) is correct and must not be flagged; every
    // non-anchored CHOOSE sibling should be.
    expect(flaggedCells).not.toContain("C1");
    expect(flaggedCells).toEqual(expect.arrayContaining(["D1", "E1", "F1", "G1"]));
    for (const cell of ["D1", "E1", "F1", "G1"]) {
      const hit = hits.find((h) => h.cell === cell)!;
      expect(hit.evidence).toMatch(/anchor/);
    }
  });

  it("does not trust a single anchored cell sitting at the very edge of the run", () => {
    // A "period 1 uses a fixed starting value" stub can coincidentally
    // skeleton-match an unrelated fill (a range collapses to the same "•"
    // token a bare ref does — see Debugging 09_08's LBO!F112, "=+$R$36/F$57"
    // sitting before a SUM(...)/col$57 fill). A lone anchored cell AT the
    // run's edge must not be trusted as "the demonstrated correct anchor".
    const row: CellSpec[] = [
      { f: "$R$36/A50", v: 1 }, // edge cell: coincidentally same skeleton, unrelated meaning
      { f: "SUM(B40:B41)/B50", v: 1 },
      { f: "SUM(C40:C41)/C50", v: 1 },
      { f: "SUM(D40:D41)/D50", v: 1 },
    ];
    const wb = wbOf({ Model: [row] });
    const hits = patternBreakOutliers(wb);
    expect(hits.filter((h) => h.evidence.includes("anchor"))).toHaveLength(0);
  });

  it("flags a cell using a different function/shape than its run", () => {
    const wb = wbOf({
      S: [
        [
          { f: "SUM(A2:A5)", v: 1 },
          { f: "SUM(B2:B5)", v: 1 },
          { f: "AVERAGE(C2:C5)", v: 1 }, // different shape
          { f: "SUM(D2:D5)", v: 1 },
        ],
      ],
    });
    const hits = patternBreakOutliers(wb);
    expect(hits.map((h) => h.cell)).toEqual(["C1"]);
    expect(hits[0].evidence).toMatch(/different formula shape/);
  });

  it("tolerates a single blank spacer cell inside an otherwise-uniform run", () => {
    const wb = wbOf({
      S: [[{ f: "A1*2", v: 2 }, { f: "B1*2", v: 2 }, null, { f: "D1*2", v: 2 }]],
    });
    expect(patternBreakOutliers(wb)).toHaveLength(0);
  });

  it("does not bridge a two-cell gap", () => {
    const wb = wbOf({
      S: [[{ f: "A1*2", v: 2 }, { f: "B1*2", v: 2 }, null, null, { f: "E1*2", v: 2 }]],
    });
    // A:B is only 2 cells (below MIN_RUN_LENGTH) and E is isolated — no run
    // of length >= 3 exists, so nothing is flagged.
    expect(patternBreakOutliers(wb)).toHaveLength(0);
  });
});

describe("duplicateHardcodes", () => {
  it("flags a literal cell matching a formula cell's live-evaluated value", () => {
    const wb = wbOf({
      S: [
        ["Source", { f: "10*2.5", v: 0 }], // B1 live-evaluates to 25
        ["Dup", 25], // B2 duplicates it
      ],
    });
    const hits = duplicateHardcodes(wb);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sheet: "S", cell: "B2", value: 25, embedded: false });
    expect(hits[0].sources).toEqual([{ sheet: "S", cell: "B1", formula: "=10*2.5" }]);
  });

  it("flags a literal even when the workbook carries no cached formula values at all", () => {
    // Real SpreadsheetBench Debugging inputs are frequently saved fully
    // uncalculated (verified: 538/538 formula cells in the "Embedded
    // Hardcodes" input.xlsx). The detector must evaluate live via the
    // formula engine rather than reading the file's absent cache.
    const wb = wbOf({
      S: [
        ["Source", { f: "10*2.5", uncalculated: true }],
        ["Dup", 25],
      ],
    });
    const hits = duplicateHardcodes(wb);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sheet: "S", cell: "B2", value: 25 });
  });

  it("flags a literal embedded inside another cell's formula", () => {
    // Debugging 03_02's J46 shape: "=-J42*0.053" should read "=-J42*$C$33".
    const wb = wbOf({
      S: [
        ["Rate", 0.053], // B1: canonical input
        ["Driver", 10],
        ["Embedded", { f: "B2*0.053", v: 0 }], // B3: embeds the same rate
      ],
    });
    const hits = duplicateHardcodes(wb);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sheet: "S", cell: "B3", value: 0.053, embedded: true });
    expect(hits[0].sources).toEqual([{ sheet: "S", cell: "B1", formula: null }]);
  });

  it("does not flag the canonical literal that other cells duplicate", () => {
    const wb = wbOf({
      S: [
        ["Rate", 0.053],
        ["Driver", 10],
        ["Embedded", { f: "B2*0.053", v: 0 }],
      ],
    });
    const hits = duplicateHardcodes(wb);
    expect(hits.map((h) => h.cell)).not.toContain("B1");
  });

  it("never flags 0, 1, -1, small integers, or calendar years", () => {
    const wb = wbOf({
      S: [
        ["Source", { f: "0*1", v: 0 }],
        ["a", 0],
        ["b", 1],
        ["c", -1],
        ["d", 7],
        ["e", 2024],
        ["Source2", { f: "2000+24", v: 0 }],
      ],
    });
    expect(duplicateHardcodes(wb)).toHaveLength(0);
  });

  it("never flags a round percentage even when it coincides with a computed value", () => {
    const wb = wbOf({
      S: [
        ["Source", { f: "0.1*1", v: 0 }], // live value 0.1 — a round 10%
        ["Dup", 0.1],
      ],
    });
    expect(duplicateHardcodes(wb)).toHaveLength(0);
  });

  it("does not flag a literal that legitimately recurs across many independent input cells", () => {
    // Debugging 03_02's J21:N21 shape: the same 1.8 typed five times on
    // purpose across period columns — no formula anywhere shares that
    // value, so it must never be treated as a "duplicate of a computation".
    const wb = wbOf({
      S: [["Rate", 1.8, 1.8, 1.8, 1.8, 1.8]],
    });
    expect(duplicateHardcodes(wb)).toHaveLength(0);
  });

  it("skips a value shared by more than the matching-source cap", () => {
    const wb = wbOf({
      S: [
        ["s1", { f: "100*2.15", v: 0 }],
        ["s2", { f: "50*4.3", v: 0 }],
        ["s3", { f: "43*5", v: 0 }],
        ["s4", { f: "215*1", v: 0 }],
        ["dup", 215],
      ],
    });
    // Four independent formula cells all landing on 215 makes it a common
    // number, not a confident single-source duplicate (cap is 3).
    expect(duplicateHardcodes(wb)).toHaveLength(0);
  });
});

describe("findCandidateBugs", () => {
  it("assigns sequential ids and caps the combined list at 20, pattern-breaks first", () => {
    const rows: CellSpec[][] = [];
    for (let i = 0; i < 30; i++) {
      // Each row is its own 4-cell run with one deliberate outlier.
      rows.push([
        { f: `SUM(A${i + 100}:A${i + 103})`, v: 1 },
        { f: `SUM(B${i + 100}:B${i + 103})`, v: 1 },
        { f: `AVERAGE(C${i + 100}:C${i + 103})`, v: 1 },
        { f: `SUM(D${i + 100}:D${i + 103})`, v: 1 },
      ]);
    }
    const wb = wbOf({ S: rows });
    const { bugs, omitted } = findCandidateBugs(wb);
    expect(bugs.length).toBe(20);
    expect(bugs.every((b) => b.kind === "pattern-break")).toBe(true);
    expect(bugs.map((b) => b.id)).toEqual(Array.from({ length: 20 }, (_, i) => `B${i + 1}`));
    expect(omitted).toBe(10);
  });

  it("combines both detectors when neither alone reaches the cap", () => {
    const wb = wbOf({
      S: [
        [
          { f: "SUM(A2:A5)", v: 1 },
          { f: "SUM(B2:B5)", v: 1 },
          { f: "AVERAGE(C2:C5)", v: 1 },
          { f: "SUM(D2:D5)", v: 1 },
        ],
        ["Source", { f: "10*2.5", v: 0 }],
        ["Dup", 25],
      ],
    });
    const { bugs } = findCandidateBugs(wb);
    const kinds = new Set(bugs.map((b) => b.kind));
    expect(kinds.has("pattern-break")).toBe(true);
    expect(kinds.has("duplicate-hardcode")).toBe(true);
  });

  it("returns an empty result for a workbook with no formulas at all", () => {
    const wb = wbOf({ S: [["just", "text", "values"]] });
    const { bugs, omitted } = findCandidateBugs(wb);
    expect(bugs).toHaveLength(0);
    expect(omitted).toBe(0);
  });
});
