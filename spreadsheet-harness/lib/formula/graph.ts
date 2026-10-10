/**
 * Directed dependency graph over spreadsheet cells, with dirty propagation
 * and topological ordering for recalculation.
 *
 * Ports simulation/dependency_graph.py, with one deliberate change: Python's
 * topological_order raises on a cycle (a crash, not a value — there is
 * nothing to match on the oracle side). This version returns the cycle,
 * plus anything downstream of it that therefore can't be computed either,
 * as `unresolved` instead of throwing. See ast.ts's `#CIRCULAR!` code.
 */

/** `${SHEET}!${COL}${ROW}` — sheet and column upper-cased, row 1-based. */
export type CellKey = string;

export function makeKey(sheet: string, col: string, row: number): CellKey {
  return `${sheet.toUpperCase()}!${col.toUpperCase()}${row}`;
}

export class DependencyGraph {
  /** cell -> cells that depend on it (forward edges, for invalidation). */
  private dependents = new Map<CellKey, Set<CellKey>>();
  /** cell -> cells it references (backward edges, for ordering). */
  private precedents = new Map<CellKey, Set<CellKey>>();
  /**
   * Runtime-discovered counterparts to `dependents`/`precedents` — edges a
   * formula cell's own evaluation revealed that no static AST walk could
   * see (OFFSET/INDIRECT resolving a target at eval time; see evaluate.ts's
   * FunctionEvaluator.reportResolvedRange). Kept as SEPARATE maps rather
   * than merged into the static ones so a cell's dynamic edges can be
   * cleanly discarded and rebuilt (`resetDynamicRefs`, called right before
   * each re-evaluation — see evaluate.ts's `recalculate`) without ever
   * risking dropping a static edge that happens to point at the same key.
   * markDirty and topologicalOrder both walk this alongside the static
   * maps; addFormulaCell/removeFormula clear it via removeEdges — a fresh
   * or removed formula has no dynamic edges to speak of until the next
   * recalculate() actually evaluates it.
   */
  private dynamicDependents = new Map<CellKey, Set<CellKey>>();
  private dynamicPrecedents = new Map<CellKey, Set<CellKey>>();
  private dirtySet = new Set<CellKey>();
  private formulaCellSet = new Set<CellKey>();

  addFormulaCell(cell: CellKey, references: Iterable<CellKey>): void {
    this.removeEdges(cell);
    this.formulaCellSet.add(cell);
    const refs = new Set(references);
    this.precedents.set(cell, refs);
    for (const ref of refs) {
      if (!this.dependents.has(ref)) this.dependents.set(ref, new Set());
      this.dependents.get(ref)!.add(cell);
    }
  }

  removeFormula(cell: CellKey): void {
    this.removeEdges(cell);
    this.formulaCellSet.delete(cell);
  }

  private removeEdges(cell: CellKey): void {
    const oldRefs = this.precedents.get(cell);
    this.precedents.delete(cell);
    if (oldRefs) {
      for (const ref of oldRefs) {
        this.dependents.get(ref)?.delete(cell);
      }
    }
    this.resetDynamicRefs(cell);
  }

  /**
   * Adds extra precedent edges for `cell`, discovered only at evaluation
   * time — see the class doc above and FunctionEvaluator.reportResolvedRange.
   * A no-op for a cell that isn't (yet) a known formula cell, so a stray
   * call against a test double or a cell mid-removal can't leave dangling
   * dependent-side edges.
   */
  addDynamicRefs(cell: CellKey, refs: Iterable<CellKey>): void {
    if (!this.formulaCellSet.has(cell)) return;
    let set = this.dynamicPrecedents.get(cell);
    if (!set) {
      set = new Set();
      this.dynamicPrecedents.set(cell, set);
    }
    for (const ref of refs) {
      if (set.has(ref)) continue;
      set.add(ref);
      if (!this.dynamicDependents.has(ref)) this.dynamicDependents.set(ref, new Set());
      this.dynamicDependents.get(ref)!.add(cell);
    }
  }

  /**
   * Discards every dynamic edge currently recorded FOR `cell` (as the
   * precedent-holder) — call right before re-evaluating a formula cell so a
   * shifted OFFSET target doesn't leave a stale edge to the range it used
   * to read. A no-op when the cell has none.
   */
  resetDynamicRefs(cell: CellKey): void {
    const old = this.dynamicPrecedents.get(cell);
    if (!old) return;
    for (const ref of old) {
      this.dynamicDependents.get(ref)?.delete(cell);
    }
    this.dynamicPrecedents.delete(cell);
  }

  markDirty(cell: CellKey): void {
    const queue: CellKey[] = [cell];
    while (queue.length > 0) {
      const c = queue.shift()!;
      if (this.dirtySet.has(c)) continue;
      this.dirtySet.add(c);
      for (const dep of this.dependents.get(c) ?? []) {
        if (!this.dirtySet.has(dep)) queue.push(dep);
      }
      for (const dep of this.dynamicDependents.get(c) ?? []) {
        if (!this.dirtySet.has(dep)) queue.push(dep);
      }
    }
  }

  markAllDirty(): void {
    this.dirtySet = new Set(this.formulaCellSet);
  }

  isDirty(cell: CellKey): boolean {
    return this.dirtySet.has(cell);
  }

  clearDirty(cell: CellKey): void {
    this.dirtySet.delete(cell);
  }

  clearAllDirty(): void {
    this.dirtySet.clear();
  }

  /** Cells this cell's formula references directly — static (AST) refs plus
   *  any dynamically-discovered ones from its last evaluation (OFFSET, …). */
  precedentsOf(cell: CellKey): CellKey[] {
    const merged = new Set([...(this.precedents.get(cell) ?? []), ...(this.dynamicPrecedents.get(cell) ?? [])]);
    return [...merged].sort();
  }

  /** Cells whose formulas reference this cell directly — static plus dynamic. */
  dependentsOf(cell: CellKey): CellKey[] {
    const merged = new Set([...(this.dependents.get(cell) ?? []), ...(this.dynamicDependents.get(cell) ?? [])]);
    return [...merged].sort();
  }

  get formulaCells(): ReadonlySet<CellKey> {
    return this.formulaCellSet;
  }

  get dirtyCells(): ReadonlySet<CellKey> {
    return this.dirtySet;
  }

  /**
   * Cells in `cells` (or the dirty set, if omitted), in an order where every
   * cell appears after everything it depends on. Kahn's algorithm, scoped to
   * the target set so a small edit doesn't re-sort the whole workbook.
   */
  topologicalOrder(cells?: Iterable<CellKey>): { order: CellKey[]; unresolved: CellKey[] } {
    const target = new Set(cells ?? this.dirtySet);
    if (target.size === 0) return { order: [], unresolved: [] };

    const inDegree = new Map<CellKey, number>();
    for (const c of target) inDegree.set(c, 0);
    for (const c of target) {
      for (const prec of this.precedents.get(c) ?? []) {
        if (target.has(prec)) inDegree.set(c, (inDegree.get(c) ?? 0) + 1);
      }
      for (const prec of this.dynamicPrecedents.get(c) ?? []) {
        if (target.has(prec)) inDegree.set(c, (inDegree.get(c) ?? 0) + 1);
      }
    }

    const queue: CellKey[] = [];
    for (const [c, d] of inDegree) if (d === 0) queue.push(c);

    const order: CellKey[] = [];
    while (queue.length > 0) {
      const c = queue.shift()!;
      order.push(c);
      for (const dep of this.dependents.get(c) ?? []) {
        if (!inDegree.has(dep)) continue;
        const next = inDegree.get(dep)! - 1;
        inDegree.set(dep, next);
        if (next === 0) queue.push(dep);
      }
      for (const dep of this.dynamicDependents.get(c) ?? []) {
        if (!inDegree.has(dep)) continue;
        const next = inDegree.get(dep)! - 1;
        inDegree.set(dep, next);
        if (next === 0) queue.push(dep);
      }
    }

    if (order.length === target.size) return { order, unresolved: [] };

    const ordered = new Set(order);
    const unresolved = [...target].filter((c) => !ordered.has(c));
    return { order, unresolved };
  }
}
