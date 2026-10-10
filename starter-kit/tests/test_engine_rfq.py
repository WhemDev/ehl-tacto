"""RFQ fact allocation: a shared fact goes to the leading supplier only, and never twice (one claim per case)."""

from dataclasses import replace

from test_engine_clock import C1, J1, Arena

import proto.engine as eng
from proto.variants import VARIANTS


def test_shared_facts_go_to_the_leader_once_and_own_facts_to_their_owner():
    n = eng.Negotiator(Arena(), "case:D02", replace(VARIANTS["A9hr"][1], pushes=0, rfq_pushes=0), quiet=True)
    lead, other = n.threads[C1], n.threads[J1]  # C1's opening (EUR 16.00) is the best standing offer
    assert n.best_standing()[1] is lead
    facts = [("cost:part:SH-220", "should-cost"), (["idx:A@1", "idx:A@2"], "index"), (f"sc:{J1[4:]}@2026Q3", "J1 card")]
    assert n.pick_facts(other, facts, 2) == [(f"sc:{J1[4:]}@2026Q3", "J1 card")]  # not the leader: only its own
    assert n.pick_facts(lead, facts, 2) == facts[:2]  # the leader gets the shared facts
    assert n.pick_facts(lead, facts, 2) == []  # and never the same ones again
    assert n.pick_facts(other, facts, 2) == []  # spent for the case, and the card is not its own
