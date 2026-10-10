"""Repeated, isolated algorithm comparisons on sandbox cases or a local simulator.

The CLI previews the schedule by default. Raw experiment files stay under ignored logs/.
An algorithm is a factory returning a fresh object with decide(case, threads), just as in play.py.
"""

import argparse
import copy
import csv
import importlib
import io
import json
import math
import os
import random
import re
import statistics
import subprocess
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from . import events as event_log
from .cli import commit, load_env
from .client import ArenaClient
from .play import RemoteTable, hosted, play

ROOT = Path(__file__).resolve().parents[2]
SECRET_FIELDS = {"api_key", "token", "access_token", "secret", "password", "authorization"}


def validate_config(config):
    def check(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key.lower() in SECRET_FIELDS or key.lower().endswith("_api_key"):
                    raise ValueError("Read credentials from environment variables, not experiment config")
                check(item)
        elif isinstance(value, list):
            for item in value:
                check(item)

    check(config)
    repeats = config.get("repeats", 3)
    if type(repeats) is not int or repeats < 1:
        raise ValueError("repeats must be a positive integer")
    if "cases" in config and (not isinstance(config["cases"], list) or
                              not all(isinstance(case_id, str) for case_id in config["cases"])):
        raise ValueError("cases must be a list of case IDs")
    strategies = config.get("strategies", [])
    if not strategies:
        raise ValueError("At least one strategy is required")
    names = set()
    for strategy in strategies:
        name = strategy.get("name", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", name) or name in names:
            raise ValueError("Strategy names must be unique letters, digits, underscores or hyphens")
        names.add(name)
        if strategy.get("factory", "").count(":") != 1:
            raise ValueError("factory must be module:callable, e.g. arena_kit.agents.naive:NaiveAgent")
        if not isinstance(strategy.get("kwargs", {}), dict):
            raise ValueError("Strategy kwargs must be an object")


def select_cases(client, target, requested=None):
    url = urlsplit(str(client.http.base_url))
    if url.username or url.password or url.query or url.fragment:
        raise ValueError("ARENA_URL must not contain credentials, query parameters or a fragment")
    if target not in {"sandbox", "sim"}:
        raise ValueError("Experiments support sandbox and local sim only")
    loopback = url.hostname in {"localhost", "127.0.0.1", "::1"}
    if target == "sim" and not loopback:
        raise ValueError("The sim target requires a loopback URL; hosted practice is not allowed")
    if target == "sandbox" and loopback:
        raise ValueError("Use --target sim for a local simulator so its results are labelled correctly")
    listed = client.cases("sandbox" if target == "sandbox" else "practice")
    cases = hosted(listed) if target == "sandbox" else listed
    by_id = {case["case_id"]: case for case in cases}
    if requested:
        unknown = set(requested) - by_id.keys()
        if unknown:
            raise ValueError(f"Cases not available in this target: {sorted(unknown)}")
        by_id = {key: by_id[key] for key in requested}
    if not by_id:
        raise ValueError("No playable cases found")
    return [by_id[key] for key in sorted(by_id)]


def schedule(config, cases):
    """Shuffle strategies within each case/repetition block; the seed controls order only."""
    rng = random.Random(config.get("seed", 2026))
    trials = []
    for repeat in range(1, config.get("repeats", 3) + 1):
        case_ids = [case["case_id"] for case in cases]
        rng.shuffle(case_ids)
        for case_id in case_ids:
            names = [strategy["name"] for strategy in config["strategies"]]
            rng.shuffle(names)
            for name in names:
                trials.append({"trial": len(trials) + 1, "case_id": case_id, "strategy": name, "repeat": repeat})
    return trials


class Files:
    def __init__(self, folder):
        self.folder = folder
        self.secrets = sorted({
            value for key, value in os.environ.items()
            if len(value) >= 8 and key.upper().endswith(("_KEY", "_TOKEN", "_SECRET", "_PASSWORD"))
        }, key=len, reverse=True)

    def write(self, name, text):
        for secret in self.secrets:
            text = text.replace(secret, "[REDACTED]")
        path = self.folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(path.suffix + ".partial")
        temp.write_text(text, encoding="utf-8")
        temp.replace(path)

    def json(self, name, value):
        self.write(name, json.dumps(value, indent=2, ensure_ascii=False, default=str) + "\n")


class TimedAgent:
    def __init__(self, agent, record):
        self.agent, self.record = agent, record

    def decide(self, case, threads):
        started = time.monotonic()
        try:
            return self.agent.decide(case, threads)
        finally:
            self.record["decision_seconds"].append(round(time.monotonic() - started, 4))


class TrialTable(RemoteTable):
    def __init__(self, client, record, save):
        super().__init__(client)
        self.record, self.save, self.open_attempted = record, save, False

    def open(self, case_id):
        self.open_attempted = True
        opened = super().open(case_id)
        self.record["session_id"] = self.session_id
        self.save()  # persist the session ID before the first policy decision
        return opened

    def send(self, supplier_id, message):
        if supplier_id not in self.record["contacted_suppliers"]:
            self.record["contacted_suppliers"].append(supplier_id)
        return super().send(supplier_id, message)


def experiment_score(record):
    score = (record.get("result") or {}).get("score")
    return float(score) if record["status"] == "completed" and isinstance(score, (int, float)) else 0.0


def qualification(records, strategies):
    """Case-balanced median across at least three D01 and three D02 sandbox runs."""
    rows = []
    for strategy in strategies:
        groups = {case_id: [r for r in records if r["strategy"] == strategy["name"] and
                             r["case_id"] == case_id] for case_id in ("case:D01", "case:D02")}
        scores = {case_id: [experiment_score(r) for r in group] for case_id, group in groups.items()}
        enough = all(len(group) >= 3 for group in groups.values())
        medians = {case_id: statistics.median(values) if values else None for case_id, values in scores.items()}
        midpoint = statistics.mean(medians.values()) if all(v is not None for v in medians.values()) else None
        all_records = [r for group in groups.values() for r in group]
        all_scores = [s for values in scores.values() for s in values]
        deals = sum(r["status"] == "completed" and bool((r.get("result") or {}).get("deal"))
                    for r in all_records)
        rows.append({"strategy": strategy["name"], "runs": (len(groups["case:D01"]), len(groups["case:D02"])),
                     "d01": medians["case:D01"], "d02": medians["case:D02"], "combined": midpoint,
                     "worst": min(all_scores) if all_scores else None,
                     "deal_rate": deals / len(all_records) if all_records else None,
                     "qualified": enough and midpoint is not None and midpoint >= 0.8})
    return rows


def report(files, manifest, records):
    files.json("trials.json", records)
    fields = ["trial", "strategy", "case_id", "repeat", "status", "session_id", "score", "experiment_score",
              "deal", "c_deal", "end_reason", "rounds", "elapsed_seconds", "max_decision_seconds", "replay_url"]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    for record in records:
        result = record.get("result") or {}
        row = {key: record.get(key, "") for key in fields}
        row.update({key: result.get(key) for key in ("score", "deal", "c_deal")})
        row.update(experiment_score=experiment_score(record),
                   max_decision_seconds=max(record.get("decision_seconds", []), default=0))
        writer.writerow(row)
    files.write("results.csv", output.getvalue())
    lines = [f"# Negotiation experiment · {manifest['target']}", "",
             f"Recorded {len(records)} of {len(manifest['schedule'])} planned trials. State: {manifest['status']}.", "",
             "Scores below count failed trials as 0; raw arena scores are preserved separately in results.csv.",
             "Costs are compared within each case. A simulator score does not predict hosted supplier performance.",
             "Incomplete experiments are provisional. The order seed cannot seed the hosted suppliers.", "",
             "| Case | Strategy | Completed / attempted | Mean score | Std dev | Min | Deal rate | Max decision s |",
             "|---|---|---:|---:|---:|---:|---:|---:|"]
    for case_id in sorted({r["case_id"] for r in manifest["schedule"]}):
        for strategy in manifest["config"]["strategies"]:
            group = [r for r in records if r["case_id"] == case_id and r["strategy"] == strategy["name"]]
            if not group:
                continue
            scores = [experiment_score(r) for r in group]
            completed = sum(r["status"] == "completed" for r in group)
            deals = sum(r["status"] == "completed" and bool((r.get("result") or {}).get("deal")) for r in group)
            slowest = max((s for r in group for s in r.get("decision_seconds", [])), default=0)
            deviation = statistics.stdev(scores) if len(scores) > 1 else 0
            lines.append(f"| {case_id} | {strategy['name']} | {completed}/{len(group)} | "
                         f"{statistics.mean(scores):.3f} | {deviation:.3f} | {min(scores):.3f} | "
                         f"{deals / len(group):.0%} | {slowest:.2f} |")
    baseline = manifest["config"]["strategies"][0]["name"]
    lines += ["", f"## Paired differences against {baseline}", "",
              "Pairs share a case and repeat number, but use independent supplier sessions.", "",
              "| Case | Candidate | Pairs | Mean score difference |", "|---|---|---:|---:|"]
    for case in manifest["cases"]:
        by_repeat = {(r["strategy"], r["repeat"]): r for r in records if r["case_id"] == case["case_id"]}
        for strategy in manifest["config"]["strategies"][1:]:
            deltas = [experiment_score(by_repeat[strategy["name"], n]) - experiment_score(by_repeat[baseline, n])
                      for n in range(1, manifest["config"].get("repeats", 3) + 1)
                      if (strategy["name"], n) in by_repeat and (baseline, n) in by_repeat]
            if deltas:
                lines.append(f"| {case['case_id']} | {strategy['name']} | {len(deltas)} | "
                             f"{statistics.mean(deltas):+.3f} |")
    if {case["case_id"] for case in manifest["cases"]} >= {"case:D01", "case:D02"}:
        rows = qualification(records, manifest["config"]["strategies"])
        fmt = lambda value: f"{value:.3f}" if value is not None else "–"  # noqa: E731
        lines += ["", "## Repeated-run qualification", "",
                  "Each case needs at least three runs. Failed trials count as 0. "
                  "The combined score is the midpoint of the two case medians.", "",
                  "| Strategy | D01 runs | D01 median | D02 runs | D02 median | Combined | Worst | Deal rate | Gate |",
                  "|---|---:|---:|---:|---:|---:|---:|---:|---|"]
        for row in rows:
            gate = "qualified" if row["qualified"] else ("need repeats" if min(row["runs"]) < 3 else "below 0.8")
            lines.append(f"| {row['strategy']} | {row['runs'][0]} | {fmt(row['d01'])} | "
                         f"{row['runs'][1]} | {fmt(row['d02'])} | {fmt(row['combined'])} | "
                         f"{fmt(row['worst'])} | {row['deal_rate']:.0%} | {gate} |")
        qualified = sorted((row for row in rows if row["qualified"]),
                           key=lambda row: (row["combined"], row["worst"], row["deal_rate"]), reverse=True)
        lines += ["", "### Qualified ranking", ""]
        lines += ([f"{n}. **{row['strategy']}** — combined median {row['combined']:.3f}; "
                   f"worst run {row['worst']:.3f}; deal rate {row['deal_rate']:.0%}"
                   for n, row in enumerate(qualified, 1)] if qualified else ["No strategy has cleared the gate yet."])
    files.write("report.md", "\n".join(lines) + "\n")


def run_experiment(client, config, cases, folder, target):
    validate_config(config)
    # Recheck the target before opening any session, including for Python callers.
    available = select_cases(client, target, [case["case_id"] for case in cases])
    factories = {}
    for strategy in config["strategies"]:
        module, attribute = strategy["factory"].split(":")
        factory = getattr(importlib.import_module(module), attribute)
        if not callable(factory):
            raise ValueError(f"{strategy['name']}: factory must be callable")
        factories[strategy["name"]] = (factory, strategy.get("kwargs", {}))
    folder.mkdir(parents=True, exist_ok=False)
    files, records = Files(folder), []
    dirty = bool(subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True).stdout)
    manifest = {"target": target, "config": config, "cases": available, "schedule": schedule(config, available),
                "commit": commit(), "dirty_worktree": dirty, "started_at": datetime.now(UTC).isoformat(),
                "python": sys.version, "model_settings": {key: os.environ.get(key) for key in
                                                          ("LLM_PROVIDER", "LLM_MODEL", "LLM_EFFORT")},
                "arena_url": str(client.http.base_url), "status": "running"}
    files.json("manifest.json", manifest)
    for trial in manifest["schedule"]:
        record = {**trial, "status": "running", "session_id": None, "result": None,
                  "started_at": datetime.now(UTC).isoformat(),
                  "decision_seconds": [], "contacted_suppliers": [], "policy_diagnostics": None}
        records.append(record)
        save = lambda: files.json("trials.json", records)  # noqa: E731
        save()
        table = TrialTable(client, record, save)
        started, stop = time.monotonic(), False
        previous_event_path, previous_event_run = event_log.PATH, event_log.RUN
        event_log.PATH, event_log.RUN = str(folder / "events.jsonl"), folder.name
        event_log.ctx.case, event_log.ctx.session = trial["case_id"], None
        event_log.ctx.trial, event_log.ctx.strategy = trial["trial"], trial["strategy"]
        event_log.ctx.repeat, event_log.ctx.target = trial["repeat"], target
        try:
            event_log.emit("trial")
            factory, kwargs = factories[trial["strategy"]]
            agent = factory(**copy.deepcopy(kwargs))  # a fresh instance and settings for every trial
            record["result"] = play(table, trial["case_id"], TimedAgent(agent, record))
            diagnostics = getattr(agent, "diagnostics", None)
            if callable(diagnostics):
                record["policy_diagnostics"] = diagnostics()
            score = record["result"].get("score")
            if not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 1:
                raise ValueError("Arena returned no valid score")
            record["status"] = "completed"
        except (Exception, KeyboardInterrupt) as error:
            record.update(status="failed", error=f"{type(error).__name__}: {error}")
            stop = isinstance(error, KeyboardInterrupt) or (table.open_attempted and table.session_id is None)
        finally:
            if table.session_id:
                try:
                    state = client.session(table.session_id)
                    if state.get("status") != "ended":
                        record.update(status="failed", cleanup="walk_away")
                        client.walk_away(table.session_id)  # only the session this trial created
                        state = client.session(table.session_id)
                        if state.get("status") != "ended":
                            raise RuntimeError("Trial session is still open after cleanup")
                    result = state.get("result") or record["result"] or {}
                    record.update(result={key: value for key, value in result.items() if key != "trace"},
                                  end_reason=state.get("end_reason"), rounds=state.get("rounds"))
                    replay = state.get("replay_url")
                    if replay:
                        url = urlsplit(str(client.http.base_url))
                        record["replay_url"] = urljoin(f"{url.scheme}://{url.netloc}", replay)
                    files.json(f"sessions/{table.session_id}.json", state)
                except Exception as error:
                    record["archive_error"] = f"{type(error).__name__}: {error}"
                    stop = stop or record["status"] != "completed"
            record["elapsed_seconds"] = round(time.monotonic() - started, 3)
            event_log.emit("trial_status", status=record["status"], score=experiment_score(record))
            event_log.PATH, event_log.RUN = previous_event_path, previous_event_run
            event_log.ctx.trial = event_log.ctx.strategy = event_log.ctx.repeat = event_log.ctx.target = None
            report(files, manifest, records)
        print(f"Trial {trial['trial']}/{len(manifest['schedule'])}: {trial['strategy']} "
              f"{trial['case_id']} {record['status']} score={experiment_score(record):.3f}", flush=True)
        if stop:
            manifest["status"] = "stopped"
            break
    else:
        manifest["status"] = "completed"
    manifest["finished_at"] = datetime.now(UTC).isoformat()
    files.json("manifest.json", manifest)
    report(files, manifest, records)
    return folder


def main(argv=None):
    load_env()
    load_env(ROOT / ".env")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--target", choices=["sandbox", "sim"], default="sandbox")
    parser.add_argument("--url", help="Override ARENA_URL (e.g. the local simulator)")
    parser.add_argument("--cases", nargs="+", help="Default: every playable case in the target")
    parser.add_argument("--repeats", type=int, help="Override the config's repetition count")
    parser.add_argument("--out", type=Path, default=ROOT / "logs" / "experiments")
    parser.add_argument("--execute", action="store_true", help="Start sessions; otherwise only preview the schedule")
    args = parser.parse_args(argv)
    config = json.loads(args.config.read_text())
    if args.repeats is not None:
        config["repeats"] = args.repeats
    validate_config(config)
    client = ArenaClient(base_url=args.url)
    cases = select_cases(client, args.target, args.cases or config.get("cases"))
    trials = schedule(config, cases)
    print(f"Target: {args.target}; cases: {', '.join(c['case_id'] for c in cases)}; "
          f"strategies: {len(config['strategies'])}; total sessions: {len(trials)}")
    if not args.execute:
        print("Preview only. Add --execute to run this schedule.")
        return
    name = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    folder = run_experiment(client, config, cases, args.out / name, args.target)
    print(f"Report: {folder / 'report.md'}")


if __name__ == "__main__":
    main()
