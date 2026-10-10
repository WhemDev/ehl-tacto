import { describe, expect, it } from "vitest";
import { excelError } from "@/lib/formula/ast";
import { createSimulator } from "@/lib/formula/simulate";
import { applyEditPlan, type CellEditPlan } from "@/lib/bench/edits";
import { parseWorkbook } from "@/lib/workbook";
import { xlsxBytes } from "./helpers/workbooks";

/** Asserts `actual` is a number within `tol` of `expected`. */
function expectClose(actual: unknown, expected: number, tol = 0.01): void {
  expect(typeof actual).toBe("number");
  expect(Math.abs((actual as number) - expected)).toBeLessThan(tol);
}

/** A1 = B1*0.5+10, B1 = A1*0.5 — fixpoint at A1≈13.3333, B1≈6.6667. */
function twoCellCycleWb(seedA1: number, seedB1: number) {
  return parseWorkbook(
    xlsxBytes({
      Calc: [[{ f: "B1*0.5+10", v: seedA1 }, { f: "A1*0.5", v: seedB1 }]],
    }),
    "cycle.xlsx",
  );
}

describe("iterative recovery for circular references", () => {
  it("(a) converges a two-cell cycle when the caller opts in", async () => {
    const wb = twoCellCycleWb(0, 0);
    const sim = createSimulator(wb, { iterateCycles: true });
    await sim.recalculate();

    expectClose(sim.getValue("Calc", "A1"), 13.3333);
    expectClose(sim.getValue("Calc", "B1"), 6.6667);
  });

  it("(b) without the flag, the same cycle still pins to #CIRCULAR! — default unchanged", async () => {
    const wb = twoCellCycleWb(0, 0);
    const sim = createSimulator(wb);
    await sim.recalculate();

    expect(sim.getValue("Calc", "A1")).toEqual(excelError("#CIRCULAR!"));
    expect(sim.getValue("Calc", "B1")).toEqual(excelError("#CIRCULAR!"));
  });

  it("(c) a cycle already cached at its fixpoint converges immediately and stays there", async () => {
    const wb = twoCellCycleWb(13.3333, 6.6667);
    const sim = createSimulator(wb, { iterateCycles: true });
    await sim.recalculate();

    expectClose(sim.getValue("Calc", "A1"), 13.3333);
    expectClose(sim.getValue("Calc", "B1"), 6.6667);
  });

  it("(d) applyEditPlan (bench path) leaves downstream cycle cells numeric, not #CIRCULAR!", async () => {
    // A1 is a plain input that feeds the B1<->C1 cycle: B1 = C1*0.5+A1, C1 = B1*0.5.
    const wb = parseWorkbook(
      xlsxBytes({
        Calc: [[10, { f: "C1*0.5+A1", v: 0 }, { f: "B1*0.5", v: 0 }]],
      }),
      "cycle-bench.xlsx",
    );
    const plan: CellEditPlan = {
      edits: [{ sheet: "Calc", range: "A1", value: 20 }],
      newSheets: [],
      notes: "",
    };
    const applied = await applyEditPlan(wb, plan);

    // New fixpoint at A1=20: B1 = 0.75B1 = 20 -> B1≈26.6667, C1≈13.3333.
    expectClose(applied.sim.getValue("Calc", "B1"), 26.6667, 0.05);
    expectClose(applied.sim.getValue("Calc", "C1"), 13.3333, 0.05);
  });

  it("(e) a non-convergent self-cycle terminates instead of hanging", async () => {
    const wb = parseWorkbook(
      xlsxBytes({ Calc: [[{ f: "A1+1", v: 0 }]] }),
      "diverge.xlsx",
    );
    const sim = createSimulator(wb, { iterateCycles: true });

    const start = Date.now();
    await sim.recalculate();
    const elapsed = Date.now() - start;

    expect(typeof sim.getValue("Calc", "A1")).toBe("number");
    expect(elapsed).toBeLessThan(2000);
  });
});
