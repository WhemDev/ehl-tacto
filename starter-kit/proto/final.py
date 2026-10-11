"""The Live Final with our engine: G8s on every case of every wave, with the wave's real cap as deadline.

    PYTHONPATH=. uv run python proto/final.py                       # the final (5 waves, up to 10 cases in parallel)
    PYTHONPATH=. uv run python proto/final.py --rehearse 10         # same code path on sandbox cases, 8-minute wave
    FINAL_VARIANT=G8s ...                                           # which named algorithm (default G8s)

Mirrors arena_kit.play.play_waves (wave polling, per-wave cap that follows extensions, one broken case never stops
the others) but drives proto.engine (PracticeNegotiator = the generic code path). A "one session per case" 409
resumes the running session instead of failing the case. Start it before the first wave and leave it running.
Writes proto/runs/final/manifest.json (exact config, code hash) and results.jsonl (one line per case).
"""
import argparse
import functools
import hashlib
import json
import logging
import os
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path

from arena_kit import ArenaClient, ArenaError
from arena_kit.cli import load_env
from arena_kit.play import RUNNING

log = logging.getLogger("final")
OUT = Path("proto/runs/final")


class SessionEnded(Exception):
    """A resumed final session had already ended: carry the arena's result instead of playing it again."""

    def __init__(self, session_id, result):
        super().__init__(session_id)
        self.session_id, self.result = session_id, result


class ResumingClient:
    """ArenaClient whose open_session resumes this team's running final session (409) instead of failing."""

    def __init__(self, client, case):
        self._c, self._case = client, case

    def __getattr__(self, name):
        return getattr(self._c, name)

    def open_session(self, case_id):
        try:
            return self._c.open_session(case_id)
        except ArenaError as e:
            running = RUNNING.search(str(e.detail)) if e.status == 409 else None
            if not running:
                raise
            sid = running.group(1)
            log.warning("%s: resuming running session %s", case_id, sid)
            state = self._c.session(sid)
            if state.get("status") == "ended":
                raise SessionEnded(sid, state.get("result") or {})
            threads = {s: self._c.thread(sid, s).get("messages") or [] for s in state.get("threads", {})}
            return {"session_id": sid, "case": self._case or state.get("case"), "threads": threads,
                    "resumed": True, "status": state.get("status")}


def manifest(variant, cfg):
    src = b"".join(Path(p).read_bytes() for p in ["proto/engine.py", "proto/practice.py", "proto/target.py", "proto/variants.py"])
    try:
        rev = subprocess.run(["git", "-C", str(Path.home() / "Documents/ehl-tacto"), "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        rev = None
    m = {"variant": variant, "config": asdict(cfg), "code_sha256": hashlib.sha256(src).hexdigest()[:16],
         "team_repo_rev": rev, "started": time.strftime("%Y-%m-%d %H:%M:%S")}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "manifest.json").write_text(json.dumps(m, indent=1, default=str))
    return m


def play_case(client, case, cfg, deadline, tag):
    """One case through our engine; never raises (one broken case must not stop the others)."""
    import proto.engine as eng
    from proto.practice import PracticeNegotiator

    t0, cid = time.time(), case["case_id"]
    try:
        sid, res = eng.play(cid, cfg, client=ResumingClient(client, case), log_dir=OUT / tag, quiet=True,
                            deadline=deadline, cls=PracticeNegotiator)
        row = {"case": cid, "session": sid, "score": (res or {}).get("score"), "deal": (res or {}).get("deal"),
               "c_deal": (res or {}).get("c_deal"), "error": (res or {}).get("error")}
    except SessionEnded as e:
        res = e.result
        row = {"case": cid, "session": e.session_id, "score": res.get("score"), "deal": res.get("deal"),
               "c_deal": res.get("c_deal"), "error": None, "resumed_ended": True}
    except Exception as e:
        log.exception("%s failed", cid)
        row = {"case": cid, "session": None, "score": None, "error": repr(e)[:300]}
    cap = deadline() if callable(deadline) else deadline
    row.update(tag=tag, wave=case.get("wave"), seconds=round(time.time() - t0, 1),
               finished_before_cap=None if cap is None else time.time() <= cap)
    with open(OUT / "results.jsonl", "a") as f:
        f.write(json.dumps(row, default=str) + "\n")
    log.warning("%s done: %s", cid, row)
    return row


def run_final(client, cfg, waves=5, parallel=10, poll=5.0):
    started, closed, caps = {}, set(), {}
    with ThreadPoolExecutor(max_workers=parallel) as pool:
        while len(closed) < waves or not all(f.done() for f in started.values()):
            try:
                cases = client.cases("final")
            except ArenaError as e:
                if e.status != 403:  # 403: no wave has started yet
                    log.warning("cases(final): %s %s", e.status, e.detail)
                cases = []
            except Exception as e:  # a network blip must not end the final
                log.warning("cases(final) failed: %r", e)
                cases = []
            for case in cases:
                if not case.get("open"):
                    closed.add(case["wave"])
                    continue
                if case.get("seconds_left") is not None:  # each wave has its own cap; follow an extension
                    caps[case["wave"]] = time.time() + case["seconds_left"]
                if case["case_id"] not in started and case.get("seconds_left"):
                    if case["wave"] not in {c["wave"] for c in cases if c["case_id"] in started}:
                        log.warning("wave %s started: %s", case["wave"], case.get("theme"))
                    started[case["case_id"]] = pool.submit(play_case, client, case, cfg,
                                                           functools.partial(caps.get, case["wave"]), "final")
            time.sleep(poll)
    return {cid: f.result() for cid, f in started.items()}


def rehearse(client, cfg, n, wave_seconds=480, parallel=10):
    """The final's code path on sandbox cases: n cases (D01/D02 alternating), one 8-minute wave, all in parallel."""
    sandbox = {c["case_id"]: c for c in client.cases("sandbox")}
    ids = [list(sandbox)[i % len(sandbox)] for i in range(n)]
    cap = time.time() + wave_seconds
    deadline = lambda: cap  # noqa: E731 - a function, exactly like the final's per-wave cap
    with ThreadPoolExecutor(max_workers=parallel) as pool:
        rows = list(pool.map(lambda cid: play_case(client, {**sandbox[cid], "wave": "rehearsal"}, cfg, deadline,
                                                   "rehearsal"), ids))
    return rows


if __name__ == "__main__":
    load_env()
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(name)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rehearse", type=int, default=0, help="sandbox rehearsal with N parallel cases (free)")
    ap.add_argument("--parallel", type=int, default=10)
    ap.add_argument("--wave-seconds", type=int, default=480)
    args = ap.parse_args()
    from proto.variants import VARIANTS

    variant = os.environ.get("FINAL_VARIANT", "G8s")
    cfg = VARIANTS[variant][1]
    m = manifest(variant, cfg)
    print(f"variant {variant} code {m['code_sha256']} team repo {m['team_repo_rev']}", flush=True)
    client = ArenaClient(timeout=25, retries=7)
    if args.rehearse:
        rows = rehearse(client, cfg, args.rehearse, args.wave_seconds, args.parallel)
    else:
        rows = list(run_final(client, cfg, parallel=args.parallel).values())
    ok = [r for r in rows if r.get("score") is not None]
    print(json.dumps({"cases": len(rows), "scored": len(ok), "mean": round(sum(r["score"] for r in ok) / len(ok), 3) if ok else None,
                      "errors": [r for r in rows if r.get("error")], "late": [r["case"] for r in rows if r.get("finished_before_cap") is False]},
                     indent=1, default=str))
