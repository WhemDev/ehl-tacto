"""The orchestra's price analysis, the profile hook and the writer's time limit, on real case files and real
arena openings."""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from arena_kit import strategy
from arena_kit.agents import orchestra
from arena_kit.analysis import analyse, meso
from arena_kit.cli import agent_factory
from arena_kit.cost import must_haves_ok

CASES = Path(__file__).resolve().parents[1] / "cases"
DATA = Path(__file__).resolve().parents[2] / "data"


@pytest.fixture(scope="module")
def pkg():
    from arena_kit.data import DataPackage

    return DataPackage(DATA)


def case(cid):
    return json.loads((CASES / f"{cid}.json").read_text(encoding="utf-8"))


def test_quote_with_partial_standard_terms(pkg):
    # practice P02 on the arena: the quote PDF's standard terms list only ppm and chargeback
    c = case("P02")
    opening = {
        "sup:70510": {
            "terms": {"unit_price": 370.96, "payment_days": 30, "index_clause": None},
            "standard": {"ppm_commitment": 250, "chargeback_eur_per_complaint": 0.0},
        }
    }
    s = analyse(c, opening, pkg)["suppliers"]["sup:70510"]
    assert s["aspiration_c"] is not None and s["ideal_levers"]
    assert s["anchor_price"] < 370.96


def test_anchor_stays_below_an_offer_under_our_floor(pkg):
    # practice P05 on the arena: 70210 opened at 36.00, below the German should-cost floor
    c = case("P05")
    opening = {
        "sup:70210": {"terms": {"unit_price": 36.0, "payment_days": 30, "lead_time_days": 35}, "standard": {}},
        "sup:70240": {"terms": {"unit_price": 31.5, "payment_days": 30, "lead_time_days": 56}, "standard": {}},
    }
    a = analyse(c, opening, pkg)
    for sid, o in opening.items():
        s = a["suppliers"][sid]
        assert s["anchor_price"] < o["terms"]["unit_price"]
        for sheet in meso(c, s, s["aspiration_c"], o["terms"]):
            assert must_haves_ok(c, sheet, s["standard"])
    assert a["suppliers"]["sup:70240"]["should_cost"]["part:320070"]["country_factor"] < 1  # a Czech plant


def test_tactics_from_a_profile():
    c = case("P05")
    p = {
        "archetype": "cash_short",
        "confidence": 1.0,
        "situation": {"cash_pressure": 0.8, "dependency_on_us": 0.5, "our_dependency": 0.5},
    }
    t = strategy.tactics(c, p)
    assert ("payment_days", "low") in t["gives"]
    assert t["interest_rate"] > c["buyer"]["interest_rate"]
    assert strategy.give_values(c, t["gives"], {})["payment_days"] == min(c["term_options"]["payment_days"])
    assert strategy.tactics(c, None)["anchor"] > 0  # no profile: the goal's defaults


SID = "sup:70110"
MOVE = {  # practice P01 on the arena: our opening to Brandlhuber
    "kind": "send",
    "phase": "explore",
    "round": 0,
    "sheets": [{"unit_price": 136.23, "effective_date": "2027-04-01", "payment_days": 14}],
    "arguments": [
        {
            "sentence": "Your letter gives 51 days' notice (doc:20260911-70110-P01), while our contract requires "
            "90 days (ctr:4600070110).",
            "ids": ["doc:20260911-70110-P01", "ctr:4600070110"],
        }
    ],
    "questions": ["Could you send us a cost breakdown for this part?"],
}


def writer(complete):
    """The orchestra in P01, as far as writing an e-mail reads it."""
    o = orchestra.Orchestra(complete)
    o.case, o.a, o.tactics = case("P01"), {"goal": "stabilise"}, {}
    o.threads = {SID: [{"from": "supplier", "status": "open", "body": "Please find our new price list attached."}]}
    o.models = {SID: orchestra.SupplierModel(SID)}
    return o


def test_a_quick_writer_writes_the_email():
    out = '{"subject": "Your price letter", "body": "Dear Brandlhuber team, thank you for your letter."}'
    msg = writer(lambda system, user: out)._write(SID, MOVE)
    assert msg["subject"] == "Your price letter"
    assert msg["body"] == "Dear Brandlhuber team, thank you for your letter.\n\n" + MOVE["arguments"][0]["sentence"]


def test_a_hung_writer_does_not_hold_the_email(monkeypatch):
    # leaving `with ThreadPoolExecutor()` waited for the abandoned call: one hung LLM call held the e-mail for
    # up to ~135 s (45 s, three attempts), past the arena's 60 s - the template must go out after NARRATE_S
    monkeypatch.setattr(orchestra, "NARRATE_S", 0.2)
    called, release = threading.Event(), threading.Event()

    def hung(system, user):
        called.set()
        release.wait(2)
        return '{"subject": "Too late", "body": "Too late."}'

    t0 = time.monotonic()
    try:
        msg = writer(hung)._write(SID, MOVE)
        took = time.monotonic() - t0
    finally:
        release.set()
    assert called.is_set() and took < 0.2 + 0.5
    assert msg == writer(None)._write(SID, MOVE)  # the template's e-mail, as without a model


def test_the_orchestras_writer_gives_up_with_it(monkeypatch):
    # its client makes one attempt of NARRATE_S, so an abandoned call ends when the orchestra stops waiting
    # (llm_from_env's 45 s and two retries kept it running for minutes, during a wave of parallel cases)
    anthropic = pytest.importorskip("anthropic")
    hits, release = [], threading.Event()

    class Hang(BaseHTTPRequestHandler):
        def do_POST(self):
            hits.append(self.path)
            release.wait(2)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Hang)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(orchestra, "NARRATE_S", 0.3)
    monkeypatch.delenv("ARENA_NARRATOR", raising=False)
    for k, v in {
        "LLM_PROVIDER": "anthropic",
        "LLM_MODEL": "claude-test",
        "ANTHROPIC_API_KEY": "test",
        "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{server.server_port}",
    }.items():
        monkeypatch.setenv(k, v)
    t0 = time.monotonic()
    try:
        with pytest.raises(anthropic.APITimeoutError):
            agent_factory("orchestra", None)().complete("system", "user")
        assert time.monotonic() - t0 < 0.3 + 0.5 and hits == ["/v1/messages"]
    finally:
        release.set()
        server.shutdown()
        server.server_close()
