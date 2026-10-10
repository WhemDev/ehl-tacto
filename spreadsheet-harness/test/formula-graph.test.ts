import { describe, expect, it } from "vitest";
import { DependencyGraph, makeKey } from "@/lib/formula/graph";

describe("makeKey", () => {
  it("upper-cases the sheet and column", () => {
    expect(makeKey("plan", "a", 1)).toBe(makeKey("PLAN", "A", 1));
  });

  it("distinguishes different rows and columns", () => {
    expect(makeKey("S", "A", 1)).not.toBe(makeKey("S", "A", 2));
    expect(makeKey("S", "A", 1)).not.toBe(makeKey("S", "B", 1));
  });
});

describe("DependencyGraph — construction and dirty tracking", () => {
  it("marks a formula cell dirty when a precedent it reads changes", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const b1 = makeKey("S", "B", 1);
    g.addFormulaCell(b1, [a1]); // B1 = A1 + 1, say
    g.clearAllDirty();
    g.markDirty(a1);
    expect(g.isDirty(a1)).toBe(true);
    expect(g.isDirty(b1)).toBe(true);
  });

  it("propagates dirty transitively through a chain", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const b1 = makeKey("S", "B", 1);
    const c1 = makeKey("S", "C", 1);
    g.addFormulaCell(b1, [a1]);
    g.addFormulaCell(c1, [b1]);
    g.clearAllDirty();
    g.markDirty(a1);
    expect(g.isDirty(c1)).toBe(true);
  });

  it("does not mark an unrelated cell dirty", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const b1 = makeKey("S", "B", 1);
    const z9 = makeKey("S", "Z", 9);
    g.addFormulaCell(b1, [a1]);
    g.clearAllDirty();
    g.markDirty(a1);
    expect(g.isDirty(z9)).toBe(false);
  });

  it("markAllDirty marks every formula cell and nothing else", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const b1 = makeKey("S", "B", 1);
    g.addFormulaCell(b1, [a1]);
    g.markAllDirty();
    expect(g.isDirty(b1)).toBe(true);
    expect(g.isDirty(a1)).toBe(false); // A1 holds no formula
  });

  it("removeFormula drops the cell's precedent edges", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const b1 = makeKey("S", "B", 1);
    g.addFormulaCell(b1, [a1]);
    g.removeFormula(b1);
    expect(g.formulaCells.has(b1)).toBe(false);
    g.clearAllDirty();
    g.markDirty(a1);
    expect(g.isDirty(b1)).toBe(false); // no longer a dependent of A1
  });

  it("re-adding a formula for the same cell replaces its old edges", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const b1 = makeKey("S", "B", 1);
    const c1 = makeKey("S", "C", 1);
    g.addFormulaCell(c1, [a1]);
    g.addFormulaCell(c1, [b1]); // C1's formula changed to reference B1 instead
    g.clearAllDirty();
    g.markDirty(a1);
    expect(g.isDirty(c1)).toBe(false);
    g.clearAllDirty();
    g.markDirty(b1);
    expect(g.isDirty(c1)).toBe(true);
  });
});

describe("DependencyGraph — dynamic edges (Fix A: OFFSET-resolved ranges)", () => {
  it("addDynamicRefs propagates dirty the same as a static edge", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const b1 = makeKey("S", "B", 1); // B1 = SUM(OFFSET(...)) reading A1 at runtime
    g.addFormulaCell(b1, []); // no STATIC edge to A1 — OFFSET's target is invisible to a walk
    g.addDynamicRefs(b1, [a1]);
    g.clearAllDirty();
    g.markDirty(a1);
    expect(g.isDirty(b1)).toBe(true);
  });

  it("is a no-op for a cell that was never registered via addFormulaCell", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const ghost = makeKey("S", "Z", 9);
    g.addDynamicRefs(ghost, [a1]);
    g.clearAllDirty();
    g.markDirty(a1);
    expect(g.isDirty(ghost)).toBe(false);
  });

  it("an unrelated edit does not dirty a cell with a dynamic edge elsewhere", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const z9 = makeKey("S", "Z", 9);
    const b1 = makeKey("S", "B", 1);
    g.addFormulaCell(b1, []);
    g.addDynamicRefs(b1, [a1]);
    g.clearAllDirty();
    g.markDirty(z9);
    expect(g.isDirty(b1)).toBe(false);
  });

  it("resetDynamicRefs discards old dynamic edges so a shifted OFFSET target doesn't leave a stale one", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1); // OFFSET's OLD target
    const d1 = makeKey("S", "D", 1); // OFFSET's NEW target, after its args changed
    const b1 = makeKey("S", "B", 1);
    g.addFormulaCell(b1, []);
    g.addDynamicRefs(b1, [a1]);
    g.resetDynamicRefs(b1);
    g.addDynamicRefs(b1, [d1]); // re-evaluation discovered a different target

    g.clearAllDirty();
    g.markDirty(a1);
    expect(g.isDirty(b1)).toBe(false); // A1 is no longer a precedent at all

    g.clearAllDirty();
    g.markDirty(d1);
    expect(g.isDirty(b1)).toBe(true);
  });

  it("resetDynamicRefs never touches the cell's static edges", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1); // static precedent
    const c1 = makeKey("S", "C", 1); // dynamic precedent
    const b1 = makeKey("S", "B", 1);
    g.addFormulaCell(b1, [a1]);
    g.addDynamicRefs(b1, [c1]);
    g.resetDynamicRefs(b1);

    g.clearAllDirty();
    g.markDirty(a1);
    expect(g.isDirty(b1)).toBe(true); // static edge survives

    g.clearAllDirty();
    g.markDirty(c1);
    expect(g.isDirty(b1)).toBe(false); // dynamic edge was discarded
  });

  it("removeFormula/re-addFormulaCell also clears a cell's dynamic edges", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const b1 = makeKey("S", "B", 1);
    g.addFormulaCell(b1, []);
    g.addDynamicRefs(b1, [a1]);
    g.addFormulaCell(b1, []); // formula reinstalled — e.g. setFormula on B1

    g.clearAllDirty();
    g.markDirty(a1);
    expect(g.isDirty(b1)).toBe(false);
  });

  it("precedentsOf/dependentsOf merge static and dynamic edges", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const c1 = makeKey("S", "C", 1);
    const b1 = makeKey("S", "B", 1);
    g.addFormulaCell(b1, [a1]);
    g.addDynamicRefs(b1, [c1]);
    expect(g.precedentsOf(b1)).toEqual([a1, c1].sort());
    expect(g.dependentsOf(a1)).toEqual([b1]);
    expect(g.dependentsOf(c1)).toEqual([b1]);
  });

  it("topologicalOrder respects a dynamic-only precedence", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const b1 = makeKey("S", "B", 1);
    g.addFormulaCell(b1, []);
    g.addDynamicRefs(b1, [a1]);
    g.addFormulaCell(a1, []);
    g.markAllDirty();
    const { order, unresolved } = g.topologicalOrder();
    expect(unresolved).toEqual([]);
    expect(order.indexOf(a1)).toBeLessThan(order.indexOf(b1));
  });
});

describe("DependencyGraph — topologicalOrder", () => {
  it("orders a simple chain precedent-first", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const b1 = makeKey("S", "B", 1);
    const c1 = makeKey("S", "C", 1);
    g.addFormulaCell(b1, [a1]);
    g.addFormulaCell(c1, [b1]);
    g.markAllDirty();
    const { order, unresolved } = g.topologicalOrder();
    expect(unresolved).toEqual([]);
    expect(order.indexOf(b1)).toBeLessThan(order.indexOf(c1));
  });

  it("accepts an explicit cell set instead of the dirty set", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const b1 = makeKey("S", "B", 1);
    g.addFormulaCell(b1, [a1]);
    const { order } = g.topologicalOrder([b1]);
    expect(order).toEqual([b1]);
  });

  it("returns nothing for an empty target set", () => {
    const g = new DependencyGraph();
    expect(g.topologicalOrder([])).toEqual({ order: [], unresolved: [] });
  });

  it("reports a two-cell cycle as unresolved instead of throwing", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const b1 = makeKey("S", "B", 1);
    g.addFormulaCell(a1, [b1]); // A1 = B1 + 1
    g.addFormulaCell(b1, [a1]); // B1 = A1 + 1  — a cycle
    g.markAllDirty();
    expect(() => g.topologicalOrder()).not.toThrow();
    const { order, unresolved } = g.topologicalOrder();
    expect(order).toEqual([]);
    expect(new Set(unresolved)).toEqual(new Set([a1, b1]));
  });

  it("marks a cell downstream of a cycle unresolved too, since it can't be computed either", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const b1 = makeKey("S", "B", 1);
    const c1 = makeKey("S", "C", 1);
    g.addFormulaCell(a1, [b1]);
    g.addFormulaCell(b1, [a1]);
    g.addFormulaCell(c1, [b1]); // C1 reads the cyclic B1 — also unresolvable
    g.markAllDirty();
    const { unresolved } = g.topologicalOrder();
    expect(new Set(unresolved)).toEqual(new Set([a1, b1, c1]));
  });

  it("orders everything outside a cycle normally, leaving only the cycle unresolved", () => {
    const g = new DependencyGraph();
    const a1 = makeKey("S", "A", 1);
    const b1 = makeKey("S", "B", 1);
    const x1 = makeKey("S", "X", 1);
    const y1 = makeKey("S", "Y", 1);
    g.addFormulaCell(a1, [b1]);
    g.addFormulaCell(b1, [a1]); // cycle: a1 <-> b1
    g.addFormulaCell(y1, [x1]); // unrelated chain: x1 -> y1
    g.markAllDirty();
    const { order, unresolved } = g.topologicalOrder();
    expect(order).toEqual([y1]);
    expect(new Set(unresolved)).toEqual(new Set([a1, b1]));
  });

  it("terminates promptly on a larger cycle rather than hanging", () => {
    const g = new DependencyGraph();
    const keys = Array.from({ length: 50 }, (_, i) => makeKey("S", "A", i + 1));
    for (let i = 0; i < keys.length; i++) {
      g.addFormulaCell(keys[i], [keys[(i + 1) % keys.length]]);
    }
    g.markAllDirty();
    const start = Date.now();
    const { order, unresolved } = g.topologicalOrder();
    expect(Date.now() - start).toBeLessThan(1000);
    expect(order).toEqual([]);
    expect(unresolved).toHaveLength(50);
  });
});
