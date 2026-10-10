"""Offline A/B of the LLM writer on recorded threads: no arena session, no quota (Anthropic usage only).

    PYTHONPATH=. uv run python proto/writer_dry.py A10 [max_messages]   -> proto/runs/writer_dry_<variant>.md

For every e-mail we sent in that variant's practice/sandbox logs: the template, what Sonnet 5.5 wrote for the same
moment (style profile from the supplier's earlier replies), the validator verdict and the latency.
"""
import glob
import json
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from arena_kit.cli import load_env
from proto import writer

VAR = sys.argv[1] if len(sys.argv) > 1 else "A10"
LIMIT = int(sys.argv[2]) if len(sys.argv) > 2 else 40


def jobs():
    for f in sorted(glob.glob(f"proto/runs/variants/{VAR}/case_*.json")):
        ev = json.load(open(f))
        case = f.split("/")[-1].split("-")[0]
        for i, e in enumerate(ev):
            if e["kind"] != "send" or not e.get("body"):
                continue
            sup = e.get("supplier")
            before = ev[:i]
            theirs = [x["body"] for x in before if x["kind"] == "reply" and x.get("supplier") == sup and x.get("body")]
            ours = [x["body"] for x in before if x["kind"] == "send" and x.get("supplier") == sup and x.get("body")]
            sheets = [", ".join(f"{k} {v}" for k, v in s[0].items()) for s in e.get("sheets") or []]
            yield case, sup, e["body"], e.get("refs") or [], sheets, theirs, ours[-1] if ours else ""


def one(j):
    case, sup, tmpl, refs, sheets, theirs, ours = j
    body, info = writer.rewrite(tmpl, refs, sheets, theirs, ours, case, 7.0)
    return case, sup, tmpl, theirs, body, info


if __name__ == "__main__":
    load_env()
    js = list(jobs())[:LIMIT]
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(one, js))
    out = [f"# Writer dry run on {VAR} logs ({len(res)} e-mails)\n"]
    reasons = Counter((r[5]["reason"] or "used").split(" ")[0] if not r[5]["used"] else "used" for r in res)
    lat = sorted(r[5]["latency"] for r in res if r[5].get("latency"))
    out.append(f"Outcome: {dict(reasons)}; latency median {lat[len(lat) // 2] if lat else '-'} s, "
               f"max {lat[-1] if lat else '-'} s\n")
    for case, sup, tmpl, theirs, body, info in res:
        out.append(f"\n## {case} {sup} — {'LLM' if info['used'] else 'template: ' + str(info['reason'])} "
                   f"({info.get('latency')} s)\n")
        out.append(f"Profile: `{json.dumps(info.get('profile'))}`\n")
        if theirs:
            out.append("**Supplier said (last):**\n\n> " + theirs[-1][:500].replace("\n", "\n> ") + "\n")
        out.append("**Template:**\n\n```\n" + tmpl + "\n```\n")
        if info["used"]:
            out.append("**Sonnet 5.5:**\n\n```\n" + body + "\n```\n")
        elif info.get("candidate"):
            out.append("**Rejected candidate:**\n\n```\n" + info["candidate"] + "\n```\n")
    path = f"proto/runs/writer_dry_{VAR}.md"
    open(path, "w").write("\n".join(out))
    print(out[1], "->", path)
