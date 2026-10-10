"""Math and statistical Excel functions."""

from __future__ import annotations

import math
from typing import Any, List

from simulation.ast_nodes import ExcelError, VALUE_ERROR, DIV0_ERROR, NUM_ERROR
from simulation.functions import register


def _flatten_numbers(evaluator, args: list) -> List[float]:
    """Resolve args (which may contain ranges) and collect all numeric values."""
    nums: List[float] = []
    for arg in args:
        val = evaluator.resolve_arg(arg)
        if isinstance(val, list):
            for row in val:
                if isinstance(row, list):
                    for cell in row:
                        n = _to_number(cell)
                        if n is not None:
                            nums.append(n)
                else:
                    n = _to_number(row)
                    if n is not None:
                        nums.append(n)
        else:
            n = _to_number(val)
            if n is not None:
                nums.append(n)
    return nums


def _to_number(val: Any) -> float | None:
    if isinstance(val, ExcelError):
        return None
    if isinstance(val, bool):
        return float(val)
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        try:
            return float(val)
        except (ValueError, TypeError):
            return None
    return None


def _coerce_number(val: Any) -> float | ExcelError:
    """Coerce a single value to float, or return VALUE_ERROR."""
    if isinstance(val, ExcelError):
        return val
    if isinstance(val, bool):
        return float(val)
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        try:
            return float(val)
        except (ValueError, TypeError):
            return VALUE_ERROR
    if val is None:
        return 0.0
    return VALUE_ERROR


@register("SUM")
def _sum(evaluator, args):
    nums = _flatten_numbers(evaluator, args)
    return sum(nums) if nums else 0.0


@register("AVERAGE")
def _average(evaluator, args):
    nums = _flatten_numbers(evaluator, args)
    if not nums:
        return DIV0_ERROR
    return sum(nums) / len(nums)


@register("MIN")
def _min(evaluator, args):
    nums = _flatten_numbers(evaluator, args)
    return min(nums) if nums else 0.0


@register("MAX")
def _max(evaluator, args):
    nums = _flatten_numbers(evaluator, args)
    return max(nums) if nums else 0.0


@register("COUNT")
def _count(evaluator, args):
    return float(len(_flatten_numbers(evaluator, args)))


@register("COUNTA")
def _counta(evaluator, args):
    count = 0
    for arg in args:
        val = evaluator.resolve_arg(arg)
        if isinstance(val, list):
            for row in val:
                if isinstance(row, list):
                    for cell in row:
                        if cell is not None and cell != "":
                            count += 1
                else:
                    if row is not None and row != "":
                        count += 1
        else:
            if val is not None and val != "":
                count += 1
    return float(count)


@register("COUNTBLANK")
def _countblank(evaluator, args):
    count = 0
    for arg in args:
        val = evaluator.resolve_arg(arg)
        if isinstance(val, list):
            for row in val:
                if isinstance(row, list):
                    for cell in row:
                        if cell is None or cell == "":
                            count += 1
                else:
                    if row is None or row == "":
                        count += 1
        else:
            if val is None or val == "":
                count += 1
    return float(count)


@register("ABS")
def _abs(evaluator, args):
    val = _coerce_number(evaluator.resolve_arg(args[0]))
    if isinstance(val, ExcelError):
        return val
    return abs(val)


@register("ROUND")
def _round(evaluator, args):
    val = _coerce_number(evaluator.resolve_arg(args[0]))
    digits = int(_coerce_number(evaluator.resolve_arg(args[1]))) if len(args) > 1 else 0
    if isinstance(val, ExcelError):
        return val
    return round(val, digits)


@register("ROUNDUP")
def _roundup(evaluator, args):
    val = _coerce_number(evaluator.resolve_arg(args[0]))
    digits = int(_coerce_number(evaluator.resolve_arg(args[1]))) if len(args) > 1 else 0
    if isinstance(val, ExcelError):
        return val
    factor = 10 ** digits
    if val >= 0:
        return math.ceil(val * factor) / factor
    else:
        return math.floor(val * factor) / factor


@register("ROUNDDOWN")
def _rounddown(evaluator, args):
    val = _coerce_number(evaluator.resolve_arg(args[0]))
    digits = int(_coerce_number(evaluator.resolve_arg(args[1]))) if len(args) > 1 else 0
    if isinstance(val, ExcelError):
        return val
    factor = 10 ** digits
    if val >= 0:
        return math.floor(val * factor) / factor
    else:
        return math.ceil(val * factor) / factor


@register("CEILING")
def _ceiling(evaluator, args):
    val = _coerce_number(evaluator.resolve_arg(args[0]))
    sig = _coerce_number(evaluator.resolve_arg(args[1])) if len(args) > 1 else 1.0
    if isinstance(val, ExcelError):
        return val
    if isinstance(sig, ExcelError):
        return sig
    if sig == 0:
        return 0.0
    return math.ceil(val / sig) * sig


@register("FLOOR")
def _floor(evaluator, args):
    val = _coerce_number(evaluator.resolve_arg(args[0]))
    sig = _coerce_number(evaluator.resolve_arg(args[1])) if len(args) > 1 else 1.0
    if isinstance(val, ExcelError):
        return val
    if isinstance(sig, ExcelError):
        return sig
    if sig == 0:
        return 0.0
    return math.floor(val / sig) * sig


@register("INT")
def _int(evaluator, args):
    val = _coerce_number(evaluator.resolve_arg(args[0]))
    if isinstance(val, ExcelError):
        return val
    return float(math.floor(val))


@register("MOD")
def _mod(evaluator, args):
    num = _coerce_number(evaluator.resolve_arg(args[0]))
    divisor = _coerce_number(evaluator.resolve_arg(args[1]))
    if isinstance(num, ExcelError):
        return num
    if isinstance(divisor, ExcelError):
        return divisor
    if divisor == 0:
        return DIV0_ERROR
    return num - divisor * math.floor(num / divisor)


@register("POWER")
def _power(evaluator, args):
    base = _coerce_number(evaluator.resolve_arg(args[0]))
    exp = _coerce_number(evaluator.resolve_arg(args[1]))
    if isinstance(base, ExcelError):
        return base
    if isinstance(exp, ExcelError):
        return exp
    try:
        return base ** exp
    except (OverflowError, ValueError):
        return NUM_ERROR


@register("SQRT")
def _sqrt(evaluator, args):
    val = _coerce_number(evaluator.resolve_arg(args[0]))
    if isinstance(val, ExcelError):
        return val
    if val < 0:
        return NUM_ERROR
    return math.sqrt(val)


@register("LOG")
def _log(evaluator, args):
    val = _coerce_number(evaluator.resolve_arg(args[0]))
    base = _coerce_number(evaluator.resolve_arg(args[1])) if len(args) > 1 else 10.0
    if isinstance(val, ExcelError):
        return val
    if isinstance(base, ExcelError):
        return base
    if val <= 0 or base <= 0 or base == 1:
        return NUM_ERROR
    return math.log(val, base)


@register("LN")
def _ln(evaluator, args):
    val = _coerce_number(evaluator.resolve_arg(args[0]))
    if isinstance(val, ExcelError):
        return val
    if val <= 0:
        return NUM_ERROR
    return math.log(val)


@register("EXP")
def _exp(evaluator, args):
    val = _coerce_number(evaluator.resolve_arg(args[0]))
    if isinstance(val, ExcelError):
        return val
    try:
        return math.exp(val)
    except OverflowError:
        return NUM_ERROR


@register("SIGN")
def _sign(evaluator, args):
    val = _coerce_number(evaluator.resolve_arg(args[0]))
    if isinstance(val, ExcelError):
        return val
    if val > 0:
        return 1.0
    elif val < 0:
        return -1.0
    return 0.0


@register("PRODUCT")
def _product(evaluator, args):
    nums = _flatten_numbers(evaluator, args)
    if not nums:
        return 0.0
    result = 1.0
    for n in nums:
        result *= n
    return result


@register("SUMPRODUCT")
def _sumproduct(evaluator, args):
    arrays = []
    for arg in args:
        val = evaluator.resolve_arg(arg)
        if isinstance(val, list):
            flat = []
            for row in val:
                if isinstance(row, list):
                    flat.extend(row)
                else:
                    flat.append(row)
            arrays.append(flat)
        else:
            arrays.append([val])

    if not arrays:
        return 0.0

    length = len(arrays[0])
    for arr in arrays[1:]:
        if len(arr) != length:
            return VALUE_ERROR

    total = 0.0
    for i in range(length):
        product = 1.0
        for arr in arrays:
            n = _to_number(arr[i])
            if n is None:
                n = 0.0
            product *= n
        total += product
    return total


@register("PI")
def _pi(evaluator, args):
    return math.pi


@register("RAND")
def _rand(evaluator, args):
    import random
    return random.random()


@register("RANDBETWEEN")
def _randbetween(evaluator, args):
    import random
    lo = int(_coerce_number(evaluator.resolve_arg(args[0])))
    hi = int(_coerce_number(evaluator.resolve_arg(args[1])))
    return float(random.randint(lo, hi))


@register("MEDIAN")
def _median(evaluator, args):
    nums = sorted(_flatten_numbers(evaluator, args))
    if not nums:
        return NUM_ERROR
    n = len(nums)
    mid = n // 2
    if n % 2 == 0:
        return (nums[mid - 1] + nums[mid]) / 2.0
    return nums[mid]


@register("LARGE")
def _large(evaluator, args):
    nums = sorted(_flatten_numbers(evaluator, [args[0]]), reverse=True)
    k = int(_coerce_number(evaluator.resolve_arg(args[1])))
    if k < 1 or k > len(nums):
        return NUM_ERROR
    return nums[k - 1]


@register("SMALL")
def _small(evaluator, args):
    nums = sorted(_flatten_numbers(evaluator, [args[0]]))
    k = int(_coerce_number(evaluator.resolve_arg(args[1])))
    if k < 1 or k > len(nums):
        return NUM_ERROR
    return nums[k - 1]
