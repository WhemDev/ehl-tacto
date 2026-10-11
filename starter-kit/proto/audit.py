"""Offline audit of what we actually sent (no arena calls, no quota): payload integrity + cost reconciliation.

    PYTHONPATH=. uv run python proto/audit.py G8s            -> proto/runs/audit_<variant>.md

Payload: duplicate IDs inside one message, messages citing > 3 IDs, the same ID re-cited to the same supplier or to
another supplier, claims the arena returned as contradicted/duplicate (with the message that caused them), wording
that contradicts the case data (horizon / contract months, supplier-type phrases), unsupported comparison phrases.
Cost: our own C of the accepted terms (relationship estimate included where the engine uses it) vs the arena's c_deal.
"""
import glob
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

VAR = sys.argv[1] if len(sys.argv) > 1 else "G8s"
ROOT = Path("proto/runs/variants")


def latest_logs(var):
    rows = [json.loads(l) for l in open(ROOT / "results.jsonl")]
    last = {}
    for r in rows:
        if r["variant"] in (var, var + "-generic") and r.get("session"):
            last[r["case"]] = r
    out = {}
    for case, r in sorted(last.items()):
        f = glob.glob(str(ROOT / var / f"case_{case.split(':')[1]}-{r['session']}.json"))
        if f:
            out[case] = (r, json.load(open(f[0])))
    return out


def main():
    logs = latest_logs(VAR)
    from arena_kit import ArenaClient, complete_offer, total_cost
    from arena_kit.cli import load_env
    load_env()
    c = ArenaClient()
    cases = {x["case_id"]: x for x in c.cases("practice")}
    cases.update({x["case_id"]: x for x in c.cases("sandbox")})
    lines = [f"# Payload and cost audit - {VAR} ({len(logs)} sessions)\n"]
    totals = Counter()
    for case, (row, ev) in logs.items():
        cs = cases.get(case, {})
        horizon = (cs.get("buyer") or {}).get("horizon_years")
        fixed_months = (cs.get("fixed_terms") or {}).get("contract_months")
        issues = []
        sent_to = defaultdict(set)  # id -> suppliers it was cited to
        per_sup = defaultdict(Counter)
        sends = [e for e in ev if e["kind"] == "send"]
        for i, e in enumerate(sends):
            refs = [str(r) for r in e.get("refs") or []]
            body = e.get("body") or ""
            sup = e.get("supplier")
            dup = [r for r, n in Counter(refs).items() if n > 1]
            if dup:
                issues.append(f"msg {i + 1} → {sup}: same ID twice in one message: {dup}")
                totals["dup_in_message"] += 1
            if len(set(refs)) > 3:
                issues.append(f"msg {i + 1} → {sup}: {len(set(refs))} distinct IDs (claim budget is 3 claims)")
                totals["over_3_ids"] += 1
            for r in set(refs):
                if per_sup[sup][r] and not r.startswith("offer:"):
                    totals["repeat_same_supplier"] += 1
                    issues.append(f"msg {i + 1} → {sup}: {r} already cited to this supplier")
                per_sup[sup][r] += 1
                if sent_to[r] - {sup} and not r.startswith("offer:"):
                    totals["repeat_other_supplier"] += 1
                sent_to[r].add(sup)
            for m in re.finditer(r"(?:full|for the full|a)\s+(\d+)[- ]month", body, re.I):
                months = int(m.group(1))
                expected = fixed_months or (12 * horizon if horizon else None)
                if expected and months != expected and not any(months == (s.get("contract_months") or 0)
                                                               for s in [x[0] for x in e.get("sheets") or []]):
                    issues.append(f"msg {i + 1} → {sup}: says '{m.group(0)}' but case horizon/contract = {expected} months "
                                  f"and no sheet uses {months}")
                    totals["horizon_wording"] += 1
            if re.search(r"\bfoundry\b", body, re.I) and not re.search(r"foundr|gie[sß]", json.dumps(cs).lower() + " ".join(
                    (x.get("body") or "") for x in ev if x["kind"] == "reply").lower()):
                issues.append(f"msg {i + 1} → {sup}: calls the supplier a foundry; nothing in the case or its replies says so")
                totals["supplier_type_wording"] += 1
            if re.search(r"below (your|the) (current )?offer|lower than your", body, re.I) and not any(
                    r.startswith(("cost:", "po:", "quote:", "offer:")) for r in refs):
                issues.append(f"msg {i + 1} → {sup}: comparison '...below your offer' without a cited figure")
                totals["unsupported_comparison"] += 1
        replies = [e for e in ev if e["kind"] == "reply"]
        claim = Counter(x.get("result") for e in replies for x in e.get("claims") or [])
        for e in replies:
            for x in e.get("claims") or []:
                if x.get("result") == "contradicted":
                    issues.append(f"reply from {e.get('supplier')}: a claim was CONTRADICTED ({x})")
                    totals["contradicted"] += 1
        totals["duplicate_results"] += claim.get("duplicate", 0)
        totals["verified_results"] += claim.get("verified", 0)
        # cost reconciliation
        res = next((e for e in reversed(ev) if e["kind"] == "result"), {})
        rec = ""
        if res.get("terms") and res.get("c_deal") and cs:
            try:
                ours = total_cost(cs, complete_offer(cs, res["terms"]))
                rec = f"our C(deal terms, no relationship) {ours:,.0f} vs arena c_deal {res['c_deal']:,.0f} ({(ours / res['c_deal'] - 1) * 100:+.2f} %)"
                if abs(ours / res["c_deal"] - 1) > 0.005:
                    totals["cost_mismatch_gt_0.5pct"] += 1
            except Exception as ex:
                rec = f"cost check failed: {ex!r}"[:120]
        lines.append(f"\n## {case} - score {row.get('score')}\n")
        lines.append(f"- claims: {dict(claim)} · {rec}")
        lines += [f"- {x}" for x in issues[:25]] or ["- no payload issues found"]
    lines.insert(1, "## Totals\n\n" + "\n".join(f"- {k}: {v}" for k, v in sorted(totals.items())) + "\n")
    out = Path(f"proto/runs/audit_{VAR}.md")
    out.write_text("\n".join(lines))
    print("\n".join(lines[:2]))
    print("->", out)


if __name__ == "__main__":
    main()
