"""The team's Obsidian vault (`vault/` at the repo root): shared notes for people and agents.

- The buyer agent reads `Playbook/*.md` notes whose frontmatter says `agent: true`, and the
  `## Team notes` section of the supplier's note in `Suppliers/`.
- `arena vault suppliers|cases|runs` writes notes from the data package, the case files and your
  ended sessions. Generated notes keep everything from `## Team notes` on, so edits survive.
"""

import json
import os
import re
from pathlib import Path

VAULT = Path(os.environ.get("ARENA_VAULT") or Path(__file__).resolve().parents[2] / "vault" / "Team-Knowledge")
TEAM = "## Team notes"
TEAM_STUB = f"{TEAM}\n\n_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._\n"


def frontmatter(text):
    """`({key: value}, body)` for a note with a simple `---` YAML header."""
    if not text.startswith("---\n"):
        return {}, text
    head, sep, body = text[4:].partition("\n---")
    if not sep:
        return {}, text
    meta = {}
    for line in head.splitlines():
        key, sep, value = line.partition(":")
        if sep and not line.startswith((" ", "-")):
            meta[key.strip()] = value.strip().strip("\"'")
    return meta, body.lstrip("-").lstrip("\n")


def _yaml(meta):
    lines = ["---"]
    for k, v in meta.items():
        if v is None or v == "":
            continue
        if isinstance(v, (list, tuple)):
            lines.append(f"{k}: [{', '.join(json.dumps(str(x)) for x in v)}]")
        elif isinstance(v, bool):
            lines.append(f"{k}: {'true' if v else 'false'}")
        elif isinstance(v, (int, float)):
            lines.append(f"{k}: {v}")
        else:
            lines.append(f"{k}: {json.dumps(str(v), ensure_ascii=False)}")
    return "\n".join(lines + ["---", ""])


def note_name(text):
    """A file name Obsidian accepts (no : / \\ | ? * < > ")."""
    return re.sub(r"\s+", " ", re.sub(r'[:/\\|?*<>"#^\[\]]+', " ", str(text))).strip()


def write_note(path, meta, body, keep_team=True):
    """Write a generated note; keep its `## Team notes` section if the file exists."""
    path.parent.mkdir(parents=True, exist_ok=True)
    team = TEAM_STUB
    if keep_team and path.is_file():
        old = path.read_text(encoding="utf-8")
        if TEAM in old:
            team = old[old.index(TEAM) :]
    text = _yaml(meta) + body.rstrip() + "\n\n" + (team if keep_team else "")
    if not path.is_file() or path.read_text(encoding="utf-8") != text:
        path.write_text(text, encoding="utf-8")
        return True
    return False


# --- what the agent reads -------------------------------------------------------------------


def playbook(limit=6000, root=None):
    """The team playbook for the agent's prompt: every `Playbook/` note with `agent: true`."""
    out = []
    for p in sorted(((root or VAULT) / "Playbook").glob("*.md")):
        meta, body = frontmatter(p.read_text(encoding="utf-8"))
        if meta.get("agent", "").lower() == "true":
            out.append(f"## {p.stem}\n{body.strip()}")
    return "\n\n".join(out)[:limit]


def supplier_notes(supplier_id, limit=1500, root=None):
    """The `## Team notes` section of a supplier's note, if anyone wrote something there."""
    for p in ((root or VAULT) / "Suppliers").glob("*.md"):
        text = p.read_text(encoding="utf-8")
        if frontmatter(text)[0].get("id") == supplier_id and TEAM in text:
            notes = text[text.index(TEAM) + len(TEAM) :].replace(TEAM_STUB[len(TEAM) :].strip(), "").strip()
            if notes:
                return notes[:limit]
    return ""


# --- notes from the data package ------------------------------------------------------------


def _table(rows, cols):
    if not rows:
        return "_none_\n"
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for r in rows:
        out.append(
            "| " + " | ".join(str(r.get(c, "") if r.get(c) is not None else "").replace("|", "/") for c in cols) + " |"
        )
    return "\n".join(out) + "\n"


def build_suppliers(pkg, root=None):
    """One note per detailed supplier: profile, parts, scorecards, history, news, documents."""
    folder = (root or VAULT) / "Suppliers"
    changed = 0
    for s in pkg.query("SELECT * FROM suppliers WHERE detail = 'full' ORDER BY id"):
        sid = s["id"]
        intel = (pkg.query("SELECT * FROM supplier_intel WHERE supplier_id = ?", (sid,)) or [{}])[0]
        parts = pkg.query(
            """SELECT so.part_id, p.description, so.status, so.quota_pct, so.tooling_owner,
                      COALESCE(
                        (SELECT id || ' ' || unit_cost || ' (own plant, ' || cost_base || ')' FROM should_cost
                         WHERE part_id = so.part_id AND supplier_id = so.supplier_id),
                        (SELECT id || ' ' || unit_cost || ' (' || COALESCE('plant of ' || NULLIF(supplier_id, ''), cost_base || ' base') || ')' FROM should_cost
                         WHERE part_id = so.part_id ORDER BY supplier_id IS NOT NULL LIMIT 1)
                      ) AS should_cost
               FROM sourcing so JOIN parts p ON p.id = so.part_id
               WHERE so.supplier_id = ? ORDER BY so.part_id""",
            (sid,),
        )
        cards = pkg.query(
            "SELECT id, quarter, otd_pct, ppm, qn_count, score, colour FROM scorecards WHERE supplier_id = ? ORDER BY quarter DESC LIMIT 4",
            (sid,),
        )
        hist = pkg.query(
            "SELECT date, part_id, type, asked_pct, settled_pct, note FROM negotiation_history WHERE supplier_id = ? ORDER BY date DESC LIMIT 8",
            (sid,),
        )
        news = pkg.query("SELECT id, date, topic, headline FROM news WHERE supplier_id = ? ORDER BY date DESC", (sid,))
        docs = pkg.query(
            "SELECT id, date, kind, subject, file, asked_pct FROM documents WHERE supplier_id = ? ORDER BY date DESC",
            (sid,),
        )
        for d in docs:
            d["link"] = f"[[{Path(d['file']).stem}]]" if d.get("file") else ""
        ctr = (s.get("contract_id") or "").split(":")[-1]
        meta = {
            "id": sid,
            "name": s["name"],
            "category": s["category"],
            "country": s["country"],
            "abc": s.get("abc_class"),
            "owner_type": intel.get("owner_type"),
            "tags": ["supplier", s["category"]],
        }
        credit = f"{intel.get('credit_index')} (12 m ago {intel.get('credit_index_12m_ago')})"
        turnover = intel.get("turnover_eur") or intel.get("turnover_band")
        body = f"""# {s["name"]}

`{sid}` · {s["category"]} · {s["country"]} · ABC {s.get("abc_class")} · contract {f"[[{ctr}]]" if ctr else "-"}

## Profile
- Legal form {intel.get("legal_form")}, founded {intel.get("founded")}, owner {intel.get("owner_type")}{", group " + intel["group_parent"] if intel.get("group_parent") else ""}
- Staff {intel.get("staff")}, turnover {turnover} (FY{intel.get("filed_fy")}), equity ratio {intel.get("equity_ratio_pct")} %
- Credit index {credit} - higher is worse
- VDA 6.3 grade {intel.get("vda63_grade")}; {intel.get("certifications")}
- Standard terms: {s.get("payment_days")} days net, {s.get("incoterm")}, lead time {s.get("standard_lead_time_days")} days

## Parts
{_table(parts, ["part_id", "description", "status", "quota_pct", "tooling_owner", "should_cost"])}
## Scorecards (rolling 12 months)
{_table(cards, ["id", "otd_pct", "ppm", "qn_count", "score", "colour"])}
## Negotiation history
{_table(hist, ["date", "part_id", "type", "asked_pct", "settled_pct", "note"])}
## News
{_table(news, ["id", "date", "topic", "headline"])}
## Letters, e-mails, notes
{_table(docs, ["date", "kind", "subject", "asked_pct", "link"])}"""
        changed += write_note(folder / f"{note_name(s['name'])}.md", meta, body)
    return changed


def build_cases(cases, root=None):
    """One note per case file (practice, sandbox or - after it - final)."""
    folder = (root or VAULT) / "Cases"
    changed = 0
    for c in cases:
        b = c.get("buyer", {})
        meta = {
            "case_id": c["case_id"],
            "set": c.get("set"),
            "type": c.get("type"),
            "goal": b.get("category_goal"),
            "hosted": c.get("hosted"),
            "suppliers": c.get("suppliers", []),
            "tags": ["case", c.get("type", "")],
        }
        musts = "\n".join(f"- `{m['field']} {m['op']} {m['value']}`" for m in b.get("must_haves", [])) or "_none_"
        rates = {k: v for k, v in b.items() if k not in ("must_haves", "alternative")}
        body = f"""# {c["case_id"]} · {c.get("title", "")}

{c.get("type")} · goal **{b.get("category_goal")}** · suppliers {", ".join(c.get("suppliers", []))} · round limit {c.get("round_limit", 10)}

## Briefing
{c.get("briefing", "")}

## Must-haves
{musts}

## Alternative
```json
{json.dumps(b.get("alternative"), indent=1, ensure_ascii=False)}
```

## Terms
- negotiable: {", ".join(c.get("negotiable", []))}
- fixed: `{json.dumps(c.get("fixed_terms", {}), ensure_ascii=False)}`
- options: `{json.dumps(c.get("term_options", {}), ensure_ascii=False)}`

## Buyer rates
```json
{json.dumps(rates, indent=1, ensure_ascii=False)}
```

## Refs
{", ".join(f"`{r}`" for r in c.get("refs", [])) or "_none_"} · trigger `{c.get("trigger_doc")}`

## Runs
```dataview
TABLE score, deal, supplier, rounds, agent, commit
FROM "Runs" WHERE case = "{c["case_id"]}" SORT score DESC
```"""
        changed += write_note(
            folder / f"{note_name(c['case_id'].split(':')[-1] + ' ' + c.get('title', ''))}.md", meta, body
        )
    return changed


# --- runs -----------------------------------------------------------------------------------


def _terms(terms):
    return ", ".join(f"{k} {json.dumps(v, ensure_ascii=False)}" for k, v in (terms or {}).items()) or "-"


def _move(move):
    if not isinstance(move, dict):
        return str(move)
    lines = []
    head = [f"**{move.get('status')}**" if move.get("status") else "", move.get("subject") or ""]
    if any(head):
        lines.append(" · ".join(h for h in head if h))
    sheets = move.get("term_sheets") or (
        [{"term_sheet_id": move.get("offer_id"), "terms": move["terms"]}] if move.get("terms") else []
    )
    for ts in sheets:
        tid = f" `{ts['term_sheet_id']}`" if ts.get("term_sheet_id") else ""
        lines.append(f"- term sheet{tid}: {_terms(ts.get('terms', ts))}")
    if move.get("action"):
        lines.append(f"- action: `{json.dumps(move['action'])}`")
    if move.get("claim_results"):
        lines.append(f"- claims: {json.dumps(move['claim_results'])}")
    if move.get("signals"):
        lines.append(f"- signals: {json.dumps(move['signals'])}")
    if text := move.get("body") or move.get("text"):
        lines.append("\n".join("> " + x for x in str(text).splitlines()))
    return "\n".join(lines)


def log_session(state, base_url="", agent=None, commit=None, root=None):
    """A note in `Runs/` for one ended session: result, cost breakdown, every move with reasons."""
    if state.get("status") != "ended":
        return None
    r = state.get("result") or {}
    case_id, sid = state.get("case_id", ""), state.get("session_id", "")
    meta = {
        "case": case_id,
        "session": sid,
        "set": state.get("set"),
        "score": round(r["score"], 3) if isinstance(r.get("score"), (int, float)) else None,
        "deal": r.get("deal"),
        "supplier": r.get("supplier_id"),
        "end_reason": state.get("end_reason") or r.get("end_reason"),
        "rounds": state.get("rounds"),
        "c_open": r.get("c_open"),
        "c_deal": r.get("c_deal"),
        "c_best": r.get("c_best"),
        "agent": agent,
        "commit": commit,
        "tags": ["run"],
    }
    replay = f"{base_url.rstrip('/')}{state['replay_url']}" if state.get("replay_url") else ""
    breakdown = r.get("cost_breakdown") or {}
    rows = [{"item": k, "eur": v} for k, v in breakdown.items()] if isinstance(breakdown, dict) else []
    trace = []
    for step in r.get("trace") or state.get("trace") or []:
        reasons = step.get("reasons")
        if isinstance(reasons, list):
            reasons = "\n".join(f"- {x}" for x in reasons)
        trace.append(
            f"### Round {step.get('round')} · {step.get('actor')}\n{_move(step.get('move'))}"
            + (f"\n\n**Reasons:**\n{reasons}" if reasons else "")
        )
    score = meta["score"]
    body = f"""# {case_id.split(":")[-1]} · score {score if score is not None else "-"}

{f"[Replay]({replay})" if replay else ""} · {"deal with " + str(r.get("supplier_id")) if r.get("deal") else "no deal"} · {meta["end_reason"]}

## Result
- terms: {_terms(r.get("terms"))}
- C open {r.get("c_open")} · C deal {r.get("c_deal")} · C alt {r.get("c_alt")} · C best {r.get("c_best")}

{_table(rows, ["item", "eur"])}
## Negotiation
{chr(10).join(trace) or "_no trace (in the final: only after the final)_"}"""
    path = (root or VAULT) / "Runs" / f"{note_name(case_id.split(':')[-1] + ' ' + sid)}.md"
    write_note(path, meta, body)
    return path


def sync_runs(client, set_="practice", agent=None, commit=None, root=None, mine=None):
    """Log every ended session of a set that has no note yet. `mine`: the session IDs this process played -
    only they get `agent` (the team shares one key: the rest were played by someone else)."""
    folder = (root or VAULT) / "Runs"
    seen = (
        {frontmatter(p.read_text(encoding="utf-8"))[0].get("session") for p in folder.glob("*.md")}
        if folder.is_dir()
        else set()
    )
    new, listed = [], client.sessions(set_)
    for s in listed.get("sessions", []) if isinstance(listed, dict) else listed:
        if s.get("status") == "ended" and s["session_id"] not in seen:
            who = agent if mine is None or s["session_id"] in mine else "another teammate"
            path = log_session(
                client.session(s["session_id"]),
                os.environ.get("ARENA_URL", ""),
                who,
                commit if who == agent else None,
                root,
            )
            if path:
                new.append(path)
    return new
