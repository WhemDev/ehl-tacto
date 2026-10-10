/**
 * test/helpers/excaliba.ts — the one door from the test suite to the real
 * Excaliba.xlsx fixture.
 *
 * Excaliba.xlsx is a real customer's planning workbook. It lives at the
 * repo root and is gitignored on purpose (private customer data) — present
 * only on founders' machines, never in a fresh clone or on a CI runner.
 *
 * Any suite that needs it must gate its Excaliba-dependent `describe`
 * block behind `describe.skipIf(!HAVE_EXCALIBA)` (see test/charts-golden
 * .test.ts for the same idiom against a different missing-on-purpose
 * dataset) so a fresh worktree and CI report those cases as skipped, never
 * as failed. Nothing in the guarded block may read the file outside a hook
 * or a lazily-evaluated getter — a bare `describe(...)` factory body still
 * runs during test collection even when the suite itself is skipped, so a
 * top-level `readExcaliba()` call there would throw regardless.
 *
 * The synthetic demo workbook planned for phase P3 (`public/demo/...`,
 * modelled on the Excaliba shape — see T3.1 in
 * docs/superpowers/specs/2026-09-04-erp-v2-design.md) is the intended
 * future replacement for these integration cases: committed, synthetic,
 * and safe to run everywhere.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Absolute path to the fixture, resolved the same way every suite that
 *  has ever read it did: relative to the process's cwd (the repo root
 *  when tests run via `npm test` / `vitest run`). */
export const EXCALIBA_PATH = join(process.cwd(), "Excaliba.xlsx");

/** True only on a machine that actually has the private fixture checked
 *  out locally. Suites gate on this, not on NODE_ENV or CI, so the same
 *  `describe.skipIf` behaves identically for a developer's fresh clone
 *  and for GitHub Actions. */
export const HAVE_EXCALIBA = existsSync(EXCALIBA_PATH);

/**
 * Reads the fixture's raw bytes. Callers should never reach here in CI or
 * a fresh worktree, because the owning `describe` is skipped — this throws
 * a clear, path-naming error instead of an opaque ENOENT if that guard is
 * ever missing.
 */
export function readExcaliba(): Uint8Array {
  if (!HAVE_EXCALIBA) {
    throw new Error(
      `Excaliba.xlsx not found at ${EXCALIBA_PATH}. This is a private customer fixture, gitignored on ` +
        "purpose, present only on founders' machines — guard the caller with describe.skipIf(!HAVE_EXCALIBA).",
    );
  }
  return new Uint8Array(readFileSync(EXCALIBA_PATH));
}
