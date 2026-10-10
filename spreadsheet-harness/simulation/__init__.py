"""CellWise Excel Formula Simulation Engine.

Provides a pure-Python Excel formula evaluator with proper dependency
graph resolution and cascade recalculation — replacing the `formulas`
library which fails on multi-hop formula chains.
"""

from simulation.engine import ExcelSimulator

__all__ = ["ExcelSimulator"]
