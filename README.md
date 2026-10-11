# makeAnother.md · a buyer agent for the Tacto Negotiation Arena

EHL Grand Finale 2026, Tacto track. Our agent negotiates by e-mail with Tacto's supplier bots for Hollerau
Pumpenwerke: price increases, renewals, RFQs with several bidders, bundles, raw-material surcharges, capacity
cuts and quality cases. It closes the deal with the lowest total cost C, or walks away when the alternative is
cheaper. Forked from [tacto-ai/negotiation-arena-kit](https://github.com/tacto-ai/negotiation-arena-kit).

Practice board on the evening before the final: mean best score **0.736** over the 10 hosted suppliers, #3 of 24.
On the morning of the final, six fresh single passes of the final build averaged **0.743** (0.737-0.749), every
case closed with a deal, no claim contradicted.

## How it negotiates

The code decides every number; a language model only writes the words around them.

1. **A target cost.** For every allowed combination of the case's levers (payment days, contract months, lead
   time, Incoterm, index clause, quality terms) the engine solves the unit price at which the supplier's cash
   value equals its estimated cost floor - from our should-cost, its own cost breakdown or letter, its cited
   cost drivers - and costs that package with the arena's published formula. The cheapest one is our target
   (`starter-kit/proto/target.py`).
2. **Packages of equal cost to us.** Each e-mail carries two term sheets that cost us the same but differ in what
   the supplier may value: longer contract, faster payment, its standard lead time, its own index clause at the
   deadband cheapest for us. A term the supplier insists on becomes part of every package.
3. **Visible concessions, then patience.** Our goal moves from the target towards the supplier's standing offer
   over four rounds (early concessions beat holding firm on every supplier we met), but we hold our ask while
   the supplier is still giving at least 0.3 % a round - and accept at once when it goes final or agrees.
4. **Evidence the arena can check.** Every claim carries a data ID from the package: a falling cost driver, our
   orders of the same part elsewhere, its scorecard, our forecast, the notice period in its own letter, the
   rival's offer in an RFQ. Facts that rose, or that argue for the supplier, are never cited; in an RFQ a shared
   fact goes to one bidder only, since the arena counts each ID once per case.
5. **RFQs.** One worker per supplier on its own 60-second clock; the cheapest quote that keeps our must-haves is
   opened first. From the first e-mail each bidder sees the cheapest rival price at least 5 % below its own -
   never a dearer one, never the same offer twice: owner-run suppliers then give half a step at once and
   announce the rest ("we need to clarify this internally"). The best standing offer is accepted the moment it
   is agreed or final; a rival's reply in flight gets at most 15 seconds.
6. **Announced steps are collected.** A reply that promises a further step ("we need to clarify this
   internally", "any further step needs approval from our management") is never accepted on; our next ask
   concedes only a quarter of its usual step, because the rest comes anyway (P05: 0.61-0.67 → 0.81-0.88).
7. **Answers.** Volume questions get our binding need and forecast, requests about fixed terms get a plain
   "fixed in this enquiry", complaints about late payment get a promise to pay on the agreed day.
8. **The e-mail.** Claude Sonnet 5.5 rewrites the engine's template; every sentence with a data ID stays
   verbatim, no figure the code did not choose gets in, and the template goes out whenever the model is slow or
   breaks a rule. On the practice suppliers wording did not move the score; the numbers did.
9. **Guards for cases we have not seen.** Never close a deal that costs more than our alternative (no deal scores
   the alternative) or breaks a must-have; never propose the supplier's opening back; price solvers that scale
   to the part (EUR 2 to EUR 1,600 in the data); a central price list ("no individual price reductions") moves
   the talk to payment and contract terms; a late move that the arena counted as a timeout is recovered by
   accepting the standing sheet it left. A persona test bench of 69 cases (prices x0.012-x40, cheaper
   alternatives, new must-haves) scores 0.520 out of distribution vs 0.474 on the known cases.

The engine is Tugra's deterministic engine (`starter-kit/proto/`, algorithm `A9h`), developed by the team on
the hosted sandbox, several hundred practice sessions, the local simulator and the persona bench. Our earlier agent, the orchestra
(`arena_kit/agents/orchestra.py`), is the fallback if the engine cannot start on a case.

## Setup

Python 3.12 and [uv](https://docs.astral.sh/uv/). Secrets go into `.env` at the repo root (never committed):

| Variable | What |
|---|---|
| `ARENA_API_KEY` | the team's arena key |
| `CLAUDE_API_KEY` | Anthropic key for the e-mail writer (aliased to `ANTHROPIC_API_KEY`) |

`starter-kit/.env` holds the non-secret settings: `ARENA_URL`, `ARENA_DATA=data/package`, `LLM_PROVIDER=anthropic`,
`LLM_MODEL=claude-sonnet-5-5`, `LLM_EFFORT=low`.

```bash
cd starter-kit
uv sync --all-extras
uv run arena data                                  # the data package (and Sunday's release, once public)
uv run pytest -q                                   # 158 tests
uv run arena run --set sandbox --agent hybrid      # free: the two demo cases
uv run arena play case:P01 --agent hybrid --practice -v   # one practice session
```

## The Live Final

```bash
cd starter-kit
uv run arena run --set final --agent hybrid --parallel 10 -v > ../logs/final.log 2>&1
```

Started before 12:00 and left running: it waits for each wave, plays its cases in parallel, closes every case
before the wave's cap, retries a case refused for the key's session limit, resumes a running session after a
restart, and never reads `/v1/events`, `/screen`, `/leaderboard` or `/results`. `uv run arena dashboard` shows
every negotiation live at http://127.0.0.1:8765 from our own event log.

## Layout

| Path | What |
|---|---|
| `starter-kit/proto/` | the engine: `engine.py` (tactics as `Config` fields, the negotiation loops), `target.py` (target cost), `practice.py` (facts and floors from the data package), `variants.py` (named algorithms) |
| `starter-kit/arena_kit/agents/hybrid.py` | runs the engine through the kit's runner: event log, resume, wave cap, background attachments |
| `starter-kit/arena_kit/agents/engine_writer.py` | the LLM writer and its guards |
| `starter-kit/arena_kit/` | the kit: client, runner (`play.py`), cost function (`cost.py`), data package, dashboard, local simulator |
| `starter-kit/tests/` | 158 tests: cost model, clock rules, RFQ accept timing, rival and announced-step rules, out-of-distribution guards, the writer's guards, the final runner |
| `vault/` | the team's Obsidian vault: decisions (`Team-Knowledge/Decisions/`), test log (`Progress/Testing.md`), every practice run with its replay |
| `brief/`, `data/` | Tacto's brief, API docs and data package |

## What we learned (short)

- A supplier's first counter barely depends on our first ask; it moves when we move, and when a fact it can
  verify arrives - once per fact.
- Equal-cost packages let the supplier pick the lever it values; the clause at the widest deadband, the longest
  contract and its standard lead time are nearly free for us and worth real money to it.
- Accepting too early cost more than asking too little: three patient rounds while the supplier still gives
  were worth +0.03 on the mean.
- The 60-second clock runs from the supplier's reply; downloading its attachments before reading the offer, or
  waiting for a rival, lost deals until both happened in the background.
- Wording, tone and even the choice of writer model did not change scores on these suppliers; data and timing did.
- In an RFQ the strongest lever is a verified rival price well below the supplier's own: half a step at once, the
  rest on the next reply - and the rest arrives whatever we ask, so conceding for it only gives money away.

Decisions, measurements and the Sunday checklist: `vault/Team-Knowledge/Decisions/0007 The final build.md`.
