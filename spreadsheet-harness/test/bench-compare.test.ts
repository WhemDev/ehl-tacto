import { describe, expect, it } from "vitest";
import {
  aggregateScores,
  compareCellFormula,
  compareCellValue,
  compareModeFor,
  generateCellNames,
  parseAnswerPosition,
  pythonRound,
  scoreTask,
  splitAnswerEntry,
  VALUE_MODE,
  type BenchCellValue,
  type CellReader,
} from "@/lib/bench/compare";

/** A reader over literal sheets: { Sheet1: { A1: value | { f, v } } }. */
function reader(
  sheets: Record<string, Record<string, BenchCellValue | { f: string; v: BenchCellValue }>>,
): CellReader {
  const cell = (sheet: string, ref: string) => sheets[sheet]?.[ref];
  return {
    sheetNames: () => Object.keys(sheets),
    value: (sheet, ref) => {
      const c = cell(sheet, ref);
      if (c === undefined) return null;
      return typeof c === "object" && c !== null && !(c instanceof Date) && "f" in c ? c.v : c;
    },
    formulaOrValue: (sheet, ref) => {
      const c = cell(sheet, ref);
      if (c === undefined) return null;
      return typeof c === "object" && c !== null && !(c instanceof Date) && "f" in c ? c.f : c;
    },
  };
}

describe("pythonRound", () => {
  it("rounds half to even like Python", () => {
    expect(pythonRound(2.5)).toBe(2);
    expect(pythonRound(3.5)).toBe(4);
    expect(pythonRound(-2.5)).toBe(-2);
    expect(pythonRound(0.125, 2)).toBe(0.12);
    expect(pythonRound(0.135, 2)).toBe(0.14);
    expect(pythonRound(1.005, 2)).toBe(1.0); // 1.005 is stored below the half
  });
});

describe("compareCellValue", () => {
  it("accepts exact and 1%-tolerant numeric matches", () => {
    expect(compareCellValue(100, 100)).toBe(true);
    expect(compareCellValue(100, 100.9)).toBe(true); // rel 0.0089
    expect(compareCellValue(100, 102)).toBe(false); // rel 0.0196
    expect(compareCellValue(-0.105, -0.10500000000000001)).toBe(true);
  });

  it("uses absolute tolerance when either side is zero", () => {
    expect(compareCellValue(0, 0.005)).toBe(true);
    expect(compareCellValue(0, 0.02)).toBe(false);
  });

  it("treats booleans as numbers, as Python's isinstance does", () => {
    expect(compareCellValue(true, 1)).toBe(true);
    expect(compareCellValue(false, 0)).toBe(true);
    expect(compareCellValue(true, 0)).toBe(false);
  });

  it("parses string-encoded numbers", () => {
    expect(compareCellValue("3.14159", 3.14)).toBe(true);
    expect(compareCellValue("1000", 1001)).toBe(true);
    expect(compareCellValue("abc", 3.14)).toBe(false);
    expect(compareCellValue("abc", "abc")).toBe(true);
    expect(compareCellValue("abc", "abd")).toBe(false);
  });

  it("collapses dates to Excel serials", () => {
    // 2023-01-15 is serial 44941.
    expect(compareCellValue(new Date(2023, 0, 15), 44941)).toBe(true);
    expect(compareCellValue(new Date(2023, 0, 15), new Date(2023, 0, 15, 10, 30))).toBe(true);
    // Official quirk, preserved: date-vs-number lands on the transformed
    // numeric branch, where 1% RELATIVE tolerance on serials makes any date
    // within ~15 months of 2023 "equal". Only a far-apart date misses.
    expect(compareCellValue(new Date(2023, 0, 15), 44942)).toBe(true);
    expect(compareCellValue(new Date(2023, 0, 15), 40000)).toBe(false);
  });

  it("treats finance placeholders and #DIV/0!/#N/A as mutually equivalent", () => {
    expect(compareCellValue("#N/A", "N/A")).toBe(true);
    expect(compareCellValue("#DIV/0!", "-")).toBe(true);
    expect(compareCellValue("n.m.", "—")).toBe(true);
    expect(compareCellValue("-", 5)).toBe(false);
    expect(compareCellValue("#REF!", "N/A")).toBe(false); // #REF! is not in the set
  });

  it("treats empty and None as equivalent, and None as zero", () => {
    expect(compareCellValue("", null)).toBe(true);
    expect(compareCellValue(null, null)).toBe(true);
    expect(compareCellValue(null, 0)).toBe(true);
    expect(compareCellValue(null, 0.001)).toBe(true); // rounds to 0.0
    expect(compareCellValue(null, 5)).toBe(false);
    expect(compareCellValue(null, "x")).toBe(false);
  });

  it("compares formula strings case-insensitively without anchors", () => {
    expect(compareCellValue("=SUM(A1:A2)", "=sum($A$1:$A$2)")).toBe(true);
    expect(compareCellValue("=SUM(A1:A2)", "=SUM(A1:A3)")).toBe(false);
  });
});

describe("compareCellFormula", () => {
  it("normalises case, anchors, and the legacy =+ prefix", () => {
    expect(compareCellFormula("=+A1*2", "=a1*2")).toBe(true);
    expect(compareCellFormula("=$B$2", "=B2")).toBe(true);
    expect(compareCellFormula("=B2", "=B3")).toBe(false);
  });

  it("treats empty and None as equivalent, and falls back to values", () => {
    expect(compareCellFormula(null, "")).toBe(true);
    expect(compareCellFormula(1.001, 1.0)).toBe(true);
    expect(compareCellFormula("=A1", 5)).toBe(false);
  });
});

describe("parseAnswerPosition / generateCellNames / splitAnswerEntry", () => {
  it("splits on commas outside quoted sheet names", () => {
    expect(parseAnswerPosition("Sheet1!A1:B2,'ACC,Dil'!B2:K52,C3")).toEqual([
      "Sheet1!A1:B2",
      "'ACC,Dil'!B2:K52",
      "C3",
    ]);
  });

  it("expands ranges column-major like the official generator", () => {
    expect(generateCellNames("A1:B2")).toEqual(["A1", "A2", "B1", "B2"]);
    expect(generateCellNames("C3")).toEqual(["C3"]);
    expect(generateCellNames("AA1:AB1")).toEqual(["AA1", "AB1"]);
  });

  it("resolves quoted sheets and falls back to the golden first sheet", () => {
    expect(splitAnswerEntry("'ACC,Dil'!B2:K52", "S")).toEqual({ sheet: "ACC,Dil", range: "B2:K52" });
    expect(splitAnswerEntry("B2:K52", "First")).toEqual({ sheet: "First", range: "B2:K52" });
  });
});

describe("compareModeFor", () => {
  it("sniffs Debugging Color/Embedded variants from the path", () => {
    expect(compareModeFor("Debugging", "spreadsheet/Embedded_1/input.xlsx").withFormula).toBe(true);
    expect(compareModeFor("Debugging", "spreadsheet/Color_2/input.xlsx").withFontColor).toBe(true);
    expect(compareModeFor("Financial_Model", "spreadsheet/Embedded/input.xlsx")).toEqual({
      withFormula: false,
      withFontColor: false,
    });
  });
});

describe("scoreTask", () => {
  const input = reader({
    S: { A1: "Region", A2: "North", A3: "South", B1: "Total", B2: null, B3: null },
  });
  const golden = reader({
    S: { A1: "Region", A2: "North", A3: "South", B1: "Total", B2: 100, B3: 200 },
  });

  it("scores a perfect output as solved", () => {
    const output = reader({
      S: { A1: "Region", A2: "North", A3: "South", B1: "Total", B2: 100, B3: 200 },
    });
    const score = scoreTask({ input, golden, output, answerPosition: "S!A1:B3" });
    expect(score.regression).toEqual({ correct: 4, total: 4 });
    expect(score.modification).toEqual({ correct: 2, total: 2 });
    expect(score.accuracy).toBe(1);
    expect(score.errorMessage).toBe("");
  });

  it("fails the task when one modification cell is wrong", () => {
    const output = reader({
      S: { A1: "Region", A2: "North", A3: "South", B1: "Total", B2: 100, B3: 999 },
    });
    const score = scoreTask({ input, golden, output, answerPosition: "S!A1:B3" });
    expect(score.modificationAccuracy).toBe(0.5);
    expect(score.accuracy).toBe(0);
    expect(score.errorMessage).toContain("Modification error at S!B3");
  });

  it("fails the task when a regression cell was disturbed", () => {
    const output = reader({
      S: { A1: "Region", A2: "CHANGED", A3: "South", B1: "Total", B2: 100, B3: 200 },
    });
    const score = scoreTask({ input, golden, output, answerPosition: "S!A1:B3" });
    expect(score.regressionAccuracy).toBe(0.75);
    expect(score.accuracy).toBe(0);
    expect(score.errorMessage).toContain("Regression error at S!A2");
  });

  it("promotes regression accuracy ≥ 99.8% to 1.0", () => {
    // 1000 regression cells with 2 disturbed → 0.998 → promoted to 1.0, so
    // with the single modification cell right the task still counts as solved.
    const inputCells: Record<string, BenchCellValue> = { B1: null };
    const goldenCells: Record<string, BenchCellValue> = { B1: 7 };
    const outputCells: Record<string, BenchCellValue> = { B1: 7 };
    for (let r = 1; r <= 1000; r++) {
      inputCells[`A${r}`] = r;
      goldenCells[`A${r}`] = r;
      outputCells[`A${r}`] = r <= 2 ? -1 : r;
    }
    const score = scoreTask({
      input: reader({ S: inputCells }),
      golden: reader({ S: goldenCells }),
      output: reader({ S: outputCells }),
      answerPosition: "S!A1:A1000,S!B1",
    });
    expect(score.regression).toEqual({ correct: 998, total: 1000 });
    expect(score.regressionAccuracy).toBe(1.0);
    expect(score.accuracy).toBe(1);

    // Three disturbed cells → 0.997 → no promotion → failed.
    outputCells.A3 = -1;
    const worse = scoreTask({
      input: reader({ S: inputCells }),
      golden: reader({ S: goldenCells }),
      output: reader({ S: outputCells }),
      answerPosition: "S!A1:A1000,S!B1",
    });
    expect(worse.regressionAccuracy).toBe(0.997);
    expect(worse.accuracy).toBe(0);
  });

  it("mirrors the official zero-total ratios exactly", () => {
    // No modification cells: mod_ratio is 0.0 by definition in the official
    // code, so accuracy can only be 1 when it is *also* 1.0 — it never is.
    const same = reader({ S: { A1: 1 } });
    const score = scoreTask({ input: same, golden: same, output: same, answerPosition: "S!A1" });
    expect(score.modification.total).toBe(0);
    expect(score.modificationAccuracy).toBe(0);
    expect(score.accuracy).toBe(0);
  });

  it("reports a missing worksheet in the official phrasing", () => {
    const output = reader({ Other: { A1: 1 } });
    const score = scoreTask({ input, golden, output, answerPosition: "S!A1:B3" });
    expect(score.errors).toContain("S worksheet not found");
    expect(score.regression).toEqual({ correct: 0, total: 4 });
    expect(score.accuracy).toBe(0);
  });

  it("falls back to formula comparison when a side holds an Excel error", () => {
    const goldenErr = reader({ S: { A1: { f: "=1/B9", v: "#DIV/0!" } } });
    const outSame = reader({ S: { A1: { f: "=1/$B$9", v: "#DIV/0!" } } });
    const outDiff = reader({ S: { A1: { f: "=1/C9", v: "#DIV/0!" } } });
    const empty = reader({ S: {} });
    expect(
      scoreTask({ input: empty, golden: goldenErr, output: outSame, answerPosition: "S!A1" })
        .modification,
    ).toEqual({ correct: 1, total: 1 });
    expect(
      scoreTask({ input: empty, golden: goldenErr, output: outDiff, answerPosition: "S!A1" })
        .modification,
    ).toEqual({ correct: 0, total: 1 });
  });

  it("compares formulas throughout in Embedded mode", () => {
    // A2 is untouched (regression); A1's formula is what the task fixes.
    const inputF = reader({ S: { A1: { f: "=SUM(B1:B2)", v: 3 }, A2: { f: "=B1", v: 1 } } });
    const goldenF = reader({ S: { A1: { f: "=SUM(B1:B3)", v: 6 }, A2: { f: "=B1", v: 1 } } });
    const outRight = reader({ S: { A1: { f: "=sum($B$1:$B$3)", v: 999 }, A2: { f: "=B1", v: 1 } } });
    const outWrong = reader({ S: { A1: { f: "=SUM(B1:B2)", v: 6 }, A2: { f: "=B1", v: 1 } } });
    const mode = { withFormula: true, withFontColor: false };
    const right = scoreTask({
      input: inputF, golden: goldenF, output: outRight, answerPosition: "S!A1:A2", mode,
    });
    expect(right.regression).toEqual({ correct: 1, total: 1 });
    expect(right.modification).toEqual({ correct: 1, total: 1 });
    expect(right.accuracy).toBe(1);
    expect(
      scoreTask({ input: inputF, golden: goldenF, output: outWrong, answerPosition: "S!A1:A2", mode })
        .modification,
    ).toEqual({ correct: 0, total: 1 });
  });

  it("flags Color-mode tasks as value-only", () => {
    const same = reader({ S: { A1: 1 } });
    const score = scoreTask({
      input: same,
      golden: same,
      output: same,
      answerPosition: "S!A1",
      mode: { withFormula: false, withFontColor: true },
    });
    expect(score.fontColorSkipped).toBe(true);
  });

  it("scores multi-range answer positions across sheets", () => {
    const inp = reader({ A: { A1: 1, B1: null }, B: { A1: "x" } });
    const gold = reader({ A: { A1: 1, B1: 5 }, B: { A1: "y" } });
    const out = reader({ A: { A1: 1, B1: 5 }, B: { A1: "y" } });
    const score = scoreTask({ input: inp, golden: gold, output: out, answerPosition: "A!A1:B1,B!A1" });
    expect(score.regression).toEqual({ correct: 1, total: 1 });
    expect(score.modification).toEqual({ correct: 2, total: 2 });
    expect(score.accuracy).toBe(1);
  });
});

describe("aggregateScores", () => {
  it("averages the way the official evaluator does", () => {
    const agg = aggregateScores([
      { regressionAccuracy: 1, modificationAccuracy: 1, accuracy: 1 },
      { regressionAccuracy: 0.5, modificationAccuracy: 0, accuracy: 0 },
      { regressionAccuracy: 0, modificationAccuracy: 0, accuracy: 0, missing: true },
    ]);
    expect(agg.totalTasks).toBe(3);
    expect(agg.missingOutputs).toBe(1);
    // Missing tasks are excluded from the soft ratios…
    expect(agg.regressionAccuracy).toBe(0.75);
    expect(agg.modificationAccuracy).toBe(0.5);
    // …but count as zeros in the headline accuracy.
    expect(agg.accuracy).toBe(0.3333);
  });
});

describe("VALUE_MODE", () => {
  it("is the plain value comparison", () => {
    expect(VALUE_MODE).toEqual({ withFormula: false, withFontColor: false });
  });
});
