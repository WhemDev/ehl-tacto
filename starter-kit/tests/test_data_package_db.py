"""An empty .sqlite file under the package (a sqlite3 shell creates one when it opens a missing path) must never
shadow the package's world.sqlite (2026-10-11 08:04: every case fell back to the orchestra)."""

import shutil
from pathlib import Path

import pytest

from arena_kit.data import DataPackage

PKG = Path(__file__).resolve().parents[1] / "data" / "package"


@pytest.mark.skipif(not (PKG / "world.sqlite").is_file(), reason="data package not downloaded")
def test_an_empty_sqlite_file_never_shadows_the_world_db(tmp_path):
    root = tmp_path / "package"
    root.mkdir()
    shutil.copy(PKG / "world.sqlite", root / "world.sqlite")
    shutil.copy(PKG / "facts.json", root / "facts.json")
    (root / "data").mkdir()
    (root / "data" / "world.sqlite").write_bytes(b"")  # sorts before root/world.sqlite in an rglob
    pkg = DataPackage(root)
    assert pkg.db.execute("SELECT count(*) FROM supplier_intel").fetchone()[0] > 0
