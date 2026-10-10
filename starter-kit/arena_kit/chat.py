"""Interactive practice client for the arena's e-mail REST API.

This is for a human exploring practice or sandbox suppliers. The Live Final must use
an autonomous agent instead.
"""

import json
import shlex

from .client import ArenaError
from .cost import complete_offer

HELP = """Commands:
  text                         send an e-mail to the selected supplier
  /offer PRICE [field=value] | message
                               send a complete term sheet and e-mail
  /suppliers                   list suppliers and their latest offers
  /use SUPPLIER_ID             choose a supplier thread
  /thread                      refresh and show the selected thread
  /attachment ATTACHMENT_ID    read a supplier's PDF or spreadsheet
  /accept                      accept the selected supplier's standing offer
  /walk                        end the case without a deal
  /state                       show session status and time left
  /quit                        leave the session open; resume with --resume ID
"""


def _latest_supplier(messages):
    return next((m for m in reversed(messages) if m.get("from") != "buyer"), None)


def _show_message(supplier_id, message):
    print(f"\n{supplier_id} [{message.get('status', 'reply')}]: {message.get('body', '')}")
    for sheet in message.get("term_sheets") or []:
        print(f"  offer {sheet.get('term_sheet_id')}: {json.dumps(sheet.get('terms', {}), ensure_ascii=False)}")
    for attachment in message.get("attachments") or []:
        print(f"  attachment: {attachment.get('name')} ({attachment.get('attachment_id')})")
    for claim in message.get("claim_results") or []:
        print(f"  claim: {json.dumps(claim, ensure_ascii=False)}")


def _show_result(result):
    print("\nCase ended:")
    print(json.dumps(result, indent=2, ensure_ascii=False))


def _offer(case, command):
    spec, separator, body = command.partition("|")
    words = shlex.split(spec)
    if len(words) < 2:
        raise ValueError("usage: /offer PRICE [field=value] | message")
    try:
        terms = {"unit_price": float(words[1])}
    except ValueError as exc:
        raise ValueError("PRICE must be a number") from exc
    if terms["unit_price"] <= 0:
        raise ValueError("PRICE must be positive")
    for item in words[2:]:
        field, sep, value = item.partition("=")
        if not sep or field not in case["negotiable"] or field == "unit_price":
            raise ValueError(f"unknown or malformed negotiable field: {item}")
        try:
            terms[field] = json.loads(value)
        except json.JSONDecodeError:
            terms[field] = value
        options = case.get("term_options", {}).get(field)
        if options and terms[field] not in options:
            raise ValueError(f"{field} must be one of {options}; got {terms[field]!r}")
    sheet = complete_offer(case, terms)
    if any(value is None for value in sheet.values()):
        raise ValueError("the case needs more term fields; specify them as field=value")
    print(f"Sending term sheet: {json.dumps(sheet, ensure_ascii=False)}")
    return {"subject": case["title"], "body": body.strip() if separator else "Please consider these terms.",
            "term_sheets": [{"terms": sheet}]}


def chat(client, case_id="case:D01", set_="sandbox", resume=None):
    """Open or resume one case, then read and send messages in the terminal."""
    if resume:
        state = client.session(resume)
        case_id, set_ = state["case_id"], state["set"]
        if state["status"] == "ended":
            _show_result(state.get("result") or {"end_reason": state.get("end_reason")})
            return resume
    if set_ not in ("practice", "sandbox"):
        raise ValueError("interactive chat is only for practice and sandbox cases")
    case = next((item for item in client.cases(set_) if item["case_id"] == case_id), None)
    if case is None:
        raise ValueError(f"{case_id} is not in the {set_} case list")

    print(f"\n{case_id}: {case['title']}\n{case.get('briefing', '')}")
    print(f"Negotiable: {', '.join(case['negotiable'])}")
    print(f"Options: {json.dumps(case.get('term_options', {}), ensure_ascii=False)}")
    if not resume:
        print("Opening starts the 60-second reply clock on each supplier thread.")
        if input("Press Enter to open, or type q to cancel: ").strip().lower() == "q":
            return None
        opened = client.open_session(case_id)
        session_id, threads = opened["session_id"], opened["threads"]
    else:
        session_id = resume
        threads = {sid: client.thread(session_id, sid)["messages"] for sid in state["threads"]}
    print(f"Session: {session_id}  (resume: arena chat --resume {session_id})")
    for sid, messages in threads.items():
        if latest := _latest_supplier(messages):
            _show_message(sid, latest)
    active = next(iter(threads))
    print(f"\nSelected: {active}. Type /help for commands.")

    while True:
        try:
            line = input(f"{active}> ").strip()
        except (EOFError, KeyboardInterrupt):
            print(f"\nSession left open. Resume with: arena chat --resume {session_id}")
            return session_id
        if not line:
            continue
        if line == "/help":
            print(HELP)
            continue
        if line == "/quit":
            print(f"Session left open. Resume with: arena chat --resume {session_id}")
            return session_id
        if line == "/suppliers":
            for sid, messages in threads.items():
                latest = _latest_supplier(messages) or {}
                sheet = (latest.get("term_sheets") or [{}])[0]
                print(f"{sid}: {latest.get('status', '?')}  {sheet.get('term_sheet_id', '')}  "
                      f"{json.dumps(sheet.get('terms', {}), ensure_ascii=False)}")
            continue
        if line.startswith("/use "):
            selected = line[5:].strip()
            if selected in threads:
                active = selected
                if latest := _latest_supplier(threads[active]):
                    _show_message(active, latest)
            else:
                print(f"Unknown supplier: {selected}")
            continue
        if line == "/thread":
            threads[active] = client.thread(session_id, active)["messages"]
            for message in threads[active]:
                if message.get("from") == "buyer":
                    print(f"\nYou: {message.get('body', '')}")
                else:
                    _show_message(active, message)
            continue
        if line.startswith("/attachment "):
            attachment_id = line.split(maxsplit=1)[1].strip()
            attachment = next(
                (a for messages in threads.values() for message in messages
                 for a in message.get("attachments") or [] if a.get("attachment_id") == attachment_id),
                None,
            )
            if attachment is None:
                print("Attachment not found in these threads. Run /thread to refresh.")
                continue
            from .docs import read_document

            print(read_document(attachment["name"], client.attachment(session_id, attachment_id)))
            continue
        if line == "/state":
            state = client.session(session_id)
            print(json.dumps({k: state.get(k) for k in ("status", "threads", "result")}, indent=2))
            continue
        try:
            if line.startswith("/offer"):
                message = _offer(case, line)
            elif line == "/accept":
                latest = _latest_supplier(threads[active]) or {}
                sheets = latest.get("term_sheets") or []
                if not sheets:
                    raise ValueError("no standing offer in this supplier thread")
                offer_id = sheets[0]["term_sheet_id"]
                print(f"Accepting {offer_id}: {json.dumps(sheets[0]['terms'], ensure_ascii=False)}")
                message = {"action": {"type": "accept", "term_sheet_id": offer_id}}
            elif line == "/walk":
                message = {"action": {"type": "walk_away"}}
            elif line.startswith("/"):
                print("Unknown command. Type /help.")
                continue
            else:
                message = {"subject": case["title"], "body": line, "term_sheets": []}
            reply = client.send_message(session_id, active, message)
        except ValueError as exc:
            print(exc)
            continue
        except ArenaError as exc:
            print(exc)
            if exc.status == 409:
                state = client.session(session_id)
                if state["status"] == "ended":
                    _show_result(state.get("result") or {"end_reason": state.get("end_reason")})
                    print("This session is closed. Start a new sandbox chat to try another bid.")
                    return session_id
                threads[active] = client.thread(session_id, active)["messages"]
                if latest := _latest_supplier(threads[active]):
                    _show_message(active, latest)
            continue
        if "result" in reply:
            _show_result(reply["result"])
            return session_id
        if "action" in message:
            _show_result(reply)
            return session_id
        threads[active].extend(({**message, "from": "buyer"}, reply))
        _show_message(active, reply)
