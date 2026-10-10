import { describe, expect, it } from "vitest";
import { excelError, isExcelError, type CellValue } from "@/lib/formula/ast";
import { FUNCTION_REGISTRY } from "@/lib/formula/functions";
import type { FunctionEvaluator } from "@/lib/formula/evaluator-types";
import { parseFormula } from "@/lib/formula/parser";
import { DependencyGraph, makeKey, type CellKey } from "@/lib/formula/graph";
import { extractRefs, recalculate, type EngineState } from "@/lib/formula/evaluate";

/**
 * There is no Python oracle for this file to check against (see
 * lib/formula/functions/financial.ts's own module doc comment) — every
 * expected value below is instead either:
 *
 *   (a) a documented example straight from Microsoft's own reference page
 *       for that function (cited by name at each test), or
 *   (b) independently reproduced from Excel's own published closed-form TVM
 *       equation, computed via a from-scratch Python script (not this
 *       module's own code) as part of the verification work for this task,
 *       with enough decimal digits to catch a formula-shape bug, not just a
 *       rounding difference.
 *
 * Several tests additionally cross-check two functions against each other
 * (e.g. IPMT(k) + PPMT(k) summed over every period must equal PMT * nper) —
 * an internal consistency check that doesn't depend on trusting any
 * external "known-correct" number at all.
 */

/** Same fakeEvaluator/callFn pattern every other functions/*.test.ts file
 *  uses: each positional value becomes one argument, resolved via a fresh
 *  placeholder AST node keyed by identity. */
function fakeEvaluator(resolve: (node: ReturnType<typeof parseFormula>) => CellValue): FunctionEvaluator {
  return {
    resolveArg: resolve,
    getCellValue: () => null,
    currentSheet: "S",
    currentRow: 1,
    currentColIndex: 1,
  };
}

function callFn(name: string, ...values: CellValue[]): CellValue {
  const args = values.map((_, i) => parseFormula(String(i)));
  const byIndex = new Map(args.map((node, i) => [node, values[i]]));
  const ev = fakeEvaluator((node) => byIndex.get(node)!);
  return FUNCTION_REGISTRY[name](ev, args);
}

function expectClose(actual: CellValue, expected: number, digits = 6): void {
  expect(typeof actual).toBe("number");
  expect(actual as number).toBeCloseTo(expected, digits);
}

describe("PMT", () => {
  it("matches Microsoft's own PMT documentation example: PMT(8%/12,10,10000) = -$1,037.03", () => {
    // Independently reproduced via Excel's closed-form TVM equation to
    // -1037.0320893591636; Microsoft's page rounds it to -1037.03.
    expectClose(callFn("PMT", 0.08 / 12, 10, 10000), -1037.0320893591636, 6);
  });

  it("rate=0 closed form: PMT = -(pv+fv)/nper, no annuity math involved", () => {
    expect(callFn("PMT", 0, 12, -1200)).toBe(100);
  });

  it("nper=0 with a nonzero rate is #DIV/0! (the general formula's denominator is zero)", () => {
    expect(callFn("PMT", 0.05, 0, 1000)).toEqual(excelError("#DIV/0!"));
  });

  it("rate=0 AND nper=0 is also #DIV/0! (the rate=0 closed form divides by nper directly)", () => {
    expect(callFn("PMT", 0, 0, 1000)).toEqual(excelError("#DIV/0!"));
  });

  it("single-tier coercion: bad text for any argument is #VALUE!", () => {
    expect(callFn("PMT", "abc", 10, 10000)).toEqual(excelError("#VALUE!"));
  });

  it("defaults fv to 0 and type to 0 when omitted", () => {
    // Same PMT example above, with fv/type spelled out explicitly, must
    // match the 3-argument call exactly.
    expect(callFn("PMT", 0.08 / 12, 10, 10000)).toBe(callFn("PMT", 0.08 / 12, 10, 10000, 0, 0));
  });
});

describe("FV", () => {
  it("matches Microsoft's own FV documentation example: FV(6%/12,10,-200,-500,1) = $2,581.40", () => {
    // Independently reproduced: 2581.4033740601362.
    expectClose(callFn("FV", 0.06 / 12, 10, -200, -500, 1), 2581.4033740601362, 6);
  });

  it("rate=0 closed form: FV = -(pv + pmt*nper)", () => {
    expect(callFn("FV", 0, 12, -100, -200)).toBe(1400);
  });

  it("single-tier coercion: bad text for any argument is #VALUE!", () => {
    expect(callFn("FV", 0.05, "x", -100)).toEqual(excelError("#VALUE!"));
  });
});

describe("PV", () => {
  it("matches Microsoft's own PV documentation example: PV(8%/12,240,500) = -$59,777.15", () => {
    // Independently reproduced: -59777.14585118777.
    expectClose(callFn("PV", 0.08 / 12, 240, 500), -59777.14585118777, 5);
  });

  it("rate=0 closed form: PV = -(fv + pmt*nper)", () => {
    expect(callFn("PV", 0, 12, -100)).toBe(1200);
  });

  it("round-trips with PMT: PV of the payment PMT produces reconstructs the original pv exactly", () => {
    // Algebraically exact, not just approximate: PMT solves
    // `fv + pv*pow + pmt*fact = 0` for pmt; PV solves the same equation for
    // pv given that pmt back — substituting PMT's own pmt into PV's formula
    // cancels out to precisely the original pv (worked through in
    // financial.ts's own pvValue/pmtValue doc comments).
    const rate = 0.08 / 12;
    const nper = 10;
    const originalPv = 10000;
    const payment = callFn("PMT", rate, nper, originalPv) as number;
    expectClose(callFn("PV", rate, nper, payment), originalPv, 6);
  });

  it("single-tier coercion: bad text for any argument is #VALUE!", () => {
    expect(callFn("PV", 0.05, 10, "x")).toEqual(excelError("#VALUE!"));
  });
});

describe("NPER", () => {
  it("matches Microsoft's own NPER documentation example: NPER(12%/12,-100,-1000,10000,1) = 59.6738656", () => {
    // Independently reproduced: 59.67386567429457.
    expectClose(callFn("NPER", 0.12 / 12, -100, -1000, 10000, 1), 59.67386567429457, 5);
  });

  it("rate=0 closed form: NPER = -(pv+fv)/pmt", () => {
    expect(callFn("NPER", 0, -100, 1000)).toBe(10);
  });

  it("rate=0 with pmt=0 is #DIV/0!", () => {
    expect(callFn("NPER", 0, 0, 1000)).toEqual(excelError("#DIV/0!"));
  });

  it("is #NUM! when the rearranged equation's ratio x = (1+rate)^nper is not a positive real", () => {
    // nperValue's rearrangement solves x := (1+rate)^nper = num/den; here
    // num and den land on opposite signs (num=-100, den=110), giving
    // x=-0.909, which has no real logarithm — no nper, real or not, solves
    // this particular combination of pmt/pv/fv at this rate.
    expect(callFn("NPER", 0.1, 100, 100, 2000)).toEqual(excelError("#NUM!"));
  });

  it("round-trips with PMT/FV: the nper PMT was computed for comes back out", () => {
    const rate = 0.08 / 12;
    const pvArg = 10000;
    const payment = callFn("PMT", rate, 10, pvArg) as number;
    expectClose(callFn("NPER", rate, payment, pvArg), 10, 6);
  });
});

describe("RATE", () => {
  it("matches Microsoft's own RATE documentation example: RATE(48,-200,8000) = 0.7701472% monthly", () => {
    // Independently reproduced via Newton's method on the same TVM
    // equation: 0.00770147248820165.
    expectClose(callFn("RATE", 48, -200, 8000), 0.00770147248820165, 6);
  });

  it("is #NUM! when the cash flows admit no real solution (all same sign — Newton and the bisection fallback both fail)", () => {
    // pv, pmt, and fv all positive: f(r) = pv*(1+r)^n + pmt*(...) + fv is
    // strictly positive for every r > -1, so there is no root anywhere in
    // the search domain — a genuine non-convergence case, not just a bad
    // guess.
    expect(callFn("RATE", 10, 1000, 1000, 1000)).toEqual(excelError("#NUM!"));
  });

  it("round-trips with PMT: the rate PMT was computed for comes back out", () => {
    const nper = 48;
    const pvArg = 8000;
    const payment = callFn("PMT", 0.0077, nper, pvArg) as number;
    expectClose(callFn("RATE", nper, payment, pvArg), 0.0077, 6);
  });

  it("defaults guess to 0.1 when omitted, matching Excel's own documented default", () => {
    expect(callFn("RATE", 48, -200, 8000)).toBe(callFn("RATE", 48, -200, 8000, 0, 0, 0.1));
  });
});

describe("IPMT / PPMT", () => {
  it("matches Microsoft's own IPMT documentation example: IPMT(10%/12,1,3,8000) = -$66.67", () => {
    expectClose(callFn("IPMT", 0.1 / 12, 1, 3, 8000), -66.66666666666667, 6);
  });

  it("PPMT(10%/12,1,3,8000): independently reproduced as -2644.5673882601554", () => {
    expectClose(callFn("PPMT", 0.1 / 12, 1, 3, 8000), -2644.5673882601554, 6);
  });

  it("IPMT + PPMT together equal PMT for every period — the definitional cross-check", () => {
    const rate = 0.08 / 12;
    const nper = 10;
    const pvArg = 10000;
    const payment = callFn("PMT", rate, nper, pvArg) as number;
    for (let per = 1; per <= nper; per++) {
      const interest = callFn("IPMT", rate, per, nper, pvArg) as number;
      const principal = callFn("PPMT", rate, per, nper, pvArg) as number;
      expect(interest + principal).toBeCloseTo(payment, 9);
    }
  });

  it("is #NUM! when per is out of the [1, nper] range", () => {
    expect(callFn("IPMT", 0.08 / 12, 0, 10, 10000)).toEqual(excelError("#NUM!"));
    expect(callFn("IPMT", 0.08 / 12, 11, 10, 10000)).toEqual(excelError("#NUM!"));
    expect(callFn("PPMT", 0.08 / 12, 11, 10, 10000)).toEqual(excelError("#NUM!"));
  });

  it("an annuity-due (type=1) accrues zero interest on the very first payment", () => {
    // No time has passed yet when the first payment of an annuity-due is
    // made, so period 1's interest portion is 0 and the whole payment is
    // principal — a real, documented Excel special case, not an
    // approximation.
    const rate = 0.08 / 12;
    expect(callFn("IPMT", rate, 1, 10, 10000, 0, 1)).toBe(0);
    const payment = callFn("PMT", rate, 10, 10000, 0, 1) as number;
    expectClose(callFn("PPMT", rate, 1, 10, 10000, 0, 1), payment, 9);
  });
});

describe("NPV", () => {
  it("matches Microsoft's own NPV documentation example: NPV(10%,-10000,3000,4200,6800) = $1,188.44", () => {
    // value1 (-10000) is discounted ONE period too, per Excel's own
    // documented off-by-one convention — independently reproduced:
    // 1188.4434123352212.
    expectClose(callFn("NPV", 0.1, -10000, 3000, 4200, 6800), 1188.4434123352212, 6);
  });

  it("is #DIV/0! at rate = -1 (the first cash flow's discount factor is a division by zero)", () => {
    expect(callFn("NPV", -1, 100, 200)).toEqual(excelError("#DIV/0!"));
  });

  it("flattens a range argument the same way SUM does, in order", () => {
    const flows: CellValue[][] = [[3000, 4200, 6800]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], 0.1],
      [args[1], flows],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expectClose(FUNCTION_REGISTRY.NPV(ev, args), 11307.287753568744, 6);
  });

  it("propagates an error found in a flattened range argument, reusing SUM's own aggregate coercion", () => {
    const flows: CellValue[][] = [[3000, excelError("#DIV/0!"), 6800]];
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], 0.1],
      [args[1], flows],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.NPV(ev, args)).toEqual(excelError("#DIV/0!"));
  });
});

describe("IRR", () => {
  it("matches Microsoft's own IRR documentation example: IRR(-70000,12000,15000,18000,21000,26000) = 8.66%", () => {
    // Independently reproduced via Newton's method on the IRR equation
    // (first cash flow at time 0, unlike NPV's own convention above):
    // 0.08663094803653168.
    const flows: CellValue[][] = [[-70000, 12000, 15000, 18000, 21000, 26000]];
    expectClose(callFn("IRR", flows), 0.08663094803653168, 6);
  });

  it("is #NUM! when every cash flow is the same sign — Excel requires at least one of each", () => {
    const flows: CellValue[][] = [[100, 200, 300]];
    expect(callFn("IRR", flows)).toEqual(excelError("#NUM!"));
  });

  it("round-trips with NPV's own equation: XNPV-free sanity check that IRR is genuinely a root", () => {
    const values = [-70000, 12000, 15000, 18000, 21000, 26000];
    const flows: CellValue[][] = [values];
    const irr = callFn("IRR", flows) as number;
    const npvAtIrr = values.reduce((total, v, i) => total + v / Math.pow(1 + irr, i), 0);
    expect(npvAtIrr).toBeCloseTo(0, 6);
  });
});

describe("XNPV", () => {
  const dates: Date[] = [
    new Date(Date.UTC(2008, 0, 1)),
    new Date(Date.UTC(2008, 2, 1)),
    new Date(Date.UTC(2008, 9, 30)),
    new Date(Date.UTC(2009, 1, 15)),
    new Date(Date.UTC(2009, 3, 1)),
  ];
  const values = [-10000, 2750, 4250, 3250, 2750];

  it("matches Microsoft's own XNPV documentation example: $2,086.65", () => {
    // Independently reproduced with actual/365 day counting from the first
    // date: 2086.6476020315354.
    const args = [parseFormula("0"), parseFormula("1"), parseFormula("2")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], 0.09],
      [args[1], [values] as CellValue[][]],
      [args[2], [dates] as unknown as CellValue[][]],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expectClose(FUNCTION_REGISTRY.XNPV(ev, args), 2086.6476020315354, 4);
  });

  it("is #NUM! when values and dates have mismatched lengths", () => {
    const args = [parseFormula("0"), parseFormula("1"), parseFormula("2")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], 0.09],
      [args[1], [[100, 200]] as CellValue[][]],
      [args[2], [[dates[0]]] as unknown as CellValue[][]],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.XNPV(ev, args)).toEqual(excelError("#NUM!"));
  });

  it("is #NUM! when a date precedes the first (starting) date in the range", () => {
    const outOfOrderDates = [dates[0], new Date(Date.UTC(2007, 0, 1))]; // second date is BEFORE dates[0]
    const args = [parseFormula("0"), parseFormula("1"), parseFormula("2")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], 0.09],
      [args[1], [[100, 200]] as CellValue[][]],
      [args[2], [outOfOrderDates] as unknown as CellValue[][]],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.XNPV(ev, args)).toEqual(excelError("#NUM!"));
  });

  it("accepts a serial-number date the same way an Excel date cell would arrive", () => {
    // dateToSerial(2008-01-01) and dateToSerial(2008-03-01) fed through
    // instead of Date objects — same coercion EOMONTH/etc. already use
    // (coerceDate), reused here rather than reimplemented.
    const args = [parseFormula("0"), parseFormula("1"), parseFormula("2")];
    const serialDates: CellValue[][] = [[39449, 39509]]; // 2008-01-01, 2008-03-01 in this engine's serial system
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], 0.09],
      [args[1], [[100, 200]] as CellValue[][]],
      [args[2], serialDates],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    const result = FUNCTION_REGISTRY.XNPV(ev, args);
    expect(typeof result).toBe("number");
  });
});

describe("XIRR", () => {
  const dates: Date[] = [
    new Date(Date.UTC(2008, 0, 1)),
    new Date(Date.UTC(2008, 2, 1)),
    new Date(Date.UTC(2008, 9, 30)),
    new Date(Date.UTC(2009, 1, 15)),
    new Date(Date.UTC(2009, 3, 1)),
  ];
  const values = [-10000, 2750, 4250, 3250, 2750];

  it("matches Microsoft's own XIRR documentation example: 37.34% (0.373362535)", () => {
    // Independently reproduced via Newton's method on the same XNPV
    // equation: 0.3733625335188312.
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], [values] as CellValue[][]],
      [args[1], [dates] as unknown as CellValue[][]],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expectClose(FUNCTION_REGISTRY.XIRR(ev, args), 0.3733625335188312, 4);
  });

  it("is #NUM! when every cash flow is the same sign", () => {
    const args = [parseFormula("0"), parseFormula("1")];
    const byIndex = new Map<ReturnType<typeof parseFormula>, CellValue>([
      [args[0], [[100, 200]] as CellValue[][]],
      [args[1], [[dates[0], dates[1]]] as unknown as CellValue[][]],
    ]);
    const ev = fakeEvaluator((node) => byIndex.get(node)!);
    expect(FUNCTION_REGISTRY.XIRR(ev, args)).toEqual(excelError("#NUM!"));
  });
});

describe("integration: SUM ranges over a PMT cell end to end through the real engine", () => {
  // The exact shape of the real-world bug this task's sibling fix (Fix A)
  // was written for: a debt-schedule cell computes a payment via PMT, and a
  // totals row SUMs across it. Before this change, PMT wasn't in
  // FUNCTION_REGISTRY at all, so the PMT cell was #NAME? and — pre-Fix-A —
  // the SUM would have silently laundered that into a wrong number instead
  // of surfacing it. This test drives the real evaluator (recalculate
  // against the real FUNCTION_REGISTRY) to prove the whole path now
  // produces a real, correct number end to end.
  function setFormula(state: EngineState, key: CellKey, formula: string, sheet: string): void {
    const node = parseFormula(formula);
    state.formulas.set(key, node);
    state.graph.addFormulaCell(key, extractRefs(node, sheet));
  }

  it("SUM(A1:A2) where A2 is a PMT formula computes a real number, not #NAME?", () => {
    const state: EngineState = { formulas: new Map(), values: new Map(), graph: new DependencyGraph() };
    setFormula(state, makeKey("S", "A", 1), "1000", "S");
    setFormula(state, makeKey("S", "A", 2), "PMT(0.08/12,10,10000)", "S");
    setFormula(state, makeKey("S", "B", 1), "SUM(A1:A2)", "S");
    state.graph.markAllDirty();
    recalculate(state, FUNCTION_REGISTRY);

    const pmtCell = state.values.get(makeKey("S", "A", 2));
    expect(isExcelError(pmtCell)).toBe(false);
    expect(pmtCell as number).toBeCloseTo(-1037.0320893591636, 6);

    const total = state.values.get(makeKey("S", "B", 1));
    expect(isExcelError(total)).toBe(false);
    expect(total as number).toBeCloseTo(1000 + -1037.0320893591636, 6);
  });
});
