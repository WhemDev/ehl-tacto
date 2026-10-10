"""Exercise human chat through the simulator's real HTTP endpoints."""

import pytest

from arena_kit import cli
from arena_kit.chat import _offer, chat
from arena_kit.cli import main
from arena_kit.client import ArenaClient


def test_chat_offer_and_resume(sim, monkeypatch):
    url, _, _ = sim
    key = ArenaClient(url).register("chat-test", "sim")["api_key"]
    client = ArenaClient(url, key)
    answers = iter([
        "",
        "/attachment att:70270-0-quote",
        "/offer 15.50 payment_days=60 | Could we agree on these terms?",
        "/quit",
    ])
    monkeypatch.setattr("builtins.input", lambda _: next(answers))

    session_id = chat(client, "case:S01", "practice")
    messages = client.thread(session_id, "sup:70270")["messages"]
    buyer = next(message for message in messages if message.get("from") == "buyer")
    assert buyer["term_sheets"][0]["terms"] == {"unit_price": 15.5, "payment_days": 60}
    assert client.session(session_id)["status"] == "open"

    monkeypatch.setattr("builtins.input", lambda _: "/accept")
    assert chat(client, resume=session_id) == session_id
    assert client.session(session_id)["result"]["deal"]


def test_chat_stops_after_session_timeout(sim, monkeypatch, capsys):
    url, _, clock = sim
    key = ArenaClient(url).register("chat-timeout-test", "sim")["api_key"]
    client = ArenaClient(url, key)
    prompts = 0

    def answer(_):
        nonlocal prompts
        prompts += 1
        if prompts == 1:
            return ""
        clock.now += 181
        return "Could you send a cost breakdown?"

    monkeypatch.setattr("builtins.input", answer)
    session_id = chat(client, "case:S01", "practice")
    assert client.session(session_id)["end_reason"] == "timeout"
    assert prompts == 2
    assert "This session is closed" in capsys.readouterr().out


def test_offer_rejects_unsupported_payment_terms(sim):
    url, _, _ = sim
    key = ArenaClient(url).register("chat-options-test", "sim")["api_key"]
    case = ArenaClient(url, key).cases("practice")[0]
    with pytest.raises(ValueError, match="payment_days must be one of"):
        _offer(case, "/offer 15.50 payment_days=40 | Please consider this")


def test_finished_chat_is_saved_to_vault(sim, monkeypatch, tmp_path):
    from arena_kit import vault

    url, _, _ = sim
    key = ArenaClient(url).register("chat-vault-test", "sim")["api_key"]
    monkeypatch.setenv("ARENA_URL", url)
    monkeypatch.setenv("ARENA_API_KEY", key)
    monkeypatch.setattr(vault, "VAULT", tmp_path)
    monkeypatch.setattr(cli, "local", lambda: False)  # exercise hosted-chat vault logging with the simulator transport
    answers = iter(["", "/accept"])
    monkeypatch.setattr("builtins.input", lambda _: next(answers))

    main(["chat", "case:S01", "--set", "practice"])

    notes = list((tmp_path / "Runs").glob("S01 *.md"))
    assert len(notes) == 1
    content = notes[0].read_text()
    assert "## Negotiation" in content
    assert "deal: true" in content
