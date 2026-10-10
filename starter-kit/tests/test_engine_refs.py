"""The practice adapter never cites a data ID the arena cannot check (facts.json): P05's forecast row came back
"doesn't exist ... that costs trust" and the suppliers went final a round early."""

import json
import re
from pathlib import Path

import pytest

from arena_kit import complete_offer, total_cost
from proto.engine import Thread
from proto.practice import PracticeNegotiator, citable
from proto.variants import VARIANTS

CASES = Path(__file__).resolve().parents[1] / "cases"
ID_RE = re.compile(r"\b(?:idx|quote|offer|sc|qn|po|cost|fc|news|doc|ctr):[\w.:@#/-]*\w")
ALL = sorted(p.stem for p in CASES.glob("P*.json"))  # the 10 hosted cases and the 9 never hosted
ASKS = ["Our offer.", "Our offer. Which volume can you commit to?",
        "Which figures is that based on? Please send us the data. Which volume can you commit to?"]


def negotiator(cid):
    case = json.loads((CASES / f"{cid}.json").read_text(encoding="utf-8"))
    b = case["buyer"]
    n = PracticeNegotiator.__new__(PracticeNegotiator)
    n.c, n.case_id, n.cfg, n.quiet, n.log = None, f"case:{cid}", VARIANTS["A9h"][1], True, []
    n.sid, n.case, n.b, n.deadline, n.slowest = "t", case, b, None, 0
    price = (b.get("current_unit_price") or b.get("fallback_unit_price") or 10.0) * 1.06
    n.threads = {}
    for i, s in enumerate(case["suppliers"]):
        terms = complete_offer(case, {"unit_price": round(price * (1 - 0.04 * i), 2)})
        ev = [{"from": f"sales@{s}", "status": "open", "body": "Our offer. Which volume can you commit to?",
               "term_sheets": [{"term_sheet_id": f"offer:{s}-0", "terms": terms}], "attachments": []}]
        n.threads[s] = Thread(s, ev)
    n.alt = b.get("alternative") or {}
    n.c_alt = total_cost(case, n.alt["terms"]) if n.alt.get("terms", {}).get("unit_price") else float("inf")
    n.relationship = b.get("category_goal") in ("stabilise", "secure_supply")
    n.c_open = min(n.C(t, t.sheets[0]["terms"]) for t in n.threads.values())
    n._estimate()
    return n


@pytest.mark.parametrize("cid", ALL)
def test_every_cited_id_is_in_facts_json(cid):
    """`lookup` also resolves table-only rows (P05's latest forecast snapshot): the arena answered those
    "contradicted ... that costs trust", so only facts.json IDs, the session's offers and the case's refs may go out."""
    n = negotiator(cid)
    own = set(n.case.get("refs") or [])
    goal = n.goal(0)
    for t in n.threads.values():
        sheets = n.meso(t, goal)
        for rnd, ask in enumerate(ASKS):
            t.events.append({"from": f"sales@{t.sid}", "status": "open", "body": ask, "attachments": [],
                             "term_sheets": t.events[-1].get("term_sheets") or t.events[0]["term_sheets"]})
            msg = n.write(t, rnd, sheets, None)
            t.events.append({"from": "buyer", "body": msg["body"], "refs": msg.get("refs") or []})
            ids = set(msg.get("refs") or []) | set(ID_RE.findall(msg["body"]))
            unknown = sorted(i for i in ids if not i.startswith("offer:") and not citable(i) and i not in own)
            assert not unknown, f"{cid} {t.sid} round {rnd}: {unknown}"


def test_landing_only_fills_the_first_mail_with_facts_that_can_land():
    """A9h-landing: no plain statement without an ID and no own order prices (0 of 198 landed), so P08/P18's two
    falling own-driver indices go out together in the first mail."""
    from proto.variants import VARIANTS as V
    for cid in ("P08", "P18"):
        n = negotiator(cid)
        n.cfg = V["A9h-landing"][1]
        t = next(iter(n.threads.values()))
        t.sheets[0]["terms"]["unit_price"] = 6.10  # the live opening: the plain PO line would qualify in A9h
        facts = n.facts_for(t)
        assert all(f[0] for f in facts), "no fact without an ID"
        assert not any(str(f[0]).startswith("['po:") for f in facts), "no own order prices"
        assert all(str(f[0]).startswith("['idx:") for f in facts[:2]), facts[:2]
