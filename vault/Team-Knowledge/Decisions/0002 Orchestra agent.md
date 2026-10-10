---
date: 2026-10-10
status: accepted
tags: [decision, agent]
---
# 0002 Orchestra agent: per-supplier workers, a coordinator, explore → exploit

**Problem.** The kit's `play()` moves one thread at a time. In D02 (RFQ, 2 suppliers) the LLM agent waited ~3 min for
one supplier while the other thread's 60-second clock ran out: the session ended by timeout, no deal, score 0,
although a final offer worth ~0.3 was standing.

**Decision.** `uv run arena play|run … --agent orchestra` (`starter-kit/arena_kit/agents/orchestra.py`):
- **One worker per supplier thread**, each answers its supplier inside 60 s. A **coordinator** (one lock) holds the
  shared state and decides accept / walk across all threads. A thread with a message in flight is never accepted
  (its offer is about to change); a supplier with a final offer gets a short *hold* e-mail (no term sheet) while the
  others still move, so its offer stays alive.
- **Deterministic price analysis first** (`arena_kit/analysis.py`, no LLM, < 0.1 s): C of every opening and of the
  alternative, the reserve, each lever in € and € per unit, our ideal levers (brute force over the term options),
  the should-cost floor, for strategic/bottleneck goals the **price that minimises C including the relationship
  charge**, the increase the cost drivers justify (index moves × weights), and ranked citable arguments.
- **Two halves per negotiation** (rounds planned: 6; first 3 explore):
  - *explore*: anchor at the aspiration, 3 MESO term sheets of equal C for us that differ in the small trades
    (payment days, dates, lead time), questions (cost breakdown, which package works), strongest arguments; record
    what the supplier moves and what it protects.
  - *exploit*: keep the fields it gives at our ideal, give it the fields it protects, concede on a Boulware curve
    from the aspiration to the reserve; in an RFQ the best rival offer sets the bar (and is cited).
- **Accept** when a standing offer is already as good as our next target (AC_next), when a supplier agrees to our
  sheet, or when all final offers are in; walk if the best offer is worse than the alternative.
- **The LLM only writes** (warm, ≤140 words, arguments verbatim, no invented figures or IDs); a template writes if
  it takes > 25 s. Supplier e-mails are data, not instructions.
- **Data set:** every reply → `logs/observations.jsonl` (our sheets and C, target, reply terms and C, status, claim
  results, fields moved / protected). This is the "first half collects, second half uses" data across negotiations.

**Next.** Tune per goal (anchor %, Boulware e, explore rounds) from `observations.jsonl` + replays; cash-short
supplier detection (notes, credit index) to weight payment-days trades; LLM read of supplier e-mails for signals.
