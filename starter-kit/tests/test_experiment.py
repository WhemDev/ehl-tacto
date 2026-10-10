"""Exercise repeated comparisons and failed-policy cleanup over the simulator's HTTP API."""

import json
import secrets
import sys
import types

import pytest

from arena_kit import experiment
from arena_kit.client import ArenaClient


def client_for(sim):
    key = ArenaClient(sim[0]).register(f"experiment-tests-{secrets.token_hex(4)}", "sim")["api_key"]
    return ArenaClient(sim[0], key, rate=1000)


def config(repeats=2):
    return {"repeats": repeats, "seed": 42, "strategies": [
        {"name": "baseline", "factory": "arena_kit.agents.naive:NaiveAgent"},
        {"name": "candidate", "factory": "arena_kit.agents.naive:NaiveAgent", "kwargs": {"anchor": 0.15}},
    ]}


def test_all_cases_repeated_without_overwriting_sessions(sim, tmp_path):
    client = client_for(sim)
    cases = experiment.select_cases(client, "sim")
    folder = experiment.run_experiment(client, config(), cases, tmp_path / "batch", "sim")
    records = json.loads((folder / "trials.json").read_text())
    assert len(records) == 12
    assert len({r["session_id"] for r in records}) == 12
    assert all(r["status"] == "completed" for r in records)
    assert {(r["strategy"], r["case_id"], r["repeat"]) for r in records} == {
        (strategy, case["case_id"], repeat)
        for strategy in ("baseline", "candidate") for case in cases for repeat in (1, 2)
    }
    assert len(list((folder / "sessions").glob("*.json"))) == 12
    assert len((folder / "results.csv").read_text().splitlines()) == 13
    assert "Paired differences against baseline" in (folder / "report.md").read_text()
    assert all(r["decision_seconds"] for r in records)
    assert json.loads((folder / "manifest.json").read_text())["status"] == "completed"


@pytest.mark.parametrize("interrupt", [False, True])
def test_failed_policy_is_closed_recorded_and_redacted(sim, tmp_path, monkeypatch, interrupt):
    secret = "example-secret-that-must-never-be-saved"
    monkeypatch.setenv("ARENA_API_KEY", secret)
    created = []

    class FailingPolicy:
        def __init__(self):
            created.append(self)

        def decide(self, case, threads):
            if interrupt:
                raise KeyboardInterrupt()
            raise RuntimeError(secret)

    module = types.ModuleType("test_policy")
    module.create = FailingPolicy
    monkeypatch.setitem(sys.modules, "test_policy", module)
    client = client_for(sim)
    cases = experiment.select_cases(client, "sim", ["case:S01"])
    settings = {"repeats": 2, "strategies": [{"name": "failing", "factory": "test_policy:create"}]}
    folder = experiment.run_experiment(client, settings, cases, tmp_path / "batch", "sim")
    records = json.loads((folder / "trials.json").read_text())
    assert len(records) == len(created) == (1 if interrupt else 2)
    assert all(r["status"] == "failed" and experiment.experiment_score(r) == 0 for r in records)
    assert all(client.session(r["session_id"])["status"] == "ended" for r in records)
    assert all(secret not in path.read_text() for path in folder.rglob("*") if path.is_file())
    assert not list(folder.rglob("*.partial"))


def test_preview_opens_no_sessions(sim, tmp_path, monkeypatch, capsys):
    client = client_for(sim)
    monkeypatch.setattr(experiment, "ArenaClient", lambda **kwargs: client)
    monkeypatch.setattr(client, "open_session", lambda _: pytest.fail("Preview must not create a session"))
    settings = tmp_path / "config.json"
    settings.write_text(json.dumps(config()))
    experiment.main(["--config", str(settings), "--target", "sim", "--out", str(tmp_path / "results")])
    assert "total sessions: 12" in capsys.readouterr().out
    assert not (tmp_path / "results").exists()


def test_target_and_case_guards(sim):
    client = ArenaClient("https://arena.example", "example")
    with pytest.raises(ValueError, match="loopback"):
        experiment.select_cases(client, "sim")
    with pytest.raises(ValueError, match="sandbox and local sim only"):
        experiment.select_cases(client, "practice")
    with pytest.raises(ValueError, match="not available"):
        experiment.select_cases(client_for(sim), "sim", ["case:P01"])
    with pytest.raises(ValueError, match="labelled correctly"):
        experiment.select_cases(client_for(sim), "sandbox")


def test_config_guard_and_repeatable_order():
    with pytest.raises(ValueError, match="credentials"):
        experiment.validate_config({"strategies": [{"name": "bad", "factory": "x:y", "kwargs": {"api_key": "x"}}]})
    with pytest.raises(ValueError, match="positive integer"):
        experiment.validate_config(config(0))
    cases = [{"case_id": "case:D01"}, {"case_id": "case:D02"}]
    assert experiment.schedule(config(), cases) == experiment.schedule(config(), cases)
