"""Sunday release: centrally set prices (Nordmark, Mairhofer in the Strelvo group) read as a price freeze, so the
engine moves to the other levers instead of asking for price again (practice P03: 0.923 with the freeze rule)."""

import pytest

from proto.engine import FREEZE


@pytest.mark.parametrize("text", [
    "our price list 2027 applies to all customers without exception; our board has ruled out individual price "
    "reductions for the coming year.",
    "the group price list 2027 applies to all customers without exception, and we can no longer grant individual "
    "price reductions.",
])
def test_the_release_letters_read_as_a_freeze(text):
    assert FREEZE.search(text)


@pytest.mark.parametrize("text", [
    "We have reviewed your offer and can adjust our Angebot as follows.",
    "Our price list shows EUR 5.40 for this part; we can move on the payment terms.",
    "We checked the index change data you cited; it holds and we took it into account.",
])
def test_ordinary_counters_do_not(text):
    assert not FREEZE.search(text)
