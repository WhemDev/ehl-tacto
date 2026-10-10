# D02 target-cost negotiation experiment

## Result

The target-cost policy improved D02's median score from the repeated `j1_cost` control's
0.660880 to 0.703004 across three sandbox sessions. It closed at €13.90 FCA, 14-day payment,
and 35-day lead time in all three runs (buyer cost €173,833.07). This is a useful gain, but
it does not meet the current D02 qualification threshold of about 0.758505 needed to pair with
the D01 median of 0.841495 and reach a combined 0.8.

The three confirmation replays are [85664f91248358a1](https://arena.tacto.ai/replay/85664f91248358a1),
[cd351e4c8657c6e8](https://arena.tacto.ai/replay/cd351e4c8657c6e8), and
[cad129adac6e988d](https://arena.tacto.ai/replay/cad129adac6e988d). Their batch is
`logs/experiments/20261010T143344Z-8364a41d/` (raw logs are ignored by Git).

## Policy

`arena_kit/agents/target_cost.py` inverts the buyer's `total_cost()` calculator by binary search
for each package. It constructs offers at a full-horizon cost target rather than assigning the
same unit-price anchor to DAP, FCA, and EXW. It first asks C1 for a valid comparison, then gives J1
three packages that vary payment, lead time, and freight responsibility. On follow-up it cites
new evidence only once, reads the supplier's reply for a stated constraint, and responds to the
current best offer. Once J1 has a final offer, it accepts the best valid current sheet instead of
spending more rounds on C1.

The confirmation configuration is `d02_target_cost_tournament.json` with
`closing_probe: false`. The optional one-message closing probe is in
`d02_target_cost_closing_probe.json`; it explicitly priced the final counter from the latest
FCA offer, but the single run still closed at €13.90 FCA and scored 0.703004. It added no measured
gain, so the three-run result remains the policy's score estimate.

## What changed the outcome

The first cost-equivalent packages, targeted at €174,000, scored 0.638965: J1 ended at €14.60 DAP
and the repeated term packages were treated as the same request. A second version that argued
€13.60 FCA from the supplier's €12.76 direct-cost breakdown scored 0.639818; the supplier pointed
out that the breakdown excluded overhead and ended at €14.20 FCA. Those trials are recorded in
`logs/experiments/20261010T142452Z-12b4b32f/`,
`logs/experiments/20261010T142749Z-b721ab55/`, and
`logs/experiments/20261010T142916Z-fd9c8f23/`.

The better package variant lowered its opening target to €171,000, cited the real competing quote
and news once, then changed the final package set to €14.00 DAP, €13.80 FCA, and €13.60 EXW. J1
replied with €13.90 FCA and a €13.70 EXW alternative. The buyer-cost calculation showed FCA was
the better executable deal, so the agent accepted it. The extra closing-probe variant received the
same €13.90 FCA offer. The tests show that total-cost inversion helps compare packages, while the
supplier's response still depends on a distinct, commercially credible next move; repeating
near-identical target packages did not help.

## Next experiment

The next useful change is to rank candidate messages by expected value of information or price
improvement. In these runs, C1's best valid offer remained far above J1's, while J1 continued to
make material concessions. A targeted final probe to J1 may be worthwhile only when its expected
improvement exceeds the risk and time cost; otherwise accept the €13.90 FCA sheet. The D02 score
remains below the 0.8 combined-score gate, so this strategy is not qualified for practice-set use.
