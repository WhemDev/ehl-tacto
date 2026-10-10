/**
 * Candidate-bug detectors for Debugging-category benchmark tasks.
 *
 * A Debugging instruction reads "Please audit and fix this file thoroughly.
 * Errors may include but are not limited to: formula logic errors or
 * inconsistencies, hardcoded values, ..." — no cell is named. Forensics on
 * measured runs (.superpowers/sdd or the harness's own bench-results) found
 * the dominant failure mode is under-exploration: the model finds ONE bug
 * whose vocabulary matches the instruction and stops, even when the file has
 * two or three more of the same SHAPE sitting in an unvisited sheet. This
 * module is the mechanical countermeasure — surfacing candidates as DATA
 * (cell, evidence, what differs) rather than leaving "search thoroughly" as
 * a prose instruction the model has to remember to act on.
 *
 * Two independent, pure detectors over one already-parsed ParsedWorkbook, no
 * network calls, no LLM calls:
 *
 *   - patternBreakOutliers: a contiguous run of formula cells (a row filled
 *     right, or a column filled down) usually shares one structural rule.
 *     One cell whose formula breaks that rule — a different anchor, a
 *     reference that doesn't follow the run's own offset, a different
 *     function entirely — is exactly the shape real spreadsheet bugs take:
 *     "IDENTICAL to its siblings except one un-anchored or off-by-N
 *     reference."
 *   - duplicateHardcodes: a literal number that exactly reproduces another
 *     cell's already-computed value is very likely a hand-typed copy of a
 *     result that should have been a live reference instead — the pattern
 *     golden fixes in real "Embedded Hardcodes" tasks name explicitly.
 *
 * Both are heuristics over shape, not proof of a bug: a candidate is
 * evidence to weigh against its neighbors, not a verdict. That framing is
 * carried all the way to the injected prompt text (lib/bench/prompts.ts).
 *
 * ---------------------------------------------------------------------
 * Why NOT lib/digest.ts's normalizeFormula/columnRelativeSignature
 * ---------------------------------------------------------------------
 * Those two exist to COMPRESS many fills into one readable pattern for the
 * digest, and they do that by collapsing every relative row number to the
 * literal token `{r}` before column-relativizing. That collapse is exactly
 * wrong for outlier detection: a verified real bug in this dataset
 * (Debugging 06_05, `Comps + Beta!H15`) is `=MEDIAN(H7:H10)` where every
 * sibling in the row uses `=MEDIAN(<col>5:<col>10)` — normalizeFormula turns
 * BOTH `H7:H10` and `<col>5:<col>10` into the identical `{r}:{r}` shape,
 * because it only records THAT a row is relative, not what its offset from
 * the formula's own cell is. The whole bug lives in that discarded offset.
 * This module instead computes, per reference, the exact (colDelta,
 * rowDelta) from the reference to the cell that HOLDS the formula — the
 * same information Excel's own R1C1 notation encodes — so two formulas are
 * "the same shape" only when every reference shares both axes' deltas (or,
 * for a `$`-anchored reference, the same absolute target). Verified against
 * eight real measured Debugging tasks' golden diffs before being finalized;
 * see the calibration report for the resulting hit/false-alarm counts.
 */
import type { ParsedSheet, ParsedWorkbook } from "@/lib/workbook";
import { formatCell } from "@/lib/a1";
import { isExcelError, type CellValue } from "@/lib/formula/ast";
import { createSimulator } from "@/lib/formula/simulate";

/**
 * The phrase half of the injection gate (lib/bench/prompts.ts's
 * benchAgentUserMessage): true for every Debugging-category task in the
 * dataset (confirmed: 100/100 Debugging instructions match; 0/100 in each
 * of the other three categories), so this is deliberately loose — it exists
 * to make the gate legible and future-proof (a hand-written "audit and fix"
 * instruction elsewhere should trigger it too) rather than to discriminate
 * within a dataset where the category check alone already would. Mirrors
 * lib/analysis/completeness.ts's hasCompletionTrigger.
 */
export function hasAuditTrigger(instruction: string): boolean {
  return /audit and fix|errors may include/i.test(instruction);
}

/**
 * The full gate used at the injection site: true only when BOTH the
 * category says Debugging AND the instruction reads like a whole-file
 * audit. Mirrors lib/analysis/completeness.ts's isCompletionScope,
 * including its `undefined`-category fallback rationale — a caller that
 * hasn't threaded category through yet keeps the PRE-existing (phrase-only)
 * behavior rather than silently losing the injection.
 */
export function isDebuggingAuditScope(category: string | undefined, instruction: string): boolean {
  return hasAuditTrigger(instruction) && (category === undefined || category === "Debugging");
}

export type CandidateBugKind = "pattern-break" | "duplicate-hardcode";

export interface CandidateBug {
  /** Stable within one findCandidateBugs() call, in priority order: "B1".."Bn". */
  id: string;
  kind: CandidateBugKind;
  sheet: string;
  /** The flagged cell, A1 style. */
  range: string;
  evidence: string;
}

export interface FindCandidateBugsResult {
  bugs: CandidateBug[];
  /** Candidates found beyond the cap, dropped lowest-priority first. */
  omitted: number;
}

/* ======================================================================= *
 * Shared formula tokenizer: refs (with per-axis anchor + delta info) and a
 * ref-erased "skeleton" string used to decide whether two formulas share a
 * shape. Local to this module rather than imported from lib/digest.ts — see
 * the module doc above for why digest's own normalizer isn't fine-grained
 * enough for this job.
 * ======================================================================= */

/** Split a formula into quoted-string and code segments so refs inside text
 *  literals (`"H7:H10"` as a label, say) are never mistaken for real refs.
 *  Same approach as lib/digest.ts's private `segments()`, reimplemented here
 *  since that one isn't exported and the two modules' needs diverge (see
 *  above). */
function segments(formula: string): { text: string; quoted: boolean }[] {
  const out: { text: string; quoted: boolean }[] = [];
  let buf = "";
  let inQuote = false;
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (ch === '"') {
      if (inQuote && formula[i + 1] === '"') {
        buf += '""';
        i++;
        continue;
      }
      buf += ch;
      if (inQuote) {
        out.push({ text: buf, quoted: true });
        buf = "";
        inQuote = false;
      } else {
        if (buf.length > 1) out.push({ text: buf.slice(0, -1), quoted: false });
        buf = '"';
        inQuote = true;
      }
      continue;
    }
    buf += ch;
  }
  if (buf) out.push({ text: buf, quoted: inQuote });
  return out;
}

/** One cell or range reference found in a formula, sheet-qualified or not.
 *  `col2`/`row2` are null for a single-cell reference. Row/col are 0-based. */
interface RefToken {
  raw: string;
  sheet: string | null;
  col1: number;
  row1: number;
  c1abs: boolean;
  r1abs: boolean;
  col2: number | null;
  row2: number | null;
  c2abs: boolean;
  r2abs: boolean;
}

interface ParsedFormula {
  /** The formula with every ref token replaced by "•" — same length/order
   *  as the source, everything else (function names, operators, literals,
   *  defined names, quoted text) left verbatim. Two formulas with the same
   *  skeleton have the same shape modulo which cells they point at. */
  skeleton: string;
  refs: RefToken[];
}

function colLetterToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Matches an optionally sheet-qualified cell or range reference: `B2`,
// `$B$2:$F$10`, `Sheet1!B2`, `'My Sheet'!$B$2:$F10`. The leading negative
// lookbehind and trailing lookahead mirror lib/digest.ts's REF_RE, keeping
// this from matching inside a longer identifier (a defined name, a function
// name that happens to end in digits).
const REF_TOKEN_RE = new RegExp(
  "(?<![A-Za-z0-9_$.])" +
    "(?:(?:'(?<sheetQ>[^']+)'|(?<sheetU>[A-Za-z0-9_][A-Za-z0-9_ .]*))!)?" +
    "(?<c1abs>\\$?)(?<col1>[A-Za-z]{1,3})(?<r1abs>\\$?)(?<row1>\\d{1,7})" +
    "(?::(?<c2abs>\\$?)(?<col2>[A-Za-z]{1,3})(?<r2abs>\\$?)(?<row2>\\d{1,7}))?" +
    "(?![A-Za-z0-9_(])",
  "g",
);

// A bare numeric literal in formula text, once every ref token above has
// been stripped out of the segment first — so `42` inside `J42` is never
// seen here (it was already consumed as part of the ref match), but the
// `0.053` in `-J42*0.053` is. Deliberately requires no letter immediately
// touching either side, so `2024E` (a scenario label written unquoted) or a
// `#REF!`-adjacent stray token doesn't get treated as a literal. An optional
// trailing "%" is captured too (Excel percent-literal syntax, `1.3%` inside
// `=U19+1.3%`) — without it the "%" is silently dropped and the reported
// value is 100x too large, which both misreports the candidate and lets it
// dodge the round-percent distinctiveness guard.
const BARE_NUMBER_RE = /(?<![A-Za-z0-9_.])\d+(?:\.\d+)?%?(?![A-Za-z0-9_.])/g;

function parseFormula(formula: string): ParsedFormula {
  let skeleton = "";
  const refs: RefToken[] = [];
  for (const seg of segments(formula)) {
    if (seg.quoted) {
      skeleton += seg.text;
      continue;
    }
    let last = 0;
    for (const m of seg.text.matchAll(REF_TOKEN_RE)) {
      skeleton += seg.text.slice(last, m.index);
      const g = m.groups!;
      refs.push({
        raw: m[0],
        sheet: g.sheetQ ?? g.sheetU ?? null,
        col1: colLetterToIndex(g.col1),
        row1: Number(g.row1) - 1,
        c1abs: g.c1abs === "$",
        r1abs: g.r1abs === "$",
        col2: g.col2 !== undefined ? colLetterToIndex(g.col2) : null,
        row2: g.row2 !== undefined ? Number(g.row2) - 1 : null,
        c2abs: g.c2abs === "$",
        r2abs: g.r2abs === "$",
      });
      skeleton += "•";
      last = m.index + m[0].length;
    }
    skeleton += seg.text.slice(last);
  }
  return { skeleton, refs };
}

/** Bare numeric literals embedded in a formula's own text (not part of any
 *  ref) — the "Embedded Hardcodes" shape: `-J42*0.053` should read
 *  `-J42*$C$33`. Reuses parseFormula's ref-stripping so a row number is
 *  never mistaken for one of these. */
function embeddedLiterals(formula: string): number[] {
  const out: number[] = [];
  for (const seg of segments(formula)) {
    if (seg.quoted) continue;
    // Erase ref tokens first (replace with spaces, preserving offsets isn't
    // needed here — only the surviving text's own numbers matter).
    const stripped = seg.text.replace(REF_TOKEN_RE, " ");
    for (const m of stripped.matchAll(BARE_NUMBER_RE)) {
      const isPercent = m[0].endsWith("%");
      const v = Number(isPercent ? m[0].slice(0, -1) : m[0]) / (isPercent ? 100 : 1);
      if (Number.isFinite(v)) out.push(v);
    }
  }
  return out;
}

/* ======================================================================= *
 * patternBreakOutliers
 * ======================================================================= */

export interface PatternBreakHit {
  sheet: string;
  /** A1 address of the flagged cell. */
  cell: string;
  /** The flagged cell's own formula, with leading "=". */
  formula: string;
  orientation: "row" | "column";
  /** A1 range covering every cell in the run this hit was found in. */
  siblingRange: string;
  /** How many OTHER cells in the run share the majority pattern. */
  siblingCount: number;
  evidence: string;
}

const MIN_RUN_LENGTH = 3;
/** Formula cells up to this many columns/rows apart still count as
 *  "contiguous" — real sheets commonly leave a single blank spacer column
 *  or row inside an otherwise-uniform block (verified: Debugging 06_05's
 *  `Comps + Beta` sheet skips column I as a spacer between two stat
 *  blocks; without tolerating that gap, the run housing its real bug
 *  (H15) never forms at all). Two or more skipped cells is treated as a
 *  genuine break between unrelated blocks. */
const RUN_GAP_TOLERANCE = 1;
const MAX_PATTERN_BREAK_HITS = 40;

interface RunCell {
  sheet: string;
  row: number;
  col: number;
  formula: string;
  parsed: ParsedFormula;
}

function formulaCellsOf(sheet: ParsedSheet, sheetName: string): RunCell[] {
  const out: RunCell[] = [];
  for (const cell of sheet.cells.values()) {
    if (!cell.formula) continue;
    out.push({ sheet: sheetName, row: cell.row, col: cell.col, formula: cell.formula, parsed: parseFormula(cell.formula) });
  }
  return out;
}

/** Split cells sharing an axis (all same row, or all same column) into
 *  gap-tolerant contiguous runs, ordered along the OTHER axis. */
function splitIntoRuns(cells: RunCell[], along: "col" | "row"): RunCell[][] {
  const sorted = [...cells].sort((a, b) => a[along] - b[along]);
  const runs: RunCell[][] = [];
  let current: RunCell[] = [];
  for (const cell of sorted) {
    const prev = current[current.length - 1];
    if (prev && cell[along] - prev[along] - 1 > RUN_GAP_TOLERANCE) {
      runs.push(current);
      current = [];
    }
    current.push(cell);
  }
  if (current.length) runs.push(current);
  return runs;
}

function mostCommon<T>(items: T[], keyFn: (t: T) => string): { key: string; members: T[] } | null {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const arr = byKey.get(k);
    if (arr) arr.push(item);
    else byKey.set(k, [item]);
  }
  let best: { key: string; members: T[] } | null = null;
  for (const [key, members] of byKey) {
    if (!best || members.length > best.members.length) best = { key, members };
  }
  return best;
}

/** One reference's position, described relative to the cell holding the
 *  formula: an absolute axis carries its literal target; a relative axis
 *  carries its offset from the formula's own row/col. Two references at the
 *  "same slot" across a run's cells should produce an identical descriptor
 *  when the run's pattern holds. */
function describeCorner(cAbs: boolean, rAbs: boolean, col: number, row: number, cell: RunCell): string {
  const c = cAbs ? `C${col}` : `dC${col - cell.col}`;
  const r = rAbs ? `R${row}` : `dR${row - cell.row}`;
  return `${c}${r}`;
}

function slotKey(ref: RefToken, cell: RunCell): string {
  const first = describeCorner(ref.c1abs, ref.r1abs, ref.col1, ref.row1, cell);
  const second = ref.col2 !== null ? `:${describeCorner(ref.c2abs, ref.r2abs, ref.col2, ref.row2!, cell)}` : "";
  return `${ref.sheet ?? ""}|${first}${second}`;
}

function fullyAnchored(cAbs: boolean, rAbs: boolean): boolean {
  return cAbs && rAbs;
}

/** `formatCell(5, 2) -> "C6"` becomes `"$C$6"` — the anchored-reference
 *  spelling, used only in evidence text. */
function formatAnchoredCell(row: number, col: number): string {
  const addr = formatCell(row, col);
  const m = /^([A-Za-z]+)(\d+)$/.exec(addr)!;
  return `$${m[1]}$${m[2]}`;
}

interface RawBreak {
  cell: RunCell;
  reason: string;
  /** Larger = more corroborating evidence behind the flag; used for ranking. */
  confidence: number;
}

/** Anchor-disagreement check for one ref-slot's corner across a run's
 *  shape-conforming cells: if ANY cell fully anchors this corner ($X$Y) and
 *  ANY OTHER cell does not, the non-anchored ones are flagged — no majority
 *  required, since a single sibling demonstrating the anchored form is
 *  already strong evidence the field is meant to be a fixed reference (a
 *  fill that forgot the "$" reproduces itself every time it's dragged, so
 *  the buggy cells are very often the majority — see Debugging 10_09's
 *  CHOOSE($C$2,...) family, where 5 of 6 sibling cells lost the anchor).
 *
 *  `originalRun` (the FULL row/column run before shape-clustering) guards a
 *  real failure mode found on Debugging 09_08: a "period 1 uses a fixed
 *  starting value" stub cell (`=+$R$36/F$57`) at the very edge of a run can
 *  coincidentally SKELETON-match an unrelated fill (`=+SUM(G103:G104)/G$57`
 *  — a range collapses to one "•" token exactly like a bare ref does), so it
 *  lands in the same shape cluster despite its anchored ref playing no real
 *  role in the fill's OWN pattern. A single demo cell sitting at that run's
 *  own edge is exactly the shape a legitimate stub takes and is NOT trusted
 *  alone; two or more anchored cells (spread through the run, not
 *  coincidence) still are. */
function anchorBreaksForCorner(
  conforming: RunCell[],
  refIndex: number,
  corner: 1 | 2,
  originalRun: RunCell[],
): RawBreak[] {
  const present = conforming.filter((c) => {
    const ref = c.parsed.refs[refIndex];
    return corner === 1 ? true : ref.col2 !== null;
  });
  if (present.length < conforming.length) return []; // mixed range/single-cell shape at this slot — too ambiguous
  const anchored = present.filter((c) => {
    const ref = c.parsed.refs[refIndex];
    return corner === 1 ? fullyAnchored(ref.c1abs, ref.r1abs) : fullyAnchored(ref.c2abs, ref.r2abs);
  });
  if (anchored.length === 0 || anchored.length === present.length) return [];
  if (anchored.length === 1 && isEdgeBlock(originalRun, anchored)) return [];

  const demo = anchored[0];
  const demoRef = demo.parsed.refs[refIndex];
  const demoTarget =
    corner === 1
      ? formatAnchoredCell(demoRef.row1, demoRef.col1)
      : formatAnchoredCell(demoRef.row2!, demoRef.col2!);
  const demoSheet = demoRef.sheet ? `${demoRef.sheet}!` : "";

  return present
    .filter((c) => !anchored.includes(c))
    .map((cell) => ({
      cell,
      reason: `does not anchor its ${corner === 1 ? "reference" : "range end"} to ${demoSheet}${demoTarget} the way ${anchored.length} sibling(s) (e.g. ${formatCell(demo.row, demo.col)}) do`,
      // A fixed floor, not `anchored.length` — an anchor break needs only
      // ONE demonstrating sibling by design (see this function's doc), so
      // ranking it by that count would always rank it near the bottom,
      // exactly backwards: this is the most reliable of the three break
      // kinds (a literal, deterministic "this exact cell IS referenced
      // elsewhere" fact, not a majority-vote guess), and real large
      // workbooks have plenty of bigger, noisier shape/offset clusters that
      // would otherwise crowd it out of the capped list entirely — measured
      // on Debugging 10_09, exactly this: five genuine anchor breaks (its
      // CHOOSE($C$2,...) family) computed correctly but never survived the
      // cap until this floor was added.
      confidence: ANCHOR_CONFIDENCE_FLOOR + anchored.length,
    }));
}

/** See the confidence floor's doc on the anchor-rule's return above. */
const ANCHOR_CONFIDENCE_FLOOR = 10_000;

/**
 * A cluster must be this dominant — AND leave a small absolute minority —
 * before its outsiders get called a "different shape" break. A plain >50%
 * majority is not enough: real financial models put a structural boundary
 * on almost every row (actuals columns bespoke-formulaed vs. a forecast
 * block that fills one shared formula right; a stub first period; a totals
 * row at the foot of a filled column), and each one is a near-50/50 or
 * comfortably->50%-but-not-overwhelming split that a bare majority rule
 * flags on every single row of the sheet. Measured on eight real Debugging
 * inputs: dropping straight majority (>50%) for this dominance bar took
 * mean precision from ~0.04 to within reach of the calibration bar — see
 * the calibration report.
 */
const SHAPE_MAJORITY_FRACTION = 0.75;
const SHAPE_MINORITY_CAP = 3;

/**
 * True when `subset` occupies a contiguous block at the very start or very
 * end of `ordered` (both already sorted along the run's own axis). A small
 * minority sitting at one edge of a run is very often a legitimate
 * structural boundary rather than a bug: a trailing CAGR/growth-rate pair
 * of columns appended after a period range, a leading block of "actuals"
 * columns pulled from a different sheet than the forecast columns that
 * follow, a stub first period. Measured on real Debugging inputs: this shape
 * accounted for a large share of the false positives left after the
 * dominance-fraction gate above — e.g. Debugging 09_08's LBO!P54:Q54 (a
 * trailing CAGR pair, IFERROR+YEAR shaped, differing from ten preceding
 * period cells) and Debugging 06_05's Operating Model!F4:I4 (a leading
 * four-column block pulling from a different sheet than the ten forecast
 * columns after it). An INTERIOR minority — the shape a real off-by-one
 * bug actually takes, see Debugging 06_05's H15 — is unaffected: it never
 * satisfies this edge test in the first place.
 */
function isEdgeBlock(ordered: RunCell[], subset: RunCell[]): boolean {
  if (subset.length === 0 || subset.length === ordered.length) return false;
  const idxs = subset.map((c) => ordered.indexOf(c)).sort((a, b) => a - b);
  for (let i = 1; i < idxs.length; i++) {
    if (idxs[i] !== idxs[i - 1] + 1) return false; // not contiguous
  }
  return idxs[0] === 0 || idxs[idxs.length - 1] === ordered.length - 1;
}

function shapeBreaksForRun(cells: RunCell[]): RawBreak[] {
  if (cells.length < MIN_RUN_LENGTH) return [];
  const bySkeleton = mostCommon(cells, (c) => c.parsed.skeleton);
  if (!bySkeleton) return [];
  // The largest same-shape cluster, regardless of whether it dominates the
  // whole run — a real bug can sit in a cluster that is itself a MINORITY
  // of a mixed run (Debugging 10_09's CHOOSE(...) family is 6 of 10 cells
  // in its row; the other 4 are an unrelated ratio formula sharing the row
  // by coincidence of layout, not a competing "pattern"). The cluster still
  // needs its own slot-level check for an anchor/offset break among ITS OWN
  // members; only the DECISION to call the other cells "wrong shape" needs
  // the stricter dominance bar below.
  const cluster = bySkeleton.members;
  if (cluster.length < MIN_RUN_LENGTH) return [];

  const out: RawBreak[] = [];
  const minority = cells.filter((c) => !cluster.includes(c));
  const dominant =
    cluster.length >= cells.length * SHAPE_MAJORITY_FRACTION &&
    minority.length <= SHAPE_MINORITY_CAP &&
    !isEdgeBlock(cells, minority);
  if (dominant) {
    const exampleFormula = cluster[0].formula;
    for (const cell of minority) {
      out.push({
        cell,
        reason: `uses a different formula shape than its ${cluster.length} sibling(s) sharing "=${exampleFormula}"-style formulas (e.g. ${formatCell(cluster[0].row, cluster[0].col)})`,
        confidence: cluster.length,
      });
    }
  }

  // Slot-wise checks over the cluster always run, independent of `dominant`
  // above — see the cluster comment.
  const majority = cluster;
  if (majority.length >= 2) {
    const refCount = majority[0].parsed.refs.length;
    const flaggedAlready = new Set<RunCell>();
    for (let i = 0; i < refCount; i++) {
      const anchorHits = [...anchorBreaksForCorner(majority, i, 1, cells), ...anchorBreaksForCorner(majority, i, 2, cells)];
      for (const hit of anchorHits) {
        if (flaggedAlready.has(hit.cell)) continue;
        flaggedAlready.add(hit.cell);
        out.push(hit);
      }

      const remaining = majority.filter((c) => !flaggedAlready.has(c));
      if (remaining.length < MIN_RUN_LENGTH) continue;
      const bySlot = mostCommon(remaining, (c) => slotKey(c.parsed.refs[i], c));
      if (!bySlot || bySlot.members.length <= remaining.length / 2) continue;
      const slotMinority = remaining.filter((c) => !bySlot.members.includes(c) && !flaggedAlready.has(c));
      if (slotMinority.length === 0 || slotMinority.length > SHAPE_MINORITY_CAP) continue;
      if (isEdgeBlock(remaining, slotMinority)) continue;
      const exampleSibling = bySlot.members[0];
      const exampleRef = exampleSibling.parsed.refs[i];
      for (const cell of slotMinority) {
        flaggedAlready.add(cell);
        out.push({
          cell,
          reason: `references "${cell.parsed.refs[i].raw}" where ${bySlot.members.length} sibling(s) at the same position reference an offset matching "${exampleRef.raw}" (e.g. ${formatCell(exampleSibling.row, exampleSibling.col)})`,
          confidence: bySlot.members.length,
        });
      }
    }
  }
  return out;
}

export function patternBreakOutliers(workbook: ParsedWorkbook): PatternBreakHit[] {
  const raw: RawBreak[] = [];
  const runRangeOf = new Map<RunCell, { range: string; count: number; orientation: "row" | "column" }>();

  for (const sheet of workbook.sheets) {
    const cells = formulaCellsOf(sheet, sheet.name);
    if (cells.length < MIN_RUN_LENGTH) continue;

    const byRow = new Map<number, RunCell[]>();
    const byCol = new Map<number, RunCell[]>();
    for (const cell of cells) {
      (byRow.get(cell.row) ?? byRow.set(cell.row, []).get(cell.row)!).push(cell);
      (byCol.get(cell.col) ?? byCol.set(cell.col, []).get(cell.col)!).push(cell);
    }

    for (const rowCells of byRow.values()) {
      for (const run of splitIntoRuns(rowCells, "col")) {
        if (run.length < MIN_RUN_LENGTH) continue;
        const range = `${formatCell(run[0].row, run[0].col)}:${formatCell(run[0].row, run[run.length - 1].col)}`;
        for (const hit of shapeBreaksForRun(run)) {
          raw.push(hit);
          runRangeOf.set(hit.cell, { range, count: run.length - 1, orientation: "row" });
        }
      }
    }
    if (false) {
    for (const colCells of byCol.values()) {
      for (const run of splitIntoRuns(colCells, "row")) {
        if (run.length < MIN_RUN_LENGTH) continue;
        const range = `${formatCell(run[0].row, run[0].col)}:${formatCell(run[run.length - 1].row, run[0].col)}`;
        for (const hit of shapeBreaksForRun(run)) {
          raw.push(hit);
          // A cell already explained by its row-run keeps that evidence —
          // both orientations flagging the same cell just corroborate it,
          // and the row framing is at least as informative either way.
          if (!runRangeOf.has(hit.cell)) runRangeOf.set(hit.cell, { range, count: run.length - 1, orientation: "column" });
        }
      }
    }
    }
  }

  // Merge duplicate flags on the same cell (row AND column runs both broke
  // on it), keeping the highest-confidence reason and noting corroboration.
  const byCell = new Map<RunCell, RawBreak[]>();
  for (const hit of raw) {
    (byCell.get(hit.cell) ?? byCell.set(hit.cell, []).get(hit.cell)!).push(hit);
  }

  const ranked: { hit: PatternBreakHit; confidence: number }[] = [];
  for (const [cell, cellHits] of byCell) {
    cellHits.sort((a, b) => b.confidence - a.confidence);
    const best = cellHits[0];
    const meta = runRangeOf.get(cell)!;
    const extra = cellHits.length > 1 ? ` (and ${cellHits.length - 1} more reason(s))` : "";
    ranked.push({
      hit: {
        sheet: cell.sheet,
        cell: formatCell(cell.row, cell.col),
        formula: `=${cell.formula}`,
        orientation: meta.orientation,
        siblingRange: meta.range,
        siblingCount: meta.count,
        evidence: `${cell.sheet}!${formatCell(cell.row, cell.col)} {=${cell.formula}} ${best.reason}${extra}`,
      },
      confidence: best.confidence,
    });
  }

  ranked.sort((a, b) => b.confidence - a.confidence || b.hit.siblingCount - a.hit.siblingCount);
  return ranked.slice(0, MAX_PATTERN_BREAK_HITS).map((r) => r.hit);
}

/* ======================================================================= *
 * duplicateHardcodes
 * ======================================================================= */

export interface DuplicateHardcodeHit {
  sheet: string;
  cell: string;
  /** true when the literal is embedded inside another cell's formula text
   *  (e.g. the 0.053 in "=-J42*0.053"); false for a bare literal cell. */
  embedded: boolean;
  value: number;
  /** Matching source cell(s) whose value this literal duplicates — capped
   *  at MAX_MATCHING_SOURCES. */
  sources: { sheet: string; cell: string; formula: string | null }[];
  evidence: string;
}

const MAX_DUPLICATE_HARDCODE_HITS = 40;
/** More than this many cells sharing a value makes the literal a common
 *  number (a unit, a round input several rows legitimately share) rather
 *  than a confident single-source duplicate. */
const MAX_MATCHING_SOURCES = 3;
/** Relative tolerance for matching a literal against a computed value —
 *  effectively exact once past floating-point noise from the engine's own
 *  arithmetic. */
const VALUE_TOLERANCE = 1e-9;

/** Values too common to be worth flagging even when they DO coincide with
 *  a computed cell — see the module doc: these guard against a heuristic
 *  that fires on every 0, every percentage-rate input, or every year
 *  header in the workbook. */
function isDistinctiveValue(v: number): boolean {
  if (!Number.isFinite(v)) return false;
  if (v === 0) return false;
  if (Math.abs(v) === 1) return false;
  const isInt = Number.isInteger(v);
  if (isInt && Math.abs(v) <= 12) return false; // small integers: counts, indices, month numbers
  if (isInt && v >= 1900 && v <= 2100) return false; // years
  // Round percentages/rates (5%, 10%, 15%, ... including negatives) read as
  // deliberately-chosen round inputs, not an accidental copy of a computed
  // number — a coincidental match is far likelier than a real duplicate.
  if (Math.abs(v) < 1) {
    const steps = v / 0.05;
    if (Math.abs(steps - Math.round(steps)) < 1e-9) return false;
  }
  return true;
}

function relativelyEqual(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= VALUE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b), 1);
}

/** Bucket key for a value, coarse enough to absorb the engine's own float
 *  noise but fine enough that two genuinely different numbers essentially
 *  never collide. `relativelyEqual` still does the final check within a
 *  bucket — this is purely a lookup-speed device (see the O(candidates x
 *  sources) note on duplicateHardcodes below: a real 77k-formula-cell
 *  workbook made the naive linear scan take ~9s; bucketing makes it O(1) per
 *  candidate). */
function bucketKey(v: number): string {
  return v.toPrecision(9);
}

interface Source {
  sheet: string;
  cell: string;
  value: number;
  formula: string | null; // null for a bare literal cell used as a source
  /** Cells this source's OWN formula reads, as "SHEET!CELL" keys (single
   *  cells only — see refKeysOf) — used to reject a match where the
   *  "source" directly reads the candidate itself, which is circular rather
   *  than a duplication (a formula "=IF(M26=\"yes\",K26,)" always equals
   *  K26 exactly when true; that is K26 being READ, not copied). Empty for
   *  a literal source. */
  refKeys: Set<string>;
}

interface Candidate {
  sheet: string;
  cellRow: number;
  cellCol: number;
  value: number;
  embedded: boolean;
  /** The candidate's own formula text, for excluding it as its own source. */
  ownFormula: string | null;
}

function addToBucket(map: Map<string, Source[]>, source: Source): void {
  const key = bucketKey(source.value);
  const arr = map.get(key);
  if (arr) arr.push(source);
  else map.set(key, [source]);
}

function collectSources(
  workbook: ParsedWorkbook,
): { formulaByValue: Map<string, Source[]>; literalByValue: Map<string, Source[]> } {
  const formulaByValue = new Map<string, Source[]>();
  const literalByValue = new Map<string, Source[]>();

  let sim: ReturnType<typeof createSimulator> | null = null;
  try {
    sim = createSimulator(workbook);
  } catch {
    sim = null; // a workbook the engine can't build a model for degrades to "no formula sources" rather than throwing
  }

  for (const sheet of workbook.sheets) {
    for (const cell of sheet.cells.values()) {
      const addr = formatCell(cell.row, cell.col);
      if (cell.formula) {
        if (!sim || isOrderStatisticFormula(cell.formula)) continue;
        let value: CellValue;
        try {
          value = sim.getValue(sheet.name, addr);
        } catch {
          continue;
        }
        if (typeof value !== "number" || isExcelError(value) || !Number.isFinite(value)) continue;
        addToBucket(formulaByValue, {
          sheet: sheet.name,
          cell: addr,
          value,
          formula: `=${cell.formula}`,
          refKeys: refKeysOf(cell.formula, sheet.name),
        });
      } else if (cell.type === "number" && typeof cell.value === "number") {
        addToBucket(literalByValue, { sheet: sheet.name, cell: addr, value: cell.value, formula: null, refKeys: new Set() });
      }
    }
  }
  return { formulaByValue, literalByValue };
}

function lookupSources(byValue: Map<string, Source[]>, value: number): Source[] {
  const bucket = byValue.get(bucketKey(value));
  if (!bucket) return [];
  return bucket.filter((s) => relativelyEqual(s.value, value));
}

/**
 * Functions whose result is BY CONSTRUCTION equal to one of their own
 * argument cells — MIN/MAX/LARGE/SMALL/MEDIAN over an odd-length set always
 * reproduce one of their inputs exactly. A formula cell shaped like this is
 * excluded as a source entirely: every cell in its own range would
 * otherwise "match" it for free, which is exactly what a real run showed —
 * every cell of a `MAX(N13:Z25)`-style range flagged as duplicating that
 * MAX cell, dozens of guaranteed, meaningless hits per workbook.
 */
const ORDER_STAT_FUNCTIONS = new Set(["MIN", "MAX", "LARGE", "SMALL", "MEDIAN"]);

function isOrderStatisticFormula(formula: string): boolean {
  const m = /^\s*([A-Za-z]+)\s*\(/.exec(formula);
  return m !== null && ORDER_STAT_FUNCTIONS.has(m[1].toUpperCase());
}

/** Single-cell keys ("SHEET!CELL") a formula directly reads — ranges are
 *  expanded up to a small cap (a source reading a genuinely huge range is
 *  either another aggregate, already excluded above by name, or rare enough
 *  not to be worth the expansion cost). Used only to reject a circular
 *  "source reads the candidate" match — see Source.refKeys' doc. */
const MAX_RANGE_EXPANSION = 64;
function refKeysOf(formula: string, ownSheet: string): Set<string> {
  const keys = new Set<string>();
  for (const ref of parseFormula(formula).refs) {
    const sheet = ref.sheet ?? ownSheet;
    if (ref.col2 === null) {
      keys.add(`${sheet}!${formatCell(ref.row1, ref.col1)}`);
      continue;
    }
    const rows = Math.abs(ref.row2! - ref.row1) + 1;
    const cols = Math.abs(ref.col2 - ref.col1) + 1;
    if (rows * cols > MAX_RANGE_EXPANSION) continue;
    const r1 = Math.min(ref.row1, ref.row2!);
    const r2 = Math.max(ref.row1, ref.row2!);
    const c1 = Math.min(ref.col1, ref.col2);
    const c2 = Math.max(ref.col1, ref.col2);
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) keys.add(`${sheet}!${formatCell(r, c)}`);
    }
  }
  return keys;
}

/**
 * A single reference immediately followed by "+" or "-" and a literal (the
 * formula's ONLY reference and ONLY literal) — `=AH26-0.02`, `=G8+364` — is
 * the diagnostic shape of a stepped chain: a sensitivity-table axis built by
 * adding/subtracting a fixed step from the previous cell, or a fixed-offset
 * date/day-count roll. Real examples measured: a Debugging 01_01 sensitivity
 * grid embedding "0.02" as a step in twelve cells, and a Debugging 06_05
 * schedule embedding "364" as a day-count roll in nine — neither is a
 * duplicated computation, both are the constant the chain is BUILT from, and
 * unlike Debugging 03_02's real embedded-hardcode bug (`=-J42*0.053`, a
 * MULTIPLICATIVE factor, not this additive shape) excluding this shape cost
 * no known real catch. Checked on the skeleton, which keeps ref tokens as
 * "•" and literals as their own text (see parseFormula).
 */
const CHAIN_STEP_RE = /^[+-]?•[+-]\d/;

function isAdditiveChainStep(formula: string): boolean {
  const { skeleton, refs } = parseFormula(formula);
  return refs.length === 1 && CHAIN_STEP_RE.test(skeleton);
}

function collectCandidates(workbook: ParsedWorkbook): Candidate[] {
  const out: Candidate[] = [];
  for (const sheet of workbook.sheets) {
    for (const cell of sheet.cells.values()) {
      if (cell.formula) {
        if (isAdditiveChainStep(cell.formula)) continue;
        for (const v of embeddedLiterals(cell.formula)) {
          if (!isDistinctiveValue(v)) continue;
          out.push({ sheet: sheet.name, cellRow: cell.row, cellCol: cell.col, value: v, embedded: true, ownFormula: cell.formula });
        }
      } else if (cell.type === "number" && typeof cell.value === "number") {
        if (!isDistinctiveValue(cell.value)) continue;
        out.push({ sheet: sheet.name, cellRow: cell.row, cellCol: cell.col, value: cell.value, embedded: false, ownFormula: null });
      }
    }
  }
  return out;
}

/** Cross-sheet names a sheet's OWN formulas already reference — used only to
 *  rank candidate matches (same-sheet or already-referenced-sheet sources
 *  first), never to filter them out. */
function referencedSheets(sheet: ParsedSheet): Set<string> {
  const out = new Set<string>();
  for (const cell of sheet.cells.values()) {
    if (!cell.formula) continue;
    for (const ref of parseFormula(cell.formula).refs) {
      if (ref.sheet) out.add(ref.sheet);
    }
  }
  return out;
}

export function duplicateHardcodes(workbook: ParsedWorkbook): DuplicateHardcodeHit[] {
  const { formulaByValue, literalByValue } = collectSources(workbook);
  const candidates = collectCandidates(workbook);
  const refsBySheet = new Map<string, Set<string>>();
  for (const sheet of workbook.sheets) refsBySheet.set(sheet.name, referencedSheets(sheet));

  const hits: PositionedHit[] = [];

  for (const cand of candidates) {
    const cellAddr = formatCell(cand.cellRow, cand.cellCol);
    // A bare literal cell only "converts" to a real formula reference, so it
    // must match a FORMULA's computed value — matching another bare literal
    // would just as often be two independent, legitimately-identical inputs
    // (e.g. the same rate typed across five period columns on purpose).
    // An embedded literal is different: it already sits inside a formula, so
    // matching either a formula's value or a canonical literal input cell
    // (see the module doc's 0.053/$C$33 example) both point at real fixes.
    const pool = cand.embedded
      ? [...lookupSources(formulaByValue, cand.value), ...lookupSources(literalByValue, cand.value)]
      : lookupSources(formulaByValue, cand.value);

    // A source whose OWN formula directly reads the candidate cell is
    // circular, not a duplicate — see Source.refKeys' doc (the K26 /
    // `=IF(M26="yes",K26,)` shape).
    const candKey = `${cand.sheet}!${cellAddr}`;
    const matches = pool.filter((s) => !(s.sheet === cand.sheet && s.cell === cellAddr) && !s.refKeys.has(candKey));
    if (matches.length === 0) continue;

    // Dedupe identical (sheet,cell) sources, then keep only the BEST tier
    // present (same sheet > a sheet this sheet's own formulas already
    // reference > anywhere else) rather than diluting a strong same-sheet
    // match with unrelated coincidental matches elsewhere in a large
    // workbook — a real "Embedded Hardcodes" case (Debugging 03_02's J46,
    // embedding 0.053) had exactly this shape: two same-sheet matches plus
    // two unrelated cross-sheet coincidences, and counting all four against
    // the cap dropped the real match entirely.
    const seen = new Set<string>();
    const deduped = matches.filter((s) => {
      const k = `${s.sheet}!${s.cell}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const tierOf = (s: Source) => (s.sheet === cand.sheet ? 2 : refsBySheet.get(cand.sheet)?.has(s.sheet) ? 1 : 0);
    const bestTier = Math.max(...deduped.map(tierOf));
    const topTier = deduped.filter((s) => tierOf(s) === bestTier);
    if (topTier.length > MAX_MATCHING_SOURCES) continue;
    const ranked = topTier.slice(0, MAX_MATCHING_SOURCES);

    const sourceDesc = ranked
      .map((s) => `${s.sheet}!${s.cell}${s.formula ? ` {${s.formula}}` : " (input cell)"}`)
      .join(", ");
    const literalDesc = cand.embedded
      ? `the literal ${cand.value} embedded in {=${cand.ownFormula}}`
      : `the literal ${cand.value}`;

    hits.push({
      sheet: cand.sheet,
      cell: cellAddr,
      embedded: cand.embedded,
      value: cand.value,
      sources: ranked.map((s) => ({ sheet: s.sheet, cell: s.cell, formula: s.formula })),
      evidence: `${cand.sheet}!${cellAddr}: ${literalDesc} matches ${sourceDesc}`,
      row: cand.cellRow,
      col: cand.cellCol,
      topSourceKey: `${ranked[0].sheet}!${ranked[0].cell}`,
    });
  }

  const deshadowed = dropShadowTables(hits);
  deshadowed.sort((a, b) => a.sources.length - b.sources.length);
  return deshadowed.map(({ row: _row, col: _col, topSourceKey: _k, ...rest }) => rest).slice(0, MAX_DUPLICATE_HARDCODE_HITS);
}

/** A cluster of at least this many candidates in a contiguous run (see
 *  patternBreakOutliers' RUN_GAP_TOLERANCE for the same gap-tolerant idea)
 *  needs ALMOST AS MANY distinct sources before it reads as a mirrored
 *  table rather than a repeated hardcode of one value — see
 *  dropShadowTables' doc. */
const SHADOW_TABLE_MIN_SIZE = 3;
const SHADOW_TABLE_SOURCE_DIVERSITY = 0.75;

interface PositionedHit extends DuplicateHardcodeHit {
  row: number;
  col: number;
  topSourceKey: string;
}

/**
 * Drops a "shadow table": a contiguous run of hardcode candidates that each
 * match a DIFFERENT source cell, the sources themselves varying in lockstep
 * with the candidates — the signature of a deliberate mirrored/derived
 * block (a memo row, a prior-version snapshot) rather than independent
 * accidental duplications. Real example: Debugging 06_05's Supporting
 * Schedules!E62:E70, nine cells down a column each equal to a different
 * SUM() cell marching across a row six columns over — a genuine "everyone
 * hardcodes the same value" bug (Debugging 03_02's LBO!I32:N32, six cells
 * ALL matching the identical $C$28) is the opposite shape: one contiguous
 * run, but a single shared source repeated, not nine different ones — so
 * this only fires when the run's distinct-source count is nearly as large
 * as the run itself.
 */
function dropShadowTables(hits: PositionedHit[]): PositionedHit[] {
  const bySheet = new Map<string, PositionedHit[]>();
  for (const h of hits) {
    (bySheet.get(h.sheet) ?? bySheet.set(h.sheet, []).get(h.sheet)!).push(h);
  }

  const shadowed = new Set<PositionedHit>();
  for (const sheetHits of bySheet.values()) {
    for (const along of ["row", "col"] as const) {
      const other = along === "row" ? "col" : "row";
      const byLine = new Map<number, PositionedHit[]>();
      for (const h of sheetHits) {
        (byLine.get(h[other]) ?? byLine.set(h[other], []).get(h[other])!).push(h);
      }
      for (const line of byLine.values()) {
        line.sort((a, b) => a[along] - b[along]);
        let run: PositionedHit[] = [];
        const flushRun = () => {
          if (run.length >= SHADOW_TABLE_MIN_SIZE) {
            const distinctSources = new Set(run.map((h) => h.topSourceKey)).size;
            if (distinctSources >= run.length * SHADOW_TABLE_SOURCE_DIVERSITY) {
              for (const h of run) shadowed.add(h);
            }
          }
          run = [];
        };
        for (const h of line) {
          const prev = run[run.length - 1];
          if (prev && h[along] - prev[along] > 1) flushRun();
          run.push(h);
        }
        flushRun();
      }
    }
  }
  return hits.filter((h) => !shadowed.has(h));
}

/* ======================================================================= *
 * findCandidateBugs: combine, rank, cap, assign ids.
 * ======================================================================= */

const MAX_CANDIDATE_BUGS = 20;

export function findCandidateBugs(workbook: ParsedWorkbook): FindCandidateBugsResult {
  const patternHits = patternBreakOutliers(workbook);
  const hardcodeHits = duplicateHardcodes(workbook);

  const combined: { kind: CandidateBugKind; sheet: string; range: string; evidence: string }[] = [
    ...patternHits.map((h) => ({ kind: "pattern-break" as const, sheet: h.sheet, range: h.cell, evidence: h.evidence })),
    ...hardcodeHits.map((h) => ({ kind: "duplicate-hardcode" as const, sheet: h.sheet, range: h.cell, evidence: h.evidence })),
  ];

  const omitted = Math.max(0, combined.length - MAX_CANDIDATE_BUGS);
  const bugs: CandidateBug[] = combined.slice(0, MAX_CANDIDATE_BUGS).map((c, i) => ({
    id: `B${i + 1}`,
    ...c,
  }));
  return { bugs, omitted };
}
