"""Text/string Excel functions."""

from __future__ import annotations

import math
from typing import Any

from simulation.ast_nodes import ExcelError, VALUE_ERROR, NA_ERROR
from simulation.functions import register


def _to_str(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, ExcelError):
        return val.error_type
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, float):
        if val == int(val):
            return str(int(val))
        return str(val)
    return str(val)


@register("LEN")
def _len(evaluator, args):
    val = _to_str(evaluator.resolve_arg(args[0]))
    return float(len(val))


@register("LEFT")
def _left(evaluator, args):
    text = _to_str(evaluator.resolve_arg(args[0]))
    n = int(evaluator.resolve_arg(args[1])) if len(args) > 1 else 1
    return text[:n]


@register("RIGHT")
def _right(evaluator, args):
    text = _to_str(evaluator.resolve_arg(args[0]))
    n = int(evaluator.resolve_arg(args[1])) if len(args) > 1 else 1
    return text[-n:] if n > 0 else ""


@register("MID")
def _mid(evaluator, args):
    text = _to_str(evaluator.resolve_arg(args[0]))
    start = int(evaluator.resolve_arg(args[1]))
    num_chars = int(evaluator.resolve_arg(args[2]))
    return text[start - 1:start - 1 + num_chars]


@register("TRIM")
def _trim(evaluator, args):
    text = _to_str(evaluator.resolve_arg(args[0]))
    import re
    return re.sub(r" +", " ", text.strip())


@register("UPPER")
def _upper(evaluator, args):
    return _to_str(evaluator.resolve_arg(args[0])).upper()


@register("LOWER")
def _lower(evaluator, args):
    return _to_str(evaluator.resolve_arg(args[0])).lower()


@register("PROPER")
def _proper(evaluator, args):
    return _to_str(evaluator.resolve_arg(args[0])).title()


@register("CONCATENATE")
def _concatenate(evaluator, args):
    parts = []
    for arg in args:
        val = evaluator.resolve_arg(arg)
        if isinstance(val, ExcelError):
            return val
        parts.append(_to_str(val))
    return "".join(parts)


@register("CONCAT")
def _concat(evaluator, args):
    parts = []
    for arg in args:
        val = evaluator.resolve_arg(arg)
        if isinstance(val, list):
            for row in val:
                if isinstance(row, list):
                    for cell in row:
                        if isinstance(cell, ExcelError):
                            return cell
                        parts.append(_to_str(cell))
                else:
                    if isinstance(row, ExcelError):
                        return row
                    parts.append(_to_str(row))
        else:
            if isinstance(val, ExcelError):
                return val
            parts.append(_to_str(val))
    return "".join(parts)


@register("TEXTJOIN")
def _textjoin(evaluator, args):
    delimiter = _to_str(evaluator.resolve_arg(args[0]))
    ignore_empty = bool(evaluator.resolve_arg(args[1]))
    parts = []
    for arg in args[2:]:
        val = evaluator.resolve_arg(arg)
        if isinstance(val, list):
            for row in val:
                if isinstance(row, list):
                    for cell in row:
                        s = _to_str(cell)
                        if ignore_empty and s == "":
                            continue
                        parts.append(s)
                else:
                    s = _to_str(row)
                    if ignore_empty and s == "":
                        continue
                    parts.append(s)
        else:
            s = _to_str(val)
            if ignore_empty and s == "":
                continue
            parts.append(s)
    return delimiter.join(parts)


@register("TEXT")
def _text(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    fmt = _to_str(evaluator.resolve_arg(args[1]))

    if isinstance(val, ExcelError):
        return val

    # Simplified TEXT formatting — handles common numeric formats
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        if fmt == "0":
            return str(int(round(val)))
        if fmt == "0.00":
            return f"{val:.2f}"
        if fmt == "0.0":
            return f"{val:.1f}"
        if fmt == "#,##0":
            return f"{val:,.0f}"
        if fmt == "#,##0.00":
            return f"{val:,.2f}"
        if "%" in fmt:
            decimals = fmt.count("0") - 1 if "." in fmt else 0
            return f"{val * 100:.{decimals}f}%"
        # Generic fallback
        try:
            decimal_places = len(fmt.split(".")[-1]) if "." in fmt else 0
            return f"{val:.{decimal_places}f}"
        except (ValueError, IndexError):
            return str(val)

    return _to_str(val)


@register("SUBSTITUTE")
def _substitute(evaluator, args):
    text = _to_str(evaluator.resolve_arg(args[0]))
    old_text = _to_str(evaluator.resolve_arg(args[1]))
    new_text = _to_str(evaluator.resolve_arg(args[2]))
    instance = int(evaluator.resolve_arg(args[3])) if len(args) > 3 else 0

    if instance == 0:
        return text.replace(old_text, new_text)

    count = 0
    result = []
    i = 0
    while i < len(text):
        if text[i:i + len(old_text)] == old_text:
            count += 1
            if count == instance:
                result.append(new_text)
            else:
                result.append(old_text)
            i += len(old_text)
        else:
            result.append(text[i])
            i += 1
    return "".join(result)


@register("REPLACE")
def _replace(evaluator, args):
    text = _to_str(evaluator.resolve_arg(args[0]))
    start = int(evaluator.resolve_arg(args[1]))
    num_chars = int(evaluator.resolve_arg(args[2]))
    new_text = _to_str(evaluator.resolve_arg(args[3]))
    return text[:start - 1] + new_text + text[start - 1 + num_chars:]


@register("FIND")
def _find(evaluator, args):
    find_text = _to_str(evaluator.resolve_arg(args[0]))
    within_text = _to_str(evaluator.resolve_arg(args[1]))
    start = int(evaluator.resolve_arg(args[2])) if len(args) > 2 else 1

    pos = within_text.find(find_text, start - 1)
    if pos == -1:
        return VALUE_ERROR
    return float(pos + 1)


@register("SEARCH")
def _search(evaluator, args):
    find_text = _to_str(evaluator.resolve_arg(args[0])).upper()
    within_text = _to_str(evaluator.resolve_arg(args[1])).upper()
    start = int(evaluator.resolve_arg(args[2])) if len(args) > 2 else 1

    # SEARCH supports wildcards (* and ?)
    import re
    pattern = re.escape(find_text).replace(r"\*", ".*").replace(r"\?", ".")
    match = re.search(pattern, within_text[start - 1:])
    if match is None:
        return VALUE_ERROR
    return float(match.start() + start)


@register("VALUE")
def _value(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        return float(val)
    if isinstance(val, str):
        try:
            return float(val.replace(",", ""))
        except ValueError:
            return VALUE_ERROR
    return VALUE_ERROR


@register("REPT")
def _rept(evaluator, args):
    text = _to_str(evaluator.resolve_arg(args[0]))
    n = int(evaluator.resolve_arg(args[1]))
    return text * max(0, n)


@register("EXACT")
def _exact(evaluator, args):
    a = _to_str(evaluator.resolve_arg(args[0]))
    b = _to_str(evaluator.resolve_arg(args[1]))
    return a == b


@register("T")
def _t(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    return val if isinstance(val, str) else ""


@register("N")
def _n(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    if isinstance(val, bool):
        return 1.0 if val else 0.0
    if isinstance(val, (int, float)):
        return float(val)
    return 0.0


@register("CLEAN")
def _clean(evaluator, args):
    text = _to_str(evaluator.resolve_arg(args[0]))
    return "".join(ch for ch in text if ord(ch) >= 32)


@register("CHAR")
def _char(evaluator, args):
    n = int(evaluator.resolve_arg(args[0]))
    if n < 1 or n > 255:
        return VALUE_ERROR
    return chr(n)


@register("CODE")
def _code(evaluator, args):
    text = _to_str(evaluator.resolve_arg(args[0]))
    if not text:
        return VALUE_ERROR
    return float(ord(text[0]))


@register("NUMBERVALUE")
def _numbervalue(evaluator, args):
    text = _to_str(evaluator.resolve_arg(args[0]))
    dec_sep = _to_str(evaluator.resolve_arg(args[1])) if len(args) > 1 else "."
    grp_sep = _to_str(evaluator.resolve_arg(args[2])) if len(args) > 2 else ","
    text = text.strip().replace(grp_sep, "")
    if dec_sep != ".":
        text = text.replace(dec_sep, ".")
    try:
        return float(text)
    except ValueError:
        return VALUE_ERROR
