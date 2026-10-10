"""The Live Final runner: a case refused for the key's 10 open sessions is retried while the wave leaves time."""

import sys
import time

from test_sim import Waves, team

from arena_kit import ArenaError
from arena_kit.agents import NaiveAgent
from arena_kit.play import play_waves


class FullKey:
    """The client, but the first `refusals` session openings answer 429 (another process holds the slots)."""

    def __init__(self, client, refusals):
        self.client, self.refusals, self.openings = client, refusals, 0

    def __getattr__(self, name):
        return getattr(self.client, name)

    def open_session(self, case_id):
        self.openings += 1
        if self.openings <= self.refusals:
            raise ArenaError(429, "at most 10 open sessions per key")
        return self.client.open_session(case_id)


def test_a_full_key_is_retried_until_a_slot_frees(sim, monkeypatch):
    monkeypatch.setattr(sys.modules["arena_kit.play"], "SLOT_RETRY_S", 0.05)  # arena_kit.play is also a function
    url, _, _ = sim
    full = FullKey(team(url), refusals=3)
    script = [[("case:S01", 1, True)], [("case:S01", 1, False)]]
    t0 = time.monotonic()
    out = play_waves(Waves(full, script), NaiveAgent, waves=1, poll=0)
    assert out["case:S01"]["ended"] and full.openings == 4 and time.monotonic() - t0 < 10


def test_a_full_key_gives_up_when_the_wave_is_nearly_over(sim, monkeypatch):
    monkeypatch.setattr(sys.modules["arena_kit.play"], "SLOT_RETRY_S", 0.05)
    url, _, _ = sim
    full = FullKey(team(url), refusals=10_000)
    script = [[("case:S01", 1, True)], [("case:S01", 1, False)]]
    out = play_waves(Waves(full, script, caps={1: 100}), NaiveAgent, waves=1, poll=0)  # 100 s left < the minimum
    assert isinstance(out["case:S01"], ArenaError) and out["case:S01"].status == 429 and full.openings == 1
