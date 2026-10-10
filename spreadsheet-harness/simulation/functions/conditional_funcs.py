"""Conditional aggregation Excel functions (SUMIF, COUNTIF, etc.)."""

from __future__ import annotations

import re
from typing import Any, List, Tuple

from simulation.ast_nodes import ExcelError, VALUE_ERROR, DIV0_ERROR
from simulation.functions import register


def _flatten_values(evaluator, arg) -> List[Any]:
    """Resolve arg and flatten to a 1D list of values."""
    val = evaluator.resolve_arg(arg)
    flat: List[Any] = []
    if isinstance(val, list):
        for row in val:
            if isinstance(row, list):
                flat.extend(row)
            else:
                flat.append(row)
    else:
        flat.append(val)
    return flat


def _parse_criteria(criteria: Any) -> callable:
    """Parse an Excel criteria string into a Python predicate.

    Supported formats:
    - number: exact match
    - string without operators: exact text match (case-insensitive)
    - ">5", ">=10", "<3", "<=100", "<>0": comparison
    - "*text*": wildcard match
    """
    if isinstance(criteria, (int, float)) and not isinstance(criteria, bool):
        target = float(criteria)
        return lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and float(v) == target

    s = str(criteria)

    # Comparison operators
    for op, fn in [
        ("<>", lambda a, b: a != b),
        ("<=", lambda a, b: a <= b),
        (">=", lambda a, b: a >= b),
        ("<", lambda a, b: a < b),
        (">", lambda a, b: a > b),
        ("=", lambda a, b: a == b),
    ]:
        if s.startswith(op):
            rest = s[len(op):]
            try:
                num_target = float(rest)
                cmp = fn
                return lambda v, _n=num_target, _f=cmp: (
                    isinstance(v, (int, float)) and not isinstance(v, bool) and _f(float(v), _n)
                )
            except ValueError:
                text_target = rest.upper()
                cmp = fn
                return lambda v, _t=text_target, _f=cmp: (
                    isinstance(v, str) and _f(v.upper(), _t)
                )

    # Wildcard match
    if "*" in s or "?" in s:
        pattern = "^" + re.escape(s).replace(r"\*", ".*").replace(r"\?", ".") + "$"
        rx = re.compile(pattern, re.IGNORECASE)
        return lambda v: isinstance(v, str) and bool(rx.match(v))

    # Exact match — try numeric first
    try:
        num_target = float(s)
        return lambda v, _n=num_target: isinstance(v, (int, float)) and not isinstance(v, bool) and float(v) == _n
    except ValueError:
        text_target = s.upper()
        return lambda v, _t=text_target: isinstance(v, str) and v.upper() == _t


@register("SUMIF")
def _sumif(evaluator, args):
    range_vals = _flatten_values(evaluator, args[0])
    criteria = evaluator.resolve_arg(args[1])
    sum_range_vals = _flatten_values(evaluator, args[2]) if len(args) > 2 else range_vals
    pred = _parse_criteria(criteria)

    total = 0.0
    for i, val in enumerate(range_vals):
        if pred(val):
            if i < len(sum_range_vals):
                sv = sum_range_vals[i]
                if isinstance(sv, (int, float)) and not isinstance(sv, bool):
                    total += float(sv)
    return total


@register("SUMIFS")
def _sumifs(evaluator, args):
    sum_range_vals = _flatten_values(evaluator, args[0])
    pairs = []
    i = 1
    while i + 1 < len(args):
        crit_range = _flatten_values(evaluator, args[i])
        criteria = evaluator.resolve_arg(args[i + 1])
        pairs.append((crit_range, _parse_criteria(criteria)))
        i += 2

    total = 0.0
    for idx in range(len(sum_range_vals)):
        match = True
        for crit_range, pred in pairs:
            if idx >= len(crit_range) or not pred(crit_range[idx]):
                match = False
                break
        if match:
            sv = sum_range_vals[idx]
            if isinstance(sv, (int, float)) and not isinstance(sv, bool):
                total += float(sv)
    return total


@register("COUNTIF")
def _countif(evaluator, args):
    range_vals = _flatten_values(evaluator, args[0])
    criteria = evaluator.resolve_arg(args[1])
    pred = _parse_criteria(criteria)
    return float(sum(1 for v in range_vals if pred(v)))


@register("COUNTIFS")
def _countifs(evaluator, args):
    pairs = []
    i = 0
    while i + 1 < len(args):
        crit_range = _flatten_values(evaluator, args[i])
        criteria = evaluator.resolve_arg(args[i + 1])
        pairs.append((crit_range, _parse_criteria(criteria)))
        i += 2

    if not pairs:
        return 0.0

    length = len(pairs[0][0])
    count = 0
    for idx in range(length):
        match = True
        for crit_range, pred in pairs:
            if idx >= len(crit_range) or not pred(crit_range[idx]):
                match = False
                break
        if match:
            count += 1
    return float(count)


@register("AVERAGEIF")
def _averageif(evaluator, args):
    range_vals = _flatten_values(evaluator, args[0])
    criteria = evaluator.resolve_arg(args[1])
    avg_range_vals = _flatten_values(evaluator, args[2]) if len(args) > 2 else range_vals
    pred = _parse_criteria(criteria)

    total = 0.0
    count = 0
    for i, val in enumerate(range_vals):
        if pred(val):
            if i < len(avg_range_vals):
                sv = avg_range_vals[i]
                if isinstance(sv, (int, float)) and not isinstance(sv, bool):
                    total += float(sv)
                    count += 1
    if count == 0:
        return DIV0_ERROR
    return total / count


@register("AVERAGEIFS")
def _averageifs(evaluator, args):
    avg_range_vals = _flatten_values(evaluator, args[0])
    pairs = []
    i = 1
    while i + 1 < len(args):
        crit_range = _flatten_values(evaluator, args[i])
        criteria = evaluator.resolve_arg(args[i + 1])
        pairs.append((crit_range, _parse_criteria(criteria)))
        i += 2

    total = 0.0
    count = 0
    for idx in range(len(avg_range_vals)):
        match = True
        for crit_range, pred in pairs:
            if idx >= len(crit_range) or not pred(crit_range[idx]):
                match = False
                break
        if match:
            sv = avg_range_vals[idx]
            if isinstance(sv, (int, float)) and not isinstance(sv, bool):
                total += float(sv)
                count += 1
    if count == 0:
        return DIV0_ERROR
    return total / count


@register("MAXIFS")
def _maxifs(evaluator, args):
    max_range_vals = _flatten_values(evaluator, args[0])
    pairs = []
    i = 1
    while i + 1 < len(args):
        crit_range = _flatten_values(evaluator, args[i])
        criteria = evaluator.resolve_arg(args[i + 1])
        pairs.append((crit_range, _parse_criteria(criteria)))
        i += 2

    result = None
    for idx in range(len(max_range_vals)):
        match = True
        for crit_range, pred in pairs:
            if idx >= len(crit_range) or not pred(crit_range[idx]):
                match = False
                break
        if match:
            sv = max_range_vals[idx]
            if isinstance(sv, (int, float)) and not isinstance(sv, bool):
                val = float(sv)
                if result is None or val > result:
                    result = val
    return result if result is not None else 0.0


@register("MINIFS")
def _minifs(evaluator, args):
    min_range_vals = _flatten_values(evaluator, args[0])
    pairs = []
    i = 1
    while i + 1 < len(args):
        crit_range = _flatten_values(evaluator, args[i])
        criteria = evaluator.resolve_arg(args[i + 1])
        pairs.append((crit_range, _parse_criteria(criteria)))
        i += 2

    result = None
    for idx in range(len(min_range_vals)):
        match = True
        for crit_range, pred in pairs:
            if idx >= len(crit_range) or not pred(crit_range[idx]):
                match = False
                break
        if match:
            sv = min_range_vals[idx]
            if isinstance(sv, (int, float)) and not isinstance(sv, bool):
                val = float(sv)
                if result is None or val < result:
                    result = val
    return result if result is not None else 0.0
