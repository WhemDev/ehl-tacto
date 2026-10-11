"""Offline single-supplier regression tests; no hosted sessions or data IDs."""

import unittest
from dataclasses import replace

from arena_kit import must_haves_ok

from proto.engine import Config, Negotiator, Thread


class Client:
    def __init__(self, engine, replies):
        self.engine = engine
        self.replies = list(replies)
        self.messages = []
        self.events = list(engine.thread.events)
        self.result = None
        self.fail_close = False
        self.direct_result = False
        self.seconds_left = 60
        self.serial = 0

    def quote(self, price, status="open", lead=1):
        self.serial += 1
        return {"from": self.engine.thread.sid, "status": status, "body": "",
                "term_sheets": [{"term_sheet_id": str(self.serial),
                                 "terms": {"unit_price": price, "lead_time_days": lead}}]}

    def session(self, sid):
        return {"status": "ended" if self.result is not None else "open", "result": self.result,
                "threads": {self.engine.thread.sid: {"closed": self.result is not None,
                                                    "seconds_left": self.seconds_left}}}

    def thread(self, sid, supplier):
        return {"messages": self.events, "closed": self.result is not None}

    def send_message(self, sid, supplier, msg):
        self.messages.append(msg)
        self.events.append({**msg, "from": "buyer"})
        action = (msg.get("action") or {}).get("type")
        if action == "walk_away":
            self.result = {"deal": False, "score": 0.0}
            return {"result": self.result}
        if action == "accept":
            if self.fail_close:
                self.fail_close = False
                reply = self.quote(0.98)
                self.events.append(reply)
                return reply  # models T2 returning None after an unsuccessful close
            self.result = {"deal": True, "score": 1.0, "terms": self.engine.thread.sheets[0]["terms"]}
            return {"result": self.result}
        if self.direct_result:
            self.result = {"deal": True, "score": 1.0}
            return {"result": self.result}
        if not msg.get("term_sheets"):
            self.engine.trace.append("probe_reply")
            reply = self.quote(0.98)
        else:
            price, status, lead = self.replies.pop(0)
            reply = self.quote(price, status, lead)
            if status == "walked_away":
                self.result = {"deal": False, "score": 0.0}
        self.events.append(reply)
        return reply


class Engine(Negotiator):
    def __init__(self, replies, cfg=None, outside=1.20, valid=True, limit=10):
        self.cfg = cfg or Config(safe_single=True, e=2, T=4, anchor=-0.03, meso_n=2,
                                 hold_gave=0.005, push="rfq")
        self.case = {"title": "Synthetic negotiation", "round_limit": limit,
                     "negotiable": ["unit_price", "lead_time_days"],
                     "term_options": {"lead_time_days": [1, 2]},
                     "buyer": {"need_per_year": 100, "horizon_years": 1, "reference_payment_days": 1,
                               "need_lead_time_days": 1, "fallback_unit_price": outside,
                               "interest_rate": 0, "freight_eur_per_unit": {"DAP": 0},
                               "must_haves": [{"field": "lead_time_days", "op": "<=", "value": 1}]}}
        opening = {"from": "supplier", "status": "open", "body": "",
                   "term_sheets": [{"term_sheet_id": "0", "terms": {"unit_price": 1.0,
                                                                                "lead_time_days": 1 if valid else 2}}]}
        self.thread = Thread(opening["from"], [opening])
        self.threads = {self.thread.sid: self.thread}
        self.b = self.case["buyer"]
        self.alt = {"terms": {"unit_price": outside, "lead_time_days": 1}}
        self.c_alt, self.c_open, self.target_c = 100 * outside, 100.0, 85.0
        self.sid, self.deadline, self.slowest = "session", None, 0.0
        self.log, self.trace, self.priced_rounds = [], [], []
        self.c = Client(self, replies)
        self.repeat = False
        self.force_repair = False
        self.probe_enabled = False

    def note(self, kind, **kw):
        self.log.append({"kind": kind, **kw})

    def C(self, thread, terms):
        return 100 * terms["unit_price"]

    def _estimate(self):
        self.trace.append("estimate")

    def near_cap(self):
        return False

    def recalled(self, thread):
        return []

    def meso(self, thread, goal):
        self.trace.append("meso")
        if self.force_repair:
            return []
        price = 0.85 if self.repeat else round(goal / 100, 4)
        return [{"unit_price": price, "lead_time_days": 1},
                {"unit_price": round(price * (1 - 0.03), 4), "lead_time_days": 1}][:self.cfg.meso_n]

    def fallback_counter(self, thread):
        return [{"unit_price": thread.sheets[0]["terms"]["unit_price"], "lead_time_days": 1}]

    def calibration_probe(self, thread):
        if self.probe_enabled:
            return {"subject": self.case["title"], "body": "Please explain the cost drivers.", "refs": []}
        return None

    def write(self, thread, rnd, sheets, rival=None):
        self.priced_rounds.append(rnd)
        return {"subject": self.case["title"], "body": "Proposal", "refs": [],
                "term_sheets": [{"terms": terms} for terms in sheets]}

    def close(self, thread, sheet):
        if not must_haves_ok(self.case, sheet["terms"], thread.std):
            raise AssertionError("attempted to close invalid terms")
        reply = self.c.send_message(self.sid, thread.sid,
                                    {"action": {"type": "accept", "term_sheet_id": sheet["term_sheet_id"]}})
        return reply.get("result")


def conceding():
    return [(0.95, "open", 1), (0.92, "open", 1), (0.91, "open", 1), (0.91, "final_offer", 1)]


class SafeSingleTests(unittest.TestCase):
    def proposals(self, engine):
        return [msg for msg in engine.c.messages if msg.get("term_sheets")]

    def test_expensive_outside_closes_at_threshold_without_fourth_counter(self):
        engine = Engine(conceding())
        result = engine.run()
        self.assertTrue(result["deal"])
        self.assertEqual(len(self.proposals(engine)), 3)
        self.assertEqual(engine.priced_rounds, [0, 1, 2])
        self.assertTrue(all(len(msg["term_sheets"]) == engine.cfg.meso_n for msg in self.proposals(engine)))
        self.assertFalse(any(row["kind"] == "hold" for row in engine.log))

    def test_useful_outside_retains_backed_hold(self):
        engine = Engine(conceding(), outside=0.99)
        self.assertTrue(engine.run()["deal"])
        self.assertEqual(len(self.proposals(engine)), 4)
        self.assertEqual(sum(row["kind"] == "hold" for row in engine.log), 1)

    def test_invalid_outside_is_not_backing(self):
        engine = Engine(conceding(), outside=0.99)
        engine.alt["terms"]["lead_time_days"] = 2
        self.assertTrue(engine.run()["deal"])
        self.assertEqual(len(self.proposals(engine)), 3)
        self.assertFalse(any(row["kind"] == "hold" for row in engine.log))

    def test_repeated_package_closes_primary_without_blanket_early_acceptance(self):
        engine = Engine([(0.95, "open", 1)])
        engine.repeat = True
        self.assertTrue(engine.run()["deal"])
        self.assertEqual(len(self.proposals(engine)), 1)
        self.assertTrue(any(row.get("why") == "repeated package" for row in engine.log))

    def test_no_valid_offer_keeps_repair_available_under_turn_guard(self):
        engine = Engine([(0.95, "agreed", 1)], valid=False)
        engine.force_repair = True
        engine.c.seconds_left = 0
        self.assertTrue(engine.run()["deal"])
        proposal = self.proposals(engine)[0]
        self.assertTrue(must_haves_ok(engine.case, proposal["term_sheets"][0]["terms"]))
        self.assertTrue(any(row["kind"] == "fallback_counter" for row in engine.log))

    def test_recoverable_close_refreshes_and_keeps_total_send_budget(self):
        engine = Engine([(0.95, "agreed", 1)], limit=3)
        engine.c.fail_close = True
        result = engine.run()
        self.assertTrue(result["deal"])
        self.assertEqual(result["terms"]["unit_price"], 0.98)
        self.assertEqual(len(engine.c.messages), engine.case["round_limit"])
        self.assertEqual(len(self.proposals(engine)), 1)
        self.assertFalse(any((msg.get("action") or {}).get("type") == "walk_away" for msg in engine.c.messages))

    def test_probe_counts_but_first_priced_round_remains_zero(self):
        engine = Engine(conceding())
        engine.probe_enabled = True
        self.assertTrue(engine.run()["deal"])
        self.assertFalse(engine.c.messages[0].get("term_sheets"))
        self.assertEqual(engine.priced_rounds[0], 0)
        self.assertEqual(engine.trace[:3], ["probe_reply", "estimate", "meso"])
        self.assertEqual(len(engine.c.messages), len(self.proposals(engine)) + 2)

    def test_ordinary_send_propagates_terminal_result(self):
        engine = Engine([])
        engine.c.direct_result = True
        self.assertTrue(engine.run()["deal"])
        self.assertEqual(len(engine.c.messages), 1)

    def test_ended_thread_returns_session_result_without_walk(self):
        engine = Engine([(0.95, "walked_away", 1)])
        self.assertEqual(engine.run(), {"deal": False, "score": 0.0})
        self.assertEqual(len(engine.c.messages), 1)

    def test_unbacked_final_offer_is_not_pushed_even_with_push_all(self):
        cfg = replace(Config(safe_single=True, e=2, anchor=-0.03), push="all")
        engine = Engine([(0.95, "final_offer", 1)], cfg=cfg)
        self.assertTrue(engine.run()["deal"])
        self.assertEqual(len(self.proposals(engine)), 1)
        self.assertEqual(engine.thread.pushes, 0)

    def test_flag_defaults_off(self):
        self.assertFalse(Config().safe_single)


if __name__ == "__main__":
    unittest.main()
