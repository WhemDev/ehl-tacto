#!/usr/bin/env python3
"""Dump every computed cell of a workbook as JSON, sorted by address.

Usage: python3 scripts/dump-oracle.py <workbook.xlsx> > test/fixtures/oracle/<name>.json
"""
import contextlib
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from simulation import ExcelSimulator


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: dump-oracle.py <workbook.xlsx>", file=sys.stderr)
        sys.exit(1)

    # ExcelSimulator._load() logs a one-line summary via print() the first
    # time it runs. That's harmless for interactive use, but this script's
    # stdout must be pure JSON (it's redirected straight into a fixture
    # file), so redirect the engine's own stdout chatter to stderr instead
    # of letting it land ahead of the JSON payload.
    with contextlib.redirect_stdout(io.StringIO()) as captured:
        sim = ExcelSimulator(sys.argv[1])
        cells = sim.dump_all()
    if captured.getvalue():
        print(captured.getvalue(), end="", file=sys.stderr)

    json.dump(dict(sorted(cells.items())), sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
