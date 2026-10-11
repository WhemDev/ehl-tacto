"""Offline provenance and dispatch-budget regressions; no hosted sessions are opened."""

import base64
import json
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from arena_kit import complete_offer
from proto.engine import Config, FACTS, Negotiator, Thread
from proto.practice import PracticeNegotiator, canonical_fact, order_unit_price


class ClaimsTests(unittest.TestCase):
    def make(self, cls=Negotiator):
        n = cls.__new__(cls)
        n.cfg = Config(safe_claims=True, facts=3, answer_plus=True, proof=True, objection_map=True)
        n.case_id = next(iter(FACTS))
        supplier = next(iter(FACTS[n.case_id]))
        n.case = {"title": "Offline enquiry", "parts": ["PH-100"], "refs": [],
                  "negotiable": ["unit_price", "volume_per_year", "contract_months"], "term_options": {},
                  "buyer": {"need_per_year": 6000, "horizon_years": 2, "reference_payment_days": 14,
                            "need_lead_time_days": 14, "freight_eur_per_unit": {"DAP": 0}}}
        n.b = n.case["buyer"]
        terms = complete_offer(n.case, {"unit_price": 1.0})
        t = Thread(supplier, [{"from": supplier, "body": "Which volume can you commit to? Send us the data.",
                               "status": "open", "term_sheets": [{"term_sheet_id": f"offer:{supplier}", "terms": terms}]}])
        n.threads = {supplier: t}
        return n, t, terms

    def text(self, msg):
        return msg.get("body", "") + "\n" + "\n".join(base64.b64decode(a["content_b64"]).decode()
                                                       for a in msg.get("attachments", []))

    def test_default_off_is_identity(self):
        n, t, _ = self.make()
        n.cfg = Config()
        msg = {"body": "Original message", "refs": []}
        self.assertIs(n.prepare_message(t, msg), msg)

    def test_sql_only_forecast_and_subclass_additions(self):
        n, t, terms = self.make(PracticeNegotiator)
        forecast = FACTS["case:D02"][next(iter(FACTS["case:D02"]))][0][0]
        with patch("proto.practice._FACT_IDS", set()), patch("proto.practice.lookup", return_value={"change_pct": 8}), patch("proto.practice.q", return_value=[]):
            self.assertIsNone(canonical_fact(forecast))
            msg = n.write(t, 1, [terms])
            msg["body"] += f"\nOur forecast ({forecast}) backs this binding volume."
            msg["refs"].append(forecast)
            msg["attachments"].append({"name": "extra.md", "content_b64": base64.b64encode(forecast.encode()).decode()})
            wire = n.prepare_message(t, msg)
        self.assertNotIn(forecast, self.text(wire))
        self.assertNotIn(forecast, wire["refs"])
        self.assertIn("Our proposed commitment", wire["body"])
        self.assertFalse(any(k.startswith("_") for k in wire))

    def test_two_source_claim_and_current_rival(self):
        n, t, terms = self.make()
        ids = [f[0] for f in FACTS[n.case_id][t.sid] if isinstance(f[0], str)][:2]
        rival_supplier = next(iter(FACTS["case:D02"]))
        rival = Thread(rival_supplier, [{"from": rival_supplier, "status": "open", "body": "", "term_sheets": [
            {"term_sheet_id": f"offer:{rival_supplier}", "terms": terms}]}])
        n.threads[rival_supplier] = rival
        rid = rival.sheets[0]["term_sheet_id"]
        n.facts_for = lambda _: [(ids, "The recorded index comparison uses both endpoints")]
        n.claim_source = lambda ref: {} if ref in ids else None
        wire = n.prepare_message(t, n.write(t, 1, [terms], (rid, terms)))
        self.assertEqual(n._message_ids(wire), set(ids + [rid]))
        again = n.prepare_message(t, n.write(t, 1, [terms], (rid, terms)))
        self.assertEqual(again["refs"], [])
        self.assertNotIn("standing", again["body"])

    def test_atomic_deferral_and_no_composition_spend(self):
        n, t, terms = self.make()
        ids = [f[0] for f in FACTS[n.case_id][t.sid] if isinstance(f[0], str)][:3]
        n.claim_source = lambda ref: {} if ref in ids else None
        n.facts_for = lambda _: [(ids[:2], "The comparison requires both sources"), (ids[2], "The next recorded reference is available")]
        draft = n.write(t, 1, [terms])
        self.assertFalse(hasattr(n, "_claim_used"))
        n._claim_used = {ids[0]}
        wire = n.prepare_message(t, draft)
        self.assertNotIn(ids[1], wire["refs"])
        self.assertIn(ids[2], wire["refs"])
        self.assertNotIn("both sources", wire["body"])

    def test_concurrent_dispatch_reserves_once(self):
        n, t, terms = self.make()
        ref = FACTS[n.case_id][t.sid][0][0]
        n.claim_source = lambda _: {}
        n.facts_for = lambda _: [(ref, "Our recorded reference supports this review")]
        drafts = [n.write(t, 1, [terms]) for _ in range(3)]
        with ThreadPoolExecutor(3) as pool:
            wires = list(pool.map(lambda msg: n.prepare_message(t, msg), drafts))
        self.assertEqual(sum(ref in wire["refs"] for wire in wires), 1)

    def test_wrong_units_and_explicit_index_rejection(self):
        self.assertIsNone(order_unit_price({"price": 1.0, "price_unit": "EUR/kg"}))
        self.assertIsNone(order_unit_price({"price": 1.0, "price_unit": "EUR/lot"}))
        self.assertEqual(order_unit_price({"price": 1.0, "price_unit": "EUR/PC"}), 1.0)
        n, t, _ = self.make()
        t.last["body"] = "That index is not applicable: our coverage is at fixed prices."
        self.assertTrue(n._index_rejected(t))

    def test_case_only_reference_does_not_assert_figures(self):
        n, t, terms = self.make()
        refs = [f[0] for f in FACTS[n.case_id][t.sid] if isinstance(f[0], str)]
        n.case["refs"] = refs
        n.claim_source = lambda _: None
        wire = n.prepare_message(t, n.write(t, 1, [terms]))
        self.assertLessEqual(len(n._message_ids(wire)), 3)
        self.assertNotIn("below", wire["body"])
        self.assertNotIn("steady", wire["body"])
        self.assertFalse(wire["attachments"])

    def test_every_available_practice_case_offline(self):
        root = Path(os.environ.get("ARENA_DATA", "data/package"))
        cases = {}

        def collect(value):
            if isinstance(value, dict):
                if value.get("case_id") and isinstance(value.get("buyer"), dict) and value.get("parts"):
                    cases[value["case_id"]] = value
                else:
                    for child in value.values():
                        collect(child)
            elif isinstance(value, list):
                for child in value:
                    collect(child)

        for path in root.rglob("*.json"):
            try:
                collect(json.loads(path.read_text()))
            except (OSError, ValueError):
                continue
        if not cases:
            self.skipTest("No offline case files in ARENA_DATA")
        for case in cases.values():
            with self.subTest(case=case["case_id"]):
                n, _, _ = self.make(PracticeNegotiator)
                n.case, n.case_id, n.b = case, case["case_id"], case["buyer"]
                n.threads = {}
                price = n.b.get("current_unit_price") or n.b["fallback_unit_price"]
                terms = complete_offer(case, {"unit_price": price})
                for supplier in case["suppliers"]:
                    n.threads[supplier] = Thread(supplier, [{"from": supplier, "body": "Which volume? Send us the data.",
                        "status": "open", "term_sheets": [{"term_sheet_id": f"offer:{supplier}", "terms": terms}]}])
                jobs = [(t, n.write(t, 1, [terms])) for t in n.threads.values()]
                with ThreadPoolExecutor(len(jobs)) as pool:
                    wires = list(pool.map(lambda job: n.prepare_message(*job), jobs))
                spent = set()
                for wire in wires:
                    ids = n._message_ids(wire)
                    self.assertLessEqual(len(ids), 3)
                    self.assertFalse(ids & spent)
                    self.assertEqual(ids, set(wire["refs"]))
                    for ref in ids:
                        self.assertTrue(n.claim_source(ref) is not None or ref in case.get("refs", []))
                    spent.update(ids)
                    self.assertFalse(any(k.startswith("_") for k in wire))


if __name__ == "__main__":
    unittest.main()
