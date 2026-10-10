"""AST node types for parsed Excel formulas."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Optional


class ASTNode:
    """Base class for all AST nodes."""


@dataclass(frozen=True)
class NumberLiteral(ASTNode):
    value: float


@dataclass(frozen=True)
class StringLiteral(ASTNode):
    value: str


@dataclass(frozen=True)
class BoolLiteral(ASTNode):
    value: bool


@dataclass(frozen=True)
class ErrorValue(ASTNode):
    error_type: str  # "#N/A", "#REF!", "#VALUE!", "#DIV/0!", "#NULL!", "#NUM!", "#NAME?"


@dataclass(frozen=True)
class CellRef(ASTNode):
    col: str
    row: int
    sheet: Optional[str] = None
    abs_col: bool = False
    abs_row: bool = False


@dataclass(frozen=True)
class RangeRef(ASTNode):
    start: CellRef
    end: CellRef


@dataclass(frozen=True)
class BinOp(ASTNode):
    op: str
    left: ASTNode
    right: ASTNode


@dataclass(frozen=True)
class UnaryOp(ASTNode):
    op: str
    operand: ASTNode


@dataclass(frozen=True)
class FuncCall(ASTNode):
    name: str
    args: List[ASTNode] = field(default_factory=list)


@dataclass(frozen=True)
class Percent(ASTNode):
    """Postfix percent operator — e.g. 5% => 0.05."""
    operand: ASTNode


# Sentinel used by functions to represent Excel error propagation
class ExcelError:
    """Represents an Excel error value (#N/A, #VALUE!, etc.)."""

    __slots__ = ("error_type",)

    def __init__(self, error_type: str):
        self.error_type = error_type

    def __repr__(self) -> str:
        return f"ExcelError({self.error_type!r})"

    def __eq__(self, other: object) -> bool:
        return isinstance(other, ExcelError) and self.error_type == other.error_type

    def __hash__(self) -> int:
        return hash(self.error_type)


NA_ERROR = ExcelError("#N/A")
VALUE_ERROR = ExcelError("#VALUE!")
REF_ERROR = ExcelError("#REF!")
DIV0_ERROR = ExcelError("#DIV/0!")
NUM_ERROR = ExcelError("#NUM!")
NAME_ERROR = ExcelError("#NAME?")
NULL_ERROR = ExcelError("#NULL!")
