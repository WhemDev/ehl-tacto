"""Two-session RFQ comparison; explicit --practice; exclusive output ledger."""

import argparse
import json
import os
import statistics
import time
from pathlib import Path

import proto.engine as eng
from arena_kit import ArenaClient
from arena_kit.agents.hybrid import _negotiator
from arena_kit.cli import load_env
from proto.variants import VARIANTS


class MeasuredClient(ArenaClient):
    def __init__(self):
        super().__init__(timeout=180, retries=0, net_retry_s=0)
        self.replies = []
        self.opened_sid = None

    def open_session(self, case_id):
        opened = super().open_session(case_id)
        self.opened_sid = opened["session_id"]
        return opened

    def _ctx(self):
        pass

    def send_message(self, session_id, supplier_id, message):
        start = time.monotonic()
        ok = False
        try:
            result = super().send_message(session_id, supplier_id, message)
            ok = True
            return result
        finally:
            if not message.get("action"):
                self.replies.append({"supplier": supplier_id, "seconds": time.monotonic() - start, "ok": ok})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--practice", action="store_true", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    ledger = args.output.open("x")
    load_env()
    os.environ["ENGINE_WRITER"] = "template"
    jobs = [("P05", "A9h"), ("P05", "A9h-owed")]
    for case, variant in jobs:
        ledger.write(json.dumps({"attempt": variant, "case": case}) + "\n")
        ledger.flush()
        client = MeasuredClient()
        eng.Negotiator = _negotiator("case:" + case)
        try:
            sid, result = eng.play(
                "case:" + case,
                VARIANTS[variant][1],
                client=client,
                log_dir=args.output.parent / variant,
                quiet=True,
                deadline=time.time() + 480,
            )
        except Exception as exc:
            ledger.write(
                json.dumps(
                    {"failed": variant, "case": case, "session": client.opened_sid, "error_type": type(exc).__name__}
                )
                + "\n"
            )
            ledger.flush()
            if client.opened_sid:
                state = client.session(client.opened_sid)
                if state.get("status") != "ended":
                    client.walk_away(client.opened_sid)
            raise
        times = [r["seconds"] for r in client.replies]
        trusted = bool(times) and min(times) >= 15 and all(r["ok"] for r in client.replies) and not result.get("error")
        row = {
            "variant": variant,
            "case": case,
            "session": sid,
            "score": result.get("score"),
            "trusted": trusted,
            "median_seconds": statistics.median(times) if times else None,
            "replies": client.replies,
            "result": result,
        }
        ledger.write(json.dumps(row) + "\n")
        ledger.flush()
        print(
            json.dumps({k: row[k] for k in ("variant", "case", "session", "score", "trusted", "median_seconds")}),
            flush=True,
        )
        if not trusted:
            print("Stopped: reply under 15 seconds or no measured reply. No further sessions.", flush=True)
            break


if __name__ == "__main__":
    main()
