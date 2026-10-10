"""Logic and information Excel functions."""

from __future__ import annotations

from typing import Any

from simulation.ast_nodes import (
    ExcelError, NA_ERROR, VALUE_ERROR,
)
from simulation.functions import register


def _to_bool(val: Any) -> bool | ExcelError:
    if isinstance(val, ExcelError):
        return val
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val != 0
    if isinstance(val, str):
        up = val.upper()
        if up == "TRUE":
            return True
        if up == "FALSE":
            return False
        return VALUE_ERROR
    if val is None:
        return False
    return VALUE_ERROR


@register("IF")
def _if(evaluator, args):
    condition = evaluator.resolve_arg(args[0])
    cond_bool = _to_bool(condition)
    if isinstance(cond_bool, ExcelError):
        return cond_bool
    if cond_bool:
        return evaluator.resolve_arg(args[1]) if len(args) > 1 else True
    else:
        return evaluator.resolve_arg(args[2]) if len(args) > 2 else False


@register("AND")
def _and(evaluator, args):
    for arg in args:
        val = evaluator.resolve_arg(arg)
        if isinstance(val, list):
            for row in val:
                items = row if isinstance(row, list) else [row]
                for cell in items:
                    b = _to_bool(cell)
                    if isinstance(b, ExcelError):
                        return b
                    if not b:
                        return False
        else:
            b = _to_bool(val)
            if isinstance(b, ExcelError):
                return b
            if not b:
                return False
    return True


@register("OR")
def _or(evaluator, args):
    for arg in args:
        val = evaluator.resolve_arg(arg)
        if isinstance(val, list):
            for row in val:
                items = row if isinstance(row, list) else [row]
                for cell in items:
                    b = _to_bool(cell)
                    if isinstance(b, ExcelError):
                        return b
                    if b:
                        return True
        else:
            b = _to_bool(val)
            if isinstance(b, ExcelError):
                return b
            if b:
                return True
    return False


@register("NOT")
def _not(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    b = _to_bool(val)
    if isinstance(b, ExcelError):
        return b
    return not b


@register("IFERROR")
def _iferror(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    if isinstance(val, ExcelError):
        return evaluator.resolve_arg(args[1]) if len(args) > 1 else ""
    return val


@register("IFNA")
def _ifna(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    if isinstance(val, ExcelError) and val.error_type == "#N/A":
        return evaluator.resolve_arg(args[1]) if len(args) > 1 else ""
    return val


@register("ISBLANK")
def _isblank(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    return val is None or val == ""


@register("ISERROR")
def _iserror(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    return isinstance(val, ExcelError)


@register("ISNA")
def _isna(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    return isinstance(val, ExcelError) and val.error_type == "#N/A"


@register("ISNUMBER")
def _isnumber(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    return isinstance(val, (int, float)) and not isinstance(val, bool)


@register("ISTEXT")
def _istext(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    return isinstance(val, str)


@register("TRUE")
def _true(evaluator, args):
    return True


@register("FALSE")
def _false(evaluator, args):
    return False


@register("IFS")
def _ifs(evaluator, args):
    """IFS(condition1, value1, condition2, value2, ...)"""
    i = 0
    while i + 1 < len(args):
        cond = evaluator.resolve_arg(args[i])
        b = _to_bool(cond)
        if isinstance(b, ExcelError):
            return b
        if b:
            return evaluator.resolve_arg(args[i + 1])
        i += 2
    return NA_ERROR


@register("SWITCH")
def _switch(evaluator, args):
    """SWITCH(expression, value1, result1, ..., [default])"""
    if len(args) < 3:
        return NA_ERROR
    expr = evaluator.resolve_arg(args[0])
    i = 1
    while i + 1 < len(args):
        test_val = evaluator.resolve_arg(args[i])
        if expr == test_val:
            return evaluator.resolve_arg(args[i + 1])
        i += 2
    # Default value (odd number of remaining args)
    if i < len(args):
        return evaluator.resolve_arg(args[i])
    return NA_ERROR


@register("NA")
def _na(evaluator, args):
    return NA_ERROR


@register("ISLOGICAL")
def _islogical(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    return isinstance(val, bool)


@register("TYPE")
def _type(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        return 1.0
    if isinstance(val, str):
        return 2.0
    if isinstance(val, bool):
        return 4.0
    if isinstance(val, ExcelError):
        return 16.0
    if isinstance(val, list):
        return 64.0
    return 1.0
