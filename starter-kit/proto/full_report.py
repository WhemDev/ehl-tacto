"""Full practice report: every conversation (full text from the arena), the engine's decisions, the arena's result,
supplier stance per message, and a summary table - written into the vault.

    PYTHONPATH=. uv run python proto/full_report.py G5-1 [since_epoch] [vault_subdir]
"""
import glob
import json
import os
import sys
import time
from collections import Counter
from pathlib import Path

from arena_kit import ArenaClient
from arena_kit.cli import load_env

VAULT = Path(os.environ.get("VAULT_DIR", "/Users/rxv/Documents/Obsidian/EHL-Hackathon"))
BOARD = {"P01": 0.932, "P02": 0.684, "P03": 0.923, "P04": 0.874, "P05": 0.824, "P07": 0.779, "P08": 0.647,
         "P10": 0.679, "P11": 0.794, "P18": 0.673}
PREV = {"A10 (run 2)": {"P01": 0.956, "P02": 0.360, "P03": 0.923, "P04": 0.810, "P05": 0.659, "P07": 0.710, "P08": 0.603,
                        "P10": 0.671, "P11": 0.710, "P18": 0.532},
        "G7": {"P01": 0.794, "P02": 0.469, "P03": 0.919, "P04": 0.860, "P05": 0.659, "P07": 0.678, "P08": 0.531,
               "P10": 0.671, "P11": 0.710, "P18": 0.532},
        "G5-1 (run 2)": {"P01": 0.956, "P02": 0.360, "P03": 0.923, "P04": 0.810, "P05": 0.659, "P07": 0.710, "P08": 0.603,
                         "P10": 0.671, "P11": 0.710, "P18": 0.532},
        "G5-1 (run 1)": {"P01": 0.956, "P02": 0.360, "P03": 0.923, "P04": 0.810, "P05": 0.665, "P07": 0.710, "P08": 0.603,
                         "P10": 0.671, "P11": 0.710, "P18": 0.532}}
DECISIONS = ("target", "open", "round", "send", "hold", "push", "accept", "mirror_alternative", "accept_retry", "result",
             "stagger", "meet_field", "required_term", "conditional_repair", "recall", "fallback_counter", "hold_close",
             "writer", "error", "crash", "range_anchor")


def money(x):
    return f"{x:,.0f}" if isinstance(x, (int, float)) else str(x)


def terms_str(t):
    keep = ("unit_price", "payment_days", "lead_time_days", "contract_months", "incoterm", "effective_date",
            "index_clause", "volume_per_year", "ppm_commitment", "chargeback_eur_per_complaint", "tooling_eur")
    return ", ".join(f"{k}={t[k]}" for k in keep if k in t and t[k] not in (None, 0.0, "") or k == "unit_price" and k in t)


def main():
    load_env()
    var = sys.argv[1]
    since = float(sys.argv[2]) if len(sys.argv) > 2 else time.time() - 3 * 3600
    sub = sys.argv[3] if len(sys.argv) > 3 else f"Progress/Runs/{time.strftime('%Y-%m-%d')}-{var}-practice"
    outdir = VAULT / sub
    outdir.mkdir(parents=True, exist_ok=True)
    c = ArenaClient(timeout=30, retries=3)
    try:
        from proto.stance import Stance
        st = Stance()
    except Exception as e:  # stance is optional
        print("stance unavailable:", e)
        st = None
    rows = [json.loads(l) for l in open("proto/runs/variants/results.jsonl")]
    rows = [r for r in rows if r["variant"] == var and r["case"].startswith("case:P") and r.get("session")]
    latest = {}
    for r in rows:
        f = glob.glob(f"proto/runs/variants/{var}/{r['case'].replace(':', '_')}-{r['session']}.json")
        if f and os.path.getmtime(f[0]) >= since:
            latest[r["case"]] = (r, f[0])
    summary = []
    for case in sorted(latest):
        r, logf = latest[case]
        cid = case.split(":")[1]
        sid = r["session"]
        ev = json.load(open(logf))
        sess = c.session(sid)
        res = sess.get("result") or {}
        t0 = ev[0]["t"] if ev else 0
        lines = [f"---\ntags: [runs, practice, {var}, conversation]\n---",
                 f"# {cid} - {var} - score {res.get('score', r.get('score')):.3f}",
                 f"Session `{sid}` · [replay](https://arena.tacto.ai/replay/{sid}) · board record {BOARD.get(cid)}",
                 ""]
        co, cd, cb = res.get("c_open"), res.get("c_deal"), res.get("c_best")
        tg = [e for e in ev if e["kind"] == "target"]
        ct = tg[-1].get("c_target") if tg else None
        lines += ["## Outcome", "",
                  f"- **Deal:** {res.get('deal')} with `{res.get('supplier_id')}` · terms: {terms_str(res.get('terms') or {})}",
                  f"- **C_open** {money(co)} · **C_deal** {money(cd)} · **C_best** {money(cb)} · our target {money(ct)}",
                  f"- **Room captured:** {(co - cd) / (co - cb):.1%}" if co and cd and cb and co != cb else "",
                  f"- **Cost breakdown (arena):** " + ", ".join(f"{k} {money(v)}" for k, v in (res.get("cost_breakdown") or {}).items() if v),
                  ""]
        # engine decisions
        lines += ["## Engine decisions (our log)", ""]
        for e in ev:
            if e["kind"] in DECISIONS and e["kind"] not in ("send", "writer"):
                d = {k: v for k, v in e.items() if k not in ("t", "kind", "body", "cost_breakdown", "trace", "candidate", "profile")}
                lines.append(f"- `{e['t'] - t0:6.1f}s` **{e['kind']}** {json.dumps(d, default=str)[:400]}")
        lines.append("")
        # conversations
        stats = Counter()
        questions = []
        tension_rows = []
        for sup in sess.get("threads", {}) or [x for x in {e.get('supplier') for e in ev} if x]:
            th = c.thread(sid, sup)
            msgs = th.get("messages") or []
            lines += [f"## Conversation with `{sup}` ({len(msgs)} messages, status {th.get('status')})", ""]
            for i, m in enumerate(msgs):
                who = "US" if m.get("from") == "buyer" else f"{m.get('from_name') or sup}"
                sheets = m.get("term_sheets") or []
                lines.append(f"### {i + 1}. {who}" + (f" — status `{m.get('status')}`" if m.get("status") else ""))
                for s in sheets:
                    lines.append(f"- sheet `{s.get('term_sheet_id', 'ours')}`: {terms_str(s.get('terms') or {})}")
                if m.get("refs"):
                    lines.append(f"- refs: {m.get('refs')}")
                if m.get("claim_results"):
                    cr = [x.get("result") for x in m["claim_results"]]
                    stats.update(cr)
                    lines.append(f"- claim results: {cr}")
                if m.get("attachments"):
                    lines.append(f"- attachments: {[a.get('name') for a in m['attachments']]}")
                if m.get("action"):
                    lines.append(f"- action: {m.get('action')}")
                body = m.get("body") or ""
                if who != "US" and body and st is not None:
                    try:
                        a = st.analyze(body)
                        lines.append(f"- stance: move {a['move']:+.2f}, stop_risk {a['stop_risk']:+.2f}, label **{a['label']}**")
                        tension_rows.append((sup, i + 1, m.get("status"), a["move"], a["stop_risk"]))
                    except Exception:
                        pass
                if who != "US":
                    questions += [q.strip() + "?" for q in body.split("?")[:-1] if len(q.strip()) < 220][-3:]
                lines += ["", "```", body.strip(), "```", ""]
        (outdir / f"{cid}.md").write_text("\n".join(x for x in lines if x is not None))
        summary.append({"case": cid, "score": res.get("score", r.get("score")), "deal": res.get("deal"),
                        "supplier": res.get("supplier_id"), "price": (res.get("terms") or {}).get("unit_price"),
                        "c_open": co, "c_deal": cd, "c_best": cb, "c_target": ct,
                        "msgs": sum(1 for e in ev if e["kind"] == "send"), "claims": dict(stats),
                        "questions": questions[-4:], "tension": tension_rows,
                        "accept": [e.get("why") for e in ev if e["kind"] == "accept"],
                        "holds": sum(1 for e in ev if e["kind"] == "hold"), "pushes": sum(1 for e in ev if e["kind"] == "push")})
    (outdir / "summary.json").write_text(json.dumps(summary, indent=1, default=str))
    tab = [f"| Case | {var} | " + " | ".join(PREV) + " | Board | Gap to board | Deal | C_deal vs C_best | Our msgs | Claims | Accept |",
           "|---|---|" + "---|" * len(PREV) + "---|---|---|---|---|---|---|"]
    for s in summary:
        cid = s["case"]
        gap = (s["score"] or 0) - BOARD.get(cid, 0)
        tab.append(f"| [[{cid}]] | **{s['score']:.3f}** | " + " | ".join(f"{p.get(cid, 0):.3f}" for p in PREV.values())
                   + f" | {BOARD.get(cid)} | {gap:+.3f} | {s['supplier']} €{s['price']} | "
                   + (f"{(s['c_deal'] / s['c_best'] - 1):+.1%}" if s["c_deal"] and s["c_best"] else "–")
                   + f" | {s['msgs']} | {s['claims']} | {s['accept']} |")
    mean = sum(s["score"] or 0 for s in summary) / max(1, len(summary))
    (outdir / "table.md").write_text("\n".join(tab) + f"\n\nMean {var}: **{mean:.3f}**\n")
    print("\n".join(tab))
    print(f"mean {mean:.3f} -> {outdir}")


if __name__ == "__main__":
    main()
