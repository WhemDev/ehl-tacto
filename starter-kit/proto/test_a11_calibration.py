"""Offline tests for evidence-gated first anchors; no arena sessions or data IDs."""

import time
import unittest
from dataclasses import replace
from unittest.mock import Mock, patch

from proto.engine import Config, Negotiator, Thread
from proto.practice import PracticeNegotiator


class CalibrationTests(unittest.TestCase):
    def make(self, count=1, cls=Negotiator, goal="leverage", **flags):
        n = cls.__new__(cls)
        n.cfg = replace(Config(e=2, anchor=-0.03, target_prior=True, calibrated_anchor=True, anchor_probe=True), **flags)
        n.b = {"category_goal": goal, "need_per_year": 1, "horizon_years": 1,
               "reference_payment_days": 30, "need_lead_time_days": 10,
               "freight_eur_per_unit": {"DAP": 0}, "interest_rate": 0.08,
               "fallback_unit_price": 120, "sustainable_margin_pct": 5}
        n.case = {"title": "Calibration fixture", "parts": ["part"], "buyer": n.b,
                  "negotiable": ["unit_price"], "fixed_terms": {}, "term_options": {}, "round_limit": 10}
        n.c, n.sid, n.case_id = Mock(), "session", "fixture"
        n.quiet, n.log, n.relationship = True, [], False
        n.deadline, n.slowest, n.c_open, n.c_alt = time.time() + 480, 0, 100, float("inf")
        n.threads = {}
        for index in range(count):
            sid = str(index)
            t = Thread(sid, [{"from": "supplier", "status": "open", "body": "Opening quote",
                              "term_sheets": [{"terms": {"unit_price": 100}}]}])
            t.std = {"payment_days": 30, "incoterm": "DAP", "lead_time_days": 10}
            t.est = {"standard": t.std, "interest_rate": 0.1, "floor": 85,
                     "basis": "prior: 85 % of the lowest opening price", "source_kind": "opening_prior",
                     "confidence": 0.25, "evidence_resolved": False, "opening_c": 100,
                     "evidence_target_c": 85}
            n.threads[sid] = t
        n.target_c, n.target_sup, n.target_terms = 85, "0", {"unit_price": 85}
        n.c.session.return_value = {"status": "open", "threads": {
            sid: {"seconds_left": 55, "closed": False} for sid in n.threads}}
        return n

    def reply(self, t, body):
        r = {"from": "supplier", "status": "open", "body": body,
             "term_sheets": [{"terms": {"unit_price": 100}}]}
        t.events.append(r)
        return r

    def discover(self, n, t, body="No cost data is available"):
        msg = n.calibration_probe(t)
        self.assertIsNotNone(msg)
        self.assertEqual(msg["refs"], [])
        self.assertEqual(msg["term_sheets"], [])
        self.assertNotRegex(msg["body"], r"\d|€|EUR")
        n._reserve_calibration(t, msg, probe=True)
        n._resolve_calibration(t, self.reply(t, body))
        return msg

    def test_flags_off_preserve_legacy_start_and_metadata(self):
        n = self.make(calibrated_anchor=False, anchor_probe=False)
        t = n.threads["0"]
        self.assertIsNone(n.calibration_probe(t))
        self.assertAlmostEqual(n.goal(0, t), 85 * 0.97)
        n._estimate()
        self.assertNotIn("confidence", t.est)
        self.assertNotIn("source_kind", t.est)
        self.assertNotIn("evidence_resolved", t.est)

    def test_no_data_boost_is_bounded_and_first_start_is_frozen(self):
        n = self.make(anchor=-0.08)
        t = n.threads["0"]
        self.discover(n, t)
        self.assertEqual(t.anchor_probe_outcome, "no_data")
        self.assertIsNone(n.calibration_probe(t))
        existing = 85 * 0.92
        start = n.goal(0, t)
        self.assertAlmostEqual(start, existing - min(0.15 * (100 - existing), 3))
        n._reserve_calibration(t, {"term_sheets": [{"terms": {"unit_price": start}}]})
        n.target_c = 70
        self.assertAlmostEqual(n.goal(0, t), start)
        self.assertEqual(sum(e["kind"] == "first_priced_ask" for e in n.log), 1)

    def test_partial_rfq_discovery_and_pending_requests_prevent_boost(self):
        n = self.make(count=2)
        a, b = n.threads.values()
        self.discover(n, a)
        self.assertAlmostEqual(n.goal(0, a), 85 * 0.97)
        msg = n.calibration_probe(b)
        n._reserve_calibration(b, msg, probe=True)
        self.assertAlmostEqual(n.goal(0, a), 85 * 0.97)
        self.assertIsNone(n.calibration_probe(b))

    def test_deferred_breakdown_prevents_boost_before_first_proposal(self):
        n = self.make(count=2)
        a, b = n.threads.values()
        self.discover(n, a)
        before = n.goal(0, a)
        self.assertAlmostEqual(before, 85 * 0.97)
        self.discover(n, b, "| Material | 30 |\n| Labour | 30 |\n| Conversion | 30 |")
        n._estimate()
        self.assertEqual(b.est["source_kind"], "own_breakdown")
        self.assertTrue(b.est["evidence_resolved"])
        self.assertAlmostEqual(n.goal(0, a), n.target_c * 0.97)
        msg = {"term_sheets": [{"terms": {"unit_price": n.goal(0, a)}}]}
        n._reserve_calibration(a, msg)
        self.assertFalse(any(e.get("reason") == "completed_weak_evidence_discovery" for e in n.log))

    def test_refusal_and_plain_reply_resolve_discovery_without_reasking(self):
        for body, outcome in (("We cannot share confidential costs", "refused"),
                              ("We can price the allowed terms", "reply")):
            with self.subTest(outcome=outcome):
                n = self.make()
                t = n.threads["0"]
                self.discover(n, t, body)
                self.assertEqual(t.anchor_probe_outcome, outcome)
                self.assertIsNone(n.calibration_probe(t))
                n.facts_for = lambda thread: []
                msg = n.write(t, 0, [{"unit_price": 85}])
                self.assertNotIn("Could you also send us your cost breakdown", msg["body"])

    def test_wave_reserve_slots_and_authoritative_thread_clock(self):
        for setup in ("short_wave", "slow_exchange", "few_slots", "late_thread", "unknown_wave"):
            with self.subTest(setup=setup):
                n = self.make()
                t = n.threads["0"]
                if setup == "short_wave":
                    n.deadline = time.time() + 179
                elif setup == "slow_exchange":
                    n.slowest, n.deadline = 100, time.time() + 259
                elif setup == "few_slots":
                    n.case["round_limit"] = 2
                elif setup == "late_thread":
                    n.c.session.return_value["threads"][t.sid]["seconds_left"] = 10
                else:
                    n.deadline = None
                self.assertIsNone(n.calibration_probe(t))
                self.assertAlmostEqual(n.goal(0, t), 85 * 0.97)

    def test_narrow_supplier_evidence_suppresses_prior_and_limits_anchor(self):
        n = self.make(goal="routine", anchor=-0.08)
        t = n.threads["0"]
        t.est.update(source_kind="supplier_should_cost", confidence=0.85,
                     basis="should-cost 98 (this supplier)", evidence_resolved=True, evidence_target_c=98)
        n.target_c = 98
        self.assertAlmostEqual(n.goal(0, t), 97.5)
        self.assertIsNone(n.calibration_probe(t))
        self.assertTrue(any(e.get("reason") == "room_prior_suppressed_by_supplier_specific_evidence" for e in n.log))
        t.est.update(source_kind="opening_prior", confidence=0.25)
        self.assertIsNone(n._narrow_room(t))

    def test_conflicting_should_cost_keeps_source_and_immutable_opening_cap(self):
        n = self.make(cls=PracticeNegotiator)
        t = n.threads["0"]
        n._opening_terms(t)
        self.reply(t, "A lower negotiated quote") ["term_sheets"][0]["terms"]["unit_price"] = 90
        with patch("proto.practice.q", return_value=[{"unit_cost": 120, "supplier_id": t.sid}]), \
                patch("proto.practice.cash_rate", return_value=0.1):
            n._estimate()
        self.assertEqual(t.est["source_kind"], "supplier_should_cost")
        self.assertEqual(t.est["raw_floor"], 120)
        self.assertEqual(t.est["floor"], round(100 / 1.05, 2))
        self.assertLess(t.est["confidence"], 0.7)
        self.assertTrue(t.est["source_conflict"])
        self.assertFalse(t.est["evidence_resolved"])
        self.assertTrue(any(e["kind"] == "estimate_conflict" for e in n.log))

    def test_no_expansion_for_other_goals_or_disabled_probe(self):
        for goal in ("routine", "quality_first", "secure_supply", "stabilise"):
            n = self.make(goal=goal)
            t = n.threads["0"]
            t.anchor_probe_state = "done"
            self.assertAlmostEqual(n.goal(0, t), 85 * 0.97)
        n = self.make(anchor_probe=False, lev_room_boost=1.3)
        self.assertAlmostEqual(n.goal(0, n.threads["0"]), 85 * 0.97)


if __name__ == "__main__":
    unittest.main()
