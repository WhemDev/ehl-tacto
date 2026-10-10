"""Directed dependency graph with topological sort and dirty propagation.

Each cell is identified by a ``CellKey = (sheet_upper, col_upper, row_int)``
tuple.  The graph tracks two edge sets:

* **dependents** (forward): cell -> set of cells that *use* it in their formula
* **precedents** (backward): cell -> set of cells it *references*

When a cell's value changes the graph marks all transitive dependents as
*dirty* so the engine knows which cells need re-evaluation.
"""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Dict, FrozenSet, Iterable, List, Optional, Set, Tuple

CellKey = Tuple[str, str, int]  # (SHEET, COL, ROW) — all upper-cased


def make_key(sheet: str, col: str, row: int) -> CellKey:
    return (sheet.upper(), col.upper(), row)


class DependencyGraph:
    """Directed graph over spreadsheet cells."""

    def __init__(self) -> None:
        # cell -> cells that depend on it (forward edges for invalidation)
        self.dependents: Dict[CellKey, Set[CellKey]] = defaultdict(set)
        # cell -> cells it references (backward edges for understanding inputs)
        self.precedents: Dict[CellKey, Set[CellKey]] = defaultdict(set)
        # cells whose cached value is stale
        self._dirty: Set[CellKey] = set()
        # all cells that hold a formula
        self._formula_cells: Set[CellKey] = set()

    # ── Graph construction ───────────────────────────────────

    def add_formula_cell(self, cell: CellKey, references: Iterable[CellKey]) -> None:
        """Register *cell* as a formula cell that references *references*.

        Replaces any previous edges for *cell* (useful when a formula is
        overwritten with a new formula or a plain value).
        """
        self._remove_edges(cell)
        self._formula_cells.add(cell)
        refs = set(references)
        self.precedents[cell] = refs
        for ref in refs:
            self.dependents[ref].add(cell)

    def remove_formula(self, cell: CellKey) -> None:
        """Cell is no longer a formula (e.g. overwritten with a constant)."""
        self._remove_edges(cell)
        self._formula_cells.discard(cell)

    def _remove_edges(self, cell: CellKey) -> None:
        old_refs = self.precedents.pop(cell, set())
        for ref in old_refs:
            self.dependents[ref].discard(cell)

    # ── Dirty tracking ───────────────────────────────────────

    def mark_dirty(self, cell: CellKey) -> None:
        """Mark *cell* and all transitive dependents as dirty (BFS)."""
        queue = deque([cell])
        while queue:
            c = queue.popleft()
            if c in self._dirty:
                continue
            self._dirty.add(c)
            for dep in self.dependents.get(c, ()):
                if dep not in self._dirty:
                    queue.append(dep)

    def mark_all_dirty(self) -> None:
        """Mark every formula cell as dirty (full recalc)."""
        self._dirty = set(self._formula_cells)

    def is_dirty(self, cell: CellKey) -> bool:
        return cell in self._dirty

    def clear_dirty(self, cell: CellKey) -> None:
        self._dirty.discard(cell)

    def clear_all_dirty(self) -> None:
        self._dirty.clear()

    @property
    def dirty_cells(self) -> FrozenSet[CellKey]:
        return frozenset(self._dirty)

    # ── Topological sort ─────────────────────────────────────

    def topological_order(self, cells: Optional[Iterable[CellKey]] = None) -> List[CellKey]:
        """Return *cells* (or all dirty cells) in topological evaluation order.

        Uses Kahn's algorithm scoped to the requested cell set so that
        we don't sort the entire workbook — only the dirty sub-graph.

        Raises ``ValueError`` on circular references.
        """
        target = set(cells) if cells is not None else set(self._dirty)
        if not target:
            return []

        # In-degree within the target sub-graph
        in_degree: Dict[CellKey, int] = {c: 0 for c in target}
        for c in target:
            for prec in self.precedents.get(c, ()):
                if prec in target:
                    in_degree[c] += 1

        queue: deque[CellKey] = deque(c for c, d in in_degree.items() if d == 0)
        order: List[CellKey] = []

        while queue:
            c = queue.popleft()
            order.append(c)
            for dep in self.dependents.get(c, ()):
                if dep in in_degree:
                    in_degree[dep] -= 1
                    if in_degree[dep] == 0:
                        queue.append(dep)

        if len(order) != len(target):
            remaining = target - set(order)
            raise ValueError(
                f"Circular reference detected among {len(remaining)} cells: "
                f"{sorted(remaining)[:10]}"
            )

        return order

    # ── Queries ──────────────────────────────────────────────

    def all_dependents(self, cell: CellKey) -> Set[CellKey]:
        """Return all transitive dependents of *cell*."""
        result: Set[CellKey] = set()
        queue = deque(self.dependents.get(cell, ()))
        while queue:
            c = queue.popleft()
            if c in result:
                continue
            result.add(c)
            for dep in self.dependents.get(c, ()):
                if dep not in result:
                    queue.append(dep)
        return result

    def all_precedents(self, cell: CellKey) -> Set[CellKey]:
        """Return all transitive precedents of *cell*."""
        result: Set[CellKey] = set()
        queue = deque(self.precedents.get(cell, ()))
        while queue:
            c = queue.popleft()
            if c in result:
                continue
            result.add(c)
            for prec in self.precedents.get(c, ()):
                if prec not in result:
                    queue.append(prec)
        return result

    @property
    def formula_cells(self) -> FrozenSet[CellKey]:
        return frozenset(self._formula_cells)

    def stats(self) -> Dict[str, int]:
        return {
            "formula_cells": len(self._formula_cells),
            "total_edges": sum(len(v) for v in self.dependents.values()),
            "dirty_cells": len(self._dirty),
        }
