# proto: Tugra's buyer engine (branch `tugra`)

A deterministic negotiation engine: **code picks every number, templates write the e-mail** (no LLM needed). It plays
any case of the arena (sandbox, practice, final). The tactics were found by an evolutionary search on the sandbox,
checked on all 10 hosted practice cases, and improved with ideas from the orchestra and a teammate's D02 replay.

Full write-up in the shared Obsidian vault (RxV00/EHL-Hackathon): `Progress/Experiment-Log.md` (every change and its
measured effect), `App/Engine-Prototype.md` (architecture + changelog), `App/Target-C-Model.md`,
`Progress/Practice-Run-A-Findings.md`, `Progress/Teammate-Findings-Comparison.md`.

## Sudeep's B line

**B1** names the strongest existing Sudeep hybrid, previously logged as `A3fca35`.
It keeps the A3 policy configuration, adds response-aware wording, and prioritizes a
14-day payment / FCA / at-least-35-day lead package at the same buyer cost for demo J1.
The historical name remains an alias. Future revisions use B2, B3, etc.; the older
standalone `target_cost_candidate.py` remains a separate baseline.

B1 still contains D02/supplier-specific rules. Its results measure a demo specialist,
not proven performance on unseen suppliers. The updated teammate commit `d5ed469`
introduces A6 and makes data-package evidence the runner default. Historical results
below used the older engine and handwritten demo facts, so compare them separately.

For a fresh, isolated comparison using the same updated engine and generic evidence:

```bash
PYTHONPATH=. uv run python proto/compare_sandbox.py --variants A3 B1 A6 --repeats 5 --data ../data
```

The comparison accepts D01/D02 sandbox cases only and defaults to D02. It records
source hashes, complete configurations, replay IDs, all attempts, means and medians
in a new ignored `proto/runs/comparisons/` directory for each batch. Use `--env-file`
if your local environment file is outside `starter-kit/`.

## A_hybrid development

The next Sudeep candidate is **A_hybrid**, based on the teammate's **A6** with
one general lesson from B1: use the supplier's quoted package trade-offs. It can
retain a longer quoted delivery schedule when it meets the buyer's requirements
and has the same complete cost. It contains no demo/supplier IDs or fixed trade values.

See [the exact algorithm](A_HYBRID.md) and
[the fresh comparison report](comparisons/2026-10-10-a-hybrid.md).
This remains an opt-in experiment; A6 and B1 are preserved side by side.

## Results

| Algorithm | D01 (sandbox) | D02 (sandbox, mean of 3) | Notes |
|---|---|---|---|
| naive kit agent | 0.20 | – | |
| A (search winner) | 0.979 | 0.640 | practice: mean 0.557 over 10 cases; P02 0.684 and P04 0.874 were case records |
| A2 (+ fixes from practice) | 0.979 | 0.626 | safe push, bottleneck anchor, say-fixed, meet supplier terms, RFQ in-flight guard |
| A3 (+ staggered RFQ opening) | 0.979 | 0.728 (0.740, 0.740, 0.703) | the D02 friend replay scored 0.661 (with hand-written sandbox facts) |
| A5 (+ practice fixes 2, generic code path only) | 0.982 | 0.706 (5 runs) | practice: 0.614 over 10 cases, P03 0.923 / P01 0.881 records |
| **A6 (+ fixes for every A5 practice problem)** | **0.982** | **0.696** (0.703, 0.703, 0.682) | **main algorithm**; generic code path (what the final runs) |

## Side-by-side D01/D02 sandbox comparison (2026-10-10)

Tugra A3 is the current lead. The earlier target-cost policy is preserved as
`target_cost_candidate.py` so we can continue comparing it without replacing A3.
These are separate policies; do not combine a strategy's D01 and another strategy's D02.

| Policy | D01, 3 runs (median) | D02, 3 runs (median) | D02 complete cost | Qualification |
|---|---:|---:|---:|---|
| **A3** (`variants.py`) | **0.978834** | **0.740063** | **€171,700.05** | Combined median mean **0.859448**; passes the team's both-demo average ≥0.8 rule. D02 alone is below 0.8. |
| Target-cost adaptive packages (`target_cost_candidate.py`, 171k opening target) | Not tested | **0.703004** | **€173,833.07** | D02-only result; not yet qualified on both demos. |

The target-cost candidate's opening target is 171,000, next target is 170,638.57, and
the extra closing probe is off. Three repeated D02 runs produced the same 0.703004
score and closed at €13.90 FCA, 14-day payment, and 35-day lead. Its D02 result is
0.037059 below A3, with €2,133.02 higher complete cost. A separate three-run check
with the older 174,000 default scored 0.638965; the defaults now match the recorded
171,000 configuration to avoid that accidental mismatch.

The comparison uses only sandbox demos and spends no hosted-practice negotiations.
Raw logs are git-ignored under `proto/runs/variants/` and
`proto/runs/target_cost_candidate/`. A3 replay IDs are recorded in the variant log:
`6888db9acac91243`, `2d4225afbc1da555`, `ff01c73080e84a97` for D02;
`9fe1bdd53756b403`, `3ea524bfc4c5a533`, `b44121f3adca032b` for D01.

To repeat the candidate's three D02 runs (sandbox only):

```bash
PYTHONPATH=. uv run python proto/run_target_cost_candidate.py --repeats 3
```

To repeat A3 on the same demos:

```bash
PYTHONPATH=. uv run python proto/variants.py --cases case:D01:3 case:D02:3 --variants A3
```

## D02-focused hybrid experiments (2026-10-10)

Since A3 is already saturated on D01, these experiments change D02 behavior and use D01 only as
a guardrail. All results below are repeated sandbox sessions; no practice quota was used. A3's
eight D02 control runs all scored 0.740063.

| D02 policy | Runs | Median | Mean | Readout |
|---|---:|---:|---:|---|
| A3 control | 8 | 0.740063 | 0.740063 | Stable baseline |
| A3 + response-aware trade wording | 3 | 0.703004 | 0.724065 | One 0.766 run, two 0.703 runs; not reliable |
| A3 + response wording, breakdown argument and volume framing | 3 | 0.703430 | 0.710166 | No gain |
| A3 + response wording and three MESOs | 3 | 0.703430 | 0.710166 | More package choices did not help |
| A3 + three MESOs, nearest supplier terms first | 3 | 0.724492 | 0.724350 | Still below A3 |
| A3 + response-aware wording, prioritize equal-cost 14-day FCA / 35-day lead | 10 | 0.743021 | 0.740494 | Best hybrid median by 0.003; mean is effectively tied with A3 and outcomes vary from 0.724066 to 0.766189 |
| Same 35-day FCA policy, 2% more ambitious target | 5 | 0.724066 | 0.673517 | Too aggressive; two poor outcomes at 0.577 and 0.619 |
| Same 35-day FCA policy, slower concessions (e=1.2) | 5 | 0.682368 | 0.678156 | Holding firm longer performed worse |
| A3 + response wording, mirror the supplier's preferred latest package | 5 | 0.703004 | 0.708139 | Matching revealed terms alone did not improve the deal |

The strongest single outcome was **0.766189**, closing at **€13.60 FCA, 14-day payment, 35-day
lead** (replays `a50fea99baa10de1` and `37d18a914f629766`). The 35-day FCA policy produced that
package twice, but other runs ended at €13.70 or €13.80 on the same delivery terms. Its ten-run
mean is nearly identical to A3, so this is not a robust improvement yet. The test supports a
useful hypothesis—J1 may trade a longer production window for a lower price—but not a fixed rule
to push harder on every run. The tested `A3fca35` flag prioritizes that package unconditionally;
a future version should enable the preference only after the supplier signals that the longer
lead or FCA terms suit it.

The D02-only 35-day FCA policy kept the D01 guardrail at 0.978834. The more aggressive and
slower-concession changes also left D01 at 0.978834 because those controls apply only to D02.
For now, keep A3 as the overall champion. Collect more runs before promoting the 35-day FCA
policy. To reproduce the tournament:

```bash
PYTHONPATH=. uv run python proto/variants.py --cases case:D02:5 --variants A3 A3fca35
```

The code flags and runner output are in `engine.py`, `variants.py`, and the git-ignored
`proto/runs/variants/results.jsonl`.

## Run

From `starter-kit/` (keys in the root `.env`, as in the rest of the repo; `load_env()` reads `.env` in the working
directory, so copy or symlink it if needed):

```bash
# sandbox (free): A3 once on D01, three times on D02 (D02 is noisy)
PYTHONPATH=. uv run python proto/variants.py --cases case:D01:1 case:D02:3 --variants A6

# hosted practice (COSTS QUOTA - ask the team first): facts and floors from the data package
PYTHONPATH=. uv run python proto/variants.py --practice --cases case:P05:1 --variants A6

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
| `variants.py` | named algorithms (A … **A6**) and a parallel runner (max 4 sessions: the key's 10 are shared) |
| `search.py`, `report.py` | evolutionary tactic search on the sandbox and its report |
| `smoke.py` | offline smoke test on all practice case files (no quota) |
| `inspect_run.py` | every message, decision and claim of a variant's practice sessions |
| `practice_report.py`, `summarize.py`, `cleanup.py`, `chat.py` | practice report, run summaries, safe cleanup, manual play |

Logs go to `proto/runs/` (git-ignored). `report.py` / `practice_report.py` write notes into `$VAULT_DIR` (default `../vault`).
