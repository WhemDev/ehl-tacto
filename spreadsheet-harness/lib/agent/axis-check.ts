/**
 * Axis-extension check: a dynamic, input-grounded complement to
 * lib/digest.ts's period-axis notes (see fix1-period-axis.md).
 *
 * Design history: the first version of this module flagged every
 * axis-sharing sheet whose header row a plan's edits hadn't reached,
 * whenever ANY sibling sheet's edits crossed the axis boundary. A
 * coordinator review against the real 01_02 golden file falsified that
 * rule: the golden extends the period header on exactly ONE of the file's
 * eleven axis-sharing sheets (Working Capital Schedule), not all of them —
 * several of the "next header cells" the old rule would have flagged are
 * golden-EMPTY on purpose (DCF Valuation's next column is a "Terminal
 * Value" label block; Consolidated P&L's is a "CAGR (25A-30E)" summary
 * column; several others are simply unused past the axis). Warning the
 * model to fill all of those would have pushed regressions onto
 * 01_01/01_03/01_04/01_05, some of which score 100% today.
 *
 * The rule here instead targets a narrower, INPUT-ONLY signal that
 * separates the real case cleanly: a column immediately after a sheet's own
 * axis end that already has data below the header row (real formulas or
 * values — Working Capital Schedule's M21/M22/M24) but has NO content at or
 * above the header row (no label, no header, nothing else claiming that
 * column either) — an "orphaned" column somebody clearly started using as a
 * period without ever giving it a period header. DCF Valuation's next
 * column fails this test the label way (row 5 already holds "Terminal
 * Value ", so content-at-or-above is nonzero); Fixed Assets/Debt Schedule's
 * next columns fail it the empty way (nothing below at all, so there is no
 * orphaned data to protect). This property depends only on the input
 * workbook, never on what any plan does, so — unlike the old rule — it
 * needs no extended/blast-radius precondition; the only plan-dependent part
 * left is skipping a flagged sheet once the plan itself has already filled
 * in the missing header.
 *
 * Moved from lib/bench/axis-check.ts in Phase A1 of the Work rework: this
 * check reads only the input workbook and an applied edit plan, nothing
 * benchmark-specific — app adoption needs it outside lib/bench.
 * lib/bench/axis-check.ts is now a shim re-exporting everything from here.
 */
import { colToIndex, indexToCol, parseRange } from "@/lib/a1";
import { detectSheetPeriodAxis, type PeriodStep, type SheetPeriodAxis } from "@/lib/digest";
import { cellKey, MAX_COLS, MAX_ROWS, type GridCell, type ParsedWorkbook } from "@/lib/workbook";
import { canonicalSheet, cellIsAffected, type AppliedPlan, type CellEditPlan } from "@/lib/plan/edits";

const CELL_BOUNDS = { rows: MAX_ROWS, cols: MAX_COLS };
/** Flagged sheets named in the warning, capped the same way lib/digest.ts's
 *  own inventory note caps its sheet list. */
const MAX_FLAGGED_SHEETS = 4;
/** Orphan data cells shown per flagged sheet — enough to make the "there's
 *  real data here" claim concrete without dumping the whole column. */
const MAX_DATA_CELLS = 3;
/** EOMONTH's month-offset for each step, used only to phrase the pattern
 *  suggestion in the warning text — the flagging logic itself never depends
 *  on this. */
const STEP_MONTHS: Record<PeriodStep, number> = { monthly: 1, quarterly: 3, annual: 12 };

/**
 * The workbook's dominant shared period axis: sheets whose header row agrees
 * on both step and exact end date (>= 2 members required — one sheet is not
 * "shared" anything). Ties on cluster size go to the later end date, same
 * tie-break lib/digest.ts's periodAxisNotesForStep uses ("the sheets someone
 * already extended are the more likely target than the ones left behind").
 * Returns [] when no such cluster exists — most files, including every
 * Template/Debugging input (fix1's survey found shared axes only in
 * Financial_Model). Cheap: one detectSheetPeriodAxis scan per sheet (top 6
 * rows each), meant to be called once per loop, not once per submit.
 */
export function dominantAxisCluster(workbook: ParsedWorkbook): SheetPeriodAxis[] {
  const axes = workbook.sheets
    .map((s) => detectSheetPeriodAxis(s))
    .filter((a): a is SheetPeriodAxis => a !== null);

  const clusters = new Map<string, SheetPeriodAxis[]>();
  for (const axis of axes) {
    const key = `${axis.step} ${axis.lastDate.getTime()}`;
    const list = clusters.get(key);
    if (list) list.push(axis);
    else clusters.set(key, [axis]);
  }

  const ranked = [...clusters.values()]
    .filter((c) => c.length >= 2)
    .sort((a, b) => b.length - a.length || b[0].lastDate.getTime() - a[0].lastDate.getTime());
  return ranked[0] ?? [];
}

export interface OrphanColumn {
  axis: SheetPeriodAxis;
  /** One column past the sheet's own axis end, on the axis row — the
   *  header cell that's missing. */
  headerCell: string;
  /** Populated cells found strictly below the axis row in the orphan
   *  column (A1 refs, sheet row order), uncapped — callers cap for
   *  display. Always non-empty when a sheet appears in the result. */
  dataCells: string[];
}

function isPopulated(cell: GridCell | undefined): boolean {
  if (!cell) return false;
  // A formula counts as "populated" whether or not its cache was ever
  // written (see GridCell.uncalculated) — an uncached formula is still
  // clearly authored content, not blank space.
  return cell.formula !== undefined || cell.type !== "empty";
}

/**
 * Sheets in `cluster` whose next column (one past their own axis end) is an
 * "orphan": populated below the axis row (real data) but completely empty
 * at or above it (no header, no label, no other content claiming that
 * column for something else). A property of the input workbook alone —
 * call once per task and reuse, the same as dominantAxisCluster.
 */
export function findOrphanColumns(cluster: SheetPeriodAxis[], workbook: ParsedWorkbook): OrphanColumn[] {
  const out: OrphanColumn[] = [];
  for (const axis of cluster) {
    const sheet = workbook.sheets.find((s) => s.name === axis.sheet);
    if (!sheet) continue;
    const nextColIdx = colToIndex(axis.endCol) + 1;
    const nextCol = indexToCol(nextColIdx);
    const dataCells: string[] = [];
    let contentAtOrAbove = 0;
    for (let r = 0; r < sheet.rows; r++) {
      if (!isPopulated(sheet.cells.get(cellKey(r, nextColIdx)))) continue;
      const rowNum = r + 1;
      if (rowNum <= axis.row) contentAtOrAbove++;
      else dataCells.push(`${nextCol}${rowNum}`);
    }
    if (dataCells.length > 0 && contentAtOrAbove === 0) {
      out.push({ axis, headerCell: `${nextCol}${axis.row}`, dataCells });
    }
  }
  return out;
}

export interface LabelEvidence {
  sheet: string;
  labelCell: string;
  labelText: string;
  /** The same sheet's own axis-row cell in that column — empty, which is
   *  what makes this a counterexample: a real label sits elsewhere, never
   *  on the header row itself. */
  axisRowCell: string;
}

/**
 * A concrete, in-workbook counterexample to "maybe this flagged cell is
 * meant to hold a label": a cluster sheet whose own next-past-axis column
 * carries a text label on some OTHER row while that same sheet's axis-row
 * cell in that column stays empty. Scans in cluster (workbook) order and
 * returns the first match, or null if this file has none. A property of
 * the input workbook alone — compute once per task and reuse, the same as
 * findOrphanColumns.
 */
export function findLabelEvidence(cluster: SheetPeriodAxis[], workbook: ParsedWorkbook): LabelEvidence | null {
  for (const axis of cluster) {
    const sheet = workbook.sheets.find((s) => s.name === axis.sheet);
    if (!sheet) continue;
    const nextColIdx = colToIndex(axis.endCol) + 1;
    const nextCol = indexToCol(nextColIdx);
    if (isPopulated(sheet.cells.get(cellKey(axis.row - 1, nextColIdx)))) continue; // axis-row cell itself must be empty
    for (let r = 0; r < sheet.rows; r++) {
      if (r === axis.row - 1) continue; // the axis row itself — already confirmed empty above
      const cell = sheet.cells.get(cellKey(r, nextColIdx));
      const text = cell?.type === "text" && typeof cell.value === "string" ? cell.value.trim() : "";
      if (text.length > 0) {
        return { sheet: axis.sheet, labelCell: `${nextCol}${r + 1}`, labelText: text, axisRowCell: `${nextCol}${axis.row}` };
      }
    }
  }
  return null;
}

/** Whether the plan's own edit ranges (as submitted, not the engine's
 *  downstream closure) cover `cell` on `sheet`. Belt-and-braces alongside
 *  the affectedKeys check in axisExtensionWarning below — an edited cell is
 *  already expected to land in affectedKeys too (applyEditPlan marks every
 *  edited cell dirty before capturing it), but this is cheap to get
 *  double-sure of. */
function planEditsCell(workbook: ParsedWorkbook, plan: CellEditPlan, sheet: string, cell: string): boolean {
  const point = parseRange(cell, CELL_BOUNDS);
  if (!point) return false;
  const target = sheet.trim().toLowerCase();
  return plan.edits.some((edit) => {
    if (canonicalSheet(workbook, plan.newSheets, edit.sheet).trim().toLowerCase() !== target) return false;
    const box = parseRange(edit.range, CELL_BOUNDS);
    return (
      !!box &&
      point.startRow >= box.startRow &&
      point.startRow <= box.endRow &&
      point.startCol >= box.startCol &&
      point.startCol <= box.endCol
    );
  });
}

function isoDate(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

/** `items`, capped at `cap` with a "(+N more)" tail. */
function listWithMore(items: string[], cap: number): string {
  const shown = items.slice(0, cap);
  const more = items.length - shown.length;
  return shown.join(", ") + (more > 0 ? ` (+${more} more)` : "");
}

function orphanClause(o: OrphanColumn): string {
  const dataList = listWithMore(o.dataCells, MAX_DATA_CELLS);
  return (
    `'${o.axis.sheet}'!${o.headerCell} has data below (${dataList}) but no period header — ` +
    `its axis (${o.axis.step}, row ${o.axis.row}) ends ${o.axis.endCol}${o.axis.row} = ${isoDate(o.axis.lastDate)}`
  );
}

/**
 * A warning for the preview feedback after a plan's FIRST valid submit (see
 * loop.ts): names every still-orphaned column from `orphans` (see
 * findOrphanColumns) that this plan has not already filled in. `orphans`
 * itself never changes across a task's submits — it's a static property of
 * the input workbook — only which of them remain un-addressed does, which
 * is what this function actually checks. Internally also calls
 * findLabelEvidence (recomputing dominantAxisCluster from `applied.workbook`
 * — both are pure/cheap and this runs at most once per task) to ground the
 * wording below in a real in-file counterexample when this workbook has
 * one, without adding a parameter that would ripple into loop.ts's
 * call site.
 *
 * The wording is deliberately prescriptive, not conditional — a live-run
 * result on the first version of this text ("If a flagged column is a live
 * forecast period, extend its header...") showed a model reading the
 * conditional as permission to conclude a flagged column was NOT a period
 * and write a text label into the header cell instead (it reasoned the
 * orphaned column fed a "Terminal Value" calculation and treated the header
 * as a label slot for that, mirroring — almost mockingly — the exact
 * DCF Valuation shape this module's own doc comment describes). The
 * instruction below states the rule as fact (header-row cells are dates,
 * never labels), backs it with whatever real counterexample this file has,
 * and narrows the escape hatch to "leave it empty," never "write something
 * else there."
 *
 * A warning, not a rejection: the caller appends this text to the existing
 * preview feedback and nothing else changes — no validation failure, no
 * consumed submit, no effect on the second-submit finalize path.
 */
export function axisExtensionWarning(
  orphans: OrphanColumn[],
  plan: CellEditPlan,
  applied: AppliedPlan,
): string | null {
  const remaining = orphans.filter((o) => {
    if (cellIsAffected(applied, o.axis.sheet, o.headerCell)) return false;
    if (planEditsCell(applied.workbook, plan, o.axis.sheet, o.headerCell)) return false;
    return true;
  });
  if (remaining.length === 0) return null;

  const shown = remaining.slice(0, MAX_FLAGGED_SHEETS);
  const more = remaining.length - shown.length;
  const clauses = shown.map(orphanClause).join("; ");
  const moreSuffix = more > 0 ? ` (+${more} more sheet${more === 1 ? "" : "s"} with the same issue)` : "";

  const example = shown[0];
  const months = STEP_MONTHS[example.axis.step];
  const suggestion = `${example.headerCell} = EOMONTH(${example.axis.endCol}${example.axis.row},${months})`;

  // Recomputed from applied.workbook (== the same input workbook the loop's
  // own dominantAxisCluster already ran against) rather than threaded in as
  // a parameter — this keeps the exported signature exactly as it was, so
  // no call site outside this file needs to change. dominantAxisCluster is
  // a pure, cheap function of the workbook alone; recomputing it here costs
  // one extra top-6-rows scan per sheet, once per task (this function runs
  // at most once, on the first valid submit).
  const labelEvidence = findLabelEvidence(dominantAxisCluster(applied.workbook), applied.workbook);

  const evidenceClause = labelEvidence
    ? ` (e.g. in this workbook, '${labelEvidence.sheet}'!${labelEvidence.labelCell} = "${labelEvidence.labelText}" ` +
      `while its own axis-row cell ${labelEvidence.axisRowCell} is empty)`
    : "";

  const rule =
    `Each flagged cell sits on its sheet's own period-axis header row: every cell on that row is a date ` +
    `continuing the row's pattern, never a text label — when a column instead carries a text label, the ` +
    `label sits on a DIFFERENT row and the axis-row cell itself stays empty${evidenceClause}.`;

  const instruction =
    `Write the next period into each flagged cell now, continuing that row's own pattern (e.g. ${suggestion}) ` +
    `— or, if you are certain a column is not a period column, leave its header cell EMPTY; never write a text ` +
    `label into a period-axis header cell.`;

  return `Axis check: ${clauses}${moreSuffix}. ${rule} ${instruction}`;
}
