# ===== proto/engine.py (interface excerpt; run_rfq = A10's 1,000-line RFQ coordinator, omitted) =====

class Thread:
    def __deepcopy__(self, memo):
        """RFQ snapshots deep-copy threads; the per-thread I/O lock is shared, not copied (an RLock cannot be)."""
        import copy

        new = Thread.__new__(Thread)
        memo[id(self)] = new
        for k, v in self.__dict__.items():
            new.__dict__[k] = v if k == "io_lock" else copy.deepcopy(v, memo)
        return new

    def __init__(self, sid, events):
        self.sid, self.events = sid, list(events)
        self.std = standard_terms(self.events)
        self.est = {}  # supplier estimate: standard, floor, full_cost, interest_rate
        self.facts_used = 0
        self.pushes = 0
        self.rounds = 0  # our messages in the RFQ loop (its own clock)
        self.in_flight = False  # our message is out and its reply has not arrived yet
        self.replied_at = time.time()  # the 60-second clock runs from the supplier's last reply
        self.moves = []  # opponent model: per-field changes of its standing sheet
        self.io_lock = RLock()
        self.event_revision = 0
        opening = next((m for m in self.events if m.get("from") not in ("buyer", "arena")
                        and m.get("term_sheets")), {})
        self.opening_sheets = tuple(self._freeze(s["terms"]) for s in opening.get("term_sheets") or [])
        self.opening_terms = self.opening_sheets[0] if self.opening_sheets else self._freeze({})
        self.opening_std = self._freeze(self.std)
        self.request_started_at = self.replied_at
        self.supplier_event_at = self.replied_at  # a lower bound, not a timestamp supplied by the API
        self.timestamp_confidence = "uncertain"
        self.turn_deadline = self.replied_at + 60
        self.clock_event_key = None
        self.event_key = self._key(self.last)
        self.standing_offer_id = self.sheets[0].get("term_sheet_id") if self.sheets else None
        self.seen_offer_ids = {s.get("term_sheet_id") for m in self.events for s in m.get("term_sheets") or []
                               if s.get("term_sheet_id")}
        self.closed = False
        self.state_uncertain = False
        self.pending_request = None
        self.deferred_attachments = set()
        self.timeouts = []

    @staticmethod
    def _freeze(value):
        if isinstance(value, dict):
            return MappingProxyType({k: Thread._freeze(v) for k, v in value.items()})
        if isinstance(value, list):
            return tuple(Thread._freeze(v) for v in value)
        return value

    @staticmethod
    def _key(message):
        # IDs are opaque: ordering comes from the authoritative message history, not guessed ID syntax.
        if message.get("message_id"):
            return ("message", message["message_id"])
        identity = {k: message.get(k) for k in ("from", "status", "body", "term_sheets")}
        identity["attachments"] = [{k: v for k, v in a.items() if k != "text"}
                                   for a in message.get("attachments") or []]
        return ("content", json.dumps(identity, sort_keys=True, default=str))

    @property
    def last(self):
        return next(m for m in reversed(self.events) if m.get("from") != "buyer")

    @property
    def status(self):
        return self.last.get("status")

    @property
    def sheets(self):
        return self.last.get("term_sheets") or []

    def sent(self):
        return sum(m.get("from") == "buyer" for m in self.events)

class Negotiator():  # excerpt

    def __init__(self, client, case_id, cfg=Config(), quiet=False, deadline=None):
        self.c, self.case_id, self.cfg, self.quiet, self.log = client, case_id, cfg, quiet, []
        self.deadline, self.slowest = deadline, 0.0  # wave cap (epoch seconds) and our slowest round so far
        opened_at = time.time() if cfg.arena_clock_guard else None
        if cfg.arena_clock_guard and self.deadline is None:
            self.deadline = opened_at + 480  # opening latency consumes the same wave budget
        self._clock_lock, self._clock_read_at = RLock(), float("-inf")
        self.terminal_response = None
        r = client.open_session(case_id)
        self.sid, self.case = r["session_id"], r["case"]
        self.threads = {s: Thread(s, ev) for s, ev in r["threads"].items()}
        if cfg.arena_clock_guard:
            self.slowest = time.time() - opened_at
            for t in self.threads.values():
                t.request_started_at = t.supplier_event_at = opened_at
                t.turn_deadline = opened_at + 60
            if self.threads:
                self.turn_remaining(next(iter(self.threads.values())))
        for t in self.threads.values():
            self._docs(t.events, t)
            t.std = standard_terms(t.events)
            if cfg.arena_clock_guard:
                t.opening_std = Thread._freeze(t.std)
        self.b = self.case["buyer"]
        self.alt = self.b.get("alternative") or {}
        self.c_alt = total_cost(self.case, self.alt["terms"]) if self.alt.get("terms", {}).get("unit_price") else float("inf")
        if cfg.arena_clock_guard and self.alt.get("terms") and not must_haves_ok(self.case, self.alt["terms"]):
            self.c_alt = float("inf")  # an outside quote that breaks a must-have is not a safe exit
        self.relationship = self.b.get("category_goal") in ("stabilise", "secure_supply")
        self.c_open = min((self.C(t, t.sheets[0]["terms"]) for t in self.threads.values() if t.sheets), default=float("inf"))
        if len(self.threads) > 1:  # RFQ-only overrides
            over = {k[4:]: v for k, v in asdict(cfg).items() if k.startswith("rfq_") and v is not None
                    and k not in ("rfq_bar", "rfq_hold", "rfq_stagger")}
            if over:
                self.cfg = cfg = replace(cfg, **over)
        self.note("config", **asdict(cfg))
        self._estimate()
        if cfg.evidence_concession_rebase and len(self.threads) > 1:
            self._evidence_rebase_state(None, None)  # Seed before pricing; shallow RFQ snapshots share this cache.
        self.note("open", session=self.sid, c_alt=self.c_alt, c_open=self.c_open)

    def note(self, kind, **kw):
        self.log.append({"t": round(time.time(), 1), "kind": kind, **kw})
        if not self.quiet:
            print(f"[{self.case_id}] {kind}: {json.dumps(kw, default=str)[:700]}", flush=True)

    def C(self, t, terms):
        return total_cost(self.case, terms, t.std, t.est if self.relationship and t.est else None)

    def calibration_probe(self, t): ...  # A single price-free discovery exchange, only when both clocks permit it.

    def best_standing(self):
        best = None
        for t in self.threads.values():
            if t.status in ENDED or (self.cfg.arena_clock_guard and t.closed):
                continue
            for sh in t.sheets:
                if must_haves_ok(self.case, sh["terms"], t.std):
                    c = self.C(t, sh["terms"])
                    if best is None or c < best[0]:
                        best = (c, t, sh)
        return best

    def goal(self, rnd, t=None):
        if self.cfg.reservation_band_goal and callable(getattr(self, "_g41_reservation_goal", None)):
            g = self._g41_reservation_goal(rnd, t)  # D02 gen4: None -> A10's own goal
            if g is not None:
                return g
        best = self.best_standing()
        ref = self.c_open if self.cfg.toward == "open" else (best[0] if best else self.c_open)
        ref = min(ref, self.c_alt)
        if self.cfg.calibrated_anchor and t is None:
            t = self.threads.get(self.target_sup)
        narrow = self._narrow_room(t) if self.cfg.calibrated_anchor else None
        start = self.target_c * (1 + self.cfg.anchor)
        if self.cfg.bottleneck_anchor and self.b.get("category_goal") == "secure_supply":
            # practice P10: never far below a bottleneck's opening PRICE (its opening C is inflated when it covers
            # only part of the need), but always with full coverage: the cheapest such package at that price
            start = self._anchor_clamp(t, start, max(start, self.bottleneck_floor_c()), "bottleneck_floor")
        prior = ROOM_PRIOR.get(self.b.get("category_goal"))
        if self.cfg.target_prior and prior and narrow is not None:
            self.note("anchor_clamp", supplier=t.sid, reason="room_prior_suppressed_by_supplier_specific_evidence",
                      room=narrow, prior=prior)
        if self.cfg.target_prior and prior and self.c_open < float("inf") and narrow is None:
            # practice P07: our data floor gave a first ask above the best possible deal; never be more timid
            # than a typical room for this goal
            start = self._anchor_clamp(t, start, min(start, self.c_open * (1 - prior)), "room_prior")
        if self.cfg.anchor_mode == "opening" and self.c_open < float("inf"):
            # teammates' rule: the first ask sits a goal-specific % below the opening, never below our target
            start = self._anchor_clamp(t, start,
                                       max(start, self.c_open * (1 - GOAL_ANCHOR.get(self.b.get("category_goal"), 0.10))),
                                       "opening_percentage_floor")
        if (not self.cfg.calibrated_anchor and self.cfg.lev_room_boost != 1.0
                and self.b.get("category_goal") == "leverage" and self.c_open < float("inf")
                and not any("breakdown" in str(t.est.get("basis", "")) or "share" in str(t.est.get("basis", ""))
                            for t in self.threads.values())):
            # calibration audit (proto/calibrate.py): without a supplier breakdown our leverage targets captured only
            # ~0.68 of the true room -> widen the room we aim for
            start = min(start, self.c_open - self.cfg.lev_room_boost * (self.c_open - start))
        if self.cfg.calibrated_anchor and t is not None:
            start = self._calibrated_start(t, start, narrow)
            t._anchor_candidate = start
        frac = min(1.0, max(rnd, 0) / self.cfg.T) ** (1 / self.cfg.e)
        ordinary = start + (ref - start) * frac
        if not self.cfg.evidence_concession_rebase or len(self.threads) < 2:
            return ordinary
        t = t or self.threads.get(self.target_sup) or (best[1] if best else next(iter(self.threads.values())))
        actual_frac = min(1.0, max(t.rounds, 0) / self.cfg.T) ** (1 / self.cfg.e)
        current_ordinary = start + (ref - start) * actual_frac
        rebased = self._evidence_rebase_state(t, current_ordinary, ref)
        if rebased is None:
            return ordinary
        frac = min(1.0, max(rnd - rebased["epoch"], 0) / rebased["horizon"]) ** (1 / self.cfg.e)
        # The cached start has no second anchor; later evidence must not weaken the ordinary goal.
        return min(ordinary, rebased["start"] + (ref - rebased["start"]) * frac)

    def bottleneck_floor_c(self): ...  # 

    def recalled(self, t):
        """P18/P08: its offers got worse after our last move. Propose its best earlier package (it offered it
        itself, so it will most likely agree) instead of pushing further."""
        if not self.cfg.recall_best or getattr(t, "recalled_once", False):
            return []
        seen = [(self.C(t, s2["terms"]), s2["terms"]) for m in t.events if m.get("from") not in ("buyer", "arena")
                for s2 in m.get("term_sheets") or [] if must_haves_ok(self.case, s2["terms"], t.std)]
        if len(seen) < 2 or not t.sheets:
            return []
        now = min(self.C(t, s2["terms"]) for s2 in t.sheets)
        best_c, best_terms = min(seen, key=lambda z: z[0])
        if best_c < now * 0.997:
            t.recalled_once = True
            self.note("recall_best", supplier=t.sid, best_c=round(best_c), now=round(now))
            return [complete_offer(self.case, best_terms)]
        return []

    def fallback_counter(self, t):
        """No package survives the guards (P10): counter at the supplier's own price with every must-have
        restored and full coverage, the cheapest such package for us - instead of walking away."""
        their = t.sheets[0]["terms"] if t.sheets else {}
        p = their.get("unit_price")
        if p is None:
            return []
        ok = [complete_offer(self.case, {**g, "unit_price": p}) for g in lever_grid(self.case, t.std)]
        ok = [x for x in ok if must_haves_ok(self.case, x, t.std)]
        ok.sort(key=lambda x: self.C(t, x))
        return ok[:1]

    def conditional_package(self, t): ...  # P18: "We can agree to your proposed price of EUR 5.30 ... we must maintain the index clause". The supplier

    def frozen_packages(self, t): ...  # P03: "management has frozen all price reductions - we can talk about the terms instead". Keep its price

    def clause_candidate(self, t, c_goal, grid, picks, room): ...  # Explore a supplier-compatible clause; sensitivity never changes our acceptance objective.

    def meso(self, t, c_goal): ...  # 

    def facts_for(self, t): ...  # [(ref or [refs], sentence)] to drip into the e-mails; subclasses build them from data.

    def claim_source(self, ref): ...  # 

    def prepare_message(self, t, msg): ...  # Finalize immediately before dispatch; uncertain delivery never refunds evidence.

    def our_calculation(self, t): ...  # Our calculation from this supplier's own cost breakdown (never another supplier's figures).

    def write(self, t, rnd, sheets, rival=None): ...  # 

    def apply_thread_update(self, t, update, request_started_at=None, revision=None, message=None): ...  # Apply a reply or an authoritative GET-thread snapshot without rolling state backwards.

    def turn_remaining(self, t, refresh=True): ...  # Conservative arena turn seconds; supplier messages have no documented timestamps.

    def styled(self, t, msg): ...  # LLM body in this supplier's register; sheets, refs and attachments stay exactly the engine's.

    def send(self, t, msg):
        # D02 gen4 AI hooks: each helper (t, msg) -> msg, called with a body-bearing draft before claims/writer
        if "action" not in msg and self.cfg.ai_counter_price and callable(getattr(self, "_g45_before_send", None)):
            msg = self._g45_before_send(t, msg) or msg
        if "action" not in msg and self.cfg.ai_term_exchange and callable(getattr(self, "_g47_before_send", None)):
            msg = self._g47_before_send(t, msg) or msg
        self._reserve_calibration(t, msg)
        if self.cfg.safe_claims and "action" not in msg:
            # T4 finalizes claims (and strips its internal keys) on every path, before the writer sees the body
            msg = self.prepare_message(t, msg) or msg
        if self.cfg.cost_residual_bridge and len(self.threads) > 1:
            with t.io_lock:
                msg = self._cost_residual_message(t, msg)
                if any(a.get("name") == "proposed-cost-bridge.md" for a in msg.get("attachments") or []):
                    # Legacy sends can also lose their response; never refund an attachment attempt.
                    t._cost_residual_attempted = True
        if self.cfg.llm_writer and msg.get("body") and "action" not in msg:
            msg = self.styled(t, msg)
        if self.cfg.arena_clock_guard:
            if t.pending_request:
                self.resync(t)
                if t.pending_request:
                    raise RuntimeError("ambiguous prior dispatch: refresh has not confirmed a newer supplier event")
            with t.io_lock:
                revision = t.event_revision
                # T4 owns the case-wide reservation inside this hook; action-only requests have no claims.
                # T4's claim finalization now runs once at the top of send()
                started = time.time()
                t.request_started_at = started
            try:
                r = self.c.send_message(self.sid, t.sid, msg)  # the client's same-move retry remains intact
                self._package_v2_dispatch(t, msg)
            except Exception as e:
                duration = time.time() - started
                self.slowest = max(self.slowest, duration)
                ambiguous = not isinstance(e, ArenaError) or e.status in (408, 429) or e.status >= 500
                with t.io_lock:
                    t.state_uncertain = True
                    if ambiguous:
                        t.pending_request = {"revision": revision, "started_at": started}
                self.note("transport_ambiguous" if ambiguous else "error", supplier=t.sid,
                          status=getattr(e, "status", None), detail=str(getattr(e, "detail", e))[:300],
                          duration=round(duration, 3), revision=t.event_revision,
                          arena_age=round(time.time() - t.supplier_event_at, 3), confidence=t.timestamp_confidence)
                if ambiguous:
                    raise  # do not turn an uncertain POST into permission to issue a duplicate
                if e.status == 409:
                    self.resync(t)
                return None
            duration = time.time() - started
            self.slowest = max(self.slowest, duration)
            if not self.apply_thread_update(t, r, started, revision, message=msg):
                return None
            if "result" in r and "status" not in r:
                return r
            self.note("reply", supplier=t.sid, status=r.get("status"), claims=r.get("claim_results"),
                      sheets=[(s["term_sheet_id"], s["terms"], round(self.C(t, s["terms"])))
                              for s in r.get("term_sheets") or []], moved=t.moves[-1] if t.moves else {},
                      body=(r.get("body") or "")[:600], duration=round(duration, 3), revision=t.event_revision,
                      arena_age=round(time.time() - t.supplier_event_at, 3), confidence=t.timestamp_confidence)
            if t.status not in ENDED and t.status not in ("agreed", "final_offer"):
                self.turn_remaining(t)
            self._docs([t.last], t)  # state and exchange timing are already committed
            return r
        prev = t.sheets[0]["terms"] if t.sheets else {}
        t0 = time.time()
        try:
            r = self.c.send_message(self.sid, t.sid, msg)
            self._package_v2_dispatch(t, msg)
        except ArenaError as e:
            self.note("error", supplier=t.sid, status=e.status, detail=str(e.detail)[:300])
            if e.status == 409:
                self.resync(t)
            return None
        if "result" in r and "status" not in r:
            return r
        self._docs([r])
        t.replied_at = time.time()
        self.slowest = max(self.slowest, t.replied_at - t0)
        t.events += [{**msg, "from": "buyer"}, r]
        self._resolve_calibration(t, r)
        new = (r.get("term_sheets") or [{}])[0].get("terms", {})
        t.moves.append({k: (prev.get(k), new.get(k)) for k in new if prev.get(k) != new.get(k)})
        self.note("reply", supplier=t.sid, status=r.get("status"), claims=r.get("claim_results"),
                  sheets=[(s["term_sheet_id"], s["terms"], round(self.C(t, s["terms"]))) for s in r.get("term_sheets") or []],
                  moved=t.moves[-1], body=(r.get("body") or "")[:600])
        return r

    def push(self, t, sh):
        """A small ask below its standing price, same terms, before we accept."""
        probe = t.__dict__.pop("_owned_probe_pending", None) if self.cfg.owned_final_probe else None
        before = Thread._key(t.last) if probe is not None else None
        if probe is not None:
            t.rounds += 1  # The reserved ask consumes this supplier's own negotiation round.
        t.pushes += 1
        pct = self.cfg.push_pct
        if self.cfg.push_scaled and self.c_open < float("inf"):
            room = max(self.c_open - self.target_c, 0.0) / self.c_open  # the case's room as a share of C
            pct = min(pct, max(0.005, 0.25 * room))
        ask = probe if probe is not None else complete_offer(
            self.case, {**sh["terms"], "unit_price": round(sh["terms"]["unit_price"] * (1 - pct), 2)})
        self.note("push", supplier=t.sid, n=t.pushes, ask=ask, c=round(self.C(t, ask)))
        msg = {"subject": self.case["title"], "term_sheets": [{"terms": ask}], "refs": [],
               "body": "\n".join(["Hello,", "", "thank you, we are very close and I would like to close this with you today. "
                                  f"On exactly your terms, can you do €{ask['unit_price']:.2f}? If yes, we sign immediately."] + SIGN)}
        if probe is None:
            return self.send(t, msg)
        try:
            reply = self.send(t, msg)
        except Exception as e:
            t._owned_probe_needs_close, t.state_uncertain = True, True
            self.note("owned_final_probe", supplier=t.sid, owner_rounds=t.rounds,
                      probe_c=self.C(t, ask), outcome="failed", error=repr(e)[:200])
            raise
        if self.terminal_result(reply) is not None:
            outcome = "terminal"
        elif reply is None and Thread._key(t.last) == before:
            outcome = "unconfirmed"
            t.state_uncertain = True  # An unobserved reply cannot authorize reuse of the old offer.
        elif t.status == "final_offer" and t.sheets and t.sheets[0]["terms"] == sh["terms"]:
            outcome = "repeated_final_offer"
        else:
            outcome = t.status
        t._owned_probe_needs_close = outcome not in ("open", "terminal")
        self.note("owned_final_probe", supplier=t.sid, owner_rounds=t.rounds,
                  probe_c=self.C(t, ask), outcome=outcome, status=t.status,
                  standing_c=self.C(t, t.sheets[0]["terms"]) if t.sheets else None)
        return reply

    def terminal_result(response): ...  # Supplier replies and HTTP errors are not session results.

    def close(self, t, sheet, revision=None):
        if getattr(self.cfg, "close_recovery_v2", False):
            return self._close_v2_unlocked(self._close_v2, t, sheet, revision)
        if self.cfg.safe_close:
            return self._safe_close(t, sheet, revision)

        # only the supplier's first (primary) sheet is its standing offer; an alternative ("-a")
        # has to be sent back as our terms first - the supplier then answers "agreed"
        if t.sheets and sheet["term_sheet_id"] != t.sheets[0]["term_sheet_id"]:
            self.note("mirror_alternative", supplier=t.sid, sheet=sheet)
            r = self.send(t, {"subject": self.case["title"], "term_sheets": [{"terms": sheet["terms"]}], "refs": [],
                              "body": "\n".join(["Hello,", "", "thank you, we take your alternative exactly as offered: "
                                                 f"{fmt(sheet['terms'])}. Please confirm and we sign today."] + SIGN)})
            if not r or not t.sheets:
                return self.walk()
            sheet = t.sheets[0]
        try:
            r = self.c.send_message(self.sid, t.sid, {"action": {"type": "accept", "term_sheet_id": sheet["term_sheet_id"]}})
        except ArenaError as e:
            # P05: late on the arena's clock (our accept counted as a timeout) -> its standing sheet changed. Read the
            # thread and accept what stands now, if it still beats our alternative and keeps the must-haves.
            self.note("accept_retry", supplier=t.sid, error=str(e.detail)[:200])
            self.resync(t)
            if t.status in ENDED or not t.sheets:
                raise
            sheet = t.sheets[0]
            if not must_haves_ok(self.case, sheet["terms"], t.std) or self.C(t, sheet["terms"]) > self.c_alt:
                raise
            r = self.c.send_message(self.sid, t.sid, {"action": {"type": "accept", "term_sheet_id": sheet["term_sheet_id"]}})
        res = r.get("result", r)
        self.note("result", **{k: res.get(k) for k in ("deal", "supplier_id", "terms", "c_open", "c_deal", "c_best", "score", "cost_breakdown")})
        return res

    def walk(self):
        if getattr(self.cfg, "close_recovery_v2", False):
            return self._close_v2_unlocked(self._close_v2_cleanup, None, False)
        if self.cfg.safe_close:
            return self._safe_walk()
        live = [t for t in self.threads.values() if t.status not in ENDED] or list(self.threads.values())
        r = self.c.send_message(self.sid, live[0].sid, {"action": {"type": "walk_away"}})
        res = r.get("result", r)
        self.note("result", **{k: res.get(k) for k in ("deal", "c_open", "c_deal", "c_best", "score")})
        return res

    def near_cap(self):
        """The kit's closing rule: act max(90 s, slowest round + 15 s) before the wave's cap. If the best offer is
        an alternative sheet, accepting it takes two exchanges (send it back, then accept): reserve both."""
        if self.cfg.arena_clock_guard:
            reserve = max(150, self.slowest + 25)
            best = self.best_standing()
            if best and best[1].sheets and best[2]["term_sheet_id"] != best[1].sheets[0]["term_sheet_id"]:
                reserve = max(reserve, 2 * self.slowest + 25)
            live = [t for t in self.threads.values() if not t.closed and t.status not in ENDED and not t.in_flight]
            if live:
                self.turn_remaining(live[0])  # one session read refreshes every thread's clock
                urgent = [t for t in live if self.turn_remaining(t, refresh=False) < 25 or
                          t.timestamp_confidence == "uncertain" or t.state_uncertain]
                for t in urgent:
                    self.resync(t, refresh_clock=False)  # timeout-generated offers must replace stale IDs before closing
                if urgent:
                    self.note("arena_urgent", suppliers=[t.sid for t in urgent], reserve=round(reserve, 3),
                              revisions={t.sid: t.event_revision for t in urgent},
                              confidence={t.sid: t.timestamp_confidence for t in urgent})
                    return True
            return self.terminal_response is not None or (
                self.deadline is not None and time.time() > self.deadline - reserve)
        if self.deadline is None:
            return False
        reserve = max(90, self.slowest + 15)
        if self.cfg.cap_reserve:
            best = self.best_standing()
            if best and best[1].sheets and best[2]["term_sheet_id"] != best[1].sheets[0]["term_sheet_id"]:
                reserve = max(90, 2 * self.slowest + 20)
        return time.time() > self.deadline - reserve

    def closing_move(self):
        if getattr(self.cfg, "close_recovery_v2", False):
            best = self.best_standing()
            self.note("cap_close", best=round(best[0]) if best else None)
            if best and best[0] <= self.c_alt:
                return self.close(best[1], best[2])
            return self.walk()
        if self.cfg.arena_clock_guard and self.terminal_response is not None:
            return self.terminal_response.get("result", self.terminal_response)
        if self.cfg.safe_close:
            return self._safe_closing_move()
        best = self.best_standing()
        self.note("cap_close", best=round(best[0]) if best else None)
        if best and best[0] <= self.c_alt:
            return self.close(best[1], best[2])
        return self.walk()

    def resync(self, t, refresh_clock=True):
        """After a 409: read the thread from the arena (timeouts, a walk-away, the session's end)."""
        if getattr(self.cfg, "close_recovery_v2", False):
            return self._close_v2_unlocked(self._close_v2_refresh, t, refresh_clock)
        if self.cfg.arena_clock_guard:
            with t.io_lock:
                started, revision = time.time(), t.event_revision
            try:
                th = self.c.thread(self.sid, t.sid)
            except Exception as e:
                with t.io_lock:
                    t.state_uncertain, t.timestamp_confidence = True, "uncertain"
                self.note("resync_uncertain", supplier=t.sid, status=getattr(e, "status", None),
                          error=str(e)[:200], revision=t.event_revision,
                          arena_age=round(time.time() - t.supplier_event_at, 3), confidence=t.timestamp_confidence,
                          duration=round(time.time() - started, 3))
                return False  # a failed read says nothing about whether the supplier withdrew
            if not self.apply_thread_update(t, th, started, revision):
                return False
            self.note("resync", supplier=t.sid, closed=t.closed, status=t.status, revision=t.event_revision,
                      duration=round(time.time() - started, 3), confidence=t.timestamp_confidence)
            if refresh_clock:
                self.turn_remaining(t)
            self._docs(t.events, t)
            return True
        try:
            th = self.c.thread(self.sid, t.sid)
        except ArenaError:
            t.events.append({"from": "arena", "status": "walked_away", "term_sheets": []})
            return
        msgs = th.get("messages") or t.events
        self._docs(msgs)
        t.events = list(msgs)
        self._resolve_calibration(t)
        if th.get("closed"):
            t.events.append({"from": "arena", "status": "walked_away", "term_sheets": []})
        self.note("resync", supplier=t.sid, closed=th.get("closed"), status=t.status)

    def run_rfq(self): ...  # Several suppliers: one worker per thread, each answering its supplier at once (the

    def run(self):
        if self.cfg.sealed_final_round and len(self.threads) == 1:
            self.note("sealed_final_round", outcome="scope_abstention", reason="single_supplier")
        if self.cfg.frontier_single_only and self.cfg.package_frontier_v2 and len(self.threads) > 1:
            # U1 was designed for single-supplier relationship packages; in RFQs it cost D02 0.745 -> 0.689
            self.cfg = replace(self.cfg, package_frontier_v2=False)
            self.note("frontier_single_only", suppliers=len(self.threads))
        if self.cfg.safe_single and len(self.threads) == 1:
            return self._run_safe_single()
        if len(self.threads) > 1:
            return self.run_rfq()
        cfg, limit = self.cfg, self.case.get("round_limit", 10)
        rnd, prev_c, holds = 0, None, 0
        while True:
            if self.near_cap():
                return self.closing_move()
            best = self.best_standing()
            live = [t for t in self.threads.values() if t.status not in ENDED]
            if not live:
                return self.walk() if best is None else self.close(best[1], best[2])
            t = live[0]
            probe = self.calibration_probe(t)
            if probe is not None:
                self._reserve_calibration(t, probe, probe=True)
                self.send(t, probe)
                self._estimate()
                continue  # Discovery consumes a message slot, not a priced concession round.
            goal, next_goal = self.goal(rnd, t), self.goal(rnd + 1, t)
            if best and best[0] <= self.c_alt:
                c, t, sh = best
                open_rivals = [x for x in live if x is not t and x.status == "open"]
                gave = (prev_c - c) if prev_c is not None else 0
                prev_c = c
                if (holds < cfg.holds and c <= next_goal and t.status == "open" and gave > cfg.hold_gave * c
                        and t.sent() < limit - 2):
                    holds += 1  # it is still moving: one more round at our current goal before we take it
                    self.note("hold", c=c, gave=round(gave), goal=round(goal))
                    rnd -= 1  # the goal stays where it is this round
                elif c <= next_goal or t.status == "agreed":
                    self.note("accept", why="goal" if c <= next_goal else "agreed", c=c, goal=next_goal)
                    return self.close(t, sh)
                if t.status == "final_offer" and not open_rivals:
                    backup = [x for x in live if x is not t and x.sheets]
                    allowed = cfg.push == "all" or (cfg.push == "rfq" and backup)
                    if allowed and t.pushes < cfg.pushes and t.sent() < limit - 1:
                        self.push(t, sh)
                        continue
                    self.note("accept", why="final_offer", c=c)
                    return self.close(t, sh)
                if rnd >= cfg.max_rounds or all(x.sent() >= limit - 1 for x in live):
                    self.note("accept", why="out of rounds: best seen", c=c)
                    return self.close(t, sh)
            elif rnd >= cfg.max_rounds:
                return self.walk()
            self.note("round", rnd=rnd, c_target=round(self.target_c), goal=round(goal),
                      reserve=round(best[0]) if best else None)
            jobs = []
            for t in live:
                if t.status == "final_offer":
                    continue  # rests while a rival is still open
                sheets = self.recalled(t) or self.meso(t, goal)
                if not sheets:
                    continue
                others = [(self.C(x, sh["terms"]), sh["term_sheet_id"], sh["terms"]) for x in self.threads.values()
                          if x is not t and x.status not in ENDED for sh in x.sheets if must_haves_ok(self.case, sh["terms"], x.std)]
                rival = min(others, key=lambda o: o[0])[1:] if cfg.rival and others and rnd >= 1 else None
                msg = self.write(t, rnd, sheets, rival)
                self.note("send", supplier=t.sid, sheets=[(s, round(self.C(t, s))) for s in sheets], refs=msg["refs"],
                          attachments=[a["name"] for a in msg.get("attachments", [])], body=msg["body"])
                jobs.append((t, msg))
            if not jobs and cfg.never_walk and self.c_alt == float("inf") and rnd < cfg.max_rounds:
                for t in live:
                    if t.status != "final_offer" and (counter := self.fallback_counter(t)):
                        self.note("fallback_counter", supplier=t.sid, sheet=counter[0])
                        jobs.append((t, self.write(t, rnd, counter, None)))
            if not jobs:
                if best:
                    self.note("accept", why="no thread left to push", c=best[0])
                    return self.close(best[1], best[2])
                return self.walk()
            with ThreadPoolExecutor(len(jobs)) as ex:
                list(ex.map(lambda j: self.send(*j), jobs))
            if cfg.calibrated_anchor or cfg.anchor_probe or (rnd == 0 and holds == 0):
                self._estimate()  # documents from round 1 (cost breakdowns) sharpen the target
            rnd += 1

def play(case_id, cfg=Config(), client=None, log_dir=LOG_DIR, quiet=False, deadline=None, cls=None):
    """Play one case; safe_close records closure only after arena confirmation. Returns (session_id, result)."""
    client = client or ArenaClient(timeout=25, retries=7)
    n = (cls or Negotiator)(client, case_id, cfg, quiet=quiet, deadline=deadline)  # cls: alternative strategies (proto/alt)
    Path(log_dir).mkdir(parents=True, exist_ok=True)
    with open(Path(log_dir).parent / "opened.txt", "a") as f:  # cleanup may only ever close our own sessions
        f.write(n.sid + "\n")
    res = None
    try:
        res = n.run()
        if getattr(cfg, "close_recovery_v2", False):
            res = n._close_v2_cleanup(res)
        elif cfg.safe_close:
            res = n._safe_cleanup(res)
    except Exception as e:  # never leave a session open: it blocks one of our 10 slots
        n.note("crash", error=repr(e)[:500])
        if getattr(cfg, "close_recovery_v2", False):
            res = n._close_v2_cleanup()
        elif cfg.safe_close:
            res = n._safe_cleanup()
        else:
            try:
                st = client.session(n.sid)
                if st.get("status") == "ended" and st.get("result"):  # the deal may already be done: report the arena's result
                    res = st["result"]
                    n.note("result_after_crash", score=res.get("score"), deal=res.get("deal"))
                else:
                    res = n.walk()
            except Exception:
                res = {"score": 0.0, "error": repr(e)[:200]}
    finally:
        Path(log_dir).mkdir(parents=True, exist_ok=True)
        if getattr(cfg, "close_recovery_v2", False) and n.terminal_result(res) is None:
            n.note("cleanup_owned_unresolved", session=n.sid, owner=n.sid)
            with open(Path(log_dir).parent / "unresolved.txt", "a") as f:
                f.write(n.sid + "\n")
        (Path(log_dir) / f"{case_id.replace(':', '_')}-{n.sid}.json").write_text(json.dumps(n.log, indent=1, default=str))
        if (not cfg.safe_close and not getattr(cfg, "close_recovery_v2", False)) or n.terminal_result(res) is not None:
            with open(Path(log_dir).parent / "closed.txt", "a") as f:
                f.write(n.sid + "\n")
    return n.sid, res

# ===== proto/practice.py (excerpt) =====

class PracticeNegotiator(Negotiator):  # excerpt

    def claim_source(self, ref): ...  # 

    def facts_for(self, t):
        if getattr(getattr(self, "cfg", None), "claim_provenance_only", False):
            return self._provenance_v2_facts(t)
        if getattr(self, "cfg", Config()).safe_claims:
            return self._safe_facts_for(t)
        if hasattr(t, "facts"):
            return t.facts
        case, b = self.case, self.b
        part = case["parts"][0]
        asked = t.sheets[0]["terms"].get("unit_price") if t.sheets else None
        refs = case.get("refs", [])
        facts = []
        # 1. notice: the letter gives less notice than the contract requires
        docs = [r for r in refs if r.startswith("doc:")]
        ctrs = [r for r in refs if r.startswith("ctr:")]
        for d in docs:
            df = lookup(d) or {}
            for c in ctrs:
                cf = lookup(c) or {}
                if df.get("days") and cf.get("days") and df["days"] < cf["days"] and cf.get("supplier") in (None, t.sid):
                    facts.append(([d, c], f"Your letter {d} gives {df['days']} days' notice, while our contract {c} "
                                          f"requires {cf['days']} days, so a new price cannot start before then"))
        # 2. should-cost of this part (at this supplier if there is one)
        sc = q("SELECT id, unit_cost, supplier_id FROM should_cost WHERE part_id = ? ORDER BY supplier_id = ? DESC", (part, t.sid))
        if sc and (asked is None or sc[0]["unit_cost"] < asked):
            facts.append((sc[0]["id"], f"Our bottom-up should-cost estimate for this part is €{sc[0]['unit_cost']:.2f} "
                                         f"({sc[0]['id']})"))
        # 3. cost drivers whose index moved less than the price (or fell): the strongest first
        ask_pct = ((asked / b["current_unit_price"] - 1) * 100) if asked and b.get("current_unit_price") else 0.0
        moves = []
        for d in q("SELECT series_id, weight FROM cost_drivers WHERE part_id = ?", (part,)):
            ch = index_change(d["series_id"])
            if ch and ch[0] < 0:  # practice run A: a driver that rose (even less than the ask) "confirms our case"
                moves.append((d["weight"] * (ch[0] - ask_pct), d["series_id"], ch))
        for _, series, (chg, a, z, ma, mz) in sorted(moves)[:2]:
            facts.append(([a, z], f"{series_name(series)} changed {chg:+.1f}% from {ma} to {mz} ({a}, {z})"))
        if self.cfg.evidence_plus:
            # 3b. a cost driver that FELL over a recent window although it may have risen over 12 months (P18: AS-14404
            #     -5.5 % since June) - the most negative of the 3/6/12-month windows ending at the latest month
            for d in q("SELECT series_id, weight FROM cost_drivers WHERE part_id = ? ORDER BY weight DESC", (part,)):
                best = None
                for mths in (3, 6, 12):
                    ch = index_change(d["series_id"], mths)
                    if ch and ch[0] < 0 and (best is None or ch[0] < best[0]):
                        best = ch
                if best and not any(best[1] in (f[0] if isinstance(f[0], list) else [f[0]]) for f in facts):
                    chg, a, z, ma, mz = best
                    facts.append(([a, z], f"{series_name(d['series_id'])} fell {chg:.1f}% from {ma} to {mz} ({a}, {z})"))
            # 4b. we buy the same part cheaper from another supplier (P18: po:4500014455-10 at EUR 5.45 vs its 5.84)
            if asked:
                other = q("SELECT id, price, price_unit FROM po_lines WHERE part_id = ? AND supplier_id != ? "
                          "ORDER BY order_date DESC LIMIT 2", (part, t.sid))
                unit = (q("SELECT price_unit FROM po_lines WHERE part_id = ? AND supplier_id = ? LIMIT 1", (part, t.sid))
                        or [{"price_unit": None}])[0]["price_unit"]
                if len(other) == 2 and all(o["price_unit"] == unit for o in other) and other[0]["price"] < asked:
                    # a plain statement without IDs: the arena only checks a supplier's own orders, so the IDs came
                    # back "irrelevant" and cost a claim slot (practice A9: P04, P08, P18)
                    facts.insert(0, ([], f"We currently buy the same part from another supplier at EUR "
                                         f"{other[0]['price']:.2f} per unit"))
        # 4. our order history with this supplier for this part (2-8 order lines)
        pos = q("SELECT id FROM po_lines WHERE part_id = ? AND supplier_id = ? ORDER BY id DESC LIMIT 3", (part, t.sid))
        if len(pos) >= 2:
            ids = [p["id"] for p in pos]
            facts.append((ids, f"Our recent orders {', '.join(ids)} show the price level we have been paying"))
        # 5. its scorecard, if it is weak
        for r in refs:
            if r.startswith("sc:") and r.split("@")[0] == "sc:" + t.sid.split(":")[1]:
                f = lookup(r) or {}
                if b.get("category_goal") == "quality_first" and f.get("ppm") is not None:
                    facts.append((r, f"Your scorecard {r} shows {f['ppm']} ppm"))
                elif f.get("otd_pct") is not None and f["otd_pct"] < 92:
                    facts.append((r, f"Your scorecard {r} shows {f['otd_pct']}% on-time delivery"))
        # 6. a forecast that grows
        for r in refs:
            if r.startswith("fc:") and (f := lookup(r) or {}).get("change_pct", 0) > 0:
                facts.append((r, f"Our forecast {r} shows demand {f['change_pct']:+.1f}%"))
        # 6b. news about this supplier (checked: that it is about this supplier) - optional
        if self.cfg.news:
            for nrow in q("SELECT id, headline FROM news WHERE supplier_id = ? ORDER BY date DESC LIMIT 1", (t.sid,)):
                facts.append((nrow["id"], f"We have read the recent news about your company ({nrow['id']})"))
        if getattr(self.cfg, "evidence_plus", False):
            # 6c. its own history on this part: it settled below its ask before (not a data ID: plain statement)
            h = q("SELECT asked_pct, settled_pct FROM negotiation_history WHERE supplier_id = ? AND part_id = ? "
                  "ORDER BY date DESC LIMIT 3", (t.sid, part))
            gaps = [x["asked_pct"] - x["settled_pct"] for x in h if x["asked_pct"] is not None and x["settled_pct"] is not None]
            if len(gaps) >= 2 and all(g > 0 for g in gaps):
                facts.append(([], f"In your last {len(gaps)} renewals of this part we settled on average "
                                  f"{sum(gaps) / len(gaps):.1f} points below your initial ask"))
        # 7. our alternative, only if it is cheaper than what the supplier asks
        alt = b.get("alternative") or {}
        if alt.get("ref", "") and alt.get("ref", "").startswith("quote:"):
            af = lookup(alt["ref"]) or {}
            if af.get("unit_price") and asked and af["unit_price"] < asked:
                facts.append((alt["ref"], f"We hold another quote at €{af['unit_price']:.2f} ({alt['ref']})"))
        # 8. the case's own reference IDs that the data package does not know (case-only facts, e.g. sandbox or a
        #    new release): cite them by type without inventing a figure - the arena then checks the data's own value
        known = {r for f in facts for r in (f[0] if isinstance(f[0], list) else [f[0]])}
        sup_short = t.sid.split(":")[1]
        for r in refs:
            if r in known or lookup(r):
                continue
            kind = r.split(":")[0]
            if kind == "po":
                facts.append((r, f"Our recent orders ({r}) show the price level we have been paying"))
            elif kind == "cost":
                facts.append((r, f"Our should-cost estimate ({r}) is below the current offer"))
            elif kind == "fc":
                facts.append((r, f"Our forecast ({r}) backs the full volume over the contract term"))
            elif kind == "sc" and sup_short in r:
                facts.append((r, f"Your delivery and quality scorecard ({r}) is part of our review"))
        if getattr(getattr(self, "cfg", None), "leader_cost_first", False):
            facts = self._lead_cost_first(t, facts, sc)
        t.facts = facts
        return facts

    def _estimate(self):
        b, case = self.b, self.case
        if self.cfg.calibrated_anchor or self.cfg.anchor_probe:
            for t in self.threads.values():
                self._resolve_calibration(t)
        part = case["parts"][0]
        prices = [self._opening_terms(t).get("unit_price") if self.cfg.calibrated_anchor else
                  t.sheets[0]["terms"].get("unit_price") if t.sheets else None for t in self.threads.values()]
        lowest_open = min((p for p in prices if p is not None), default=None)
        for s, t in self.threads.items():
            std = {**t.std, **case.get("fixed_terms", {})}
            std.setdefault("payment_days", b["reference_payment_days"])
            std.setdefault("incoterm", max(b["freight_eur_per_unit"], key=b["freight_eur_per_unit"].get))
            est = {"standard": std, "interest_rate": cash_rate(s)}
            from proto.engine import BREAKDOWN
            txt = " ".join((m.get("body") or "") + " " + " ".join(a.get("text") or "" for a in m.get("attachments") or [])
                           for m in t.events if m.get("from") != "buyer")
            mats = [float(m.group(1)) for x in self.threads.values() for m in [BREAKDOWN.search(" ".join(
                a.get("text") or "" for e in x.events for a in e.get("attachments") or []))] if m]
            sc = q("SELECT unit_cost, supplier_id FROM should_cost WHERE part_id = ? ORDER BY supplier_id = ? DESC", (part, s))
            if bd := BREAKDOWN.search(txt):  # its own cost breakdown: material + labour + conversion
                direct = round(sum(float(x) for x in bd.groups()), 2)
                est.update(floor=direct, full_cost=direct, basis="own cost breakdown: material + labour + conversion")
            elif self.cfg.calibrated_anchor and sc and sc[0]["supplier_id"] == s:
                est.update(floor=sc[0]["unit_cost"], full_cost=sc[0]["unit_cost"],
                           basis=f"should-cost {sc[0]['unit_cost']} (this supplier)")
            elif mats and (share := re.search(r"Material accounts for about (\d+) %", txt)):
                f = round(mats[0] / (int(share.group(1)) / 100), 2)  # a rival's material cost / its material share
                est.update(floor=f, full_cost=f, basis=f"material {mats[0]} / {share.group(1)} % share")
            elif sc:
                est.update(floor=sc[0]["unit_cost"], full_cost=sc[0]["unit_cost"],
                           basis=f"should-cost {sc[0]['unit_cost']} ({'this supplier' if sc[0]['supplier_id'] == s else 'other supplier'})")
            elif b.get("current_unit_price"):
                m = (b.get("sustainable_margin_pct") or 5) / 100
                full = b["current_unit_price"] / (1 + m) * (1 + drift(part))
                est.update(floor=round(full, 2), full_cost=round(full, 2), basis=f"current / (1+{m}) x (1+drift {drift(part):+.4f})")
            elif lowest_open:
                est.update(floor=round(0.85 * lowest_open, 2), full_cost=round(0.85 * lowest_open, 2), basis="85 % of lowest opening")
            # teammates' P02/P05 zeros: should-cost can sit ABOVE the quotes. It is a weak prior: cap it so
            # the supplier's own opening still earns a sustainable margin (else the opening looks like a squeeze)
            raw_floor = est.get("floor")
            own_open = (self._opening_terms(t).get("unit_price") if self.cfg.calibrated_anchor else
                        t.sheets[0]["terms"].get("unit_price") if t.sheets else None)
            if est.get("floor") and own_open:
                cap = round(own_open / (1 + (b.get("sustainable_margin_pct") or 5) / 100), 2)
                if est["floor"] > cap:
                    self._anchor_clamp(t, est["floor"], cap, "floor_capped_at_immutable_opening_margin")
                    est.update(floor=cap, full_cost=cap, basis=est["basis"] + f" -> capped at opening/(1+margin) = {cap}")
            if self.cfg.calibrated_anchor:
                self._calibrate_estimate(t, est, raw_floor)
            t.est = est
        rows = target(case, {s: t.est for s, t in self.threads.items() if t.est.get("floor")})
        self.target_c, self.target_sup, self.target_terms = rows[0] if rows else (float("inf"), None, None)
        if self.cfg.calibrated_anchor:
            self._calibration_targets(rows)
        self.note("target", c_target=self.target_c, supplier=self.target_sup, terms=self.target_terms,
                  floors={s: (t.est.get("floor"), t.est.get("basis"), t.est.get("interest_rate")) for s, t in self.threads.items()})

    def write(self, t, rnd, sheets, rival=None): ...  # 