/**
 * Financial (time-value-of-money) functions: PMT, IPMT, PPMT, FV, PV, NPER,
 * RATE, NPV, XNPV, IRR, XIRR.
 *
 * Unlike every sibling module in this directory, these are NOT ported from
 * simulation/functions/ — the Python reference engine (the oracle every
 * other function here matches byte-for-byte, per test/formula-oracle*.
 * test.ts) has no financial-function family at all, so there is no oracle
 * line range to cite and no fixture that exercises them. These are written
 * directly against Excel's own documented closed-form TVM equation instead;
 * each export below cites it and the known-correct example value(s) used to
 * test it (test/formula-functions-financial.test.ts documents the
 * derivation of every one of those numbers).
 *
 * Their absence from FUNCTION_REGISTRY was the proximate #NAME? in a real
 * LBO debt schedule (`=-PMT(W28,W29,S30,0)`), whose wrong-number fallout
 * into a Gauss-Seidel cycle is the subject of this same change's sibling
 * fix — see coerce.ts's toNumberOrErrorForAggregate doc comment.
 */

import { excelError, isExcelError, type AstNode, type ExcelErrorValue } from "../ast";
import { coerceNumber, toNumberOrErrorForAggregate } from "../coerce";
import type { ExcelFunction, FunctionEvaluator } from "../evaluator-types";
import { coerceDate, dateToSerial } from "./date";
import { flattenNumbersOrError, flattenOneLevel } from "./math";

// -- shared TVM algebra --------------------------------------------------

/** (1+rate)^nper — the one term every PMT/FV/PV/NPER/RATE/IPMT/PPMT closed
 *  form below builds on. */
function growth(rate: number, nper: number): number {
  return Math.pow(1 + rate, nper);
}

/**
 * The payment for a loan/annuity. Excel's own TVM equation (documented on
 * the PMT function reference page, and shared verbatim by FV/PV/NPER/RATE
 * below — each just solves it for a different unknown):
 *
 *   fv + pv*(1+rate)^nper + pmt*(1+rate*type)*((1+rate)^nper - 1)/rate = 0
 *
 * solved for pmt. `type` is 0 for an ordinary annuity (payment at the end of
 * each period) or 1 for an annuity-due (payment at the start) — the
 * `(1+rate*type)` factor. rate=0 is a separate closed form (Excel's own PMT
 * page gives it too) rather than a limit of the general one, since the
 * general form divides by rate.
 *
 * nper=0 with a nonzero rate makes the general form's denominator
 * ((1+rate)^0 - 1 = 0) zero — #DIV/0!, matching real Excel.
 */
function pmtValue(rate: number, nper: number, pv: number, fv: number, type: number): number | ExcelErrorValue {
  if (rate === 0) {
    if (nper === 0) return excelError("#DIV/0!");
    return -(pv + fv) / nper;
  }
  const pow = growth(rate, nper);
  const fact = ((1 + rate * type) * (pow - 1)) / rate;
  if (fact === 0) return excelError("#DIV/0!");
  return -(fv + pv * pow) / fact;
}

/** Same equation as pmtValue, solved for fv instead. No division-by-rate
 *  guard needed beyond the rate===0 branch: the general form only divides by
 *  `rate`, which is nonzero in that branch by construction. */
function fvValue(rate: number, nper: number, pmt: number, pv: number, type: number): number {
  if (rate === 0) return -(pv + pmt * nper);
  const pow = growth(rate, nper);
  return -(pv * pow + (pmt * (1 + rate * type) * (pow - 1)) / rate);
}

/** Same equation, solved for pv. Guards the one extra failure mode FV
 *  doesn't have: dividing by `pow` at the end, which is 0 when rate = -1 (a
 *  100%-per-period decline) and nper > 0. */
function pvValue(rate: number, nper: number, pmt: number, fv: number, type: number): number | ExcelErrorValue {
  if (rate === 0) return -(fv + pmt * nper);
  const pow = growth(rate, nper);
  if (pow === 0) return excelError("#DIV/0!");
  return -(fv + (pmt * (1 + rate * type) * (pow - 1)) / rate) / pow;
}

/**
 * Same equation, solved for nper. The standard rearrangement (also used by
 * numpy-financial's `nper`, cross-checked independently for this port):
 *
 *   x := (1+rate)^nper = (pmt*(1+rate*type) - fv*rate) / (pmt*(1+rate*type) + pv*rate)
 *   nper = ln(x) / ln(1+rate)
 *
 * #NUM! when x isn't a positive real (no real solution — e.g. pv, pmt, and
 * fv all carrying the same sign, so the account only ever grows or only
 * ever shrinks and never crosses zero) or when 1+rate isn't positive
 * (ln(1+rate) undefined for a rate at or below -100%). #DIV/0! when the
 * denominator of x is exactly zero, or (rate=0 branch) when pmt is zero —
 * both genuine division by zero, not "no solution".
 */
function nperValue(rate: number, pmt: number, pv: number, fv: number, type: number): number | ExcelErrorValue {
  if (rate === 0) {
    if (pmt === 0) return excelError("#DIV/0!");
    return -(pv + fv) / pmt;
  }
  if (1 + rate <= 0) return excelError("#NUM!");
  const num = pmt * (1 + rate * type) - fv * rate;
  const den = pmt * (1 + rate * type) + pv * rate;
  if (den === 0) return excelError("#DIV/0!");
  const x = num / den;
  if (x <= 0) return excelError("#NUM!");
  const n = Math.log(x) / Math.log(1 + rate);
  return Number.isFinite(n) ? n : excelError("#NUM!");
}

/**
 * Interest portion of payment number `per` (1-based) of an nper-period
 * loan/annuity. Algorithm (matching numpy-financial's `ipmt`, cross-checked
 * against Microsoft's own IPMT documentation example —
 * IPMT(0.1/12,1,3,8000) = -66.67 — in the test file):
 *
 *   totalPmt = pmtValue(rate, nper, pv, fv, type)
 *   balance  = fvValue(rate, per-1, totalPmt, pv, type)   -- the running
 *              balance after `per-1` payments, expressed the same
 *              cash-position way FV itself is
 *   interest = balance * rate
 *
 * ...then, only for an annuity-due (type=1): the payment at the start of
 * the period means no interest has accrued yet at payment time, so the
 * whole-period interest above is discounted back one period
 * (`interest / (1+rate)`), and period 1 specifically has accrued zero
 * interest at all (nothing owed yet when the very first payment is made).
 */
function ipmtValue(
  rate: number,
  per: number,
  nper: number,
  pv: number,
  fv: number,
  type: number,
): number | ExcelErrorValue {
  if (per < 1 || per > nper) return excelError("#NUM!");
  const totalPmt = pmtValue(rate, nper, pv, fv, type);
  if (isExcelError(totalPmt)) return totalPmt;
  const balance = fvValue(rate, per - 1, totalPmt, pv, type);
  let interest = balance * rate;
  if (type === 1) {
    interest = interest / (1 + rate);
    if (per === 1) interest = 0;
  }
  return interest;
}

/** Principal portion of payment number `per` — whatever of the total
 *  payment isn't interest. */
function ppmtValue(
  rate: number,
  per: number,
  nper: number,
  pv: number,
  fv: number,
  type: number,
): number | ExcelErrorValue {
  const totalPmt = pmtValue(rate, nper, pv, fv, type);
  if (isExcelError(totalPmt)) return totalPmt;
  const interest = ipmtValue(rate, per, nper, pv, fv, type);
  if (isExcelError(interest)) return interest;
  return totalPmt - interest;
}

// -- argument plumbing -----------------------------------------------------

/** rate, nper, pv, [fv], [type] — the shared 5-argument shape PMT/FV/PV all
 *  use (each just names its own 3rd positional argument differently). */
function readTvmArgs(
  evaluator: FunctionEvaluator,
  args: AstNode[],
): [number, number, number, number, number] | ExcelErrorValue {
  const rate = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(rate)) return rate;
  const nper = coerceNumber(evaluator.resolveArg(args[1]));
  if (isExcelError(nper)) return nper;
  const third = coerceNumber(evaluator.resolveArg(args[2]));
  if (isExcelError(third)) return third;
  const fourth = args.length > 3 ? coerceNumber(evaluator.resolveArg(args[3])) : 0;
  if (isExcelError(fourth)) return fourth;
  const type = args.length > 4 ? coerceNumber(evaluator.resolveArg(args[4])) : 0;
  if (isExcelError(type)) return type;
  return [rate, nper, third, fourth, type];
}

// PMT(rate, nper, pv, [fv], [type])
export const pmt: ExcelFunction = (evaluator, args) => {
  const parsed = readTvmArgs(evaluator, args);
  if (isExcelError(parsed)) return parsed;
  const [rate, nper, pv, fv, type] = parsed;
  return pmtValue(rate, nper, pv, fv, type);
};

// FV(rate, nper, pmt, [pv], [type])
export const fv: ExcelFunction = (evaluator, args) => {
  const parsed = readTvmArgs(evaluator, args);
  if (isExcelError(parsed)) return parsed;
  const [rate, nper, pmtArg, pv, type] = parsed;
  return fvValue(rate, nper, pmtArg, pv, type);
};

// PV(rate, nper, pmt, [fv], [type])
export const pv: ExcelFunction = (evaluator, args) => {
  const parsed = readTvmArgs(evaluator, args);
  if (isExcelError(parsed)) return parsed;
  const [rate, nper, pmtArg, fvArg, type] = parsed;
  return pvValue(rate, nper, pmtArg, fvArg, type);
};

// NPER(rate, pmt, pv, [fv], [type])
export const nper: ExcelFunction = (evaluator, args) => {
  const parsed = readTvmArgs(evaluator, args);
  if (isExcelError(parsed)) return parsed;
  const [rate, pmtArg, pvArg, fvArg, type] = parsed;
  return nperValue(rate, pmtArg, pvArg, fvArg, type);
};

// IPMT(rate, per, nper, pv, [fv], [type])
export const ipmt: ExcelFunction = (evaluator, args) => {
  const rate = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(rate)) return rate;
  const perRaw = coerceNumber(evaluator.resolveArg(args[1]));
  if (isExcelError(perRaw)) return perRaw;
  const nperArg = coerceNumber(evaluator.resolveArg(args[2]));
  if (isExcelError(nperArg)) return nperArg;
  const pv = coerceNumber(evaluator.resolveArg(args[3]));
  if (isExcelError(pv)) return pv;
  const fv = args.length > 4 ? coerceNumber(evaluator.resolveArg(args[4])) : 0;
  if (isExcelError(fv)) return fv;
  const type = args.length > 5 ? coerceNumber(evaluator.resolveArg(args[5])) : 0;
  if (isExcelError(type)) return type;
  return ipmtValue(rate, Math.trunc(perRaw), nperArg, pv, fv, type);
};

// PPMT(rate, per, nper, pv, [fv], [type])
export const ppmt: ExcelFunction = (evaluator, args) => {
  const rate = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(rate)) return rate;
  const perRaw = coerceNumber(evaluator.resolveArg(args[1]));
  if (isExcelError(perRaw)) return perRaw;
  const nperArg = coerceNumber(evaluator.resolveArg(args[2]));
  if (isExcelError(nperArg)) return nperArg;
  const pv = coerceNumber(evaluator.resolveArg(args[3]));
  if (isExcelError(pv)) return pv;
  const fv = args.length > 4 ? coerceNumber(evaluator.resolveArg(args[4])) : 0;
  if (isExcelError(fv)) return fv;
  const type = args.length > 5 ? coerceNumber(evaluator.resolveArg(args[5])) : 0;
  if (isExcelError(type)) return type;
  return ppmtValue(rate, Math.trunc(perRaw), nperArg, pv, fv, type);
};

// -- root-finding (RATE, IRR, XIRR) ----------------------------------------

/**
 * Excel-compatible root finder shared by RATE/IRR/XIRR: Newton's method
 * (central-difference numeric derivative — the three callers' equations are
 * different enough that a shared closed-form derivative isn't worth
 * maintaining three times) from `guess`, falling back to a bracket-and-
 * bisect scan across a wide rate domain when Newton fails to converge, hits
 * a non-finite value, or leaves the domain where the derivative is usable.
 * Excel's own RATE/IRR just give up and report #NUM! in that situation
 * (their Newton implementation is undocumented but known to have no
 * fallback); this port tries harder before giving up, but still ends at
 * null (→ #NUM! at the call site) rather than ever silently returning a
 * wrong root.
 */
function findRoot(f: (r: number) => number, guess: number): number | null {
  const NEWTON_ITERATIONS = 50;
  const TOL = 1e-10;

  let r = guess;
  for (let i = 0; i < NEWTON_ITERATIONS; i++) {
    const fr = f(r);
    if (!Number.isFinite(fr)) break;
    if (Math.abs(fr) < TOL) return r;
    const h = Math.max(1e-6, Math.abs(r) * 1e-6);
    const derivative = (f(r + h) - f(r - h)) / (2 * h);
    if (!Number.isFinite(derivative) || derivative === 0) break;
    const next = r - fr / derivative;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - r) < TOL) return next;
    r = next;
  }

  // Bisection fallback: scan a wide domain (-99% to +1000%, in 1-point
  // steps) for a sign change, then bisect inside the first bracket found.
  // No sign change anywhere in this domain means there is, for all
  // practical purposes, no real solution (e.g. cash flows that never
  // change sign) — #NUM! at the call site, not a wrong answer.
  const STEP = 0.01;
  let a = -0.99;
  let fa = f(a);
  for (let b = a + STEP; b <= 10; b += STEP) {
    const fb = f(b);
    if (Number.isFinite(fa) && Number.isFinite(fb) && ((fa < 0 && fb > 0) || (fa > 0 && fb < 0))) {
      let lo = a;
      let hi = b;
      let flo = fa;
      for (let iter = 0; iter < 100; iter++) {
        const mid = (lo + hi) / 2;
        const fmid = f(mid);
        if (!Number.isFinite(fmid)) break;
        if (Math.abs(fmid) < TOL || hi - lo < 1e-12) return mid;
        if ((flo < 0 && fmid < 0) || (flo > 0 && fmid > 0)) {
          lo = mid;
          flo = fmid;
        } else {
          hi = mid;
        }
      }
      return (lo + hi) / 2;
    }
    a = b;
    fa = fb;
  }
  return null;
}

// RATE(nper, pmt, pv, [fv], [type], [guess])
export const rate: ExcelFunction = (evaluator, args) => {
  const nperArg = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(nperArg)) return nperArg;
  const pmtArg = coerceNumber(evaluator.resolveArg(args[1]));
  if (isExcelError(pmtArg)) return pmtArg;
  const pvArg = coerceNumber(evaluator.resolveArg(args[2]));
  if (isExcelError(pvArg)) return pvArg;
  const fvArg = args.length > 3 ? coerceNumber(evaluator.resolveArg(args[3])) : 0;
  if (isExcelError(fvArg)) return fvArg;
  const type = args.length > 4 ? coerceNumber(evaluator.resolveArg(args[4])) : 0;
  if (isExcelError(type)) return type;
  // Excel's own documented default guess for RATE is 10% (0.1).
  const guess = args.length > 5 ? coerceNumber(evaluator.resolveArg(args[5])) : 0.1;
  if (isExcelError(guess)) return guess;

  const f = (r: number): number => {
    if (r === 0) return pvArg + pmtArg * nperArg + fvArg;
    const pow = growth(r, nperArg);
    return pvArg * pow + (pmtArg * (1 + r * type) * (pow - 1)) / r + fvArg;
  };
  const root = findRoot(f, guess);
  if (root === null || root <= -1) return excelError("#NUM!");
  return root;
};

// -- NPV / XNPV --------------------------------------------------------------

/**
 * NPV(rate, value1, [value2], ...) — Excel's own off-by-one convention:
 * value1 is discounted ONE period, not zero (unlike IRR below, which treats
 * its first cash flow as occurring at time 0). This is why a typical model
 * writes `=NPV(rate, futureFlows) + initialOutlay` with the time-0 outlay
 * added outside the NPV call rather than passed as value1 — real Excel
 * documents this explicitly on the NPV reference page.
 *
 * Each value argument may itself be a range; flattenNumbersOrError (shared
 * with SUM/AVERAGE/etc. in math.ts — see Fix A) skips a non-numeric cell but
 * propagates an ExcelErrorValue, matching real Excel: an error cell in an
 * NPV range surfaces, it isn't silently treated as absent.
 */
export const npv: ExcelFunction = (evaluator, args) => {
  const rateArg = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(rateArg)) return rateArg;
  if (1 + rateArg === 0) return excelError("#DIV/0!");

  const flows = flattenNumbersOrError(evaluator, args.slice(1));
  if (isExcelError(flows)) return flows;

  let total = 0;
  for (let i = 0; i < flows.length; i++) {
    total += flows[i] / Math.pow(1 + rateArg, i + 1);
  }
  return total;
};

/** Shared by XNPV and XIRR: resolves the values/dates range pair to
 *  same-length parallel arrays of (number, Excel serial day). Uses
 *  flattenOneLevel (imported from math.ts, where SUMPRODUCT needs the exact
 *  same "position-preserving, nothing skipped" flattening for its own
 *  index-aligned range pairing) rather than flattenNumbersOrError above:
 *  XNPV/XIRR pair values[i] with dates[i] by index, so silently dropping a
 *  non-numeric values[i] without dropping the matching dates[i] would
 *  desynchronize the pairing. */
function readCashflowSchedule(
  evaluator: FunctionEvaluator,
  valuesArg: AstNode,
  datesArg: AstNode,
): { values: number[]; serials: number[] } | ExcelErrorValue {
  const valuesRaw = flattenOneLevel(evaluator.resolveArg(valuesArg));
  const datesRaw = flattenOneLevel(evaluator.resolveArg(datesArg));
  if (valuesRaw.length !== datesRaw.length || valuesRaw.length === 0) {
    return excelError("#NUM!");
  }

  const values: number[] = [];
  const serials: number[] = [];
  for (let i = 0; i < valuesRaw.length; i++) {
    const n = coerceNumber(valuesRaw[i]);
    if (isExcelError(n)) return n;
    values.push(n);
    const d = coerceDate(datesRaw[i]);
    if (isExcelError(d)) return d;
    serials.push(dateToSerial(d));
  }

  // Real Excel: "If any number in dates precedes the starting date [the
  // first date in the range], XNPV/XIRR return the #NUM! error" — the
  // discount exponent below is (serial[i] - serial[0])/365, which needs
  // serial[0] to be the earliest to keep every exponent non-negative.
  const d0 = serials[0];
  for (const s of serials) {
    if (s < d0) return excelError("#NUM!");
  }

  return { values, serials };
}

/**
 * XNPV(rate, values, dates) — actual/365 day-count discounting from the
 * FIRST date in the range (dates[0], per Microsoft's own XNPV
 * documentation — not necessarily the chronological minimum, though
 * readCashflowSchedule above requires it to be, matching real Excel's own
 * "dates must not precede the starting date" #NUM! rule):
 *
 *   XNPV = sum_i values[i] / (1+rate)^((dates[i]-dates[0])/365)
 *
 * Verified against Microsoft's own XNPV documentation example (dates
 * 2008-01-01 .. 2009-04-01, values -10000,2750,4250,3250,2750, rate 9%):
 * $2,086.65 — see the test file for the exact figure and independent
 * reproduction of this same formula.
 */
export const xnpv: ExcelFunction = (evaluator, args) => {
  const rateArg = coerceNumber(evaluator.resolveArg(args[0]));
  if (isExcelError(rateArg)) return rateArg;
  if (1 + rateArg <= 0) return excelError("#NUM!");

  const schedule = readCashflowSchedule(evaluator, args[1], args[2]);
  if (isExcelError(schedule)) return schedule;
  const { values, serials } = schedule;

  const d0 = serials[0];
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const exponent = (serials[i] - d0) / 365;
    total += values[i] / Math.pow(1 + rateArg, exponent);
  }
  return total;
};

// -- IRR / XIRR --------------------------------------------------------------

/**
 * IRR(values, [guess]) — the rate at which NPV of `values` is zero, with
 * the FIRST cash flow at time 0 (unlike NPV's own value1-at-period-1
 * convention above — a real, well-documented divergence between the two
 * functions in Excel itself):
 *
 *   0 = sum_{i=0}^{n-1} values[i] / (1+rate)^i
 *
 * Real Excel requires at least one positive and one negative value (a pure
 * income or pure outflow stream has no rate that reconciles it — the sum is
 * always the same sign for every rate above -100%) — #NUM! otherwise,
 * checked explicitly rather than relying on findRoot's bisection scan to
 * fail to find a sign change (same outcome, cheaper).
 *
 * Verified against Microsoft's own IRR documentation example (values
 * -70000,12000,15000,18000,21000,26000): 8.66%, reproduced independently in
 * the test file via this same equation.
 */
export const irr: ExcelFunction = (evaluator, args) => {
  const valuesRaw = flattenOneLevel(evaluator.resolveArg(args[0]));
  const values: number[] = [];
  for (const v of valuesRaw) {
    // Aggregate-tier coercion (skip blanks/non-numeric text, propagate a
    // real error) — the same contract SUM/AVERAGE/etc. use for a range
    // argument, reused here via coerce.ts's toNumberOrErrorForAggregate
    // rather than re-implemented.
    const n = toNumberOrErrorForAggregate(v);
    if (n === null) continue;
    if (isExcelError(n)) return n;
    values.push(n);
  }
  if (values.length < 2) return excelError("#NUM!");
  if (!values.some((v) => v > 0) || !values.some((v) => v < 0)) return excelError("#NUM!");

  const guess = args.length > 1 ? coerceNumber(evaluator.resolveArg(args[1])) : 0.1;
  if (isExcelError(guess)) return guess;

  const f = (r: number): number => {
    let total = 0;
    for (let i = 0; i < values.length; i++) total += values[i] / Math.pow(1 + r, i);
    return total;
  };
  const root = findRoot(f, guess);
  if (root === null || root <= -1) return excelError("#NUM!");
  return root;
};

/**
 * XIRR(values, dates, [guess]) — the rate at which XNPV of the schedule is
 * zero. Same actual/365, first-date-anchored discounting as XNPV above,
 * solved by the same Newton-then-bisection root finder RATE/IRR use.
 *
 * Verified against Microsoft's own XIRR documentation example (same
 * schedule as the XNPV example above): 37.34% (0.373362535 exactly),
 * reproduced independently in the test file via this same formula.
 */
export const xirr: ExcelFunction = (evaluator, args) => {
  const schedule = readCashflowSchedule(evaluator, args[0], args[1]);
  if (isExcelError(schedule)) return schedule;
  const { values, serials } = schedule;
  if (!values.some((v) => v > 0) || !values.some((v) => v < 0)) return excelError("#NUM!");

  const d0 = serials[0];
  const guess = args.length > 2 ? coerceNumber(evaluator.resolveArg(args[2])) : 0.1;
  if (isExcelError(guess)) return guess;

  const f = (r: number): number => {
    let total = 0;
    for (let i = 0; i < values.length; i++) {
      total += values[i] / Math.pow(1 + r, (serials[i] - d0) / 365);
    }
    return total;
  };
  const root = findRoot(f, guess);
  if (root === null || root <= -1) return excelError("#NUM!");
  return root;
};
