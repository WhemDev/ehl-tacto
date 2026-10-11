"""Train and test proto/stance.py on every supplier reply in our logs (words vs. actions).

    PYTHONPATH=. uv run python proto/stance_eval.py      -> proto/stance_model.json + proto/runs/stance_report.md

Labels come from what the supplier DID (its primary offer's total cost C and its status):
  concede_same : this reply's offer is > 0.2 % cheaper (C) than its previous one
  concede_next : the supplier's NEXT reply is > 0.2 % cheaper than this one
  hard_next    : the next reply is final_offer / walked_away
Validation is leave-one-case-out: the learned direction never sees the case it is tested on (unseen suppliers).
"""
import glob
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

from proto.stance import MODEL, Stance, _dot, _mean, embed, lexical, split_sentences

ROOT = Path(__file__).parent
FILES = glob.glob(str(ROOT / "runs/variants/*/case_*.json")) + \
    glob.glob("/Users/rxv/.claude/jobs/*/tmp/*/proto/runs/variants/*/case_*.json")


def dataset():
    rows = []
    for f in FILES:
        try:
            ev = json.load(open(f))
        except Exception:
            continue
        case = re.search(r"case_(\w+)-", f).group(1)
        seq = defaultdict(list)
        for e in ev:
            if e.get("kind") == "reply" and e.get("body") and e.get("sheets"):
                try:
                    c = float(e["sheets"][0][2])
                except Exception:
                    continue
                seq[e.get("supplier")].append({"body": e["body"], "status": e.get("status"), "C": c})
        for sup, rs in seq.items():
            for i, r in enumerate(rs):
                prev, nxt = (rs[i - 1] if i else None), (rs[i + 1] if i + 1 < len(rs) else None)
                rows.append({"case": case, "supplier": sup, "i": i, "body": r["body"], "status": r["status"],
                             "concede_same": None if prev is None else (prev["C"] - r["C"]) / prev["C"] > 0.002,
                             "concede_next": None if nxt is None else (r["C"] - nxt["C"]) / r["C"] > 0.002,
                             "hard_next": None if nxt is None else nxt["status"] in ("final_offer", "walked_away")})
    return rows


def auc(scores, labels):
    pairs = [(s, l) for s, l in zip(scores, labels) if l is not None]
    pos = [s for s, l in pairs if l]
    neg = [s for s, l in pairs if not l]
    if not pos or not neg:
        return float("nan")
    ranked = sorted([(s, 1) for s in pos] + [(s, 0) for s in neg])
    rank_sum, i = 0.0, 0
    while i < len(ranked):  # average ranks for ties
        j = i
        while j < len(ranked) and ranked[j][0] == ranked[i][0]:
            j += 1
        r = (i + j + 1) / 2
        rank_sum += r * sum(1 for k in range(i, j) if ranked[k][1])
        i = j
    return (rank_sum - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def agg(vals):
    """message score from sentence scores: stance-bearing and later sentences weigh more"""
    if not vals:
        return 0.0
    n = len(vals)
    w = [(0.3 + abs(v)) * (1 + 0.5 * i / max(1, n - 1)) for i, v in enumerate(vals)]
    return sum(a * b for a, b in zip(w, vals)) / sum(w)


def main():
    rows = dataset()
    sents = sorted({s for r in rows for s in split_sentences(r["body"])})
    print(f"{len(rows)} replies, {len({r['body'] for r in rows})} unique messages, {len(sents)} unique sentences, "
          f"cases {Counter(r['case'] for r in rows)}")
    vec = dict(zip(sents, embed(sents)))
    st = Stance(model_path="/nonexistent")
    proto = {s: st.prototype(vec[s])[0] for s in sents}
    lex = {s: lexical(s)[0] for s in sents}
    for r in rows:
        r["sents"] = split_sentences(r["body"])
        r["lex"] = agg([lex[s] for s in r["sents"]])
        r["proto"] = agg([proto[s] for s in r["sents"]])
        r["tokens"] = {h[0] + ": " + h[1] for s in r["sents"] for h in lexical(s, {})[1]}

    def token_weights(train):
        """log-lift of each token on 'concedes in the next reply' (smoothed, >= 20 replies)"""
        lab = [r for r in train if r["concede_next"] is not None]
        base = (sum(r["concede_next"] for r in lab) + 1) / (len(lab) + 2)
        cnt = defaultdict(lambda: [0, 0])
        for r in lab:
            for h in r["tokens"]:
                cnt[h][0] += 1
                cnt[h][1] += r["concede_next"]
        return {h: max(-1.5, min(1.0, 3 * math.log(((c + base * 10) / (n + 10)) / base)))
                for h, (n, c) in cnt.items() if n >= 20}

    def direction(train):
        pos = [vec[s] for r in train if r["concede_same"] for s in r["sents"]]
        neg = [vec[s] for r in train if r["concede_same"] is False for s in r["sents"]]
        if not pos or not neg:
            return None, 0.0
        d = [a - b for a, b in zip(_mean(pos), _mean(neg))]
        n = math.sqrt(sum(x * x for x in d)) or 1.0
        d = [x / n for x in d]
        proj = sorted(_dot(vec[s], d) for r in train for s in r["sents"])
        return d, proj[len(proj) // 2]

    cases = sorted({r["case"] for r in rows})
    for c in cases:  # leave-one-case-out
        train = [r for r in rows if r["case"] != c]
        d, b = direction(train)
        tw = token_weights(train)
        for r in rows:
            if r["case"] == c:
                r["learned"] = agg([math.tanh(4 * (_dot(vec[s], d) - b)) for s in r["sents"]]) if d else 0.0
                r["lex_learned"] = agg([lexical(s, tw)[0] for s in r["sents"]])

    targets = [("concede_same", 1), ("concede_next", 1), ("hard_next", -1)]
    layers = ["lex", "lex_learned", "proto", "learned"]
    best_w, best_score = None, -1
    for wl in [i / 10 for i in range(11)]:
        for wp in [i / 10 for i in range(11 - int(wl * 10))]:
            wle = round(1 - wl - wp, 2)
            sc = [wl * r["lex_learned"] + wp * r["proto"] + wle * r["learned"] for r in rows]
            m = sum(auc([sgn * x for x in sc], [r[t] for r in rows]) for t, sgn in targets) / 3
            if m > best_score:
                best_w, best_score = (wl, wp, wle), m
    for r in rows:
        r["combined"] = best_w[0] * r["lex_learned"] + best_w[1] * r["proto"] + best_w[2] * r["learned"]

    lines = ["# Supplier stance: words vs. actions\n",
             f"{len(rows)} supplier replies from {len(FILES)} logged sessions; {len(sents)} unique sentences; "
             "embeddings text-embedding-3-large (512 d); leave-one-case-out (the learned direction never sees the tested case).\n",
             "## Does the message predict what the supplier does? (AUC: 0.5 = chance, 1.0 = perfect)\n",
             "| Layer | concedes in this reply | concedes in its next reply | next reply is final_offer / walked_away (higher = predicts the stop) |",
             "|---|---|---|---|"]
    for layer in layers + ["combined"]:
        a = [auc([sgn * r[layer] for r in rows], [r[t] for r in rows]) for t, sgn in targets]
        lines.append(f"| {layer} | {a[0]:.3f} | {a[1]:.3f} | {a[2]:.3f} |")
    lines.append(f"\nBest combination weights (learned-token lexical, prototype, learned direction) = {best_w}, mean AUC {best_score:.3f}.\n")

    # the two axes and what their bands mean in practice
    for r in rows:
        r["move"], r["stop"] = r["lex"], -r["learned"]
    lines += ["## The two axes\n", "| Axis | concedes in this reply | concedes in its next reply | next reply is final / walk-away |",
              "|---|---|---|---|"]
    for name, key, sgn in [("move (token logic)", "move", (1, 1, -1)), ("stop_risk (learned vector direction)", "stop", (-1, -1, 1))]:
        a = [auc([g * r[key] for r in rows], [r[t] for r in rows]) for (t, _), g in zip(targets, sgn)]
        lines.append(f"| {name} | {a[0]:.3f} | {a[1]:.3f} | {a[2]:.3f} |")

    def bands(key, labels):
        xs = sorted(r[key] for r in rows if r["concede_next"] is not None)
        q = [xs[int(len(xs) * f)] for f in (0.25, 0.5, 0.75)]
        out = ["", f"| {labels} | replies | conceded in that reply | concedes next time | next reply final / walk-away |", "|---|---|---|---|---|"]
        for lo, hi, name in [(-9, q[0], "lowest 25 %"), (q[0], q[1], "25–50 %"), (q[1], q[2], "50–75 %"), (q[2], 9, "highest 25 %")]:
            g = [r for r in rows if r["concede_next"] is not None and lo <= r[key] < hi]
            if g:
                out.append(f"| {name} ({lo:+.2f} … {hi:+.2f}) | {len(g)} | {sum(bool(r['concede_same']) for r in g) / len(g):.0%} | "
                           f"{sum(r['concede_next'] for r in g) / len(g):.0%} | {sum(r['hard_next'] for r in g) / len(g):.0%} |")
        return out
    lines += ["\n### move (willingness) bands"] + bands("move", "move")
    lines += ["\n### stop_risk bands"] + bands("stop", "stop_risk") + [""]

    d_all, b_all = direction(rows)
    proj = {s: _dot(vec[s], d_all) - b_all for s in sents}
    top = sorted(sents, key=proj.get)
    lines += ["\n## Sentences furthest on the UNWILLING side of the learned direction\n"] + [f"- {s}" for s in top[:15]]
    lines += ["\n## Sentences furthest on the WILLING side\n"] + [f"- {s}" for s in top[-15:][::-1]]

    tok = defaultdict(lambda: [0, 0])  # token class hits -> concede_next rate
    for r in rows:
        if r["concede_next"] is None:
            continue
        seen = {h[0] + ": " + h[1] for s in r["sents"] for h in lexical(s)[1]}
        for h in seen:
            tok[h][0] += 1
            tok[h][1] += r["concede_next"]
    base = sum(1 for r in rows if r["concede_next"]) / max(1, sum(1 for r in rows if r["concede_next"] is not None))
    lines += [f"\n## Tokens and what follows them (base rate: supplier concedes in its next reply {base:.0%})\n",
              "| Token (class: text) | replies | concedes next | lift |", "|---|---|---|---|"]
    for h, (n, c) in sorted(tok.items(), key=lambda kv: kv[1][1] / kv[1][0] if kv[1][0] else 0):
        if n >= 25:
            lines.append(f"| {h} | {n} | {c / n:.0%} | {c / n / base:.2f}× |")

    MODEL.write_text(json.dumps({"direction": [round(x, 6) for x in d_all], "bias": b_all,
                                 "token_weights": token_weights(rows),
                                 "weights": {"lexical": best_w[0], "prototype": best_w[1], "learned": best_w[2]}}))
    out = ROOT / "runs" / "stance_report.md"
    out.write_text("\n".join(lines))
    print("\n".join(lines[:16]))
    print(f"-> {out}, model -> {MODEL}")


if __name__ == "__main__":
    main()
