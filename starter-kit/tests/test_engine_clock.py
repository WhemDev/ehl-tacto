"""Bug #9: the supplier's 60-second clock runs from its reply. A best final offer is accepted at once (a rival's reply
already in flight gets a short grace), and a reply's attachments never delay the reply itself."""

import json
import threading
import time
from dataclasses import replace
from pathlib import Path

import proto.engine as eng
from arena_kit.agents.hybrid import _negotiator
from arena_kit.events import RecordingTable
from proto.variants import VARIANTS

CASE = json.loads((Path(__file__).resolve().parents[1] / "cases" / "D02.json").read_text(encoding="utf-8"))
J1, C1 = "sup:DEMO-J1", "sup:DEMO-C1"


def quote(sid, price, n=0, status="open", pay=30, lead=35, inco="FCA"):
    terms = {"unit_price": price, "payment_days": pay, "lead_time_days": lead, "incoterm": inco}
    return {"from": f"sales@{sid}", "status": status, "body": "Hello", "attachments": [],
            "term_sheets": [{"term_sheet_id": f"offer:{sid}-{n}", "terms": terms}]}


class Arena:
    """Two suppliers. J1 goes final on our second message; C1's replies from the second on take `slow` seconds."""

    def __init__(self, slow=0.0):
        self.slow, self.sent, self.log, self.lock = slow, {J1: 0, C1: 0}, [], threading.Lock()

    def _ctx(self):
        pass

    def open_session(self, case_id):
        return {"session_id": "s1", "case": CASE,
                "threads": {J1: [quote(J1, 17.1)], C1: [quote(C1, 16.0, pay=45, inco="EXW")]}}

    def attachment(self, session_id, attachment_id):  # a cost breakdown: the engine's floor for this supplier
        return b"| BAR-316L (material) | 5.56 |\nMaterial accounts for about 45 % of our cost"

    def session(self, session_id):
        return {"status": "open"}

    def thread(self, session_id, supplier_id):
        raise AssertionError("no resync expected")

    def send_message(self, session_id, sup, msg):
        now = time.monotonic()
        if msg.get("action"):
            with self.lock:
                self.log.append(("accept", sup, now))
            return {"result": {"deal": True, "supplier_id": sup, "score": 0.7, "terms": {}}}
        with self.lock:
            self.sent[sup] += 1
            k = self.sent[sup]
            self.log.append(("msg", sup, now))
        if sup == J1:
            return quote(J1, 15.2, n=1) if k == 1 else quote(J1, 13.9, n=k, status="final_offer", pay=14, lead=28)
        if k >= 2:
            time.sleep(self.slow)
        return quote(C1, 15.8 if k == 1 else 15.2, n=k, pay=14)


def cfg():
    return replace(VARIANTS["A9"][1], pushes=0, rfq_pushes=0)  # no pushes: the accept's timing is what we test


def test_a_best_final_offer_waits_at_most_the_grace_for_a_rivals_reply_in_flight(monkeypatch):
    monkeypatch.setattr(eng, "FINAL_GRACE_S", 1.0)
    arena = Arena(slow=6.0)
    res = eng.Negotiator(arena, "case:D02", cfg(), quiet=True).run()
    assert res["supplier_id"] == J1
    final_at = [t for k, s, t in arena.log if k == "msg" and s == J1][1]  # its final offer answers at once
    accept_at = next(t for k, s, t in arena.log if k == "accept")
    c1_sent = [t for k, s, t in arena.log if k == "msg" and s == C1]
    assert accept_at - final_at < 4.5  # the grace plus one wait cycle, not a 90-second rest
    assert c1_sent and accept_at < c1_sent[-1] + arena.slow  # C1's reply was still in flight


def test_a_best_final_offer_is_accepted_at_once_when_no_rival_reply_is_pending():
    arena = Arena(slow=0.0)
    res = eng.Negotiator(arena, "case:D02", cfg(), quiet=True).run()
    assert res["supplier_id"] == J1
    final_at = [t for k, s, t in arena.log if k == "msg" and s == J1][1]
    accept_at = next(t for k, s, t in arena.log if k == "accept")
    assert accept_at - final_at < 4.5


def test_the_engines_reply_attachments_load_in_the_background():
    class Slow(Arena):
        def attachment(self, session_id, attachment_id):
            time.sleep(0.8)
            return super().attachment(session_id, attachment_id)

    arena = Slow()
    n = _negotiator("case:D02")(arena, "case:D02", cfg(), quiet=True)
    before = n.target_c
    reply = {"from": "sales", "status": "open", "term_sheets": [],
             "attachments": [{"attachment_id": "att:9", "name": "breakdown.txt"}]}
    n.threads[J1].events.append(reply)
    t0 = time.monotonic()
    n._docs([reply])
    assert time.monotonic() - t0 < 0.3  # the reply is acted on now, the document arrives later
    for _ in range(60):
        if "text" in reply["attachments"][0] and n.target_c != before:
            break
        time.sleep(0.05)
    assert "Material accounts" in reply["attachments"][0]["text"]
    assert n.target_c != before  # the material share re-estimated J1's floor


def test_the_recorder_hands_a_reply_over_before_its_attachments_when_asked():
    class Table:
        session_id = "s1"
        client = None

        def __init__(self):
            self.fetched = []

        def send(self, sid, msg):
            return {"from": "sales", "status": "open", "term_sheets": [],
                    "attachments": [{"attachment_id": "att:1", "name": "note.txt"}]}

        def attachment(self, attachment_id):
            self.fetched.append(attachment_id)
            return b"text"

    eager = RecordingTable(Table())
    eager.send("sup:X", {"body": "hi"})
    assert eager._t.fetched == ["att:1"]  # the kit's play() reads the text right after send
    lazy = RecordingTable(Table())
    lazy.eager_documents = False
    reply = lazy.send("sup:X", {"body": "hi"})
    assert lazy._t.fetched == [] and "text" not in reply["attachments"][0]
