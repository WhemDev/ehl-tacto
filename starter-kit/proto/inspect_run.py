"""Everything about one variant's practice sessions: per case the deal, C vs best, rounds, every message (ours and
theirs, compact), claim results, supplier questions/requests, engine decisions, timing. Output: Markdown."""
import glob
import json
import re
import sys
from collections import Counter

VAR = sys.argv[1] if len(sys.argv) > 1 else "A5"
rows = [json.loads(l) for l in open("proto/runs/variants/results.jsonl")]
rows = [r for r in rows if r["variant"] == VAR and r["case"].startswith("case:P")]
latest = {}
for r in rows:
    latest[r["case"]] = r
ASK = re.compile(r"[^.?!]*\?", re.S)
for case in sorted(latest):
    r = latest[case]
    f = glob.glob(f"proto/runs/variants/{VAR}/{case.replace(':', '_')}-{r['session']}.json")
    ev = json.load(open(f[0])) if f else []
    t0 = ev[0]["t"] if ev else 0
    print(f"\n## {case} — score {r['score']:.3f}  session {r['session']}")
    res = next((e for e in reversed(ev) if e["kind"] == "result"), {})
    op = next((e for e in ev if e["kind"] == "open"), {})
    print(f"C_open {res.get('c_open') or op.get('c_open')} · C_deal {res.get('c_deal')} · C_best {res.get('c_best')} · C_alt {op.get('c_alt')} · deal {res.get('deal')} · error {r.get('error')}")
    if res.get("terms"):
        print("deal terms:", {k: v for k, v in res["terms"].items() if v not in (None, 0.0)})
    if res.get("cost_breakdown"):
        print("cost breakdown:", {k: round(v) for k, v in res["cost_breakdown"].items() if v})
    tg = [e for e in ev if e["kind"] == "target"]
    if tg:
        print("target:", round(tg[-1]["c_target"]), tg[-1]["terms"], "floors:", tg[-1]["floors"])
    claims = Counter()
    for e in ev:
        k = e["kind"]
        dt = e["t"] - t0
        if k == "send":
            print(f"  {dt:6.0f}s -> {e['supplier'][-5:]} r{e.get('rnd', '')} sheets " + "; ".join(
                f"{ {x: y for x, y in s[0].items() if x not in ('index_clause',)} }{' +clause' + str((s[0].get('index_clause') or {}).get('deadband_pct')) if s[0].get('index_clause') else ''} C={s[1]:,}" for s in e["sheets"]) + f" refs={e['refs']}")
        elif k == "reply":
            for c in e.get("claims") or []:
                claims[c["result"]] += 1
            qs = [q.strip() for q in ASK.findall(e.get("body") or "") if len(q.strip()) > 10][:3]
            print(f"  {dt:6.0f}s <- {e['supplier'][-5:]} [{e['status']}] " + "; ".join(
                f"{s[0][-6:]} { {x: y for x, y in s[1].items() if x != 'index_clause'} }{' +clause' + str((s[1].get('index_clause') or {}).get('deadband_pct')) if s[1].get('index_clause') else ''} C={s[2]:,}" for s in e["sheets"])
                  + f" claims={[c['result'] for c in e.get('claims') or []]}")
            body = (e.get("body") or "").replace("\n", " ")
            print(f"           SUP: {body[:520]}")
            if qs:
                print(f"           ASKS: {qs}")
        elif k in ("accept", "push", "hold", "meet_field", "fallback_counter", "mirror_alternative", "error", "resync",
                   "crash", "close_failed", "session_ended", "cap_close", "stagger", "bar"):
            print(f"  {dt:6.0f}s ** {k} " + json.dumps({x: y for x, y in e.items() if x not in ("t", "kind", "sheet")}, default=str)[:260])
    print("claim results:", dict(claims), "· duration", round(ev[-1]["t"] - t0) if ev else None, "s")
