"""Fault injection for the safe_exceptions switch: the old path walks away, the new one recovers. No arena session."""
import json, sys, tempfile
from arena_kit import ArenaClient, ArenaError, complete_offer
from arena_kit.cli import load_env
import proto.engine as eng
from proto.variants import VARIANTS

load_env()
CASE = {c["case_id"]: c for c in ArenaClient().cases("sandbox")}["case:D01"]


class Fake:
    def __init__(self, thread_error=False, session_status="running"):
        self.sent, self.thread_error, self.status = [], thread_error, session_status

    def send_message(self, sid, sup, msg):
        self.sent.append(msg)
        a = (msg.get("action") or {}).get("type")
        return {"result": {"deal": a == "accept", "score": 0.5 if a == "accept" else 0.0, "supplier_id": sup}}

    def thread(self, sid, sup):
        if self.thread_error:
            raise ArenaError(503, "upstream timeout")
        return {"messages": [], "closed": False}

    def session(self, sid):
        return {"status": self.status, "result": None}


def negotiator(variant, client):
    n = eng.Negotiator.__new__(eng.Negotiator)
    n.cfg, n.case, n.b, n.c, n.sid, n.log, n.quiet = VARIANTS[variant][1], CASE, CASE["buyer"], client, "s1", [], True
    n.relationship, n.slowest, n.deadline = False, 0.0, None
    prim = complete_offer(CASE, {"unit_price": 50.0})
    alt = complete_offer(CASE, {"unit_price": 49.5})
    t = eng.Thread("sup:F1", [{"from": "sup:F1", "status": "open", "body": "",
                               "term_sheets": [{"term_sheet_id": "offer:1", "terms": prim}, {"term_sheet_id": "offer:1-a", "terms": alt}]}])
    t.std = {}
    n.threads, n.c_alt = {t.sid: t}, float("inf")
    return n, t


def actions(c):
    return [(m.get("action") or {}).get("type", "email") + ":" + str((m.get("action") or {}).get("term_sheet_id", "")) for m in c.sent]


ok = True
for variant, expect in [("G8t", "walk_away"), ("G8u", "accept:offer:1")]:
    # 1. the promotion reply is lost -> old: walk away; new: accept the standing primary
    c = Fake(); n, t = negotiator(variant, c)
    n.send = lambda t_, msg: None
    n.resync = lambda t_, refresh_clock=True: None
    n.close(t, t.sheets[1])
    got = actions(c)[-1]
    print(f"[promotion lost] {variant}: {got}  expected {expect}")
    ok &= got.startswith(expect)
    # 2. a thread read fails -> old: supplier marked walked_away; new: state unchanged
    c = Fake(thread_error=True); n, t = negotiator(variant, c)
    n._docs = lambda *a, **k: None
    n.resync(t)
    status = t.status
    want = "walked_away" if variant == "G8t" else "open"
    print(f"[read failed]    {variant}: status {status}  expected {want}")
    ok &= status == want

# 3. a crash inside run() -> old: walk away; new: accept the best acceptable standing primary
for variant, expect in [("G8t", "walk_away"), ("G8u", "accept:offer:1")]:
    c = Fake()

    class Crashy(eng.Negotiator):
        def __init__(self, client, case_id, cfg, quiet=False, deadline=None):
            m, t = negotiator(variant, client)
            self.__dict__.update(m.__dict__)
            self._docs = lambda *a, **k: None

        def run(self):
            raise RuntimeError("bug in our code")

    with tempfile.TemporaryDirectory() as d:
        sid, res = eng.play("case:D01", VARIANTS[variant][1], client=c, log_dir=d + "/x", quiet=True, cls=Crashy)
    got = actions(c)[-1]
    print(f"[crash in run]   {variant}: {got}  expected {expect}  result deal={res.get('deal')}")
    ok &= got.startswith(expect)
print("ALL PASS" if ok else "FAILURES")
sys.exit(0 if ok else 1)
