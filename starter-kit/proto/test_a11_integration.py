"""Offline A11 contracts and release evidence gate; importing never opens a session.

Run syntax/import checks and default-off fixtures first, then all task tests and
combined faults, proto/smoke.py on 19 files, and generic sandbox comparisons.
Only then spend hosted quota: robustness, clause check, complete measured run.
D01 needs at least one attempt and D02 four per comparison configuration.
Use temporary dataclasses.replace ablations, not additional permanent variants.

Contracts owned elsewhere: close/closing_move -> terminal result or None;
terminal_result(response) -> real terminal result or None;
turn_remaining(thread) -> conservative seconds;
prepare_message(thread, message) -> finalized dispatch message;
calibration_probe(thread) -> optional discovery message.
T3 owns thread revisions and opening snapshots. Messages have no timestamps.

    PYTHONPATH=. python -m unittest proto.test_a11_integration -v
    PYTHONPATH=. python -m proto.test_a11_integration --report evidence.json

The report command exits unsuccessfully for missing or failed evidence. Its JSON
input has checks and attempts; every attempt includes phase, variant, case,
result, arena_status, arena_result, claims, unsupported_citations,
invalid_acceptances, duplicate_in_flight, late_actions, max_turn_age and elapsed.
Phases are sandbox_single, sandbox_rfq, robustness, clause and measured.
Include unsuccessful attempts too; an absent real result contributes zero.
"""

import copy
import json
import math
import sys
import threading
import time
import unittest
from collections import Counter
from dataclasses import asdict, fields, replace
from pathlib import Path
from unittest.mock import patch

import proto.engine as eng
from arena_kit import ArenaError, must_haves_ok
from proto.practice import PracticeNegotiator
from proto.variants import VARIANTS

FLAGS = ("resilient_rfq", "safe_close", "arena_clock_guard", "safe_claims",
         "safe_single", "clause_explore", "calibrated_anchor", "anchor_probe")


class Clock:
    """Virtual delays expose stale clocks without slowing the free test path."""
    def __init__(self):
        self.now, self.calls = 0.0, 0
        self.lock = threading.RLock()

    def time(self):
        with self.lock:
            self.calls += 1
            if self.calls > 5000:
                raise AssertionError("decision loop did not terminate")
            return self.now

    monotonic = time
    perf_counter = time

    def advance(self, seconds):
        with self.lock:
            self.now += seconds

    def sleep(self, seconds):
        if not 0 <= seconds <= 2:
            raise AssertionError("unbounded worker sleep")
        self.advance(seconds)
        self.time()
        time.sleep(0)  # yield to another worker without adding a real delay


class StaleOffer(ArenaError):
    def __init__(self):
        self.status, self.detail = 422, "not a standing offer"
        Exception.__init__(self, self.detail)


class FixtureNegotiator(PracticeNegotiator):
    """Use the generic wording/dispatch path without opening a data package."""
    def _estimate(self):
        eng.Negotiator._estimate(self)

    def facts_for(self, t):
        return []


class Client:
    """A small arena with primary IDs, timeouts and independently stored results."""
    def __init__(self, clock, fault=None, count=1):
        self.clock, self.fault = clock, fault
        self.lock = threading.RLock()
        self.wire, self.active, self.used = [], set(), set()
        self.result, self.injected, self.expired = None, False, False
        self.budget = 60
        price = float(eng.Config().T)
        self.case = {
            "case_id": "fixture", "title": "Fixture", "parts": ["fixture"],
            "type": "renewal", "suppliers": [f"thread:{i}" for i in range(count)],
            "refs": [], "round_limit": 10, "negotiable": ["unit_price"],
            "term_options": {}, "fixed_terms": {},
            "buyer": {"category_goal": "routine", "need_per_year": 12,
                      "horizon_years": 1, "fallback_unit_price": price * 2,
                      "reference_payment_days": 30, "need_lead_time_days": 30,
                      "interest_rate": 0, "freight_eur_per_unit": {"DAP": 0},
                      "must_haves": [{"field": "unit_price", "op": "<=", "value": price}]}}
        agreed = fault in ("stale", "unsafe_stale", "nonterminal_accept", "agreed")
        self.history, self.revisions = {}, {}
        for sid in self.case["suppliers"]:
            self.revisions[sid] = 0
            self.history[sid] = [self.message(sid, {"unit_price": price}, "agreed" if agreed else "open")]
        if fault == "alternative_terminal":
            sid = self.case["suppliers"][0]
            self.history[sid][-1]["term_sheets"].append({
                "term_sheet_id": self.offer_id(sid) + "-a",
                "terms": {"unit_price": price * (1 - eng.Config().push_pct)}})

    def offer_id(self, sid):
        return f"offer:{sid.split(':')[-1]}-{self.revisions[sid]}"

    def message(self, sid, terms, status):
        return {"from": sid, "message_id": "msg:" + self.offer_id(sid),
                "body": "Here is our offer.", "status": status, "refs": [],
                "attachments": [], "claim_results": [],
                "term_sheets": [{"term_sheet_id": self.offer_id(sid), "terms": copy.deepcopy(terms)}]}

    def opening(self):
        return {s: copy.deepcopy(events) for s, events in self.history.items()}

    def open_session(self, case_id):
        return {"session_id": "fixture-session", "case": copy.deepcopy(self.case), "threads": self.opening()}

    def session(self, sid):
        return {"session_id": sid, "status": "ended" if self.result is not None else "open",
                "result": copy.deepcopy(self.result),
                "threads": {s: {"offer_id": self.offer_id(s), "closed": self.result is not None,
                                "status": self.history[s][-1]["status"],
                                "seconds_left": None if self.result is not None else (0 if self.expired else self.budget)}
                            for s in self.history}}

    def thread(self, sid, supplier):
        with self.lock:
            timeouts = []
            if self.expired:
                terms = self.history[supplier][-1]["term_sheets"][0]["terms"]
                self.revisions[supplier] += 1
                reply = self.message(supplier, terms, "open")
                self.history[supplier].append(reply)
                timeouts.append({"offer_id": self.offer_id(supplier), "round": self.revisions[supplier],
                                 "status": "open", "terms": copy.deepcopy(terms),
                                 "alternatives": [], "text": reply["body"]})
                self.expired = False
            return {"closed": self.result is not None, "messages": copy.deepcopy(self.history[supplier]),
                    "offer_id": self.offer_id(supplier), "supplier_id": supplier,
                    "status": self.history[supplier][-1]["status"], "timeouts": timeouts}

    def terminal(self, supplier, terms):
        self.result = {"deal": True, "supplier_id": supplier, "terms": copy.deepcopy(terms),
                       "score": 1.0, "c_open": 12 * float(eng.Config().T),
                       "c_deal": 12 * terms["unit_price"], "c_best": 12 * terms["unit_price"]}
        return {"status": "ended", "result": copy.deepcopy(self.result)}

    def send_message(self, sid, supplier, msg):
        with self.lock:
            if self.result is not None:
                raise AssertionError("action after a terminal response")
            if supplier in self.active:
                raise AssertionError("duplicate in-flight action")
            if self.expired:
                raise AssertionError("dispatch before overdue turn was resynchronized")
            self.active.add(supplier)
            self.wire.append((supplier, copy.deepcopy(msg)))
        try:
            with self.lock:
                action = msg.get("action", {}).get("type")
                if action == "walk_away":
                    raise AssertionError("discarded an available valid deal")
                if action == "accept":
                    if self.fault in ("stale", "unsafe_stale") and not self.injected:
                        self.injected = True
                        terms = copy.deepcopy(self.history[supplier][-1]["term_sheets"][0]["terms"])
                        if self.fault == "unsafe_stale":
                            terms["unit_price"] *= 2
                        self.revisions[supplier] += 1
                        self.history[supplier].append(self.message(supplier, terms, "open"))
                        raise StaleOffer()
                    primary = self.history[supplier][-1]["term_sheets"][0]
                    if msg["action"]["term_sheet_id"] != self.offer_id(supplier):
                        raise AssertionError("accepted a stale or alternative sheet")
                    if not must_haves_ok(self.case, primary["terms"]):
                        raise AssertionError("accepted broken must-haves")
                    if self.fault == "nonterminal_accept" and not self.injected:
                        self.injected = True
                        self.revisions[supplier] += 1
                        reply = self.message(supplier, primary["terms"], "open")
                        self.history[supplier].append(reply)
                        return copy.deepcopy(reply)
                    return self.terminal(supplier, primary["terms"])
                refs = msg.get("refs") or []
                if not isinstance(refs, list) or any(not isinstance(r, str) for r in refs):
                    raise AssertionError("malformed claims reached dispatch")
                known = {sh["term_sheet_id"] for events in self.history.values()
                         for m in events for sh in m.get("term_sheets") or []}
                if any(r not in known for r in refs):
                    raise AssertionError("unsupported citation reached dispatch")
                if len(refs) != len(set(refs)) or self.used.intersection(refs):
                    raise AssertionError("duplicate claim reached dispatch")
                self.used.update(refs)
                terms = (msg.get("term_sheets") or self.history[supplier][-1]["term_sheets"])[0]["terms"]
                if not must_haves_ok(self.case, terms):
                    raise AssertionError("invalid proposed package")
                if self.fault in ("terminal_send", "alternative_terminal"):
                    return self.terminal(supplier, terms)
                self.history[supplier].append({**copy.deepcopy(msg), "from": "buyer"})
                self.revisions[supplier] += 1
                delayed = self.fault == "delayed" and not self.injected
                reply = self.message(supplier, terms, "open" if delayed else "agreed")
                self.history[supplier].append(reply)
                if delayed:
                    self.injected, self.expired = True, True
                    self.clock.advance(2 * self.budget)
                return copy.deepcopy(reply)
        finally:
            with self.lock:
                self.active.remove(supplier)


def release_report(evidence):
    """Count all attempts and reject incomplete evidence rather than best runs."""
    checks, attempts = evidence.get("checks", {}), evidence.get("attempts", [])
    failures = []
    for name in ("syntax_import", "default_off", "task_units", "combined_faults"):
        if checks.get(name) is not True:
            failures.append(name)
    if checks.get("smoke_files") != 19 or checks.get("smoke_passed") is not True:
        failures.append("19-file smoke")
    cfg = VARIANTS["A11"][1]
    for flag, gate in (("calibrated_anchor", "calibration_gate"), ("anchor_probe", "calibration_gate"),
                       ("clause_explore", "clause_gate")):
        if getattr(cfg, flag) and checks.get(gate) is not True:
            failures.append(gate)
        if not getattr(cfg, flag) and not checks.get("rollback_documented"):
            failures.append("undocumented rollback")
    order = {"sandbox_single": 0, "sandbox_rfq": 0, "robustness": 1, "clause": 2, "measured": 3}
    ranks = [order.get(a.get("phase"), -1) for a in attempts]
    if -1 in ranks or ranks != sorted(ranks):
        failures.append("validation order")
    sandbox = {a.get("variant") for a in attempts if a.get("phase") in ("sandbox_single", "sandbox_rfq")}
    if len(sandbox) < 2:
        failures.append("baseline/candidate comparison")
    for variant in sandbox:
        counts = Counter(a.get("phase") for a in attempts if a.get("variant") == variant)
        if counts["sandbox_single"] < 1 or counts["sandbox_rfq"] < 4:
            failures.append("sandbox repetitions")
    if len({a.get("case") for a in attempts if a.get("phase") == "robustness"}) < 2:
        failures.append("robustness coverage")
    if not any(a.get("phase") == "clause" for a in attempts):
        failures.append("clause coverage")
    if len({a.get("case") for a in attempts if a.get("phase") == "measured"}) != 10:
        failures.append("complete measured run")
    metrics = {"attempts": len(attempts), "mean": 0.0, "deal_rate": 0.0, "zero_rate": 0.0,
               "contradicted_claims": 0, "duplicate_claims": 0, "terminal_result_coverage": 0.0,
               "max_turn_age": 0.0, "elapsed": 0.0}
    terminal_count, deals, zeros, scores = 0, 0, 0, []
    for a in attempts:
        result = a.get("result")
        real = (isinstance(result, dict) and a.get("arena_status") == "ended"
                and result == a.get("arena_result") and type(result.get("deal")) is bool)
        score = result.get("score") if real else None
        if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1:
            real, score = False, 0.0
        terminal_count += int(real)
        deals += int(real and result["deal"])
        zeros += int(score == 0)
        scores.append(score)
        if not real or a.get("error"):
            failures.append("unverified terminal result or failed attempt")
        claims = a.get("claims")
        if not isinstance(claims, list) or any(not isinstance(c, dict) for c in claims):
            failures.append("missing claim audit")
        else:
            metrics["contradicted_claims"] += sum(c.get("status") == "contradicted" for c in claims)
            metrics["duplicate_claims"] += sum(c.get("status") == "duplicate" for c in claims)
        for name in ("unsupported_citations", "invalid_acceptances", "duplicate_in_flight", "late_actions"):
            if a.get(name) != 0:
                failures.append(name)
        for name in ("elapsed", "max_turn_age"):
            value = a.get(name)
            if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                failures.append("missing " + name)
            elif name == "elapsed":
                metrics[name] += value
            else:
                metrics[name] = max(metrics[name], value)
    if attempts:
        n = len(attempts)
        metrics.update(mean=sum(scores) / n, deal_rate=deals / n, zero_rate=zeros / n,
                       terminal_result_coverage=terminal_count / n)
    if metrics["contradicted_claims"] or metrics["duplicate_claims"]:
        failures.append("claim failures")
    failures = sorted(set(failures))
    return {"release": not failures, "failures": failures, "metrics": metrics}


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.time_patch = patch.object(eng, "time", self.clock)
        self.time_patch.start()
        self.addCleanup(self.time_patch.stop)

    def negotiator(self, cfg, fault=None, count=1, deadline=None):
        client = Client(self.clock, fault, count)
        return FixtureNegotiator(client, "fixture", cfg, quiet=True, deadline=deadline), client

    def test_config_and_exact_inheritance(self):
        self.assertEqual(tuple(f.name for f in fields(eng.Config))[-len(FLAGS):], FLAGS)
        self.assertTrue(all(not getattr(eng.Config(), name) for name in FLAGS))
        self.assertFalse(any(name.startswith("rfq_") for name in FLAGS))
        candidate, baseline = asdict(VARIANTS["A11"][1]), asdict(VARIANTS["A10"][1])
        self.assertEqual({k for k in candidate if candidate[k] != baseline[k]}, set(FLAGS))
        self.assertTrue(all(candidate[name] is True for name in FLAGS))
        self.assertEqual(replace(VARIANTS["A11"][1], **dict.fromkeys(FLAGS, False)), VARIANTS["A10"][1])
        self.assertFalse(candidate["objection_map"])
        self.assertEqual(candidate["lev_room_boost"], 1.0)
        self.assertEqual(candidate["anchor_mode"], "target")
        self.assertEqual(candidate["push"], "rfq")
        for name, (_, cfg) in VARIANTS.items():
            if name != "A11":
                self.assertTrue(all(not getattr(cfg, flag) for flag in FLAGS), name)

    def test_default_off_legacy_single_wire_and_decisions(self):
        for cfg in (eng.Config(), VARIANTS["A10"][1]):
            with self.subTest(cfg=cfg.key()):
                n, client = self.negotiator(cfg)
                result = n.run()
                price = round(float(eng.Config().T) * 0.85 * (1 + cfg.anchor), 2)
                body = "\n".join([
                    "Hello,", "", "Thank you for your quote. We'd like to award this part to a partner for the full 24 months.",
                    "Our proposal is attached as a term sheet.",
                    "Could you also send us your cost breakdown, so we can see which costs really moved?", *eng.SIGN])
                self.assertEqual(client.wire, [
                    ("thread:0", {"subject": "Fixture", "body": body, "refs": [],
                                  "term_sheets": [{"terms": {"unit_price": price}}]}),
                    ("thread:0", {"action": {"type": "accept", "term_sheet_id": "offer:0-1"}})])
                self.assertEqual([r["kind"] for r in n.log if r["kind"] in ("round", "send", "accept", "result")],
                                 ["round", "send", "accept", "result"])
                self.assertEqual(result, client.result)
                self.assertEqual({k: v for k, v in next(r for r in n.log if r["kind"] == "config").items()
                                  if k not in ("t", "kind", *FLAGS)},
                                 {k: v for k, v in asdict(cfg).items() if k not in FLAGS})

    def test_default_off_legacy_rfq_wire(self):
        for cfg in (eng.Config(), VARIANTS["A10"][1]):
            with self.subTest(cfg=cfg.key()):
                n, client = self.negotiator(cfg, "agreed", count=2)
                self.assertEqual(n.run(), client.result)
                self.assertEqual(client.wire, [("thread:0", {
                    "action": {"type": "accept", "term_sheet_id": "offer:0-0"}})])
                self.assertEqual([r["kind"] for r in n.log if r["kind"] in ("send", "accept", "result")],
                                 ["accept", "result"])

    def test_published_contracts_and_authoritative_budget(self):
        n, client = self.negotiator(VARIANTS["A11"][1])
        for name in ("terminal_result", "turn_remaining", "prepare_message", "calibration_probe"):
            self.assertTrue(callable(getattr(n, name, None)), name)
        for payload in ({}, {"score": 0}, {"status": "open", "term_sheets": []}):
            self.assertIsNone(n.terminal_result(payload))
        response = client.terminal("thread:0", {"unit_price": float(eng.Config().T)})
        self.assertEqual(n.terminal_result(response), client.result)
        n, client = self.negotiator(VARIANTS["A11"][1])
        client.budget = eng.Config().T
        remaining = n.turn_remaining(next(iter(n.threads.values())))
        self.assertGreaterEqual(remaining, 0)
        self.assertLessEqual(remaining, client.budget)

    def test_combined_faults_return_only_actual_results(self):
        profiles = (("stale", 1), ("unsafe_stale", 2), ("nonterminal_accept", 1),
                    ("delayed", 1), ("delayed", 2), ("terminal_send", 1),
                    ("terminal_send", 2), ("alternative_terminal", 1),
                    ("alternative_terminal", 2), (None, 2))
        for fault, count in profiles:
            with self.subTest(fault=fault, count=count):
                deadline = self.clock.time() if fault == "alternative_terminal" else None
                n, client = self.negotiator(VARIANTS["A11"][1], fault, count, deadline)
                result = n.run()
                self.assertIsNotNone(client.result)
                self.assertEqual(result, client.session(n.sid)["result"])
                self.assertFalse(client.active)
                if fault == "alternative_terminal":
                    self.assertTrue(any(msg.get("term_sheets") for _, msg in client.wire))
                if fault in ("stale", "unsafe_stale", "nonterminal_accept", "delayed"):
                    self.assertTrue(client.injected)

    def test_malformed_and_duplicate_claims_at_dispatch(self):
        n, client = self.negotiator(VARIANTS["A11"][1])
        original = n.write

        def malformed(t, rnd, sheets, rival=None):
            msg = original(t, rnd, sheets, rival)
            ref = t.sheets[0]["term_sheet_id"]
            msg["refs"] = [ref, ref, None, [], {}]
            return msg

        n.write = malformed
        self.assertEqual(n.run(), client.result)
        self.assertFalse(client.active)

    def test_release_report_is_fail_closed_and_counts_every_attempt(self):
        self.assertFalse(release_report({})["release"])
        good = {"phase": "measured", "variant": "candidate", "case": "fixture",
                "result": {"deal": True, "score": 1.0}, "arena_status": "ended",
                "arena_result": {"deal": True, "score": 1.0}, "claims": [],
                "unsupported_citations": 0, "invalid_acceptances": 0,
                "duplicate_in_flight": 0, "late_actions": 0, "max_turn_age": 0, "elapsed": 1}
        checks = dict.fromkeys(("syntax_import", "default_off", "task_units", "combined_faults",
                               "smoke_passed", "calibration_gate", "clause_gate"), True)
        checks["smoke_files"] = 19
        rows = []
        for variant in ("baseline", "candidate"):
            rows.append({**good, "variant": variant, "phase": "sandbox_single"})
            rows.extend({**good, "variant": variant, "phase": "sandbox_rfq"} for _ in range(4))
        rows.extend({**good, "phase": "robustness", "case": f"fixture:{i}"} for i in range(2))
        rows.append({**good, "phase": "clause"})
        rows.extend({**good, "case": f"fixture:{i}"} for i in range(10))
        evidence = {"checks": checks, "attempts": rows}
        self.assertTrue(release_report(evidence)["release"])
        failed = {**good, "result": None, "arena_status": "open", "arena_result": None}
        report = release_report({"checks": checks, "attempts": rows + [failed]})
        self.assertFalse(report["release"])
        self.assertEqual(report["metrics"]["attempts"], len(rows) + 1)
        self.assertAlmostEqual(report["metrics"]["mean"], len(rows) / (len(rows) + 1))
        self.assertAlmostEqual(report["metrics"]["zero_rate"], 1 / (len(rows) + 1))
        for name in ("unsupported_citations", "invalid_acceptances", "duplicate_in_flight", "late_actions"):
            bad = {**good, name: 1}
            self.assertFalse(release_report({"checks": checks, "attempts": rows + [bad]})["release"])
        for gate in ("calibration_gate", "clause_gate"):
            self.assertFalse(release_report({"checks": {**checks, gate: False}, "attempts": rows})["release"])
        duplicate = {**good, "claims": [{"status": "duplicate"}, {"status": "contradicted"}]}
        report = release_report({"checks": checks, "attempts": rows + [duplicate]})
        self.assertFalse(report["release"])
        self.assertEqual(report["metrics"]["duplicate_claims"], 1)
        self.assertEqual(report["metrics"]["contradicted_claims"], 1)
        self.assertFalse(release_report({"checks": checks, "attempts": list(reversed(rows))})["release"])


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--report":
        report = release_report(json.loads(Path(sys.argv[2]).read_text()))
        print(json.dumps(report, indent=2))
        raise SystemExit(0 if report["release"] else 1)
    unittest.main()
