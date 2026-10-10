"""The hybrid agent: each case type goes to the agent that won it in practice, through one opened session."""

import time

from test_sim import team

from arena_kit.agents import hybrid
from arena_kit.play import RemoteTable, play


def test_case_types_go_to_the_agent_that_won_them(monkeypatch):
    monkeypatch.delenv("HYBRID_ENGINE_TYPES", raising=False)
    assert hybrid.plays_engine({"type": "rfq"}) and hybrid.plays_engine({"type": "price_increase"})
    assert not hybrid.plays_engine({"type": "raw_material"}) and not hybrid.plays_engine({"type": "quality"})
    monkeypatch.setenv("HYBRID_ENGINE_TYPES", "all")
    assert hybrid.plays_engine({"type": "capacity"})
    monkeypatch.setenv("HYBRID_ENGINE_TYPES", "none")
    assert not hybrid.plays_engine({"type": "rfq"})


def test_the_engine_plays_an_rfq_in_the_session_we_opened(sim):
    client = team(sim[0])
    t0 = time.monotonic()
    result = play(RemoteTable(client), "case:S02", hybrid.Hybrid(None), deadline=time.time() + 100)
    assert result.get("ended") or "deal" in result
    assert time.monotonic() - t0 < 30
    assert len(client.sessions("practice")) == 1  # the engine used our session, it did not open its own


def test_other_types_go_to_the_orchestra_with_the_opening(sim, monkeypatch):
    monkeypatch.setenv("HYBRID_ENGINE_TYPES", "none")
    seen = []

    class Orchestra:
        def play_case(self, table, case_id, deadline=None):
            case, threads = table.open(case_id)  # the opening we already have: no second session
            seen.append((case["case_id"], sorted(threads), table.session_id))
            return table.close(next(iter(threads)), {"action": {"type": "walk_away"}})

    client = team(sim[0])
    play(RemoteTable(client), "case:S01", hybrid.Hybrid(Orchestra))
    assert seen and seen[0][0] == "case:S01" and seen[0][2]
    assert len(client.sessions("practice")) == 1
