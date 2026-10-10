import json
from pathlib import Path

import pytest

from arena_kit import profiles
from arena_kit.data import DataPackage

DATA = Path(__file__).resolve().parents[2] / "data"
pytestmark = pytest.mark.skipif(not (DATA / "world.sqlite").is_file(), reason="data package not unpacked")


@pytest.fixture(scope="module")
def pkg():
    return DataPackage(DATA)


def test_every_detailed_supplier_gets_a_dossier(pkg):
    ids = profiles.suppliers(pkg)
    assert len(ids) == 46
    d = profiles.dossier(pkg, "sup:70110")
    assert d["supplier"]["id"] == "sup:70110"
    assert d["correspondence"] and all(c["text"] for c in d["correspondence"])
    assert "our_share_of_its_turnover_pct" in d["indicators"]
    json.dumps(d, default=str)  # the dossier goes into the prompt as JSON


def test_the_dossier_key_is_stable(pkg):
    a, b = profiles.dossier(pkg, "sup:70110"), profiles.dossier(pkg, "sup:70110")
    assert profiles._key(a, "m") == profiles._key(b, "m") != profiles._key(a, "other model")


def test_invented_ids_are_dropped(pkg):
    dropped = []
    out = profiles._clean_ids(
        {"trades": [{"give": "x", "ids": ["cost:310010", "doc:nope", "ctr:4600070110#3.1"]}]}, pkg, dropped
    )
    assert out["trades"][0]["ids"] == ["cost:310010", "ctr:4600070110#3.1"]
    assert dropped == ["doc:nope"]


def test_build_uses_the_cache(pkg, tmp_path, monkeypatch):
    monkeypatch.setattr(profiles, "OUT", tmp_path)
    calls = []

    def fake(system, user):
        calls.append(user)
        return json.dumps({"archetype": "cash_short", "trades": [{"ids": ["cost:310010", "doc:invented"]}]})

    p, built = profiles.build(pkg, "sup:70110", fake, "m")
    assert built and p["archetype"] == "cash_short" and p["meta"]["dropped_ids"] == ["doc:invented"]
    p2, built2 = profiles.build(pkg, "sup:70110", fake, "m")
    assert not built2 and len(calls) == 1
    assert profiles.load("sup:70110")["archetype"] == "cash_short"
