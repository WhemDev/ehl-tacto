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


# --- the Live Final's wave cap -------------------------------------------------------------------


def test_close_margin_follows_the_slowest_round():
    o = orchestra.Orchestra()
    o.limit_rounds, o.round_times, o.slowest = 5, [], 0.0
    o.deadline = time.time() + 60
    assert o._deadline_near()  # 60 s left < the 90 s minimum
    o.deadline = time.time() + 200
    assert not o._deadline_near()
    o.slowest = 190.0  # one round took 190 s: another one no longer fits
    assert o._deadline_near()


def test_rounds_budget_from_the_time_left():
    o = orchestra.Orchestra()
    o.limit_rounds, o.slowest, o.round_times = 5, 60.0, [60.0]
    o.deadline = None
    assert o._rounds_by_time(0) == 5  # practice: no cap
    o.deadline = time.time() + 300  # 300 s - 90 s margin = 3 more rounds of 60 s
    assert o._rounds_by_time(0) == 4
    o.deadline = time.time() + 100
    assert o._rounds_by_time(2) == 3  # no room: this is the last message


def test_a_case_near_the_cap_closes_at_once(sim, monkeypatch):
    from test_sim import team

    from arena_kit.play import RemoteTable, play

    client = team(sim[0])
    t0 = time.monotonic()
    result = play(RemoteTable(client), "case:S01", orchestra.Orchestra(None), deadline=time.time() + 30)
    assert result["ended"] and time.monotonic() - t0 < 10  # 30 s left < 90 s: accept or walk, no new round


def test_the_watchdog_accepts_the_best_offer_just_before_the_cap():
    closed = []

    class Table:
        def close(self, supplier_id, message):
            closed.append((supplier_id, message["action"]))
            return {"deal": True, "ended": True}

    def quote(sid, price):
        return [
            {
                "from": f"sales@{sid}",
                "status": "open",
                "term_sheets": [{"term_sheet_id": f"offer:{sid}-1", "terms": {"unit_price": price}}],
            }
        ]

    o = orchestra.Orchestra()
    o.case, o.table, o.closed, o.inflight = case("P05"), Table(), False, {"sup:70250"}
    o.threads = {"sup:70210": quote("sup:70210", 36.0), "sup:70250": quote("sup:70250", 30.0)}
    o.a = {"c_alt": None, "suppliers": {}}
    o.deadline = time.time() + orchestra.WATCHDOG_S - 5  # inside the watchdog's window
    o._watchdog((None, None))
    # 70250 is cheaper but its reply is in flight (its offer is about to change): 70210 is taken
    assert closed == [("sup:70210", {"type": "accept", "term_sheet_id": "offer:sup:70210-1"})] and o.closed


# --- what we argue with and what we offer ---------------------------------------------------------


def test_claims_never_argue_for_the_supplier(pkg):
    # practice P03 (renewal, no price letter): copper +47.7 % and electronics +13.5 % are its arguments
    c = case("P03")
    opening = {"sup:70530": {"terms": {"unit_price": 438.21, "payment_days": 30}, "standard": {}}}
    claims = analyse(c, opening, pkg)["suppliers"]["sup:70530"]["claims"]
    assert claims and not [x for x in claims if x["kind"] == "index" and "+" in x["sentence"].split("changed ")[1][:2]]
    ids = [i for x in claims for i in x["ids"]]
    assert len(ids) == len(set(ids))  # each ID once: a repeated one only scores "duplicate"


def test_bundles_cite_no_component_prices(pkg):
    c = case("P07")  # a kit of several parts: a component's order price is not the kit's price
    opening = {"sup:70610": {"terms": {"unit_price": 5.74, "payment_days": 30, "contract_months": 12}, "standard": {}}}
    claims = analyse(c, opening, pkg)["suppliers"]["sup:70610"]["claims"]
    assert not [x for x in claims if x["kind"] in ("orders", "should_cost")]


def test_free_levers_go_to_the_supplier(pkg):
    # a contract beyond the horizon and a lead time up to our need cost us nothing: offer the longest
    c = case("P07")
    opening = {"sup:70610": {"terms": {"unit_price": 5.74, "payment_days": 30, "contract_months": 12}, "standard": {}}}
    ideal = analyse(c, opening, pkg)["suppliers"]["sup:70610"]["ideal_levers"]
    assert ideal["contract_months"] == max(c["term_options"]["contract_months"])


def test_profiles_never_soften_the_goals_anchor():
    c = case("P10")
    timid = {
        "archetype": "near_monopolist",
        "confidence": 1.0,
        "protects": ["unit_price is policy"],
        "situation": {"dependency_on_us": 0.0, "our_dependency": 1.0, "relationship": "strained"},
    }
    from arena_kit.analysis import GOALS

    assert strategy.tactics(c, timid)["anchor"] >= GOALS[c["buyer"]["category_goal"]]["anchor"]


# --- the teammate's engine, ported (target from the floor, alternatives, no lonely pushes) ------------------


def test_floor_from_the_suppliers_own_letter():
    from arena_kit.analysis import floor_estimate

    c = case("D01")  # today 48.60, sustainable margin 4 %, the letter: wages +3.1 % at 28 % of its cost
    body = "In light of current market conditions, WAGES-METAL rose 3.1 % in twelve months and is 28 % of our cost."
    assert floor_estimate(c, 52.9, 52.9, None, body) == 47.14
    assert floor_estimate(case("D02"), 17.1, 16.0, None, "") == 13.6  # nothing known: 85 % of the lowest quote


def test_engine_targets_sit_below_the_floor(monkeypatch):
    monkeypatch.setenv("ORCH_CURVE", "engine")
    c = case("D02")
    opening = {
        "sup:DEMO-J1": {"terms": {"unit_price": 17.1, "payment_days": 30, "lead_time_days": 28}, "standard": {}},
        "sup:DEMO-C1": {"terms": {"unit_price": 16.0, "payment_days": 45, "incoterm": "EXW"}, "standard": {}},
    }
    a = analyse(c, opening, None)
    assert all(s["anchor_price"] == 13.19 for s in a["suppliers"].values())  # 3 % below 85 % of 16.00


def offers(*sheets, status="open"):
    return {
        "from": "sales@x",
        "status": status,
        "body": "",
        "term_sheets": [{"term_sheet_id": i, "terms": t} for i, t in sheets],
    }


def engine_orchestra(c, threads):
    o = orchestra.Orchestra()
    o.case, o.threads, o.closed, o.inflight, o.deadline = c, threads, False, set(), None
    o.limit_rounds, o.explore, o.slowest, o.round_times = 8, 4, 0.0, []
    o.last_target, o.holds, o.pushes, o.used, o.tactics = {}, {}, {}, {}, {}
    o.models = {sid: orchestra.SupplierModel(sid) for sid in threads}
    opening = {sid: {"terms": ev[0]["term_sheets"][0]["terms"], "standard": {}} for sid, ev in threads.items()}
    o.a = analyse(c, opening, None)
    for sid in threads:
        o._offer_seen(sid)
    return o


def test_a_better_alternative_is_sent_back_to_be_agreed():
    c = case("D01")
    std = {"payment_days": 30, "contract_months": 24, "effective_date": "2026-12-01"}
    t = engine_orchestra(c, {"sup:DEMO-F1": [offers(("offer:F1-0", {**std, "unit_price": 52.9}))]})
    t.threads["sup:DEMO-F1"].append({"from": "buyer"})
    t.threads["sup:DEMO-F1"].append(
        offers(
            ("offer:F1-1", {**std, "unit_price": 51.0}),
            ("offer:F1-1-a", {**std, "unit_price": 49.6}),
            status="final_offer",
        )
    )
    t._offer_seen("sup:DEMO-F1")
    move = t.next_move("sup:DEMO-F1")
    assert (
        move["kind"] == "send"
        and move["sheets"][0]["unit_price"] == 49.6
        and "exactly as offered" in move["fixed_text"]
    )


def test_no_push_after_a_final_offer_without_a_fallback():
    c = case("D01")
    std = {"payment_days": 30, "contract_months": 24, "effective_date": "2026-12-01"}
    t = engine_orchestra(c, {"sup:DEMO-F1": [offers(("offer:F1-0", {**std, "unit_price": 52.9}))]})
    t.threads["sup:DEMO-F1"] += [
        {"from": "buyer"},
        offers(("offer:F1-1", {**std, "unit_price": 50.0}), status="final_offer"),
    ]
    t._offer_seen("sup:DEMO-F1")
    assert t.next_move("sup:DEMO-F1")["kind"] == "accept"  # practice P10: a push made a lone supplier walk


def test_asks_never_retreat():
    c = case("D01")
    std = {"payment_days": 30, "contract_months": 24, "effective_date": "2026-12-01"}
    t = engine_orchestra(c, {"sup:DEMO-F1": [offers(("offer:F1-0", {**std, "unit_price": 52.9}))]})
    t.last_target["sup:DEMO-F1"] = 420000.0  # we already asked this much
    assert t._target("sup:DEMO-F1", 1) >= 420000.0
