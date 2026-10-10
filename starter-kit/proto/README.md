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
| **A8 (+ D02 search: RFQ-only 1 package, 1 fact, anchor −8 %, 3 pushes of 3 %, breakdown argument)** | **0.982** | **0.765** (4/4 identical) | **main algorithm**; generic code path |

## Run

From `starter-kit/` (keys in the root `.env`, as in the rest of the repo; `load_env()` reads `.env` in the working
directory, so copy or symlink it if needed):

```bash
# sandbox (free): A3 once on D01, three times on D02 (D02 is noisy)
PYTHONPATH=. uv run python proto/variants.py --cases case:D01:1 case:D02:3 --variants A8

# hosted practice (COSTS QUOTA - ask the team first): facts and floors from the data package
PYTHONPATH=. uv run python proto/variants.py --practice --cases case:P05:1 --variants A8

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
| `variants.py` | named algorithms (A … **A8**) and a parallel runner (max 4 sessions: the key's 10 are shared) |
| `search.py`, `report.py` | evolutionary tactic search on the sandbox and its report (`--base A6 --cases case:D02 --space rfq` searches RFQ-only settings) |
| `smoke.py` | offline smoke test on all practice case files (no quota) |
| `inspect_run.py` | every message, decision and claim of a variant's practice sessions |
| `practice_report.py`, `summarize.py`, `cleanup.py`, `chat.py` | practice report, run summaries, safe cleanup, manual play |

Logs go to `proto/runs/` (git-ignored). `report.py` / `practice_report.py` write notes into `$VAULT_DIR` (default `../vault`).
