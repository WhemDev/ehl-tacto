"""A constructor failure must not strand another hosted validation session."""

import sys
from types import SimpleNamespace

import pytest

from proto import validate_owed as validation


def test_failed_constructor_records_and_closes_only_its_own_opening(monkeypatch, tmp_path):
    closed = []
    client = SimpleNamespace(
        opened_sid="owned-session", session=lambda sid: {"status": "open"}, walk_away=lambda sid: closed.append(sid)
    )
    output = tmp_path / "results.jsonl"
    monkeypatch.setattr(sys, "argv", ["validate", "--practice", "--output", str(output)])
    monkeypatch.setattr(validation, "load_env", lambda: None)
    monkeypatch.setattr(validation, "MeasuredClient", lambda: client)
    monkeypatch.setattr(validation.eng, "Negotiator", validation.eng.Negotiator)
    monkeypatch.setattr(validation, "_negotiator", lambda cid: object)
    monkeypatch.setenv("ENGINE_WRITER", "template")

    def fail(*args, **kwargs):
        raise AttributeError("constructor failed after opening")

    monkeypatch.setattr(validation.eng, "play", fail)
    with pytest.raises(AttributeError):
        validation.main()
    assert closed == ["owned-session"]
    assert "owned-session" in output.read_text()
    with pytest.raises(FileExistsError):
        validation.main()
    assert closed == ["owned-session"]
