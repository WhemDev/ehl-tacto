"""CLUSTER / SAFEZONE negotiator (the lead's spec, with the lead's own review points 1-3).

Procedure
  1. NetPreis: every offer is compared on an adjusted net price = landed cost per unit (our total cost C / units,
     which already prices payment days at the case's interest rate) x the mean present-value factor of 0/12/24-month
     installments at a real rate built from investment return (case interest rate) and inflation (2 %).
  2. First counter to every supplier with the standard individual algorithm (A10/G5-1: goal(0), meso, write).
  3. CLUSTER: if the NetPreis spread of the replies exceeds 7 %, shortlist. Two rules are computed and logged:
     the ratio rule (2/3, 3/5, 4/8 = floor(n/2) + 1 for n <= 5) and the lead's review point 3, a standard-deviation
     cutoff from the lowest bid (NetPreis <= min + 1 SD). The SD rule decides, but never below 2 vendors while 2 or
     more exist (a live rival is our strongest measured lever). Only shortlisted vendors are negotiated further.
  4. TENSION per vendor = P(next reply is final / walk-away): stop_risk from proto/stance.py mapped to a probability
     with the measured band calibration (8 / 11 / 28 / 49 %), + 0.20 per hard-stop phrase, status final_offer = 0.95,
     walked_away / no_bid = 1.0.
  5. Aggressive counters to the shortlisted vendors (ask near our minimum, rival cited) until a vendor's tension
     crosses the threshold (cs_tension: 0.60 spec, 0.45 the lead's review point 2) - then it is frozen.
  6. When every vendor has crossed: SAFEZONE = the best frozen offer (always one guaranteed vendor). Its clock is kept
     alive (review point 1: a short holding e-mail when its 60 s run low) and it is closed before the round limit /
     wave cap. The other cluster vendors get "beat this" counters until a superior offer arrives (it becomes the new
     SAFEZONE) or they are terminal. When all active vendors are terminal, accept the lowest offer.
  Contract length <= 12 months unless the longer package is exceptionally better (C at least 3 % lower at the same
  price; fixed terms and allowed options always win). A 36-48-month prospect is only mentioned in the wording.
  SOUL: the Sonnet writer (llm_writer) with a positive-sentiment tone goal; its validator still blocks any new
  number, ID or promise.
Hard guards: never above a vendor's standing price on the same terms, allowed options and must-haves only, never accept
C above our alternative, one worker per vendor, no lock held while sending, every decision logged.
"""

import math
import re
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from arena_kit import complete_offer, must_haves_ok
from proto.engine import ENDED, SIGN, fmt
from proto.practice import PracticeNegotiator
from proto.target import price_for_c

INFLATION = 0.02
HARD_STOP = re.compile(r"final offer|letztes|last price|please decide|take it or leave it|does(?: not|n't) change our "
                       r"calculation|which figures|withdraw", re.I)
BANDS = [(0.05, 0.08), (0.24, 0.11), (0.365, 0.28), (0.55, 0.49), (0.80, 0.55)]  # stop_risk -> P(stop next), measured
HINT = ("If this first period works well for both of us, we would be glad to discuss a longer partnership of 36 to 48 "
        "months on even better mutual terms.")

_stance, _stance_lock = None, threading.Lock()


def stance():
    global _stance
    with _stance_lock:
        if _stance is None:
            from proto.stance import Stance

            _stance = Stance()
        return _stance


def p_stop(stop_risk):
    """piecewise-linear map of the analyser's stop_risk onto the measured P(next reply is final / walk-away)"""
    if stop_risk <= BANDS[0][0]:
        return BANDS[0][1]
    for (x0, y0), (x1, y1) in zip(BANDS, BANDS[1:]):
        if stop_risk <= x1:
            return y0 + (y1 - y0) * (stop_risk - x0) / (x1 - x0)
    return BANDS[-1][1]


class Negotiator(PracticeNegotiator):
    # ---------- prices ----------
    def netpreis(self, t, terms):
        units = max(1.0, float(self.b.get("need_per_year") or 1) * float(self.b.get("horizon_years") or 1))
        r = float(self.b.get("interest_rate") or 0.08)
        real = (1 + r) / (1 + INFLATION) - 1
        factor = sum((1 + real) ** (-m / 12) for m in (0, 12, 24)) / 3
        return self.C(t, terms) / units * factor

    def standing(self, t):
        """(C, NetPreis, sheet) of the vendor's primary standing offer, or None. A reply without a term sheet (e.g. to our
        holding mail) does not withdraw the offer: the last supplier sheet stays the standing one (CS2 D02 bug: the
        SAFEZONE vanished after a keepalive reply and we accepted a worse vendor)."""
        if t.status in ENDED:
            return None
        sheets = t.sheets or next((m.get("term_sheets") for m in reversed(t.events)
                                   if m.get("from") not in ("buyer", "arena") and m.get("term_sheets")), None)
        if not sheets:
            return None
        sh = sheets[0]
        if not must_haves_ok(self.case, sh["terms"], t.std):
            return None
        return self.C(t, sh["terms"]), self.netpreis(t, sh["terms"]), sh

    # ---------- packages ----------
    def contract_rule(self, t, sheets):
        """<= 12 months unless the longer package is exceptional; fixed terms / allowed options always win"""
        if "contract_months" not in self.case.get("negotiable", []):
            return sheets
        opts = [m for m in self.case.get("term_options", {}).get("contract_months", []) if isinstance(m, int | float)]
        short = max([m for m in opts if m <= 12], default=None)
        out = []
        for s in sheets:
            if short is None or (s.get("contract_months") or 0) <= 12:
                out.append(s)
                continue
            alt = complete_offer(self.case, {**s, "contract_months": short})
            c_long, c_short = self.C(t, s), self.C(t, alt)
            exceptional = c_long <= c_short * 0.97
            self.note("cs_contract_rule", supplier=t.sid, long=s.get("contract_months"), short=short,
                      c_long=round(c_long), c_short=round(c_short), kept_long=exceptional)
            out.append(s if exceptional or not must_haves_ok(self.case, alt, t.std) else alt)
        return out

    def cap(self, t, sheets):
        """never ask above the vendor's standing price on the same terms"""
        their = t.sheets[0]["terms"] if t.sheets else {}
        out = []
        for s in sheets:
            same = {k: v for k, v in s.items() if k != "unit_price"} == {k: v for k, v in their.items() if k != "unit_price"}
            if same and their.get("unit_price") is not None and s["unit_price"] > their["unit_price"]:
                s = {**s, "unit_price": their["unit_price"]}
            if must_haves_ok(self.case, s, t.std):
                out.append(s)
        return out

    def packages(self, t, c_goal):
        sheets = self.meso(t, c_goal)
        if sheets and self.cfg.cs_lock_incoterm:
            sheets = self.lock_incoterm(t, sheets, c_goal)
        if not sheets:
            sheets = self.fallback_counter(t)
            if sheets and self.cfg.cs_lock_incoterm:
                sheets = self.lock_incoterm(t, sheets, None)
        return self.cap(t, self.contract_rule(t, [complete_offer(self.case, dict(s)) for s in sheets]))

    def rival_for(self, t):
        best = None
        for x in self.threads.values():
            if x is t or x.sid not in self.cluster:
                continue
            st = self.standing(x)
            if st and (best is None or st[0] < best[0]):
                best = (st[0], st[2]["term_sheet_id"], st[2]["terms"])
        return best[1:] if best else None

    def message(self, t, sheets, rival, hint=False):
        msg = self.write(t, self.k[t.sid], sheets, rival)
        if hint and HINT not in msg["body"]:
            msg["body"] = msg["body"].replace("\nBest regards", "\n" + HINT + "\n\nBest regards", 1)
        self.k[t.sid] += 1
        self.note("send", supplier=t.sid, rnd=self.k[t.sid] - 1, sheets=[(s, round(self.C(t, s))) for s in sheets],
                  refs=msg.get("refs"), body=msg["body"])
        return msg

    # ---------- tension ----------
    def update_tension(self, t):
        if t.status in ("walked_away", "no_bid") or (t.status in ENDED and t.status != "agreed"):
            tension, info = 1.0, {"status": t.status}
        else:
            body = t.last.get("body") or ""
            try:
                a = stance().analyze(body)
                sr, mv = a["stop_risk"], a["move"]
            except Exception as e:  # no embeddings: phrases and status still work
                sr, mv = 0.3, 0.0
                self.note("cs_stance_failed", supplier=t.sid, error=repr(e)[:200])
            phrases = sorted({m.group(0).lower() for m in HARD_STOP.finditer(body)})
            tension = min(1.0, p_stop(sr) + 0.20 * len(phrases))
            if t.status == "final_offer":
                tension = max(tension, 0.95)
            info = {"stop_risk": sr, "move": mv, "p_stop": round(p_stop(sr), 3), "phrases": phrases, "status": t.status}
        with self.lock:
            self.tension[t.sid] = tension
            if tension >= self.cfg.cs_tension:
                self.breached.add(t.sid)
        self.note("cs_tension", supplier=t.sid, tension=round(tension, 3), threshold=self.cfg.cs_tension, **info)

    def terminal(self, t):
        return (t.status in ENDED or t.status == "final_offer" or self.tension.get(t.sid, 0) >= 0.9
                or t.sent() >= self.limit - 1)

    # ---------- cluster ----------
    def build_cluster(self):
        live = {sid: self.standing(t) for sid, t in self.threads.items()}
        live = {sid: st for sid, st in live.items() if st}
        if not live:
            self.cluster = set(self.threads)
            return
        nps = {sid: st[1] for sid, st in live.items()}
        lo, hi, n = min(nps.values()), max(nps.values()), len(nps)
        spread = (hi - lo) / lo if lo else 0.0
        k_ratio = n // 2 + 1 if n <= 5 else max(1, n // 2)
        by_price = sorted(nps, key=nps.get)
        ratio_set = set(by_price[:k_ratio])
        sd = statistics.stdev(nps.values()) if n >= 2 else 0.0
        sd_set = {sid for sid, v in nps.items() if v <= lo + sd}
        if spread > 0.07:
            chosen = set(sd_set)
            if n >= 2 and len(chosen) < 2:
                chosen |= set(by_price[:2])  # keep a live rival: rival citation is worth +0.13 on D02
        else:
            chosen = set(nps)
        self.cluster = chosen
        self.note("cs_cluster", n=n, netpreis={s: round(v, 4) for s, v in nps.items()}, spread=round(spread, 4),
                  shortlist_needed=spread > 0.07, ratio_rule=sorted(ratio_set), sd=round(sd, 4),
                  sd_rule=sorted(sd_set), chosen=sorted(chosen),
                  note=("2 vendors: ratio rule keeps both; SD cutoff (min + 1 SD) keeps only the lowest - floored at 2 "
                        "to keep a rival" if n == 2 else ""))

    # ---------- decisions ----------
    def best(self):
        rows = [(st[0], t, st[2]) for t in self.threads.values() if t.sid in self.cluster and (st := self.standing(t))]
        rows = [r for r in rows if r[0] <= self.c_alt]
        return min(rows, key=lambda r: r[0]) if rows else None

    def decide(self, t):
        """under self.lock: ('stop'|'wait'|'close'|'walk'|'send', payload)"""
        if self.closing:
            return "stop", None
        now = time.time()
        members = [self.threads[s] for s in self.cluster]
        best = self.best()
        if best is None and all(x.status in ENDED for x in members):
            self.closing = True
            return "walk", None
        if now > self.wave_end - 90 and best:  # wave cap: never lose the best standing offer
            self.closing = True
            return "close", (best[1], best[2], "wave_cap")
        if self.cfg.cs_no_direct_accept and len(self.threads) > 1:
            return self.decide_nda(t, now, members, best)  # no direct accept: SAFEZONE + beat rounds
        if best and math.isfinite(self.target_c) and best[0] <= self.target_c * 1.005:
            self.closing = True
            return "close", (best[1], best[2], "at_target")
        st = self.standing(t)
        if t.status == "agreed" and st and best and st[0] <= best[0] * 1.001:
            self.closing = True
            return "close", (t, st[2], "agreed")
        if all(s in self.breached for s in self.cluster) and best:
            if self.safe is None or self.standing(self.threads[self.safe]) is None or best[0] < self.safe_c:
                self.safe, self.safe_c = best[1].sid, best[0]
                self.note("cs_safezone", supplier=self.safe, c=round(best[0]), tension=self.tension)
            others = [x for x in members if x.sid != self.safe]
            safe_t = self.threads[self.safe]
            if all(self.terminal(x) for x in others) or safe_t.sent() >= self.limit - 2:
                self.closing = True
                return "close", (best[1], best[2], "all_terminal" if all(self.terminal(x) for x in others)
                                 else "safezone_round_limit")
        if t.sid == self.safe:
            if (now - t.replied_at > 38 and t.sent() < self.limit - 2 and self.keepalive[t.sid] < 2
                    and t.status not in ENDED):
                self.keepalive[t.sid] += 1
                return "send", ("keepalive", None)
            return "wait", None
        if t.status in ENDED or t.sid not in self.cluster or st is None:
            return "stop", None
        if t.sent() >= self.limit - 2:
            return "wait", None
        if t.sid not in self.breached:
            # aggressive: ask near our minimum, conceding only slowly; rival cited
            share = min(0.6, 0.15 + 0.15 * self.aggr[t.sid])
            floor = self.target_c if math.isfinite(self.target_c) else self.goal(0, t)
            c_goal = floor + (st[0] - floor) * share
            self.aggr[t.sid] += 1
            return "send", ("counter", c_goal)
        if self.safe is not None and t.sid != self.safe and not self.terminal(t):
            return "send", ("beat", self.safe_c * 0.985)
        if now - t.replied_at > 38 and t.sent() < self.limit - 3 and self.keepalive[t.sid] < 1 and t.status not in ENDED:
            self.keepalive[t.sid] += 1  # a frozen SAFEZONE candidate must not time out (review point 1)
            return "send", ("keepalive", None)
        return "wait", None

    # ---------- cs_lock_incoterm ----------
    def lock_incoterm(self, t, sheets, c_goal):
        """keep the vendor's own (allowed) incoterm in every package: rebuild and re-price to the same C goal"""
        if "incoterm" not in self.case.get("negotiable", []) or not t.sheets:
            return sheets
        their = t.sheets[0]["terms"]
        mine = their.get("incoterm")
        allowed = (self.case.get("term_options") or {}).get("incoterm") or []
        req = getattr(t, "required", None) or {}
        if mine is None or mine not in allowed or ("incoterm" in req and mine not in req["incoterm"]):
            return sheets
        their_price = their.get("unit_price")
        their_c = self.C(t, their) if their_price is not None else float("inf")
        est = t.est if self.relationship else None
        out, changed = [], []
        for s in sheets:
            if s.get("incoterm") == mine:
                new = s
            else:
                try:
                    pkg = {k: v for k, v in complete_offer(self.case, {**s, "incoterm": mine}).items() if k != "unit_price"}
                    goal = c_goal if c_goal is not None else self.C(t, s)
                    p = price_for_c(self.case, pkg, t.std, goal, est)
                    if their_price is not None:
                        p = min(p, their_price)  # never above its standing price
                    new = complete_offer(self.case, {**pkg, "unit_price": p})
                    if (new.get("unit_price") is None or new["unit_price"] <= 0.5
                            or not must_haves_ok(self.case, new, t.std) or self.C(t, new) >= their_c):
                        continue
                except Exception as e:
                    self.note("cs_incoterm_lock_failed", supplier=t.sid, error=f"{type(e).__name__}: {str(e)[:200]}")
                    return sheets
                changed.append((s.get("incoterm"), mine, new["unit_price"]))
            if new not in out:
                out.append(new)
        if not out:
            self.note("cs_incoterm_lock_failed", supplier=t.sid, reason="no valid locked package", incoterm=mine)
            return sheets
        if changed:
            self.note("cs_incoterm_locked", supplier=t.sid, incoterm=mine, changes=changed,
                      goal=None if c_goal is None else round(c_goal))
        return out

    # ---------- cs_no_direct_accept ----------
    def safe_eligible(self, row):
        c, x, _ = row
        return (x.sid in self.breached or x.status in ("agreed", "final_offer")
                or (math.isfinite(self.target_c) and c <= self.target_c * 1.005))

    def update_safezone(self, members):
        """under self.lock: the SAFEZONE is the lowest guaranteed offer; a cheaper standing offer replaces it"""
        if self.safe is not None:
            cur = self.standing(self.threads[self.safe])
            if cur is None or cur[0] > self.c_alt:
                self.note("cs_safezone_lost", supplier=self.safe)
                self.safe, self.safe_c = None, float("inf")
            else:
                self.safe_c = cur[0]
        rows = [(st[0], x, st[2]) for x in members if (st := self.standing(x)) and st[0] <= self.c_alt]
        for _ in range(2):
            if self.safe is None:
                pool, why = [r for r in rows if self.safe_eligible(r)], "first_terminal_or_target"
            else:
                pool, why = [r for r in rows if r[1].sid != self.safe and r[0] < self.safe_c], "beats_safezone"
            if not pool:
                break
            c, x, _ = min(pool, key=lambda r: r[0])
            self.note("cs_safezone", supplier=x.sid, c=round(c), why=why, previous=self.safe, tension=self.tension)
            self.safe, self.safe_c = x.sid, c

    def beat_done(self, x, now):
        if x.sid in self.busy:  # its reply has not arrived yet
            return False
        if x.status in ENDED or x.status in ("walked_away", "no_bid", "agreed") or self.standing(x) is None:
            return True
        return (x.sent() >= self.limit - 2 or now > self.wave_end - 90
                or self.beats[x.sid] >= self.cfg.cs_beat_rounds)

    def decide_nda(self, t, now, members, best):
        """under self.lock: like decide, but an acceptable offer becomes the SAFEZONE instead of closing the deal"""
        self.update_safezone(members)
        st = self.standing(t)
        if self.safe is not None:
            safe_t = self.threads[self.safe]
            pending = [x.sid for x in members if x.sid != self.safe and not self.beat_done(x, now)]
            if best is not None and (not pending or safe_t.sent() >= self.limit - 2):
                self.closing = True
                return "close", (best[1], best[2], "nda_beats_done" if not pending else "safezone_round_limit")
            if t.sid == self.safe:
                if (now - t.replied_at > 38 and t.sent() < self.limit - 2 and self.keepalive[t.sid] < 2
                        and t.status not in ENDED):
                    self.keepalive[t.sid] += 1
                    return "send", ("keepalive", None)
                return "wait", None
        if t.status in ENDED or t.sid not in self.cluster or st is None:
            return "stop", None
        if t.sent() >= self.limit - 2:
            return "wait", None
        if self.safe is not None:
            if self.beats[t.sid] < self.cfg.cs_beat_rounds and t.status != "agreed":
                self.beats[t.sid] += 1  # also after a final offer: it may still beat the SAFEZONE
                return "send", ("beat", self.safe_c * 0.985)
        elif t.sid not in self.breached:
            share = min(0.6, 0.15 + 0.15 * self.aggr[t.sid])
            floor = self.target_c if math.isfinite(self.target_c) else self.goal(0, t)
            c_goal = floor + (st[0] - floor) * share
            self.aggr[t.sid] += 1
            return "send", ("counter", c_goal)
        if now - t.replied_at > 38 and t.sent() < self.limit - 3 and self.keepalive[t.sid] < 1 and t.status not in ENDED:
            self.keepalive[t.sid] += 1
            return "send", ("keepalive", None)
        return "wait", None

    # ---------- cs_stagger ----------
    def first_send(self, t, msg):
        try:
            if self.send(t, msg) is not None:
                self.update_tension(t)
        except Exception as e:
            self.note("cs_worker_error", supplier=t.sid, phase="first", error=f"{type(e).__name__}: {str(e)[:200]}")

    def staggered_first(self):
        """cheapest opening first; after its reply (or 25 s) the others open citing its fresh offer"""
        def opening_c(t):
            st = self.standing(t)
            return st[0] if st else float("inf")

        def opening_rival(t):
            others = [(self.C(x, x.sheets[0]["terms"]), x.sheets[0]["term_sheet_id"], x.sheets[0]["terms"])
                      for x in self.threads.values() if x is not t and x.sheets
                      and must_haves_ok(self.case, x.sheets[0]["terms"], x.std)]
            return min(others, key=lambda o: o[0])[1:] if others and self.cfg.rival else None

        order = sorted(self.threads.values(), key=opening_c)
        lead, others = order[0], order[1:]
        self.note("cs_stagger", lead=lead.sid, opening_c={t.sid: round(opening_c(t)) if math.isfinite(opening_c(t)) else None
                                                         for t in order})
        with ThreadPoolExecutor(max(1, len(self.threads))) as ex:
            sheets = self.packages(lead, self.goal(0, lead))
            lead_msg = self.message(lead, sheets, None, hint=True) if sheets else None
            done = threading.Event()

            def run_lead():
                try:
                    self.first_send(lead, lead_msg)
                finally:
                    done.set()

            if lead_msg is not None:
                ex.submit(run_lead)
                done.wait(25)
            fresh = None
            if lead_msg is not None and done.is_set() and self.cfg.rival:
                st = self.standing(lead)
                if st:
                    fresh = (st[2]["term_sheet_id"], st[2]["terms"])
            self.note("cs_stagger_release", lead=lead.sid, lead_replied=done.is_set(), rival=fresh[0] if fresh else None)
            jobs = []
            for t in others:
                sheets = self.packages(t, self.goal(0, t))
                if sheets:
                    jobs.append((t, self.message(t, sheets, fresh or opening_rival(t), hint=True)))
            list(ex.map(lambda j: self.first_send(*j), jobs))

    def build(self, t, kind, payload):
        """under self.lock: the message for this action (packages and wording touch shared engine state)"""
        if kind == "keepalive":
            self.note("cs_keepalive", supplier=t.sid)
            return {"subject": self.case["title"], "refs": [], "body": "\n".join(
                ["Hello,", "", "thank you for your offer, we appreciate it. We are completing our evaluation and will "
                 "come back to you very shortly with our decision."] + SIGN)}
        sheets = self.packages(t, payload)
        if not sheets:
            if kind == "beat":
                self.beats[t.sid] = max(self.beats.get(t.sid, 0), self.cfg.cs_beat_rounds)  # nothing to ask: done
            self.breached.add(t.sid)
            self.note("cs_no_package", supplier=t.sid, goal=round(payload))
            return None
        return self.message(t, sheets, self.rival_for(t), hint=self.k[t.sid] % 3 == 0)

    def worker(self, t):
        while time.time() < self.wave_end + 30:
            try:
                with self.lock:
                    kind, payload = self.decide(t)
                    msg = self.build(t, *payload) if kind == "send" else None
                    if msg is not None:
                        self.busy.add(t.sid)  # reply pending (cs_no_direct_accept waits for it)
                if kind == "send" and msg is None:
                    continue
                if kind == "stop":
                    return
                if kind == "wait":
                    time.sleep(1.0)
                    continue
                if kind in ("close", "walk"):
                    if kind == "walk":
                        self.note("cs_walk", why="no acceptable offer")
                        res = self.walk()
                    else:
                        x, sh, why = payload
                        self.note("accept", why=why, supplier=x.sid, c=round(self.C(x, sh["terms"])),
                                  safezone=self.safe, tension=self.tension)
                        res = self.close(x, sh)
                    with self.lock:
                        self.done = res
                    return
                try:
                    r = self.send(t, msg)  # outside the lock: the other vendors keep their own clocks
                    if r is not None:
                        self.update_tension(t)
                        if "result" in r and "status" not in r:
                            with self.lock:
                                self.done, self.closing = r.get("result", r), True
                            return
                finally:
                    with self.lock:
                        self.busy.discard(t.sid)
            except Exception as e:
                self.note("cs_worker_error", supplier=t.sid, error=f"{type(e).__name__}: {str(e)[:200]}")
                time.sleep(1.0)

    def run(self):
        self.lock = threading.RLock()
        self.limit = self.case.get("round_limit", 10)
        self.wave_end = self.deadline or (time.time() + 420)
        self.closing, self.done, self.safe, self.safe_c = False, None, None, float("inf")
        self.tension = {s: 0.0 for s in self.threads}
        self.breached, self.cluster = set(), set(self.threads)
        self.k = {s: 0 for s in self.threads}
        self.aggr = {s: 0 for s in self.threads}
        self.keepalive = {s: 0 for s in self.threads}
        self.beats = {s: 0 for s in self.threads}  # cs_no_direct_accept: beat counters used per vendor
        self.busy = set()  # vendors whose send is out and whose reply has not arrived
        self.note("cs_start", vendors=len(self.threads), threshold=self.cfg.cs_tension, target_c=round(self.target_c),
                  c_alt=self.c_alt, netpreis_factor=round(sum((1 + ((1 + float(self.b.get('interest_rate') or 0.08))
                                                                     / (1 + INFLATION) - 1)) ** (-m / 12)
                                                                for m in (0, 12, 24)) / 3, 4))
        # 1. first counter with the standard individual algorithm, all vendors in parallel
        firsts = []
        staggered = self.cfg.cs_stagger and len(self.threads) > 1  # then staggered_first() does the opening
        for t in ([] if staggered else self.threads.values()):  # built one by one (shared engine state), sent in parallel
            sheets = self.packages(t, self.goal(0, t))
            if not sheets:
                continue
            others = [(self.C(x, x.sheets[0]["terms"]), x.sheets[0]["term_sheet_id"], x.sheets[0]["terms"])
                      for x in self.threads.values() if x is not t and x.sheets
                      and must_haves_ok(self.case, x.sheets[0]["terms"], x.std)]
            rival = min(others, key=lambda o: o[0])[1:] if others and self.cfg.rival else None
            firsts.append((t, self.message(t, sheets, rival, hint=True)))

        def first(job):
            t, msg = job
            try:
                if self.send(t, msg) is not None:
                    self.update_tension(t)
            except Exception as e:
                self.note("cs_worker_error", supplier=t.sid, phase="first", error=f"{type(e).__name__}: {str(e)[:200]}")
        with ThreadPoolExecutor(max(1, len(firsts))) as ex:
            list(ex.map(first, firsts))
        if staggered:
            self.staggered_first()
        try:
            self._estimate()  # round-1 documents (cost breakdowns) sharpen the target
        except Exception as e:
            self.note("cs_estimate_failed", error=repr(e)[:200])
        # 2. cluster, 3. negotiate inside it - one worker per vendor
        self.build_cluster()
        with ThreadPoolExecutor(len(self.cluster)) as ex:
            list(ex.map(self.worker, [self.threads[s] for s in self.cluster]))
        if self.done is None:  # every worker ended without closing: take the best standing offer
            best = self.best()
            self.note("cs_fallback_close", best=round(best[0]) if best else None)
            self.done = self.close(best[1], best[2]) if best else self.walk()
        return self.done
