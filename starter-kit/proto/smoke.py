"""Offline smoke test (no session, no quota): the practice/final engine on practice case files with simulated
opening quotes - targets, packages, must-haves, facts. Catches crashes and silly offers before quota is spent.

    ALL=1 V=A6 CLAUSE=1 PYTHONPATH=. uv run python proto/smoke.py     # all 19 case files, incl. never-played ones
"""
import json, sys, os, traceback
sys.path.insert(0, os.environ.get("ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.environ.get("ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from arena_kit.cli import load_env; load_env()
from arena_kit import ArenaClient, complete_offer, total_cost, must_haves_ok
from proto.engine import Thread
from proto.practice import PracticeNegotiator
from proto.variants import VARIANTS
cases = {c["case_id"]: c for c in ArenaClient().cases("practice") if os.environ.get("ALL") or c.get("hosted")}
for cid, case in cases.items():
    b = case["buyer"]
    try:
        n = PracticeNegotiator.__new__(PracticeNegotiator)
        n.c=None; n.case_id=cid; n.cfg=VARIANTS[os.environ.get("V","A")][1]; n.quiet=True; n.log=[]; n.sid="smoke"; n.case=case; n.b=b
        n.deadline=None; n.slowest=0
        price = (b.get("current_unit_price") or b.get("fallback_unit_price")) * 1.06
        threads = {}
        for i, s in enumerate(case["suppliers"]):
            terms = complete_offer(case, {"unit_price": round(price * (1 - 0.04 * i), 2)})
            if cid == "case:P10":
                terms.update(volume_per_year=19890, contract_months=12, lead_time_days=56, unit_price=32.2)
            if os.environ.get("CLAUSE") and "index_clause" in case["negotiable"]:
                opts = [o for o in case["term_options"]["index_clause"] if o]
                terms["index_clause"] = opts[int(os.environ.get("CLAUSE_IDX", "-1"))]
            ev = [{"from": f"sales@{s}", "status": "open", "body": "Our offer. Which volume can you commit to? Faster payment would help. For 24 months an AS-14404 index clause is mandatory.",
                   "term_sheets": [{"term_sheet_id": f"offer:{s}-0", "terms": terms}], "attachments": []}]
            threads[s] = Thread(s, ev)
        n.threads = threads
        n.alt = b.get("alternative") or {}
        n.c_alt = total_cost(case, n.alt["terms"]) if n.alt.get("terms", {}).get("unit_price") else float("inf")
        n.relationship = b.get("category_goal") in ("stabilise", "secure_supply")
        n.c_open = min(n.C(t, t.sheets[0]["terms"]) for t in threads.values())
        n._estimate()
        t = list(threads.values())[0]
        g0 = n.goal(0)
        print("   facts:", [f[1][:70] for f in n.facts_for(list(threads.values())[0])])
        sheets = n.meso(t, g0)
        t.events.append({"from": "buyer", "term_sheets": [{"terms": x} for x in sheets], "body": "x"})
        t.events.append(dict(t.events[0]))
        sheets = n.meso(t, n.goal(1))
        msg = n.write(t, 1, sheets, None)
        ok = all(must_haves_ok(case, s, t.std) for s in sheets)
        opn = t.sheets[0]["terms"]["unit_price"]
        print(f"{'' if case.get('hosted') else 'UNSEEN '}{cid} {case['type']:14} {b['category_goal']:13} open€{opn:.2f} C_open={n.c_open:,.0f} alt={n.c_alt:,.0f} target={n.target_c:,.0f} "
              f"g0={g0:,.0f} n_sheets={len(sheets)} must_ok={ok} facts={len(n.facts_for(t))}")
        for s in sheets: print("      sheet", s, "C", round(n.C(t, s)))
        print("      floor:", {k: v for k, v in t.est.items() if k in ('floor','basis','interest_rate')})
    except Exception:
        print(cid, "CRASH"); traceback.print_exc()
