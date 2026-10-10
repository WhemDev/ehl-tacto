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
