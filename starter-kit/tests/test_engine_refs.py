"""The practice adapter never cites a data ID the arena cannot check (facts.json): P05's forecast row came back
"doesn't exist ... that costs trust" and the suppliers went final a round early."""

import json
import re
from pathlib import Path

import pytest

from arena_kit import complete_offer, total_cost
from proto.engine import Thread
from proto.practice import PracticeNegotiator, lookup
from proto.variants import VARIANTS

CASES = Path(__file__).resolve().parents[1] / "cases"
ID_RE = re.compile(r"\b(?:idx|quote|offer|sc|qn|po|cost|fc|news|doc|ctr):[\w.:@#/-]*\w")
HOSTED = ["P01", "P02", "P03", "P04", "P05", "P07", "P08", "P10", "P11", "P18"]


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


@pytest.mark.parametrize("cid", HOSTED)
def test_every_cited_id_is_in_facts_json(cid):
    n = negotiator(cid)
    goal = n.goal(0)
    for t in n.threads.values():
        sheets = n.meso(t, goal)
        for rnd in (0, 1):  # the first mail and an answer to "which volume can you commit to?"
            msg = n.write(t, rnd, sheets, None)
            ids = set(msg.get("refs") or []) | set(ID_RE.findall(msg["body"]))
            unknown = sorted(i for i in ids if not i.startswith("offer:") and not lookup(i))
            assert not unknown, f"{cid} {t.sid} round {rnd}: {unknown}"
