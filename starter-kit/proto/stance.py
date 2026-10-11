"""Supplier stance from message text: how willing / unwilling a supplier is, from token logic and vector meaning.

Three layers, each scoring every sentence on a willing (+1) ... unwilling (-1) scale:
  1. LEXICAL  - token classes (refusal, firmness, dismissal, exit, conditional, willing) with negation scope
                ("we cannot accept" flips a willing token) and intensifiers ("under no circumstances").
  2. PROTOTYPE - cosine similarity of the sentence embedding to the centroids of six stance classes, each seeded
                with generic example sentences (no case or supplier specifics).
  3. LEARNED  - the direction in embedding space from sentences of replies where the supplier did NOT move to
                sentences of replies where it conceded (learned from our own logs; proto/stance_eval.py).
The message stance aggregates its sentences (stance-bearing and late sentences weigh more).

    from proto.stance import Stance
    s = Stance()                      # loads the learned direction if proto/stance_model.json exists
    s.analyze(body)                   # -> {"stance": -0.42, "label": "firm", "sentences": [...], ...}
Embeddings: OpenAI text-embedding-3-large (512 dims), cached in proto/runs/stance_cache.json.
"""

import hashlib
import json
import math
import os
import re
import threading
from pathlib import Path

import httpx

EMBED_MODEL, EMBED_DIMS = "text-embedding-3-large", 512
CACHE = Path(__file__).parent / "runs" / "stance_cache.json"
MODEL = Path(__file__).parent / "stance_model.json"

# ---------- 1. token logic ----------
CLASSES = {  # weight on the willing(+)/unwilling(-) axis
    "refusal": -1.0, "exit": -1.0, "firm": -0.7, "dismissal": -0.6, "conditional": 0.25, "willing": 0.8,
}
LEX = {
    "refusal": r"\b(cannot|can't|can ?not|unable|not able|not possible|impossible|no room|no scope|not in a position|"
               r"decline|reject|refuse|not acceptable|unacceptable|out of the question|no further|no more)\b",
    "exit": r"\b(withdraw\w*|walk(ing)? away|end (the|this) negotiation|terminate|look elsewhere|please decide|"
            r"take it or leave it|we will not continue)\b",
    "firm": r"\b(final|last|best and final|letztes|remains?|stands?|firm|frozen|freeze|fixed|non[- ]negotiable|"
            r"must|only|require[sd]?|insist\w*|mandatory|non-binding|binding minimum|bottom line|our limit)\b",
    "dismissal": r"(does not change|doesn't change|not our reality|irrelevant|already (taken|factored) into account|"
                 r"do not share|our property|not relevant|we do not see|no basis|that remains|is our property)",
    "conditional": r"\b(if|provided|subject to|in exchange|as long as|on condition|assuming|should you|would you)\b",
    "willing": r"\b(can|could|accept\w*|agree\w*|adjust\w*|move|moving|reduce\w*|lower\w*|meet you|beat|flexib\w*|"
               r"happy|glad|welcome|fair point|took it into account|taken it into account|holds|we are prepared|"
               r"willing|improv\w*|concession|discount|work with you|partnership|appreciate)\b",
}
NEGATOR = re.compile(r"\b(not|no|never|cannot|can't|unable|without|nor|n't)\b", re.I)
INTENS = re.compile(r"\b(absolutely|under no circumstances|definitely|strictly|by no means|in no case)\b", re.I)
SOFT = re.compile(r"\b(perhaps|maybe|might|possibly|we will consider|we could look|open to)\b", re.I)


def split_sentences(text):
    text = re.sub(r"\s+", " ", (text or "").replace("\n", ". "))
    out = [s.strip(" .") for s in re.split(r"(?<=[.!?])\s+", text)]

    def content(x):  # drop greetings, signatures, names and titles (they correlate with *when* a mail is sent)
        w = x.split()
        if len(w) < 5 or re.match(r"^(dear|hello|hallo|guten tag|best regards|kind regards|mit freundlichen)\b", x, re.I):
            return False
        return sum(1 for t in w if t[:1].isupper()) / len(w) < 0.6
    return [x for x in out if content(x)]


TOKEN_WEIGHTS = {}  # learned "class: token" -> weight (log lift on the supplier's next move); proto/stance_model.json


def lexical(sentence, learned=None):
    """(score in [-1, 1], hits) - negation flips a willing token inside a 4-token window. With `learned` token
    weights (data-driven), a known token uses its learned weight instead of its class weight."""
    learned = TOKEN_WEIGHTS if learned is None else learned
    low = sentence.lower()
    hits, total = [], 0.0
    for cls, pat in LEX.items():
        for m in re.finditer(pat, low, re.I):
            w = CLASSES[cls]
            window = low[max(0, m.start() - 30):m.start()]
            if cls in ("willing", "conditional") and NEGATOR.search(window.split(".")[-1]):
                w, cls_eff = -0.9, "negated_" + cls  # "we cannot accept", "not willing"
            elif cls in ("refusal", "firm") and re.search(r"\b(no longer|not)\s*$", window):
                w, cls_eff = 0.3, "negated_" + cls  # "no longer final"
            else:
                cls_eff = cls
            hits.append((cls_eff, m.group(0)))
            total += learned.get(f"{cls_eff}: {m.group(0)}", w) if learned else w
    if INTENS.search(low):
        total *= 1.5
        hits.append(("intensifier", INTENS.search(low).group(0)))
    if SOFT.search(low):
        total += 0.2
        hits.append(("softener", SOFT.search(low).group(0)))
    return math.tanh(total / 1.5), hits


# ---------- 2. vector meaning: prototypes ----------
PROTOTYPES = {
    "willing": ["We can move on the price.", "We are happy to accept your proposal.", "We have adjusted our offer to meet you.",
                "That is a fair point and we took it into account.", "We can reduce the price further.",
                "We are willing to work with you on the terms."],
    "conditional": ["We could lower the price if you commit to a larger volume.", "Provided you accept faster payment, we can adjust.",
                    "In exchange for a longer contract we can offer a discount.", "Subject to internal approval, we may move."],
    "firm": ["This is our final offer.", "Our price remains unchanged.", "The price stands as quoted.",
             "We must maintain these terms.", "Our position has not changed."],
    "refusing": ["We cannot accept your proposal.", "A further reduction is not possible.", "We are unable to move on price.",
                 "We have no room for further concessions.", "Your target price is unacceptable for us."],
    "dismissive": ["The data you cited does not change our calculation.", "That is not relevant to our costs.",
                   "We do not share our cost calculation.", "We have already taken that into account."],
    "exiting": ["We are withdrawing from this negotiation.", "Please decide now or we end the discussion.",
                "We will not continue this negotiation.", "If this is not acceptable, we will walk away."],
}
PROTO_SIGN = {"willing": 1.0, "conditional": 0.3, "firm": -0.6, "refusing": -1.0, "dismissive": -0.5, "exiting": -1.0}

_lock = threading.Lock()


def _key():
    k = os.environ.get("OPENAI_API_KEY")
    if not k:
        from arena_kit.cli import load_env
        load_env()
        k = os.environ.get("OPENAI_API_KEY")
    return k


def embed(texts):
    """Embeddings for texts (cached by sha1)."""
    with _lock:
        cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    need = [t for t in dict.fromkeys(texts) if hashlib.sha1(t.encode()).hexdigest() not in cache]
    for i in range(0, len(need), 256):
        batch = need[i:i + 256]
        r = httpx.post("https://api.openai.com/v1/embeddings", timeout=60,
                       headers={"Authorization": f"Bearer {_key()}"},
                       json={"model": EMBED_MODEL, "input": batch, "dimensions": EMBED_DIMS})
        r.raise_for_status()
        for t, d in zip(batch, r.json()["data"]):
            cache[hashlib.sha1(t.encode()).hexdigest()] = [round(x, 5) for x in d["embedding"]]
    if need:
        with _lock:
            CACHE.parent.mkdir(exist_ok=True)
            CACHE.write_text(json.dumps(cache))
    return [cache[hashlib.sha1(t.encode()).hexdigest()] for t in texts]


def _norm(v):
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def _mean(vs):
    return _norm([sum(c) / len(vs) for c in zip(*vs)])


class Stance:
    def __init__(self, model_path=MODEL):
        self.centroids = {c: _mean(embed(ex)) for c, ex in PROTOTYPES.items()}
        self.direction, self.bias = None, 0.0
        if Path(model_path).exists():
            m = json.loads(Path(model_path).read_text())
            self.direction, self.bias = m["direction"], m.get("bias", 0.0)
            # learned token weights are kept for the report only: they overfit to the dominant sandbox case
            # (leave-one-case-out AUC 0.657 vs 0.688 for the hand-made token logic)
            self.weights = m.get("weights", {"lexical": 0.4, "prototype": 0.3, "learned": 0.3})
        else:
            self.weights = {"lexical": 0.55, "prototype": 0.45, "learned": 0.0}

    def prototype(self, vec):
        """(score, class, probs): softmax over cosine similarities (temperature 0.05)."""
        sims = {c: _dot(vec, cen) for c, cen in self.centroids.items()}
        mx = max(sims.values())
        ex = {c: math.exp((s - mx) / 0.05) for c, s in sims.items()}
        z = sum(ex.values())
        probs = {c: e / z for c, e in ex.items()}
        return sum(PROTO_SIGN[c] * p for c, p in probs.items()), max(probs, key=probs.get), probs

    def learned(self, vec):
        return math.tanh(4 * (_dot(vec, self.direction) - self.bias)) if self.direction else 0.0

    def sentence_scores(self, sentences, vecs=None):
        vecs = vecs or embed(sentences)
        out = []
        for s, v in zip(sentences, vecs):
            lx, hits = lexical(s)
            pr, cls, _ = self.prototype(v)
            le = self.learned(v)
            w = self.weights
            score = w["lexical"] * lx + w["prototype"] * pr + w["learned"] * le
            out.append({"sentence": s, "score": round(score, 3), "lexical": round(lx, 3), "prototype": round(pr, 3),
                        "learned": round(le, 3), "class": cls, "hits": hits})
        return out

    @staticmethod
    def _agg(vals):
        n = len(vals)
        w = [(0.3 + abs(v)) * (1 + 0.5 * i / max(1, n - 1)) for i, v in enumerate(vals)]  # stance-bearing + late weigh more
        return sum(a * b for a, b in zip(w, vals)) / sum(w) if vals else 0.0

    def analyze(self, text):
        """Two axes (validated leave-one-case-out on 3,683 replies):
             move      - willingness to move, from token logic (AUC 0.83 'concedes in this reply', 0.69 'next reply')
             stop_risk - risk that the next reply is final / walk-away, from the learned vector direction (AUC 0.77)
        """
        sents = split_sentences(text)
        if not sents:
            return {"move": 0.0, "stop_risk": 0.0, "label": "neutral", "sentences": []}
        rows = self.sentence_scores(sents)
        move = self._agg([r["lexical"] for r in rows])
        stop = -self._agg([r["learned"] for r in rows]) if self.direction else -self._agg([r["prototype"] for r in rows])
        firm_words = any(h[0] in ("firm", "exit") and h[1] in ("final", "letztes", "please decide", "last")
                         for r in rows for h in r["hits"])
        label = ("closing / final" if firm_words or (stop > 0.35 and move < 0.2) else
                 "resisting" if move < -0.1 else
                 "conditional" if any(h[0] == "conditional" for r in rows for h in r["hits"]) else
                 "moving" if move > 0.25 and stop < 0.2 else "neutral")
        neg = min(rows, key=lambda r: r["lexical"] - r["learned"])
        pos = max(rows, key=lambda r: r["lexical"] + r["learned"])
        return {"move": round(move, 3), "stop_risk": round(stop, 3), "label": label,
                "most_negative": neg["sentence"], "most_positive": pos["sentence"], "sentences": rows}


if __name__ == "__main__":
    import sys
    s = Stance()
    for text in sys.argv[1:] or ["We have reviewed your offer and can adjust our price. However, this is our final offer."]:
        a = s.analyze(text)
        print(json.dumps({k: v for k, v in a.items() if k != "sentences"}, indent=1))
        for r in a["sentences"]:
            print(f"  {r['score']:+.2f}  lex {r['lexical']:+.2f} proto {r['prototype']:+.2f} learned {r['learned']:+.2f} "
                  f"[{r['class']}] {r['sentence'][:90]}  {r['hits']}")
