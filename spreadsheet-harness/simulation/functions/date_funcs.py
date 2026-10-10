"""Date and time Excel functions.

Excel stores dates as serial numbers (days since 1899-12-30).
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from typing import Any

from simulation.ast_nodes import ExcelError, VALUE_ERROR, NUM_ERROR
from simulation.functions import register

# Excel epoch: serial number 1 = 1900-01-01
# But Excel incorrectly considers 1900 a leap year (Lotus 1-2-3 bug),
# so serial 60 = 1900-02-29 (which didn't exist). We handle this.
_EXCEL_EPOCH = date(1899, 12, 30)


def _date_to_serial(d: date) -> float:
    delta = d - _EXCEL_EPOCH
    serial = delta.days
    if serial >= 60:
        serial += 1  # Lotus 1-2-3 leap year bug
    return float(serial)


def _serial_to_date(serial: float) -> date:
    s = int(serial)
    if s >= 61:
        s -= 1
    return _EXCEL_EPOCH + timedelta(days=s)


def _coerce_date(val: Any) -> date | ExcelError:
    if isinstance(val, ExcelError):
        return val
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        try:
            return _serial_to_date(val)
        except (OverflowError, ValueError):
            return VALUE_ERROR
    if isinstance(val, str):
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d"):
            try:
                return datetime.strptime(val, fmt).date()
            except ValueError:
                continue
        return VALUE_ERROR
    return VALUE_ERROR


@register("TODAY")
def _today(evaluator, args):
    return _date_to_serial(date.today())


@register("NOW")
def _now(evaluator, args):
    n = datetime.now()
    serial = _date_to_serial(n.date())
    frac = (n.hour * 3600 + n.minute * 60 + n.second) / 86400.0
    return serial + frac


@register("DATE")
def _date_func(evaluator, args):
    year = int(evaluator.resolve_arg(args[0]))
    month = int(evaluator.resolve_arg(args[1]))
    day = int(evaluator.resolve_arg(args[2]))

    # Handle month overflow/underflow
    if month > 12:
        year += (month - 1) // 12
        month = (month - 1) % 12 + 1
    elif month < 1:
        year += (month - 12) // 12
        month = 12 + (month % 12) if month % 12 != 0 else 12

    try:
        import calendar
        max_day = calendar.monthrange(year, month)[1]
        day = min(day, max_day)
        d = date(year, month, day)
        return _date_to_serial(d)
    except (ValueError, OverflowError):
        return VALUE_ERROR


@register("YEAR")
def _year(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    d = _coerce_date(val)
    if isinstance(d, ExcelError):
        return d
    return float(d.year)


@register("MONTH")
def _month(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    d = _coerce_date(val)
    if isinstance(d, ExcelError):
        return d
    return float(d.month)


@register("DAY")
def _day(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    d = _coerce_date(val)
    if isinstance(d, ExcelError):
        return d
    return float(d.day)


@register("HOUR")
def _hour(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    if isinstance(val, datetime):
        return float(val.hour)
    if isinstance(val, (int, float)):
        frac = val - int(val)
        return float(int(frac * 24) % 24)
    return VALUE_ERROR


@register("MINUTE")
def _minute(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    if isinstance(val, datetime):
        return float(val.minute)
    if isinstance(val, (int, float)):
        frac = val - int(val)
        total_minutes = frac * 1440
        return float(int(total_minutes) % 60)
    return VALUE_ERROR


@register("SECOND")
def _second(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    if isinstance(val, datetime):
        return float(val.second)
    if isinstance(val, (int, float)):
        frac = val - int(val)
        total_seconds = frac * 86400
        return float(int(total_seconds) % 60)
    return VALUE_ERROR


@register("EOMONTH")
def _eomonth(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    months = int(evaluator.resolve_arg(args[1]))

    d = _coerce_date(val)
    if isinstance(d, ExcelError):
        return d

    import calendar
    new_month = d.month + months
    new_year = d.year
    if new_month > 12:
        new_year += (new_month - 1) // 12
        new_month = (new_month - 1) % 12 + 1
    elif new_month < 1:
        new_year += (new_month - 12) // 12
        new_month = 12 + (new_month % 12) if new_month % 12 != 0 else 12

    try:
        last_day = calendar.monthrange(new_year, new_month)[1]
        return _date_to_serial(date(new_year, new_month, last_day))
    except (ValueError, OverflowError):
        return NUM_ERROR


@register("EDATE")
def _edate(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    months = int(evaluator.resolve_arg(args[1]))

    d = _coerce_date(val)
    if isinstance(d, ExcelError):
        return d

    import calendar
    new_month = d.month + months
    new_year = d.year
    if new_month > 12:
        new_year += (new_month - 1) // 12
        new_month = (new_month - 1) % 12 + 1
    elif new_month < 1:
        new_year += (new_month - 12) // 12
        new_month = 12 + (new_month % 12) if new_month % 12 != 0 else 12

    try:
        max_day = calendar.monthrange(new_year, new_month)[1]
        new_day = min(d.day, max_day)
        return _date_to_serial(date(new_year, new_month, new_day))
    except (ValueError, OverflowError):
        return NUM_ERROR


@register("DATEDIF")
def _datedif(evaluator, args):
    start = _coerce_date(evaluator.resolve_arg(args[0]))
    end = _coerce_date(evaluator.resolve_arg(args[1]))
    unit = str(evaluator.resolve_arg(args[2])).upper()

    if isinstance(start, ExcelError):
        return start
    if isinstance(end, ExcelError):
        return end

    if unit == "D":
        return float((end - start).days)
    elif unit == "M":
        return float((end.year - start.year) * 12 + end.month - start.month)
    elif unit == "Y":
        return float(end.year - start.year)
    return VALUE_ERROR


@register("WEEKDAY")
def _weekday(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    return_type = int(evaluator.resolve_arg(args[1])) if len(args) > 1 else 1

    d = _coerce_date(val)
    if isinstance(d, ExcelError):
        return d

    # Python: Monday=0, Sunday=6. Excel type 1: Sunday=1, Saturday=7
    py_weekday = d.weekday()  # 0=Mon, 6=Sun

    if return_type == 1:
        return float((py_weekday + 2) % 7 or 7)
    elif return_type == 2:
        return float(py_weekday + 1)
    elif return_type == 3:
        return float(py_weekday)
    return VALUE_ERROR


@register("NETWORKDAYS")
def _networkdays(evaluator, args):
    start = _coerce_date(evaluator.resolve_arg(args[0]))
    end = _coerce_date(evaluator.resolve_arg(args[1]))

    if isinstance(start, ExcelError):
        return start
    if isinstance(end, ExcelError):
        return end

    holidays = set()
    if len(args) > 2:
        hvals = evaluator.resolve_arg(args[2])
        if isinstance(hvals, list):
            for row in hvals:
                items = row if isinstance(row, list) else [row]
                for h in items:
                    hd = _coerce_date(h)
                    if isinstance(hd, date):
                        holidays.add(hd)
        else:
            hd = _coerce_date(hvals)
            if isinstance(hd, date):
                holidays.add(hd)

    sign = 1 if end >= start else -1
    if sign == -1:
        start, end = end, start

    count = 0
    current = start
    while current <= end:
        if current.weekday() < 5 and current not in holidays:
            count += 1
        current += timedelta(days=1)

    return float(count * sign)


@register("DATEVALUE")
def _datevalue(evaluator, args):
    val = evaluator.resolve_arg(args[0])
    d = _coerce_date(val)
    if isinstance(d, ExcelError):
        return d
    return _date_to_serial(d)
