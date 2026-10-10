# Reversible candidates — 11 October 2026

Baseline: `arda`, `a5c7cf8`. Default hybrid remains A9h. No changes to main.

## Switches

Set `ENGINE_VARIANT` before starting a run (restart to change an already running process):

| Variant | Change from A9h |
|---|---|
| A9h-owed | Collect one announced approval/follow-up; keep RFQ final offers alive |
| A9h-indices-first | Promote falling cost-driver facts, with PPI before hedge-sensitive material indices |
| A9h-economic-lead | Allow longer lead times when comparable supplier quotes show the discount exceeds our extra total cost |
| A9h-extreme-pay | Shortest or longest feasible payment term in proposed packages |
| A9h-candidate | All three new levers, without owed |
| A9h | Baseline; all new switches off |

Single switches can also be set through ENGINE_CFG (`first_indices`, `economic_lead`, `extreme_payment`, `collect_owed`). Clear ENGINE_CFG overrides when restoring A9h.

Payment endpoints respect fixed terms, must-haves and binding supplier requirements. Accepting or mirroring an existing supplier offer preserves its exact terms; the endpoint restriction is for newly generated packages. Speed discounts are learned only from same-message alternatives differing solely in price and lead time. No discount is inferred from prose. Complete buyer cost includes late cost; the observed speed premium also informs supplier package ranking.

The first-mail candidate preserves the remaining evidence, numbers and claim-validation checks. PPI-first is a heuristic grounded in the replay finding, not a new measured per-series success model. Both-indices-first previously lost on P08/P18; this candidate is not promoted on that evidence.

## RFQ tests

Imported the owed implementation from gap commit f5b2224 (engine, variant and tests only). The two skipped RFQ fixtures now make J1 the initial cheapest bidder, so its announced follow-up is visible before C1 agrees. Both tests run with staggered RFQ enabled: A9h accepts C1; owed collects J1's next offer and awards J1. Other owed tests cover ordinary/final status and one-shot collection.

## Hosted budget and validity

Maximum four openings, including failed harness starts. Two P02 openings failed during local adapter initialization before a buyer message (missing context callback). They were explicitly closed and excluded: `6816ff81ba0d88d8`, `8a7f1501eafb9e95`. The adapter was corrected and smoke-tested offline before the remaining paired P05 comparison.

The identical template writer is used on both sides to isolate strategy. Measure only supplier-message request time, not attachments or writing. Require every measured reply >=15 seconds; finish the current negotiation but start no further session after a sub-threshold result. No performance conclusion from failed, missing, fast, or otherwise invalid runs. One valid pair is exploratory, not statistical proof.

Raw measurements: `logs/owed-validation-20261011/`. The script refuses to overwrite its output ledger. No retry automatically opens another session.

## Rollback

Select A9h and clear ENGINE_CFG to disable the candidate behavior immediately for the next process. All task files are isolated in a dedicated commit: revert that commit to remove the implementation/tests/report. Do not reset the checkout or remove teammates' uncommitted files. Arena sessions already consumed cannot be reverted.

## Offline verification

142 passed, 1 skipped; ruff clean. All 19 saved practice cases generate must-have-compliant packages with endpoint payment terms under the combined candidate. The six owed tests pass, including both formerly skipped RFQ scenarios.

P08 opening replay (same fixture, price €6.10): A9h first-mail refs contain AS-14404 only and proposes payment 90/60 days. The candidate cites PPI-C2431 May→August first, then AS-14404 June→September, and proposes 90/14 days. These are deterministic output checks, not hosted performance evidence.

## Hosted results — budget exhausted, no winner established

| Variant | Case | Score | Reply min / median / max (s) | Valid under >=15 s for every reply? |
|---|---|---:|---|---|
| A9h | P05 | 0.606911 | 15.953 / 47.789 / 126.706 | Yes |
| A9h-owed | P05 | 0.665452 | 0.145 / 36.473 / 61.810 | **No** |

Nine measured non-action responses per run. The owed run had two sub-threshold responses (0.145 s, 0.197 s). Its median passes but the stricter per-reply gate fails; do not interpret the apparent +5.85 percentage points as a measured improvement. Owed collected a promised step from sup:70250. Two 409 errors/resyncs occurred after another worker accepted the session, so those are post-close races, not evidence of a supplier-brain change. Fast-response origin is not established. Baseline had no error/resync events.

Sessions: A9h `fcde2c9ee56cb07e`; owed `3c3de5db2e0a85cd`. Together with the two failed P02 starts, **four sessions used**, no replacements. Both completed deals. Default remains A9h. The three-lever candidate is offline-verified only.

The final validation harness also records failed message requests and treats them as invalid, records/cleans up an opened session if constructor setup fails, and refuses an existing output file. An additional local regression test verifies constructor-failure cleanup and duplicate-ledger refusal (1 passed, in addition to the 142-test full suite).
