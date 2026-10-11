"""Offline transactional-close tests; fake IDs never leave the fake client."""

import copy
import tempfile
import unittest
from pathlib import Path
from threading import RLock
from unittest.mock import patch

import proto.engine as eng
from proto.engine import Config, Negotiator, Thread


class Rejected(Exception):
    status = 422
    detail = "not a standing offer"


def reply(sid, revision, price=None, status="open", lead=None):
    cfg = Config()
    terms = {"unit_price": float(cfg.max_rounds) if price is None else price,
             "lead_time_days": cfg.T if lead is None else lead}
    return {"from": sid, "status": status, "body": "", "message_id": f"{sid}:{revision}",
            "term_sheets": [{"term_sheet_id": f"{sid}:{revision}", "terms": terms}]}


def view(message, closed=False):
    return {"messages": [message], "status": message["status"], "closed": closed,
            "offer_id": None if closed else message["term_sheets"][0]["term_sheet_id"], "timeouts": []}


class FakeClient:
    def __init__(self, messages):
        self.views = {m["from"]: view(m) for m in messages}
        self.result = None
        self.accepts, self.proposals, self.walks = [], [], []
        self.on_accept = None
        self.on_proposal = None
        self.reads = 0

    def session(self, sid):
        return {"status": "ended" if self.result is not None else "live", "result": self.result,
                "threads": {s: {"offer_id": v["offer_id"], "closed": v["closed"],
                                "seconds_left": None if v["closed"] else 60} for s, v in self.views.items()}}

    def thread(self, sid, supplier):
        self.reads += 1
        return copy.deepcopy(self.views[supplier])

    def send_message(self, sid, supplier, message):
        action = message.get("action") or {}
        if action.get("type") == "accept":
            oid = action["term_sheet_id"]
            self.accepts.append((supplier, oid))
            if self.on_accept:
                return self.on_accept(supplier, oid)
            if oid != self.views[supplier]["offer_id"]:
                raise Rejected()
            self.result = {"deal": True, "score": 1.0, "supplier_id": supplier,
                           "terms": self.views[supplier]["messages"][-1]["term_sheets"][0]["terms"]}
            return {"result": self.result}
        if action.get("type") == "walk_away":
            self.walks.append(supplier)
            raise AssertionError("a live superior offer must not be walked")
        self.proposals.append(copy.deepcopy(message["term_sheets"][0]["terms"]))
        if self.on_proposal is None:
            raise Rejected()
        answer = self.on_proposal(supplier, message)
        self.views[supplier] = view(answer)
        return copy.deepcopy(answer)


def negotiator(messages):
    n = Negotiator.__new__(Negotiator)
    n.cfg, n.sid, n.case_id = Config(safe_close=True), "session", "fixture"
    n.case = {"title": "Offline enquiry", "negotiable": ["unit_price", "lead_time_days"],
              "term_options": {"lead_time_days": [n.cfg.T, n.cfg.max_rounds]}, "fixed_terms": {},
              "buyer": {"need_per_year": 1, "horizon_years": 1, "reference_payment_days": n.cfg.T,
                        "need_lead_time_days": n.cfg.T, "freight_eur_per_unit": {"DAP": 0},
                        "must_haves": [{"field": "lead_time_days", "op": "<=", "value": n.cfg.T}]}}
    n.alt, n.c_alt, n.deadline, n.slowest = {}, float("inf"), None, 0.0
    n.quiet, n.log = True, []
    n.threads = {m["from"]: Thread(m["from"], [copy.deepcopy(m)]) for m in messages}
    for t in n.threads.values():
        t.io_lock, t.revision = RLock(), 0
    n.C = lambda t, terms: terms["unit_price"]
    n.c = FakeClient(messages)
    return n


class SafeCloseTests(unittest.TestCase):
    def test_stale_primary_retries_only_new_primary(self):
        old = reply("supplier", 0)
        n = negotiator([old])
        t = n.threads["supplier"]
        fresh = reply(t.sid, 1, price=float(n.cfg.T))

        def reject_once(supplier, oid):
            n.c.views[supplier] = view(fresh)
            n.c.on_accept = None
            raise Rejected()

        n.c.on_accept = reject_once
        res = n.close(t, t.sheets[0])
        self.assertTrue(res["deal"])
        self.assertEqual([oid for _, oid in n.c.accepts],
                         [old["term_sheets"][0]["term_sheet_id"], fresh["term_sheets"][0]["term_sheet_id"]])
        self.assertEqual(n.c.walks, [])

    def test_walked_thread_does_not_zero_live_rival(self):
        first, second = reply("supplier", 0), reply("rival", 0)
        n = negotiator([first, second])
        t = n.threads["supplier"]

        def withdraw(supplier, oid):
            withdrawn = reply(supplier, 1, status="walked_away")
            n.c.views[supplier] = view(withdrawn, closed=True)
            n.c.on_accept = None
            raise Rejected()

        n.c.on_accept = withdraw
        self.assertIsNone(n.close(t, t.sheets[0]))
        self.assertTrue(n.closing_move()["deal"])
        self.assertEqual(n.c.accepts[-1][0], "rival")
        self.assertEqual(n.c.walks, [])

    def test_lost_accept_response_returns_committed_result(self):
        n = negotiator([reply("supplier", 0)])
        t = n.threads["supplier"]

        def commit_then_lose(supplier, oid):
            n.c.result = {"deal": True, "score": 1.0, "supplier_id": supplier}
            raise TimeoutError("response lost after commit")

        n.c.on_accept = commit_then_lose
        self.assertEqual(n.close(t, t.sheets[0]), n.c.result)
        self.assertEqual(len(n.c.accepts), 1)
        self.assertEqual(n.c.reads, 0)
        self.assertEqual(n.walk(), n.c.result)
        self.assertEqual(n.c.walks, [])

    def test_alternative_changed_or_open_requires_new_decision(self):
        for status, changed in (("agreed", True), ("open", False)):
            with self.subTest(status=status):
                initial = reply("supplier", 0)
                alternative = {"term_sheet_id": initial["term_sheets"][0]["term_sheet_id"] + ":alternative",
                               "terms": {"unit_price": float(Config().T), "lead_time_days": Config().T}}
                initial["term_sheets"].append(alternative)
                n = negotiator([initial])
                t = n.threads["supplier"]
                price = float(n.cfg.T + int(changed))
                confirmed = reply(t.sid, 1, price=price, status=status)
                n.c.on_proposal = lambda supplier, message: confirmed
                self.assertIsNone(n.close(t, alternative))
                self.assertEqual(n.c.accepts, [])
                self.assertEqual(n.c.proposals, [alternative["terms"]])
                self.assertTrue(n.closing_move()["deal"])
                self.assertEqual(n.c.accepts, [(t.sid, confirmed["term_sheets"][0]["term_sheet_id"])])
                self.assertEqual(n.c.walks, [])

    def test_must_have_violation_on_refresh_is_not_accepted(self):
        initial = reply("supplier", 0)
        n = negotiator([initial])
        t = n.threads["supplier"]
        bad = reply(t.sid, 1, price=float(n.cfg.T), lead=n.cfg.max_rounds)
        n.c.views[t.sid] = view(bad)
        res = n.close(t, t.sheets[0], revision=t.revision - 1)
        self.assertIsNone(res)
        self.assertEqual(n.c.accepts, [])
        self.assertLessEqual(len(n.c.proposals), 1)
        if n.c.proposals:
            self.assertEqual(n.c.proposals[0], initial["term_sheets"][0]["terms"])
        self.assertEqual(n.c.walks, [])

    def test_unchanged_rejection_is_not_hammered(self):
        n = negotiator([reply("supplier", 0)])
        t = n.threads["supplier"]
        n.c.on_accept = lambda supplier, oid: (_ for _ in ()).throw(Rejected())
        self.assertIsNone(n.close(t, t.sheets[0]))
        self.assertIsNone(n.close(t, t.sheets[0]))
        self.assertEqual(len(n.c.accepts), 1)
        self.assertEqual(len(n.c.proposals), 1)
        self.assertEqual(n.c.walks, [])

    def test_ambiguous_accept_is_not_a_result(self):
        n = negotiator([reply("supplier", 0)])
        t = n.threads["supplier"]
        n.c.on_accept = lambda supplier, oid: {"status": "open", "body": "still live"}
        self.assertIsNone(n.close(t, t.sheets[0]))
        self.assertEqual(len(n.c.accepts), 1)
        self.assertIsNone(n.terminal_result({"score": 0.0, "error": "live failure"}))
        self.assertIsNone(n.terminal_result({"status": "open", "result": {"deal": False, "score": 0.0}}))

    def test_timeout_primary_is_taken_from_authoritative_timeout_terms(self):
        n = negotiator([reply("supplier", 0)])
        t = n.threads["supplier"]
        fresh = reply(t.sid, 1, price=float(n.cfg.T))
        sh = fresh["term_sheets"][0]
        n.c.views[t.sid]["offer_id"] = sh["term_sheet_id"]
        n.c.views[t.sid]["timeouts"] = [{"offer_id": sh["term_sheet_id"], "status": "open", "terms": sh["terms"]}]
        self.assertTrue(n.close(t, t.sheets[0], revision=t.revision - 1)["deal"])
        self.assertEqual(n.c.accepts, [(t.sid, sh["term_sheet_id"])])

    def test_crash_recovers_rival_before_outside_option(self):
        n = negotiator([reply("supplier", 0), reply("rival", 0)])
        n.c.views["supplier"] = view(reply("supplier", 1, status="walked_away"), closed=True)
        n.run = lambda: (_ for _ in ()).throw(RuntimeError("closing failed"))
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "runs"
            with patch.object(eng, "Negotiator", return_value=n):
                sid, res = eng.play(n.case_id, n.cfg, client=n.c, log_dir=out, quiet=True)
            self.assertTrue(res["deal"])
            self.assertEqual(n.c.accepts[-1][0], "rival")
            self.assertEqual((out.parent / "closed.txt").read_text().strip(), sid)
            self.assertEqual(n.c.walks, [])

    def test_unresolved_crash_is_not_written_closed_or_scored(self):
        n = negotiator([reply("supplier", 0)])
        n.run = lambda: (_ for _ in ()).throw(RuntimeError("closing failed"))
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "runs"
            with patch.object(eng, "Negotiator", return_value=n), \
                    patch.object(n.c, "session", side_effect=TimeoutError("unavailable")), \
                    patch.object(n.c, "thread", side_effect=TimeoutError("unavailable")), \
                    patch.object(n.c, "send_message", side_effect=TimeoutError("unavailable")):
                _, res = eng.play(n.case_id, n.cfg, client=n.c, log_dir=out, quiet=True)
            self.assertTrue(res["unresolved"])
            self.assertNotIn("score", res)
            self.assertFalse((out.parent / "closed.txt").exists())
            self.assertTrue(any(row["kind"] == "cleanup_unresolved" for row in n.log))


if __name__ == "__main__":
    unittest.main()
