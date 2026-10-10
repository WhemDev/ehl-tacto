"""How the hosted suppliers move: one row per supplier reply, from our own event logs (no arena calls).

    uv run --directory starter-kit python ../scripts/supplier_moves.py            # summary
    uv run --directory starter-kit python ../scripts/supplier_moves.py --csv out.csv

Positions are normalised per case between the opening (1.0) and the best package any supplier would
accept (0.0, the arena's C_best, known after the case): `ask` is our most ambitious term sheet, `before`
and `after` the supplier's standing offer before and after its reply. `gave` = how much of the gap
between its offer and our ask it closed in this reply.
"""

import argparse
import csv
import json
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOGS = [ROOT / "logs" / "events.jsonl", ROOT / "starter-kit" / "experiments" / "out" / "events.jsonl"]


def sessions(paths):
    """{session: {"case", "type", "goal", "variant", "result", "threads": {supplier: [events]}}}"""
    out, variants, cases = {}, {}, {}
    for path in paths:
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("kind") == "run":
                variants[e["run"]] = e.get("variant") or "-"
            sid = e.get("session")
            if not sid or str(sid).startswith("sim"):
                continue
            s = out.setdefault(sid, {"case": e.get("case"), "variant": variants.get(e["run"], "-"), "threads": defaultdict(list)})
            if e["kind"] == "case":
                s.update(type=e.get("type"), goal=e.get("goal"), c_alt=e.get("c_alt"))
                cases[e.get("case")] = e
            elif e["kind"] in ("supplier", "buyer"):
                s["threads"][e["supplier"]].append(e)
            elif e["kind"] == "result":
                s["result"] = e
    return {k: v for k, v in out.items() if v.get("result") and v["result"].get("c_best") and v["result"].get("c_open")}


def rows(sess):
    out = []
    for sid, s in sess.items():
        r = s["result"]
        lo, hi = r["c_best"], r["c_open"]
        if hi - lo < 1:
            continue
        pos = lambda c: (c - lo) / (hi - lo) if c is not None else None  # noqa: E731
        for sup, evs in s["threads"].items():
            before, ask, n = None, None, 0
            for e in evs:
                if e["kind"] == "buyer":
                    cs = [t["c"] for t in e.get("sheets") or [] if t.get("c") is not None]
                    ask = min(cs) if cs else None  # no sheet: a question or a hold
                    n += 1
                elif e["kind"] == "supplier":
                    after = e.get("c")
                    if before is not None and n:
                        gap = (before - ask) if ask is not None else None
                        out.append({
                            "session": sid, "case": s["case"], "type": s.get("type"), "goal": s.get("goal"),
                            "variant": s["variant"], "supplier": sup, "round": n, "status": e.get("status"),
                            "ask": pos(ask), "before": pos(before), "after": pos(after),
                            "gave": ((before - after) / gap) if gap and gap > 1 and after is not None else None,
                            "score": r.get("score"), "deal_supplier": r.get("supplier"),
                        })
                    before = after if after is not None else before
    return out


def summary(rs):
    print(f"{len(rs)} supplier replies from {len({r['session'] for r in rs})} finished sessions\n")
    by = defaultdict(list)
    for r in rs:
        by[(r["type"], r["round"])].append(r)
    print(f"{'type':<15}{'round':>6}{'n':>4}{'ask':>7}{'before':>8}{'after':>7}{'gave':>7}  status")
    for (t, n), g in sorted(by.items(), key=lambda kv: (str(kv[0][0]), kv[0][1])):
        med = lambda k: statistics.median([x[k] for x in g if x[k] is not None]) if [x for x in g if x[k] is not None] else float("nan")  # noqa: E731
        st = defaultdict(int)
        for x in g:
            st[x["status"]] += 1
        print(f"{str(t):<15}{n:>6}{len(g):>4}{med('ask'):>7.2f}{med('before'):>8.2f}{med('after'):>7.2f}{med('gave'):>7.2f}  "
              + ", ".join(f"{k} {v}" for k, v in sorted(st.items())))
    finals = [r for r in rs if r["status"] in ("final_offer", "agreed")]
    if finals:
        print("\nfirst final/agreed reply per thread, by round:",
              dict(sorted(defaultdict(int, {n: sum(1 for r in finals if r["round"] == n) for n in {r['round'] for r in finals}}).items())))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv")
    args = ap.parse_args()
    rs = rows(sessions(LOGS))
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rs[0]))
            w.writeheader()
            w.writerows(rs)
    summary(rs)


if __name__ == "__main__":
    main()
