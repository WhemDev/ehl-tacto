"""The network, not the arena: DNS failures and dropped connections are retried for ~30 s with one move ID, then raised.
Practice P02 (2026-10-10 23:26): a DNS outage outlasted three quick retries; the supplier walked."""

import httpx
import pytest

import arena_kit.client as client_mod
from arena_kit import ArenaClient


class Clock:
    def __init__(self):
        self.now, self.slept = 0.0, []

    def monotonic(self):
        return self.now

    def sleep(self, s):
        self.slept.append(s)
        self.now += s


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(client_mod.time, "monotonic", c.monotonic)
    monkeypatch.setattr(client_mod.time, "sleep", c.sleep)
    return c


def test_a_short_outage_is_ridden_out_with_the_same_move_id(clock):
    seen = []

    def handle(request):
        seen.append(request)
        if len(seen) <= 5:
            raise httpx.ConnectError("nodename nor servname provided, or not known")
        return httpx.Response(200, json={"api_key": "k"})

    c = ArenaClient("http://arena.test", transport=httpx.MockTransport(handle), rate=1000)
    assert c.register("Team", "CODE")["api_key"] == "k"
    assert len({r.headers["X-Move-Id"] for r in seen}) == 1  # one move, retried
    assert clock.slept == [0.5, 1.0, 2.0, 4.0, 5.0]


def test_a_long_outage_is_raised_after_the_budget(clock):
    def handle(request):
        raise httpx.ConnectError("down")

    c = ArenaClient("http://arena.test", transport=httpx.MockTransport(handle), rate=1000)
    with pytest.raises(httpx.TransportError):
        c.me()
    assert 30.0 <= clock.now <= 35.0
