# proto: Tugra's buyer engine (branch `tugra`)

A deterministic negotiation engine: **code picks every number, templates write the e-mail** (no LLM needed). It plays
any case of the arena (sandbox, practice, final). The tactics were found by an evolutionary search on the sandbox,
checked on all 10 hosted practice cases, and improved with ideas from the orchestra and a teammate's D02 replay.

Full write-up in the shared Obsidian vault (RxV00/EHL-Hackathon): `Progress/Experiment-Log.md` (every change and its
measured effect), `App/Engine-Prototype.md` (architecture + changelog), `App/Target-C-Model.md`,
`Progress/Practice-Run-A-Findings.md`, `Progress/Teammate-Findings-Comparison.md`.

## Results

| Algorithm | D01 (sandbox) | D02 (sandbox, mean of 3) | Notes |
|---|---|---|---|
| naive kit agent | 0.20 | – | |
| A (search winner) | 0.979 | 0.640 | practice: mean 0.557 over 10 cases; P02 0.684 and P04 0.874 were case records |
| A2 (+ fixes from practice) | 0.979 | 0.626 | safe push, bottleneck anchor, say-fixed, meet supplier terms, RFQ in-flight guard |
| A3 (+ staggered RFQ opening) | 0.979 | 0.728 (0.740, 0.740, 0.703) | the D02 friend replay scored 0.661 (with hand-written sandbox facts) |
| A5 (+ practice fixes 2, generic code path only) | 0.982 | 0.706 (5 runs) | practice: 0.614 over 10 cases, P03 0.923 / P01 0.881 records |
| A6 (+ fixes for every A5 practice problem) | 0.982 | 0.696 (0.703, 0.703, 0.682) | generic code path (what the final runs) |
| A8 (+ D02 search: RFQ-only 1 package, 1 fact, anchor −8 %, 3 pushes of 3 %, breakdown argument) | 0.982 | 0.765 (4/4 identical) | generic code path |
| A9 (+ team review upgrades as generic rules: insisted/introduced terms in every package at the variant cheapest for us, lead-time cap, new evidence, answers) | 0.982 | 0.70–0.79 | practice mean 0.688 over 10 cases (P01 0.956, P08 0.586, P18 0.485) |
| A10 (+ GPT-6.1-sol advice: deadline reserve for alternatives, conditional-agreement repair, push scaled to room, plain proof) | 0.982 | 0.744 over 6 recent runs (0.682–0.786) | practice 0.693 over 10 cases |
| A10w (A10 + Claude Sonnet 5.5 writes every e-mail in the supplier's register, template fallback) | 0.982 | – | practice 0.682 (writer used for 90 % of mails, median 2.5 s) - kept as an option |
| A11c / A12d (Astra + GPT-6.1-sol rounds: safe close, clause exploration, package frontier, close recovery …) | 0.957–0.995 | 0.765–0.772 | practice 0.657 / 0.664 → not adopted (Experiment-Log E38–E39) |
| **G5-1 (A10 + keep a delivered incoterm + stable incoterm basis + no RFQ hold rewinds + Nash package bargaining; from a 5-generation D02 evolution with Astra)** | **0.982** | **0.772** (0.765, 0.765, 0.786; never below 0.765) | main algorithm until 11 Oct; practice 0.694 |

## The Live Final (start before wave 1, leave it running)

```bash
PYTHONPATH=. uv run python proto/final.py                 # G8s on every case of every wave, real wave cap as deadline
PYTHONPATH=. uv run python proto/final.py --rehearse 10   # same code path on sandbox cases, one 8-minute wave (free)
```
`FINAL_VARIANT` picks another named algorithm (default **G8s**). A "one session per case" 409 resumes the running
session (e.g. after a crash/restart). `proto/runs/final/manifest.json` records the exact config and code hash.

| **G8s** (G5-1 + slow tough ask for single-supplier stabilise cases with a generosity guard + spread arguments (single supplier) + clause package for stabilise + evidence fixes + quality packages) | **1.000** | 0.73–0.77 | **current main algorithm**; practice **0.731** (P01 0.956 and P02 0.733 above the board records) |

## Run

From `starter-kit/` (keys in the root `.env`, as in the rest of the repo; `load_env()` reads `.env` in the working
directory, so copy or symlink it if needed):

```bash
# sandbox (free): A3 once on D01, three times on D02 (D02 is noisy)
PYTHONPATH=. uv run python proto/variants.py --cases case:D01:1 case:D02:3 --variants G5-1

# hosted practice (COSTS QUOTA - ask the team first): facts and floors from the data package
PYTHONPATH=. uv run python proto/variants.py --practice --cases case:P05:1 --variants G5-1

# one case, any Config as JSON
ENGINE_CFG='{"e": 2, "T": 4, "rfq_stagger": true}' PYTHONPATH=. uv run python proto/engine.py case:D02

# negotiate by hand (interactive)
PYTHONPATH=. uv run python proto/chat.py case:D01

# after a kill: close only the sessions this engine opened (never teammates' sessions)
PYTHONPATH=. uv run python proto/cleanup.py proto/runs/variants
```

## How A3 negotiates

1. **Target C** (`target.py`): for every allowed combination of levers, the price where the supplier's cash value
   (`cost.supplier_value`) equals its estimated cost floor, costed with the published C; the minimum is our own
   C_best estimate. Floors come from in-game evidence: should-cost (capped so the opening keeps a sustainable
   margin), the supplier's cost breakdown, cost drivers × index moves.
2. **First ask:** 3 % beyond that target; for `secure_supply` (bottleneck) at most 3 % below the opening.
3. **Every message:** 2 term sheets of equal cost to us that differ in the levers the supplier values; 2 new
   verified facts (only *falling* indices); answers to its questions (volume, fixed terms); in an RFQ the best
   rival offer by ID; warm tone. If it keeps insisting on a term we never offered (e.g. its index clause), one
   sheet takes that term at equal cost to us.
4. **Concession:** visible from round 1 (curve e=2), planned over 4 rounds, aimed at its current offer.
5. **RFQ:** one worker per supplier, each on its own 60-second clock; **staggered opening**: the cheapest quote
   first, the others opened citing its fresh reply; never close while a supplier is untouched or a reply is in flight.
6. **Closing:** accept at our next goal (one extra round if it still moves > 0.5 %); after a final offer push 2 × 1 %
   **only when a rival's offer backs us up**; mirror an alternative sheet back before accepting it; close
   `max(90 s, slowest round + 15 s)` before a wave cap; never above the supplier's own price, never a broken must-have.

## Files

| File | Role |
|---|---|
| `engine.py` | `Config` (every tactic is a field), `Negotiator` (`goal`, `meso`, `write`, `run`, `run_rfq`, guards), `play()` |
| `target.py` | target C and price-for-C solver |
| `practice.py` | practice/final adapter: facts and floors from the data package |
| `variants.py` | named algorithms (A … A12d, G1-x … G5-x from the D02 evolution; **G5-1** is the main one) and a parallel runner |
| `writer.py`, `writer_dry.py` | optional LLM e-mail writer (Claude Sonnet 5.5, `ANTHROPIC_API_KEY`), deterministic validator, template fallback; offline replay |
| `astra/d02/` | the D02 evolution: brief, every generation's ideas (`gen*.json/md`) and results (`history.md`); `orchestrate.py d02 <gen> <n>` asks Astra, `code` dispatches Sol coders |
| `search.py`, `report.py` | evolutionary tactic search on the sandbox and its report (`--base A6 --cases case:D02 --space rfq` searches RFQ-only settings) |
| `ask_advisor.py`, `advisor_briefing.md` | send the briefing to an OpenAI model for outside advice (`OPENAI_API_KEY` in `.env`) |
| `astra/orchestrate.py` | Astra (gpt-6-astra) plans from `astra/review.md` + the source; GPT-6.1-sol sub-agents code each task as exact edits; applied only after review |
| `calibrate.py` | offline audit: our target vs the reported C_best on every practice run |
| `smoke.py` | offline smoke test on all practice case files (no quota) |
| `inspect_run.py` | every message, decision and claim of a variant's practice sessions |
| `practice_report.py`, `summarize.py`, `cleanup.py`, `chat.py` | practice report, run summaries, safe cleanup, manual play |

Logs go to `proto/runs/` (git-ignored). `report.py` / `practice_report.py` write notes into `$VAULT_DIR` (default `../vault`).
