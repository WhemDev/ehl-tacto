"""Summarise engine run logs (proto/runs/*.json): one line per round, offers and replies."""
import json
import sys
from pathlib import Path


def summarize(path):
    rows = json.loads(Path(path).read_text())
    out = []
    for r in rows:
        k = r["kind"]
        if k == "config":
            out.append(f"config T={r['T']} e={r['e']} push={r['push_after_final']} mode={r.get('mode', 'boulware')} alpha={r.get('alpha')} hold={r.get('hold')}")
        elif k == "target":
            out.append(f"target C={r['c_target']:,.0f} via {r['supplier']} {r['terms']} floors={r['floors']}")
        elif k == "round":
            out.append(f"R{r['rnd']}: our goal C={r['goal']:,} (reserve {r['reserve']:,})")
        elif k == "send":
            out.append(f"  -> {r['supplier']} refs={r['refs']} att={r.get('attachments', [])} sheets=" +
                       "; ".join(f"{s[0]['unit_price']}/{s[0].get('payment_days')}d/{s[0].get('effective_date') or s[0].get('incoterm')}/{s[0].get('lead_time_days') or ''}" for s in r["sheets"]))
        elif k == "reply":
            out.append(f"  <- {r['supplier']} [{r['status']}] claims={[c['result'] for c in r['claims'] or []]} sheets=" +
                       "; ".join(f"{s[0]}: {s[1]['unit_price']}/{s[1].get('payment_days')}d/{s[1].get('effective_date') or s[1].get('incoterm')} C={s[2]:,}" for s in r["sheets"]))
        elif k in ("accept", "push_after_final", "push", "mirror_alternative", "hold"):
            out.append(f"  ** {k}: {({x: y for x, y in r.items() if x not in ('t', 'kind', 'sheet')})}")
        elif k == "result":
            out.append(f"RESULT score={r.get('score'):.3f} C_deal={r.get('c_deal'):,} C_best={r.get('c_best'):,} terms={r.get('terms')}")
    return "\n".join(out)


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(f"### {Path(p).name}\n{summarize(p)}\n")
