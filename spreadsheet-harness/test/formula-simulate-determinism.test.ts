/**
 * Correctness guarantee for the undo-log evaluateWithChanges path
 * (lib/formula/simulate.ts): runs the same randomized change-sets, seeded
 * for reproducibility, through both createSimulator's fast undo-log restore
 * and createSimulatorWithLegacyRestore's whole-workbook snapshot/graph-rebuild
 * restore, against the real Excaliba.xlsx fixture (the actual workload the
 * undo log was built for — 102 rows x 63 cols, a mix of literal Forecast/PO
 * cells and formula-driven Stock Level/TOPLAM cells).
 *
 * Two things are checked after every one of the 200 iterations:
 *   1. The values evaluateWithChanges itself returns for a random target list
 *      are identical between the two paths — the "compute" side is shared
 *      code (runRecalculate), so this mostly guards against a change-set
 *      application bug, not the restore logic specifically.
 *   2. Every populated cell's value, read straight off each simulator via
 *      getValue, is identical between the two paths AND identical to the
 *      pristine pre-transaction baseline — this is the actual restore-path
 *      guarantee: evaluateWithChanges must be non-destructive, and the fast
 *      path's patch-only undo log must leave the workbook exactly where the
 *      slow path's full rebuild would have.
 *
 * Running check #2 after every iteration (not just the last one) matters:
 * an undo-log bug that only corrupts, say, a formula cell's graph edges
 * would otherwise not show up until a later iteration's recalculate()
 * depended on that cell — checking every iteration catches it at the exact
 * step it was introduced.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { formatCell } from "@/lib/a1";
import type { CellValue } from "@/lib/formula/ast";
import { createSimulator, createSimulatorWithLegacyRestore } from "@/lib/formula/simulate";
import { parseWorkbook, type ParsedSheet, type ParsedWorkbook } from "@/lib/workbook";
import { HAVE_EXCALIBA, readExcaliba } from "./helpers/excaliba";

const ITERATIONS = 200;

/** mulberry32 — small, seeded, dependency-free PRNG. Deterministic across
 *  runs/machines so a failure here is always reproducible from the seed. */
function mulberry32(seed: number): () => number {
  let s = seed;
  return function next(): number {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.skipIf(!HAVE_EXCALIBA)("evaluateWithChanges: undo-log path matches the legacy snapshot/rebuild path", () => {
  let workbook: ParsedWorkbook;
  let sheet: ParsedSheet;

  beforeAll(() => {
    workbook = parseWorkbook(readExcaliba(), "Excaliba.xlsx");
    sheet = workbook.sheets[0];
  });

  it("has a real fixture with both literal and formula cells to mix into change-sets", () => {
    expect(sheet.cells.size).toBeGreaterThan(1000);
  });

  it(`is byte-identical to the legacy path across ${ITERATIONS} randomized change-sets`, async () => {
    // Two independent simulators sharing the same immutable ParsedWorkbook —
    // buildWorkbookModel copies out of it rather than mutating it, so this is
    // exactly like two callers who each loaded the file separately.
    const fast = createSimulator(workbook);
    const legacy = createSimulatorWithLegacyRestore(workbook);

    const addresses = [...sheet.cells.values()].map((cell) => formatCell(cell.row, cell.col));
    const baseline = new Map<string, CellValue>(addresses.map((addr) => [addr, fast.getValue(sheet.name, addr)]));

    const rand = mulberry32(0xc0ffee ^ sheet.cells.size);
    const randInt = (n: number): number => Math.floor(rand() * n);
    const randomAddr = (): string => formatCell(randInt(sheet.rows), randInt(sheet.cols));
    const randomValue = (): CellValue => {
      const kind = rand();
      if (kind < 0.6) return Math.round((rand() - 0.5) * 4_000_000) / 100;
      if (kind < 0.75) return randInt(3) === 0; // boolean
      if (kind < 0.85) return `note-${randInt(1000)}`; // string, forces a formula removal + type churn
      if (kind < 0.95) return 0;
      return Math.round(rand() * 15) * 107142; // a batch-size-shaped multiple, the real solve pattern
    };

    const assertFullStateMatchesBaseline = (): void => {
      for (const addr of addresses) {
        const vFast = fast.getValue(sheet.name, addr);
        const vLegacy = legacy.getValue(sheet.name, addr);
        expect(vFast).toEqual(baseline.get(addr));
        expect(vLegacy).toEqual(baseline.get(addr));
      }
    };

    // Every populated cell must already agree before a single change runs —
    // establishes the two simulators actually started from the same state.
    assertFullStateMatchesBaseline();

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const changeCount = 1 + randInt(4);
      const cells: Record<string, CellValue> = {};
      for (let c = 0; c < changeCount; c++) {
        cells[randomAddr()] = randomValue();
      }
      const changes = { [sheet.name]: cells };

      const targetCount = 1 + randInt(6);
      const targets = { [sheet.name]: Array.from({ length: targetCount }, randomAddr) };

      const resultFast = await fast.evaluateWithChanges(changes, targets);
      const resultLegacy = await legacy.evaluateWithChanges(changes, targets);

      expect(resultFast, `iteration ${iter}: returned target values diverged`).toEqual(resultLegacy);
      assertFullStateMatchesBaseline();
    }
  });
});
