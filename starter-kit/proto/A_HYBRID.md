# A_hybrid: A6 with supplier-quoted delivery flexibility

Status: experimental candidate, not a replacement for A6. Sudeep's earlier
specialist remains B1; historical `A3fca35` is its unchanged configuration alias.

## What transfers from B1

B1 explored non-price package trades before the supplier's final offer. A_hybrid
transfers that principle: preserve a supplier-quoted schedule when faster delivery
has no calculated buyer benefit. It removes B1's hard-coded case, supplier, FCA,
payment-day and lead-day choices. An observed quote establishes a feasible schedule,
not proof that the supplier will accept our lower price or save production costs.

## Exact policy

Base: `VARIANTS["A6"]`, including its targets, concession schedule, evidence,
package generation, supplier coordination, acceptance and deadline controls.
The only configuration difference is `revealed_schedule=True`.

After A6 generates its normal package proposals:

1. Act only for an RFQ whose current supplier thread is open. Lead time must be
   negotiable and absent from the case's fixed terms.
2. Examine the proposed packages in their existing order, and the current
   supplier's latest quoted term sheets in their existing order.
3. Require an explicit quoted lead time longer than the proposed lead time and
   no longer than the buyer's required lead time. If allowed options are provided,
   require exact membership; do not snap an unsupported observation to an option.
4. Resolve both packages through the official `closing_terms` helper. Every term
   other than price and lead time must match. A different Incoterm or payment
   period does not establish evidence for this trade.
5. Copy the buyer proposal and replace only its lead time. Preserve its price.
   Reject duplicate packages and mandatory-constraint violations.
6. Calculate both complete costs with `total_cost`, including the supplier estimate
   for relationship costs where applicable. Require finite costs within €0.01.
7. Apply the first valid change to at most one package. Record the source quote ID,
   old/new lead times, actual terms, and before/after costs. Otherwise leave A6's
   proposals unchanged.
8. Ask whether the supplier can confirm the proposed price on its quoted schedule.
   This is a new counteroffer, not acceptance of an old quote. Ordinary A6 closing
   logic remains responsible for accepting an executable offer.

Price-frozen packages returned early by A6 and its recalled offers bypass this
transformation. The new rule does not change single-supplier price-increase cases.

The current cost model charges only delivery after `need_lead_time_days`, making
some earlier schedules economically equivalent. The full calculator and hard
constraints still validate every change; the policy does not assume this from prose.

## Evaluation

Use the generic data-package evidence path for both policies. Freeze source and
configuration before the batch, rotate variant order, retain every attempted run,
and report means, medians, ranges, failures and replay IDs. D01 is a regression
check; D02 tests the intended change. Repeated demos cannot establish performance
on unseen suppliers, and neither the cost check nor an observed schedule guarantees
supplier acceptance.

```bash
PYTHONPATH=. uv run python proto/compare_sandbox.py \
  --variants A6 A_hybrid --cases case:D01 case:D02 \
  --repeats 5 --workers 2 --data ../data
```

Add `--env-file /path/to/local/.env` if needed. This runner accepts only sandbox
D01/D02. Raw artifacts are ignored under `proto/runs/comparisons/`; durable reports
belong in `proto/comparisons/`. No hosted practice cases are part of this experiment.

Implementation: `hybrid.py`, integrated through `engine.py` and `variants.py`.
Offline checks in `tests/test_hybrid.py` use an unrelated synthetic case and verify
cost preservation, constraints, allowed terms, evidence matching, input immutability,
duplicate avoidance, and isolation to one configuration change.
