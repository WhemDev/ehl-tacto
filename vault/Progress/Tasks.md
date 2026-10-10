# Tasks

Status: `todo` · `doing` · `review` · `done`

| Task | Owner | Status | Branch/PR | Notes |
|------|-------|--------|-----------|-------|
| Supplier profile builder: all 46 suppliers → type, cash pressure, workload, dependency on us, approval ladder, floor, wants (cached JSON; rerun after Sun 08:00) | Claude | review |  | `uv run python -m arena_kit.profiles` → `starter-kit/profiles/` (INDEX.md); [[0003 Generalise, don't overfit]] |
| Persona supplier simulator from the profiles (extend arena-sim), checked against practice replays |  | todo |  | needs profiles |
| Type → strategy parameters in `analysis.py` (anchor, e, levers per supplier type) | Claude (Arda) | done | `arda` e66e867 | `strategy.py`, [[0004 Profile hook]]; A/B 58.0 vs 56.8, see [[Report 2026-10-10 - profile hook and practice A-B]] |
| Claude ↔ GPT fallback per LLM role on 429/timeout |  | todo |  |  |
| Noise measurement: the same agent 3× on 3 cases, hold out 2–3 hosted cases |  | todo |  | sets the bar for "better" |
| Sandbox experiment runner `starter-kit/experiments/` | Claude | review |  | see its README |
| Writer model on the final machine: `LLM_MODEL=claude-sonnet-5-5` in `starter-kit/.env` (now Opus) |  | todo |  | [[0005 Writer model]], needs the team's OK |
| Writer: structured output (`output_config.format`) so a non-JSON answer can't happen; GPT fallback on 429/timeout |  | todo |  | [[Progress/Bugs]] #4 |
| Final timing: close at max(90 s, slowest round + 15) before the cap, rounds from `seconds_left`; final command `--agent orchestra` |  | todo |  | [[Report 2026-10-10 - profile hook and practice A-B]] #1 - risk for the final |
| Plan 4 rounds and concede visibly from round 1 (suppliers go final at r2-4) |  | todo |  | test on the persona simulator first |
| Profiles only raise the anchor (floor at the goal default), keep trades + voice |  | todo |  | A/B: softer anchors gained nothing |
| Longest `contract_months` ≥ horizon in every sheet where it is free |  | todo |  | P03, P07 |
| Raw material: index clause with deadband + lower base price from round 1 (P08 0.52, P18 0.39) |  | todo |  | room 15-25 % |
