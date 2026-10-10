---
agent: false
tags: [playbook]
---
# Playbook

Notes in this folder with `agent: true` in their properties are injected into the buyer agent's
prompt for every case (`arena_kit/vault.py → playbook()`, capped at 6,000 characters).
Notes with `agent: false` are for people only.

Rules for agent notes:
- Short, imperative, general. Hidden cases have **new suppliers**: write rules that transfer
  ("a cash-short job shop trades price for payment days"), not "Brandlhuber accepts 131.40".
- Every rule should come from a replay or the brief: link the run note it came from.
- Supplier-specific observations go into that supplier's note under `## Team notes` instead.
- Mark untested ideas as hypotheses and test them in practice before you trust them.
