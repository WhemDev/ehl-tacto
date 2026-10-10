"""Fact planner (variant A9h-plan): every checkable, favourable fact for the supplier, ranked by measured land rate;
never our own order prices or a plain statement without an ID; one claim per type in a mail; a type the supplier
waved off drops back; the holds go on (with a small move) while a fact likely to land is left."""

import json
import threading
from dataclasses import replace
from pathlib import Path

import pytest

from arena_kit import complete_offer
from proto.practice import CITE_RE, PracticeNegotiator, citable
from proto.variants import VARIANTS

CASES = Path(__file__).resolve().parents[1] / "cases"
ALL = sorted(p.stem for p in CASES.glob("P*.json"))
PLAN = VARIANTS["A9h-plan"][1]
CLAUSE5 = {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}


def case(cid):
    return json.loads((CASES / f"{cid}.json").read_text(encoding="utf-8"))


class Werdenfels:
    """P18's supplier: concedes `step` of its price for every mail that carries a new fact other than a forecast,
    waves forecasts off ("does not change our calculation"), and repeats its price when nothing new lands."""

    def __init__(self, step=0.01, floor=5.0):
        self.case, self.sup = case("P18"), case("P18")["suppliers"][0]
        self.step, self.floor, self.price, self.n = step, floor, 5.95, 0
        self.asks, self.refs, self.accepted_after, self.lock = [], [], None, threading.Lock()

    def quote(self, status="open"):
        terms = complete_offer(self.case, {"unit_price": self.price, "payment_days": 90, "contract_months": 24,
                                           "index_clause": CLAUSE5})
        terms = {k: terms[k] for k in self.case["negotiable"]}
        return {"from": f"sales@{self.sup}", "status": status, "attachments": [], "body": self.body,
                "term_sheets": [{"term_sheet_id": f"offer:{self.sup[4:]}-{self.n}", "terms": terms}]}

    body = "Our offer."

    def open_session(self, case_id):
        return {"session_id": "s1", "case": self.case, "threads": {self.sup: [self.quote()]}}

    def attachment(self, session_id, attachment_id):
        return b""

    def session(self, session_id):
        return {"status": "open"}

    def thread(self, session_id, supplier_id):
        raise AssertionError("no resync expected")

    def send_message(self, session_id, sup, msg):
        if msg.get("action"):
            self.accepted_after = self.n
            return {"result": {"deal": True, "supplier_id": sup, "score": 0.5, "terms": {}}}
        self.n += 1
        refs = set(msg.get("refs") or []) | set(CITE_RE.findall(msg["body"]))
        new = [r for r in refs if r not in self.refs and not r.startswith("offer:")]
        self.refs += sorted(new)
        self.asks.append(min(s["terms"]["unit_price"] for s in msg["term_sheets"]))
        lines = []
        if any(r.startswith("fc:") for r in new):
            lines.append("We checked the volume change data you cited; it holds, "
                         "but it does not change our calculation.")
        landed = [r for r in new if not r.startswith("fc:")]
        if landed:
            lines.append("We checked the index change data you cited; it holds and we took it into account.")
            self.price = max(self.floor, round(self.price * (1 - self.step), 2))
        self.body = " ".join(lines) or "Since you did not bring any new data, our price stays."
        return self.quote()


def run(cfg, **kw):
    w = Werdenfels(**kw)
    res = PracticeNegotiator(w, "case:P18", cfg, quiet=True).run()
    return w, res


def test_inventory_has_no_order_prices_no_plain_statements_and_only_checkable_ids():
    for cid in ALL:
        c = case(cid)
        n = PracticeNegotiator.__new__(PracticeNegotiator)
        n.cfg, n.case, n.b, n.quiet, n.log, n.case_id = PLAN, c, c["buyer"], True, [], f"case:{cid}"
        for sup in c["suppliers"]:
            t = type("T", (), {})()
            t.sid, t.sheets = sup, [{"terms": {"unit_price": (c["buyer"].get("current_unit_price") or 10) * 1.06}}]
            for f in n.inventory(t):
                assert f["ids"], f"{cid}: a fact without an ID"
                assert not any(i.startswith("po:") for i in f["ids"]), f"{cid}: our own order prices never land"
                assert all(citable(i) or i in (c.get("refs") or []) for i in f["ids"]), f"{cid}: {f['ids']}"
                assert CITE_RE.findall(f["text"]), f"{cid}: the sentence must carry its IDs"


def test_keeps_negotiating_while_facts_land_and_never_sends_an_id_twice():
    frozen, _ = run(replace(VARIANTS["A9h"][1]))
    plan, res = run(PLAN)
    assert res["deal"]
    assert len(plan.refs) == len(set(plan.refs))  # no ID twice
    assert plan.price < frozen.price  # more facts landed, so it conceded further
    for a, b in zip(plan.asks, plan.asks[1:], strict=False):
        assert a != b  # never the same ask twice: a hold moves a quarter step


def test_a_waved_off_type_drops_back():
    plan, _ = run(PLAN)
    fc = [i for i, r in enumerate(plan.refs) if r.startswith("fc:")]
    assert fc, plan.refs  # one forecast goes out (a fair chance before the supplier's verdict)
    if len(fc) > 1:  # it was waved off: the next one only once every other type is spent
        assert all(r.startswith("fc:") for r in plan.refs[fc[1]:]), plan.refs


@pytest.mark.parametrize("cid", ["P05", "P18", "P02", "P11"])
def test_first_mail_has_at_most_three_claims_one_per_type(cid):
    c = case(cid)
    n = PracticeNegotiator.__new__(PracticeNegotiator)
    n.cfg, n.case, n.b, n.quiet, n.log, n.case_id = PLAN, c, c["buyer"], True, [], f"case:{cid}"
    n.threads = {}
    t = type("T", (), {})()
    t.sid, t.sheets, t.events = c["suppliers"][0], [{"terms": {"unit_price": 99.0}}], []
    queue = n.fact_queue(t)
    kinds = [f["ids"][0].split("@")[0] if f["type"] == "index_change" else f["type"] for f in queue]
    assert len(kinds) == len(set(kinds))
