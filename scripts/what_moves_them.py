"""What made a hosted supplier move after its first counter? Reads the replay traces of our finished
practice and sandbox sessions (GET /v1/sessions/{sid} - no practice quota) and relates each supplier reply's
concession (share of the room between opening and C_best) to what our message carried and what it said.

    uv run --directory starter-kit python ../scripts/what_moves_them.py
"""

import json
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "starter-kit"))
sys.path.insert(0, str(ROOT / "scripts"))

from supplier_moves import LOGS, sessions  # noqa: E402

CACHE = ROOT / "logs" / "traces.json"


def traces(sids):
    from arena_kit import ArenaClient
    from arena_kit.cli import load_env

    load_env(ROOT / "starter-kit" / ".env")
    load_env(ROOT / ".env")
    cache = json.loads(CACHE.read_text()) if CACHE.is_file() else {}
    client = ArenaClient()
    for sid in sids:
        if sid not in cache:
            try:
                st = client.session(sid)
                cache[sid] = (st.get("result") or {}).get("trace") or st.get("trace") or []
            except Exception as e:  # noqa: BLE001
                print("skip", sid, e)
    CACHE.write_text(json.dumps(cache))
    return cache


def main():
    sess = sessions(LOGS)
    tr = traces(sorted(sess))
    rows = []
    for sid, s in sess.items():
        r = s["result"]
        lo, hi = r["c_best"], r["c_open"]
        if hi - lo < 1:
            continue
        # supplier offers in C, per thread, from our event log (the trace's prices are the same offers)
        for sup, evs in s["threads"].items():
            offers = [e for e in evs if e["kind"] == "supplier"]
            ours = [e for e in evs if e["kind"] == "buyer"]
            steps = [e for e in tr.get(sid, []) if e.get("actor") == sup]
            for n in range(1, len(offers)):
                before, after = offers[n - 1].get("c"), offers[n].get("c")
                if before is None or after is None:
                    continue
                reasons = " ".join(steps[n].get("reasons") or []) if n < len(steps) else ""
                msg = ours[n - 1] if n - 1 < len(ours) else {}
                claims = offers[n].get("claims") or []
                rows.append({
                    "round": n, "type": s.get("type"), "drop": (before - after) / (hi - lo),
                    "verified": sum(c.get("result") == "verified" for c in claims),
                    "sheets": len(msg.get("sheets") or []), "reasons": reasons.lower(),
                    "status": offers[n].get("status"),
                })
    later = [x for x in rows if x["round"] >= 2]
    print(f"{len(rows)} replies, {len(later)} after the first counter\n")
    print("drop (share of the room) after the first counter, by what the reply's reasons say:")
    keys = {
        "took data into account": r"took it into account|fair point|we did not know",
        "data holds, no change": r"does not change|doesn't change|not our reality|cannot give up margin",
        "faster payment valued": r"faster payment|cash flow|zahlungsziel",
        "contract length / volume": r"contract|volume|stability|commit",
        "boss / approval": r"approv|management|managing director|my boss|the boss",
        "no new data": r"no new data|didn't bring|did not bring|new data",
        "our price unchanged": r"remains unchanged|unchanged|same price|maintain our offer",
        "final word": r"final|last offer|cannot go lower|can't go lower|really can't",
    }
    for name, rx in keys.items():
        hit = [x["drop"] for x in later if re.search(rx, x["reasons"])]
        miss = [x["drop"] for x in later if not re.search(rx, x["reasons"])]
        if hit:
            print(f"  {name:<26} n={len(hit):>3}  median drop {statistics.median(hit):.3f}  (without: {statistics.median(miss):.3f})")
    print("\nby verified claims in our message:")
    by = defaultdict(list)
    for x in later:
        by[min(x["verified"], 2)].append(x["drop"])
    for k, v in sorted(by.items()):
        print(f"  {k}{'+' if k == 2 else ''} verified  n={len(v):>3}  median drop {statistics.median(v):.3f}  mean {statistics.mean(v):.3f}")
    big = sorted(later, key=lambda x: -x["drop"])[:8]
    print("\nlargest later concessions:")
    for x in big:
        print(f"  {x['type']:<14} r{x['round']} drop {x['drop']:.2f} verified {x['verified']} | {x['reasons'][:230]}")


if __name__ == "__main__":
    main()
