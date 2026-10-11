"""Offline clock/state tests; fixture IDs are opaque and are never cited as data claims."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock, patch

from arena_kit import ArenaError
from proto.engine import Config, Negotiator, Thread


class HttpError(ArenaError):
    def __init__(self, status):
        Exception.__init__(self, str(status))
        self.status, self.detail = status, "temporary failure"


def reply(round_number, status="open", attachments=None):
    return {"from": "supplier", "message_id": "message-" + str(round_number), "status": status,
            "body": "fixture", "attachments": attachments or [], "term_sheets": [
                {"term_sheet_id": "offer-" + str(round_number), "terms": {"unit_price": float(round_number)}}]}


def harness(now=1000.0):
    clock = SimpleNamespace(now=now)
    t = Thread("supplier", [reply(1)])
    n = Negotiator.__new__(Negotiator)
    n.cfg, n.sid, n.case_id, n.quiet, n.log = Config(arena_clock_guard=True), "session", "fixture", True, []
    n.threads, n.deadline, n.slowest, n.terminal_response = {t.sid: t}, now + 480, 0.0, None
    from threading import RLock
    n._clock_lock, n._clock_read_at = RLock(), float("-inf")
    n.c_alt, n.C = float("inf"), lambda thread, terms: terms["unit_price"]
    t.request_started_at = t.supplier_event_at = now
    t.turn_deadline = now + 60
    n.c = Mock()
    n.c.thread.side_effect = lambda *args: {"messages": t.events, "offer_id": t.standing_offer_id,
                                           "status": t.status, "closed": t.closed, "timeouts": t.timeouts}
    n.c.session.side_effect = lambda *args: {"status": "open", "threads": {t.sid: {
        "offer_id": t.standing_offer_id, "status": t.status, "closed": t.closed,
        "seconds_left": 60 - (clock.now - t.supplier_event_at)}}}
    return n, t, clock


class ArenaClockTests(unittest.TestCase):
    def test_old_arena_event_is_urgent_not_fresh(self):
        n, t, clock = harness()
        with patch("proto.engine.time.time", side_effect=lambda: clock.now):
            n.apply_thread_update(t, reply(2), clock.now, t.event_revision)
            n.c.session.return_value = None
            n.c.session.side_effect = lambda *args: {"threads": {t.sid: {
                "offer_id": t.standing_offer_id, "status": "open", "closed": False, "seconds_left": -15}}}
            self.assertEqual(n.turn_remaining(t), 0)
            self.assertEqual(clock.now - t.supplier_event_at, 75)
            self.assertEqual(t.timestamp_confidence, "arena_seconds_left")
            self.assertTrue(n.near_cap())

    def test_missing_timestamp_uses_request_start(self):
        n, t, clock = harness()
        with patch("proto.engine.time.time", side_effect=lambda: clock.now):
            n.apply_thread_update(t, reply(2), clock.now - 75, t.event_revision)
            self.assertEqual(n.turn_remaining(t, refresh=False), 0)
            self.assertEqual(t.timestamp_confidence, "uncertain")
            n.c.session.side_effect = lambda *args: {"threads": {t.sid: {"seconds_left": None}}}
            n.turn_remaining(t)
            self.assertEqual(t.turn_deadline, clock.now - 15)
            self.assertTrue(n.near_cap())

    def test_identical_refresh_does_not_restart_clock_or_revision(self):
        n, t, clock = harness()
        with patch("proto.engine.time.time", side_effect=lambda: clock.now):
            n.turn_remaining(t)
            deadline, revision = t.turn_deadline, t.event_revision
            for _ in range(3):
                clock.now += 2
                # Even an over-generous repeated countdown cannot restart this event's clock.
                n.c.session.side_effect = lambda *args: {"threads": {t.sid: {
                    "offer_id": t.standing_offer_id, "status": "open", "closed": False, "seconds_left": 60}}}
                self.assertTrue(n.resync(t))
                self.assertEqual(t.turn_deadline, deadline)
                self.assertEqual(t.event_revision, revision)
            self.assertEqual(n.turn_remaining(t, refresh=False), 54)

    def test_transient_read_keeps_recoverable_offer(self):
        n, t, clock = harness()
        before = list(t.events)
        n.c.thread.side_effect = HttpError(503)
        with patch("proto.engine.time.time", side_effect=lambda: clock.now):
            self.assertFalse(n.resync(t))
        self.assertEqual(t.events, before)
        self.assertEqual(t.status, "open")
        self.assertFalse(t.closed)
        self.assertTrue(t.state_uncertain)

    def test_late_reply_and_older_snapshot_are_rejected(self):
        n, t, clock = harness()
        with patch("proto.engine.time.time", side_effect=lambda: clock.now):
            revision = t.event_revision
            n.apply_thread_update(t, {"messages": [reply(1), reply(3)], "offer_id": "offer-3",
                                      "status": "open", "closed": False}, clock.now, revision)
            self.assertFalse(n.apply_thread_update(t, reply(2), clock.now, revision))
            self.assertFalse(n.apply_thread_update(t, {"messages": [reply(1)], "offer_id": "offer-1",
                                                       "closed": False}, clock.now, t.event_revision))
            self.assertEqual(t.standing_offer_id, "offer-3")
            self.assertEqual(dict(t.opening_terms), {"unit_price": 1.0})
            with self.assertRaises(TypeError):
                t.opening_terms["unit_price"] = 3.0

    def test_timeout_offer_uses_authoritative_standing_id(self):
        n, t, clock = harness()
        with patch("proto.engine.time.time", side_effect=lambda: clock.now):
            n.apply_thread_update(t, {"messages": [reply(1)], "offer_id": "offer-2", "status": "open",
                "closed": False, "timeouts": [{"offer_id": "offer-2", "round": 2, "status": "open",
                                                "terms": {"unit_price": 2.0}, "alternatives": [], "text": "timeout"}]},
                                  clock.now, t.event_revision)
        self.assertEqual(t.sheets[0]["term_sheet_id"], "offer-2")
        self.assertFalse(t.closed)

    def test_agreement_does_not_download_slow_attachment(self):
        n, t, clock = harness()
        n.c.send_message.return_value = reply(2, "agreed", [{"attachment_id": "attachment", "name": "quote.md"}])
        n.c.attachment.side_effect = AssertionError("a slow download must not precede acceptance")
        n.prepare_message = Mock(side_effect=lambda thread, message: message)
        with patch("proto.engine.time.time", side_effect=lambda: clock.now):
            r = n.send(t, {"body": "proposal", "refs": [], "term_sheets": []})
        self.assertEqual(r["status"], "agreed")
        self.assertEqual(t.status, "agreed")
        self.assertEqual(t.event_revision, 1)
        self.assertIn("attachment", t.deferred_attachments)
        self.assertNotIn("text", t.last["attachments"][0])
        n.c.attachment.assert_not_called()
        n.prepare_message.assert_called_once()

    def test_terminal_and_ambiguous_transport_are_distinct(self):
        n, t, clock = harness()
        n.prepare_message = Mock()
        n.c.send_message.return_value = {"result": {"deal": True}}
        with patch("proto.engine.time.time", side_effect=lambda: clock.now):
            r = n.send(t, {"action": {"type": "accept", "term_sheet_id": t.standing_offer_id}})
        self.assertTrue(r["result"]["deal"])
        n.prepare_message.assert_not_called()
        n, t, clock = harness()
        n.c.send_message.side_effect = HttpError(503)
        with patch("proto.engine.time.time", side_effect=lambda: clock.now):
            with self.assertRaises(ArenaError):
                n.send(t, {"body": "proposal"})
            with self.assertRaises(RuntimeError):
                n.send(t, {"body": "proposal"})
        self.assertEqual(n.c.send_message.call_count, 1)
        self.assertEqual(t.status, "open")

    def test_deadline_is_established_before_open_and_never_extended(self):
        clock = SimpleNamespace(now=1000.0)
        c = Mock()
        def open_session(*args):
            clock.now += 75
            return {"session_id": "session", "case": {"buyer": {"category_goal": "routine"}},
                    "threads": {"supplier": [reply(1)]}}
        c.open_session.side_effect = open_session
        c.session.return_value = {"threads": {"supplier": {"offer_id": "offer-1", "seconds_left": 25}}}
        with patch("proto.engine.time.time", side_effect=lambda: clock.now), \
                patch.object(Negotiator, "_estimate"), patch.object(Negotiator, "C", return_value=1):
            n = Negotiator(c, "fixture", Config(arena_clock_guard=True), quiet=True)
            self.assertEqual(n.deadline, 1480)
            clock.now = 1000
            n = Negotiator(c, "fixture", Config(arena_clock_guard=True), quiet=True, deadline=1300)
            self.assertEqual(n.deadline, 1300)

    def test_unsafe_outside_alternative_is_not_a_fallback(self):
        c = Mock()
        c.open_session.return_value = {"session_id": "session", "case": {"buyer": {
            "category_goal": "routine", "alternative": {"terms": {"unit_price": 1.0}}}},
            "threads": {"supplier": [reply(1)]}}
        c.session.return_value = {"threads": {"supplier": {"offer_id": "offer-1", "seconds_left": 60}}}
        with patch.object(Negotiator, "_estimate"), patch.object(Negotiator, "C", return_value=1), \
                patch("proto.engine.total_cost", return_value=1), patch("proto.engine.must_haves_ok", return_value=False):
            n = Negotiator(c, "fixture", Config(arena_clock_guard=True), quiet=True)
        self.assertEqual(n.c_alt, float("inf"))

    def test_ten_concurrent_eight_minute_waves_with_delayed_replies(self):
        # Each worker has virtual time, avoiding real sleeps and hosted supplier calls.
        def simulate(index):
            n, t, clock = harness(now=0)
            deadline = n.deadline
            round_number = 1
            while clock.now < 480:
                started, revision = clock.now, t.event_revision
                clock.now += 75 if index % 2 else 25
                round_number += 1
                n.apply_thread_update(t, reply(round_number), started, revision)
                self.assertEqual(n.deadline, deadline)
                self.assertEqual(t.turn_deadline, started + 60)
                self.assertEqual(t.timestamp_confidence, "uncertain")
            return n.deadline
        # apply_thread_update's receipt clock is fixed; request bounds remain worker-local and immutable.
        with patch("proto.engine.time.time", return_value=480), ThreadPoolExecutor(10) as ex:
            self.assertEqual(list(ex.map(simulate, range(10))), [480] * 10)

    def test_flag_off_keeps_receipt_clock(self):
        n, t, clock = harness()
        n.cfg = Config()
        t.replied_at = clock.now - 2
        with patch("proto.engine.time.time", side_effect=lambda: clock.now):
            self.assertEqual(n.turn_remaining(t), 58)
        n.c.session.assert_not_called()


if __name__ == "__main__":
    unittest.main()
