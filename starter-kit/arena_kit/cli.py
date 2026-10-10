"""`arena` command line: register, list cases, play one case or a whole set, show the board,
run the MCP server."""

import argparse
import functools
import io
import json
import logging
import os
import statistics
import zipfile
from pathlib import Path

from .client import ArenaClient, ArenaError
from .play import RemoteTable, hosted, play, play_all, play_waves


def load_env(path=".env"):
    """Read KEY=VALUE lines from .env into the environment (real env vars win)."""
    p = Path(path)
    if p.is_file():
        for line in p.read_text().splitlines():
            key, sep, value = line.partition("=")
            value = value.strip().strip("\"'")
            if sep and value and not key.strip().startswith("#"):
                os.environ.setdefault(key.strip(), value)


def agent_factory(name, data):
    from .agents import LLMAgent, NaiveAgent, llm_from_env

    if name == "naive":
        return NaiveAgent
    package = None
    if data:
        from .data import DataPackage

        package = DataPackage(data)
        package.lookup("")  # build the ID index once, before agents share it
    from .events import recording_complete

    complete = recording_complete(llm_from_env())
    return lambda: LLMAgent(complete, package)


def commit():
    """The commit this agent runs, for the run notes."""
    import subprocess

    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or None
    except OSError:
        return None


def local():
    """True when ARENA_URL points at arena-sim on this machine (no quota, no real suppliers)."""
    from urllib.parse import urlparse

    return urlparse(os.environ.get("ARENA_URL", "")).hostname in ("127.0.0.1", "localhost", "::1")


def guard_practice(client, args):
    """The team shares 200 practice sessions a day: spending them needs --practice."""
    if local() or getattr(args, "practice", False):
        return
    if args.cmd == "run" and args.set == "practice":
        n = len(hosted(client.cases("practice")))
    elif args.cmd == "play" and args.case_id in {c["case_id"] for c in client.cases("practice")}:
        n = 1
    else:
        return
    raise SystemExit(
        f"refused: this would use {n} of the team's practice sessions "
        f"({client.me()['practice']['left']} left today). Add --practice to spend them, "
        "or use the sandbox (case:D01, case:D02, --set sandbox) or arena-sim (scripts/sim.sh)."
    )


def log_runs(client, set_, agent, session_id=None):
    """Practice and sandbox runs go to the vault (`vault/Runs`); never during the final or from arena-sim."""
    from . import vault

    if local():
        return

    try:
        if session_id:
            state = client.session(session_id)
            path = vault.log_session(state, os.environ.get("ARENA_URL", ""), agent, commit())
            new = [path] if path else []
        else:
            new = vault.sync_runs(client, set_, agent, commit())
        for path in new:
            print(f"vault: {path.relative_to(vault.VAULT.parent)}")
    except Exception as e:  # the notes must never cost a run
        logging.warning("vault logging failed: %s", e)


def summary(result):
    keep = ("deal", "supplier_id", "terms", "c_open", "c_deal", "c_best", "score")
    return {k: result.get(k) for k in keep if k in result}


def main(argv=None):
    load_env()
    load_env(Path(__file__).resolve().parents[2] / ".env")  # team secrets at the repo root
    if os.environ.get("CLAUDE_API_KEY"):
        os.environ.setdefault("ANTHROPIC_API_KEY", os.environ["CLAUDE_API_KEY"])
    ap = argparse.ArgumentParser(prog="arena")
    ap.add_argument("-v", "--verbose", action="store_true")
    verbose = argparse.ArgumentParser(add_help=False)  # -v also after the command
    verbose.add_argument("-v", "--verbose", action="store_true", default=argparse.SUPPRESS)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser = functools.partial(sub.add_parser, parents=[verbose])
    r = sub.add_parser(
        "register", help="arena-sim only: get a simulator key (the arena's key comes from the organisers)"
    )
    r.add_argument("team_name")
    r.add_argument("event_code")
    data = {"default": os.environ.get("ARENA_DATA"), "help": "data package folder"}
    sets = {"default": "practice", "help": "practice, final or sandbox"}
    c = sub.add_parser("cases", help="list the cases you can play")
    c.add_argument("--set", **sets)
    c.add_argument("--save", metavar="DIR", help="also write each case file as JSON into DIR (for arena-sim --cases)")
    spend = {"action": "store_true", "help": "allow spending practice sessions (200 a day, shared by the team)"}
    p = sub.add_parser("play", help="play one case")
    p.add_argument("case_id")
    p.add_argument("--agent", default="naive", choices=["naive", "llm"])
    p.add_argument("--data", **data)
    p.add_argument("--practice", **spend)
    ch = sub.add_parser("chat", help="chat with one sandbox or practice case over the REST API")
    ch.add_argument("case_id", nargs="?", default="case:D01", help="default: sandbox case:D01")
    ch.add_argument("--set", choices=["sandbox", "practice"], default="sandbox")
    ch.add_argument("--resume", metavar="SESSION_ID", help="resume an open session")
    a = sub.add_parser("run", help="play every case of a set in parallel")
    a.add_argument("--set", **sets)
    a.add_argument("--agent", default="naive", choices=["naive", "llm"])
    a.add_argument("--data", **data)
    a.add_argument("--parallel", type=int, default=8, help="cases at once (at most 10)")
    a.add_argument("--waves", type=int, default=5, help="final: stop after this many waves have closed")
    a.add_argument("--practice", **spend)
    d = sub.add_parser("data", help="download and unpack the data (package, Sunday release once public)")
    d.add_argument("--out", default="data", help="folder to unpack into")
    sub.add_parser("me", help="your team: practice quota used and left, best score per case")
    b = sub.add_parser("board", help="show the leaderboard")
    b.add_argument("--set", **sets)
    v = sub.add_parser("vault", help="write Obsidian notes: suppliers (data), cases (case files), runs (sessions)")
    v.add_argument("what", choices=["suppliers", "cases", "runs"])
    v.add_argument("--set", **sets)
    v.add_argument("--data", **data)
    w = sub.add_parser("dashboard", help="live dashboard of the agent's negotiations (logs/events.jsonl)")
    w.add_argument("--port", type=int, default=8765)
    w.add_argument("--events", help="event log to view, such as a batch's logs/experiments/<id>/events.jsonl")
    m = sub.add_parser("mcp", help="run the read-only MCP server over the data (stdio)")
    m.add_argument("--data", **data)
    args = ap.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(asctime)s %(message)s",
        datefmt="%H:%M:%S",
    )

    if args.cmd == "dashboard":
        from .dashboard import serve

        return serve(args.port, path=args.events or None) if args.events else serve(args.port)
    if args.cmd in ("play", "run"):
        from . import events

        events.install()
    if args.cmd == "mcp":
        from .mcp_server import main as serve

        return serve(args.data)
    if args.cmd == "vault" and args.what == "suppliers":
        from . import vault
        from .data import DataPackage

        n = vault.build_suppliers(DataPackage(args.data or "../data"))
        return print(f"vault: {n} supplier notes written to {vault.VAULT / 'Suppliers'}")
    client = ArenaClient()
    if args.cmd == "vault":
        from . import vault

        if args.what == "cases":
            n = vault.build_cases(client.cases(args.set))
            return print(f"vault: {n} case notes written to {vault.VAULT / 'Cases'}")
        return log_runs(client, args.set, None)
    if args.cmd == "register":
        out = client.register(args.team_name, args.event_code)
        print(json.dumps(out, indent=2))
        print("\nA simulator key: put it into .env as ARENA_API_KEY=... while you point ARENA_URL at arena-sim.")
    elif args.cmd == "cases":
        cases = client.cases(args.set)
        if args.save:
            Path(args.save).mkdir(parents=True, exist_ok=True)
            for case in cases:
                name = case["case_id"].split(":")[-1] + ".json"
                (Path(args.save) / name).write_text(json.dumps(case, indent=1, ensure_ascii=False), encoding="utf-8")
            print(f"{len(cases)} case files saved to {args.save}")
        playable = {c["case_id"] for c in hosted(cases)}
        for case in cases:
            mark = "" if case["case_id"] in playable else "  (not hosted: data only)"
            print(case["case_id"], case.get("type", ""), case.get("title", "") + mark, sep="  ")
    elif args.cmd == "me":
        try:
            print(json.dumps(client.me(), indent=2))
        except ArenaError as e:
            print(f"no team view on this arena ({e})" if e.status == 404 else e)
    elif args.cmd == "board":
        print(json.dumps(client.leaderboard(args.set), indent=2))
    elif args.cmd == "data":
        for name, info in client.downloads().items():
            if info.get("url"):
                zipfile.ZipFile(io.BytesIO(client.download(name))).extractall(args.out)
                print(f"{name}: {Path(args.out) / name}")
            else:
                print(f"{name}: public from {info.get('at')}")
    if args.cmd in ("play", "run"):
        guard_practice(client, args)
    if args.cmd == "play":
        table = RemoteTable(client)
        try:
            result = play(table, args.case_id, agent_factory(args.agent, args.data)())
        except ArenaError as e:  # e.g. not hosted, the quota, a paused key: the arena says why
            raise SystemExit(str(e)) from None
        print(json.dumps(summary(result), indent=2))
        replay = client.session(table.session_id).get("replay_url")
        if replay:  # the supplier's reasons, move by move: read it, improve, play again
            print(f"replay: {os.environ['ARENA_URL'].rstrip('/')}{replay}")
        log_runs(client, None, args.agent, table.session_id)
    elif args.cmd == "chat":
        from .chat import chat

        if not os.environ.get("ARENA_API_KEY"):
            raise SystemExit("Set ARENA_API_KEY in the repo root .env before chatting with sellers.")
        try:
            session_id = chat(client, args.case_id, args.set, args.resume)
        except ArenaError as e:
            raise SystemExit(str(e)) from None
        if session_id:
            log_runs(client, None, "manual", session_id)
    elif args.cmd == "run" and args.set == "final":  # waits for each wave and plays its cases within the cap
        out = play_waves(client, agent_factory(args.agent, args.data), args.waves, min(args.parallel, 10))
    elif args.cmd == "run":
        ids = [case["case_id"] for case in hosted(client.cases(args.set))]
        out = play_all(
            lambda: RemoteTable(client),
            ids,
            agent_factory(args.agent, args.data),
            min(args.parallel, 10),
        )
    if args.cmd == "run":
        for case_id, result in out.items():
            print(case_id, result if isinstance(result, Exception) else summary(result))
        scores = {c: r.get("score") for c, r in out.items() if isinstance(r, dict)}
        if args.set == "final" and scores:  # points so far: each wave 0-100, their sum, as the board counts
            waves = {}
            for case in client.cases("final"):  # your own case list: which wave each case was in
                waves.setdefault(case["wave"], []).append(scores.get(case["case_id"]) or 0)
            points = {n: round(100 * statistics.mean(v), 1) for n, v in sorted(waves.items())}
            print(f"waves: {points}  points so far: {round(sum(points.values()), 1)} (the board is the record)")
        elif scores and all(v is not None for v in scores.values()):
            print(f"mean score: {100 * statistics.mean(scores.values()):.1f}")
        if args.set != "final":
            log_runs(client, args.set, args.agent)
    if args.cmd in ("play", "run") and client.practice_remaining is not None and not local():
        print(f"practice sessions left today: {client.practice_remaining}")


if __name__ == "__main__":
    main()
