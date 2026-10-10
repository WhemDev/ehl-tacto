# Algorithm testing

Use `arena-experiment` to compare policy factories across every hosted sandbox case (D01 and D02).
Start with the existing naive baseline and one candidate. Check the API flow locally, inspect one
hosted run per case, screen with three repetitions, then retest finalists with ten per case.

Each case/strategy/repetition gets a fresh session and a fresh policy instance. Strategy order is
shuffled within each case/repetition block. Compare mean score, variability, worst run, deal rate,
failures and timing within each case. Errors stay in the comparison as zero-valued experimental
outcomes; the official result is retained separately. Supplier randomness is not controllable.

From `starter-kit`, preview with `uv run arena-experiment --config experiments/demo.json`; add
`--execute` to start it. The command cannot target hosted practice or the final. Raw reports,
CSV/JSON and session traces live under ignored `logs/experiments/`, not individual vault notes for
every trial. Promote a small number of findings and representative replays after reviewing them.

See `starter-kit/experiments/README.md` for the policy interface and limitations. The shared
[algorithm testing plan](https://github.com/RxV00/EHL-Hackathon/blob/sudeep/manual-negotiation-findings/App/Algorithm-Testing-Plan.md)
contains the evaluation procedure and what to specify when handing over a proposed algorithm.

## First hosted tournament · 2026-10-10

Implemented the three proposed builds as deterministic policies: A `ControlledAgent`, B
`AdaptiveHybridAgent`, and C `LearningHybridAgent`, with the existing naive buyer as the comparator.
The strategies share the arena cost calculator and hard must-have checks. A uses a fixed linear
concession schedule; B enumerates term options, responds to supplier cost movement, and contacts
both RFQ suppliers; C uses a within-session contextual bandit over A/B and resets its observations
for each case. All use fixed email templates; there were no model calls. C is a bandit prototype,
not pretrained reinforcement learning.

The configured tournament ran three sessions per strategy per case (24 sessions total). All 24
completed with a deal. The hosted demo suppliers returned identical outcomes in all three repeats,
so the zero variation is not evidence of broad robustness. Results:

| Case | Naive | A: controlled | B: adaptive | C: bandit |
|---|---:|---:|---:|---:|
| D01 · price increase | 0.200 | **0.657** | 0.617 | 0.637 |
| D02 · two-supplier RFQ | 0.229 | **0.251** | 0.104 | **0.251** |

Scores are official arena scores. On D01, A achieved a buyer cost of €422,400, compared with
€440,757 for naive. On D02, A and C each achieved €199,848 versus €201,088 for naive. B contacted
both suppliers but closed at €208,304; its initial supplier ordering and switching rule need work.
The score gap across cases shows no single winner yet. A is the strongest simple baseline in this
screen; C adds complexity without a demonstrated advantage over A. Keep B's multi-supplier
coordination as a separate feature to improve and retest.

Raw, credential-redacted experiment artifacts are in the ignored local folder
`logs/experiments/20261010T131701Z-faddd5f5/` (manifest, CSV, detailed trial records, session
traces and report). The first smoke tournament is also retained locally. This batch is a small
development screen on two demos, not a final-case result or statistical proof.

## D02 J1 evidence trade · 2026-10-10

`EvidenceTraderAgent(d02_style="j1_cost")` scored **0.6608797298** on one hosted D02 sandbox run,
closing with J1 at €14.10 / 14-day payment / 35-day lead / FCA. Total buyer cost: **€176,257.60**.
It first secured a valid €15.50 alternative from C1, then cited that quote and `news:N-0412` to J1.
J1 moved to €14.60. A follow-up citing `cost:part:SH-220` and `sc:DEMO-J1@2026Q3` moved J1 to
€14.10. A further direct-cost argument made J1 mark €14.10 final, and the policy accepted it.
The full sequence, verified claims, cost breakdown and [replay](https://arena.tacto.ai/replay/6fe86ce06c0af781)
are in the shared Obsidian vault note
[`App/D02-J1-Evidence-Trading-0.661.md`](https://github.com/RxV00/EHL-Hackathon/blob/sudeep/manual-negotiation-findings/App/D02-J1-Evidence-Trading-0.661.md).
This D02 result is below the requested 0.8 gate; the corresponding cost threshold is about €168,250.

The D01 evidence policy scored **0.841495** in three hosted sandbox sessions (one initial and two
repeats), always at €414,993.77. For D02, the follow-up `j1_soft` variant also scored **0.660880**;
the other new D02 package variants scored 0.346–0.357. These are development observations, not a
qualified ranking: no tested D02 strategy has met the 0.8 gate. No hosted P-case was opened.

Revised gate from the team: test each strategy at least three times on each demo, take the median
official score per case, then take the midpoint of the two case medians. Qualify and rank only when
that combined value is at least **0.8**. With D01 at 0.841495, the matching D02 median must reach
at least **0.758505** (buyer cost at or below about €170,638.57 on the observed D02 scale). Show
worst run and deal rate alongside any eventual ranking.

The `experiments/qualification.json` batch ran the exact `j1_cost` policy **3× on D01 and 3× on
D02**. All six dealt. Scores were identical within each case: D01 **0.841495** and D02 **0.660880**;
their midpoint was **0.751187**. The D02 cost was €176,257.60 on every run, €5,619.03 above the
revised gate. The report in ignored `logs/experiments/20261010T135649Z-ee126c66/` correctly has
an empty qualified ranking. The dashboard can display these six sessions live from that batch's
`events.jsonl`.
