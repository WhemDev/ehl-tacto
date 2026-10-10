"""Smoke checks for sandbox policy branches that format live competitor evidence."""

import json
from pathlib import Path

from arena_kit.agents.evidence import EvidenceTraderAgent


def test_j1_opening_uses_a_valid_current_competitor_offer():
    case = json.loads((Path(__file__).parents[1] / "cases" / "D02.json").read_text())
    threads = {"sup:DEMO-C1": [{
        "from": "supplier", "status": "open",
        "term_sheets": [{"term_sheet_id": "offer:DEMO-C1-1-a", "terms": {
            "unit_price": 15.5, "payment_days": 14, "lead_time_days": 42, "incoterm": "EXW",
        }}],
    }]}
    message = EvidenceTraderAgent(d02_style="j1_cost")._opening(case, False, threads)
    assert "€15.50" in message["body"]
    assert "EXW. Could you price" in message["body"]
    assert len(message["term_sheets"]) == 3
