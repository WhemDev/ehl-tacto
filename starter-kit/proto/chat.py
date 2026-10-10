"""Negotiate with an arena supplier by hand.

    uv run python chat.py case:D01          # sandbox: free, no quota
    uv run python chat.py case:P01          # practice: costs one session

At the `message>` prompt type your e-mail body (one line). At `terms>` type term changes such as
`unit_price=50 payment_days=60` (blank = repeat the supplier's standing terms). Commands start
with `/`: see /help. Remember the 60 s limit per message, counted from the supplier's reply.
"""

import sys
import time

from arena_kit import ArenaClient, ArenaError, complete_offer, total_cost
from arena_kit.docs import standard_terms
from arena_kit.cli import load_env
from arena_kit.play import ENDED, latest, standing

HELP = """/case          case file (need, goal, negotiable fields, must-haves)
/doc           text of the supplier's attached documents (read the quote PDF!)
/thread        the whole e-mail history
/accept        accept the supplier's standing term sheet
/walk          walk away
/help          this text
/to <id>       switch supplier (RFQ cases)
Add data IDs to your body, e.g. idx:PPI-D351@2026-08; they are checked. Terms are space-separated k=v."""


def show_reply(m):
    print(f"\n--- {m.get('from')}  [{m.get('status')}]  {m.get('subject', '')}")
    print(m.get("body", ""))
    for s in m.get("term_sheets") or []:
        print(f"  standing {s['term_sheet_id']}: {s['terms']}")
    if m.get("missing_fields"):
        print("  missing (close on standard terms):", m["missing_fields"])
    if m.get("claim_results"):
        print("  claim_results:", m["claim_results"])
    if m.get("signals"):
        print("  signals:", m["signals"])
    for a in m.get("attachments") or []:
        print(f"  attachment: {a.get('attachment_id')} ({a.get('name')})")


def parse_terms(case, text, base):
    terms = dict(base)
    for part in text.split():
        k, _, v = part.partition("=")
        try:
            terms[k] = float(v) if "." in v else int(v)
        except ValueError:
            terms[k] = v
    return complete_offer(case, terms)


def main():
    case_id = sys.argv[1] if len(sys.argv) > 1 else "case:D01"
    load_env()
    client = ArenaClient()
    r = client.open_session(case_id)
    sid, case = r["session_id"], r["case"]
    suppliers = list(r["threads"])
    print(f"session {sid}  replay: https://arena.tacto.ai/replay/{sid}")
    print(f"{case.get('title')}  goal={case.get('category_goal')}  suppliers={suppliers}")
    print("negotiable:", case["negotiable"], " (type /help)")
    threads = {s: list(ev) if isinstance(ev, list) else [ev] for s, ev in r["threads"].items()}
    sup = suppliers[0]
    if len(suppliers) > 1:
        print("RFQ: switch supplier with /to <id>")
    show_reply(latest(threads[sup]))

    while True:
        events = threads[sup]
        last = latest(events)
        if last.get("status") in ENDED:
            print("thread ended:", last.get("status"))
            break
        sheet_id, theirs = standing(events)
        std = standard_terms(events)
        if theirs:
            print(f"\n[{sup}] their C = €{total_cost(case, theirs, std):,.0f}")
        try:
            body = input("message> ").strip()
        except EOFError:
            break
        t0 = time.time()
        if body.startswith("/"):
            cmd, _, arg = body.partition(" ")
            if cmd == "/help":
                print(HELP)
            elif cmd == "/case":
                print({k: v for k, v in case.items() if k in ("need", "buyer", "negotiable", "must_haves", "term_options", "round_limit", "category_goal", "horizon")} or case)
            elif cmd == "/thread":
                for m in events:
                    show_reply(m) if m.get("from") != "buyer" else print("\n>>> YOU:", m.get("body"), m.get("term_sheets"))
            elif cmd == "/doc":
                from arena_kit.play import fetch_documents

                class T:
                    attachment = staticmethod(lambda aid: client.attachment(sid, aid))

                for a in fetch_documents(T, last).get("attachments") or []:
                    print(f"\n== {a.get('name')}\n{a.get('text', '(no text)')}")
            elif cmd == "/to" and arg in threads:
                sup = arg
                show_reply(latest(threads[sup]))
            elif cmd in ("/accept", "/walk"):
                action = {"type": "accept", "term_sheet_id": sheet_id} if cmd == "/accept" else {"type": "walk_away"}
                res = client.send_message(sid, sup, {"action": action})
                print("\nRESULT:", res.get("result", res))
                break
            continue
        terms_in = input("terms> ").strip()
        ask = parse_terms(case, terms_in, theirs) if terms_in or theirs else None
        msg = {"subject": case.get("title", "Re"), "body": body or "Please see our proposal."}
        if ask:
            msg["term_sheets"] = [{"terms": ask}]
            print(f"  your ask: {ask}\n  your C if accepted = €{total_cost(case, ask, std):,.0f}")
            if input("send? [Y/n] ").strip().lower() == "n":
                continue
        print(f"  (typed in {time.time() - t0:.0f}s of your 60s)")
        try:
            reply = client.send_message(sid, sup, msg)
        except ArenaError as e:
            print("ERROR:", e.status, e.detail)
            continue
        events.append({"from": "buyer", **msg})
        events.append(reply)
        show_reply(reply)

    print("\nsession state:", client.session(sid).get("status"), " replay: https://arena.tacto.ai/replay/" + sid)


if __name__ == "__main__":
    main()
