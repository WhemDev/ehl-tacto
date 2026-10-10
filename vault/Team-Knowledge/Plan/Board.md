---
kanban-plugin: basic
---

## Backlog

- [ ] Upgrade 1: raw-material clause from round 1 at a 5 % deadband, 90 days, 36 months (P08, P18) - [[Review 2026-10-10 - worst practice cases and upgrades]]
- [ ] Upgrade 2: new evidence - rival POs for the same part, recently falling cost drivers (P18, P08, P05, P04, P13)
- [ ] Upgrade 3: lead time never beyond our need, the supplier's standard within it (P10, P05)
- [ ] Upgrade 4: RFQ accept fix from A6 into the hybrid's engine (the A5 P05 zero; same guard in A3)
- [ ] Upgrade 5-6: answer volume / on-time payment / fixed terms; bundle volume framing (P05, P07, P08, P11, P18)
- [ ] Validate upgrades on practice: P18, P08, P10, P05 (4 sessions, needs the team's OK)
- [ ] Get the arena key approved at the Tacto desk, put `ARENA_API_KEY=` into the root `.env`
- [ ] `uv run arena vault cases` once the key works (case notes for all 19 practice cases)
- [ ] Baseline: `arena play case:P01 --agent llm -v`, read the replay, log learnings
- [ ] Supplier dossier builder: per case, the notes/letters/news/quote remarks that say what the supplier wants
- [ ] Citable-claims generator: index changes, PO prices, scorecards, should-cost with verified figures
- [ ] Cost optimiser: C of every candidate term sheet, which levers are cheap for us and worth something to the supplier
- [ ] Estimate C_best and the supplier's cost floor (should-cost, quotes, its replies)
- [ ] RFQ play: keep 2-3 threads alive, cite rival quotes
- [ ] Timing guard: every message well under 60 s, close before the 8-min wave cap
- [ ] Local supplier simulator for cheap iteration
- [ ] Rehearse the final: `arena run --set practice --parallel 10` from the final machine
- [ ] README (setup, env vars without values, command) + approach description
- [ ] Slides + pick one replay to walk the jury through
- [ ] Make the repo readable for the jury and tum.ai before Sun 12:00

## Doing

- [ ] Final runner: retry `429 at most 10 open sessions` until the cap (`play_waves` and `proto/final.py`)
- [ ] A9: when every supplier's final offer is dearer than our alternative, walk at once instead of waiting for the cap (sim D02; the worktree's R-engine has it)
- [ ] Merge or drop the worktree's uncommitted R4 engine (`.claude/worktrees/tugra`, sandbox D02 ~0.79): its fact allocation and supplier's-levers package are not in A9


## Done

- [x] **Decided (Arda, 19:00): the final runs `arena run --set final --agent hybrid` (A9h, our runner), not `proto/final.py`**
- [x] Full practice pass of the final build: mean 0.694, 10/10 deals, P08 0.603 and P18 0.532 new bests, P05 0.665 fresh ([[Testing]])
- [x] Fresh practice pass, all 10 at once: mean 0.692, 10/10 deals, < 3 min for the whole wave, P05 0.688 new best ([[Testing]])
- [x] Bug #9 fixed: attachments no longer delay a reply (17-21 s per quote PDF), a best final offer is accepted within 15 s of its arrival, A9's accept recovery ([[Progress/Bugs]], `tests/test_engine_clock.py`)
- [x] A6-A9 merged into `arda`; the hybrid plays A9h (A9's rules, A6's RFQ play) for every case type (A9 practice mean 0.688: P08 0.586, P18 0.485, P01 0.956; board 72.7; A9's RFQ settings lose 0.13 on fresh sandbox D02)
- [x] Does an LLM writer pay for Tugra's engine? Sonnet 5.5 vs template, 5 runs/case: no (80.0-82.8 vs 83.3); templates stay ([[0005 Writer model]])
- [x] `--agent hybrid`: Tugra's engine (merged from `tugra`) for price/renewal/RFQ/bundle, orchestra for the rest - sandbox 85.9 vs orchestra 80.7 ([[Report 2026-10-10 - hybrid head to head on D01 D02]])
- [x] Final timing: close by the slowest round, round budget, watchdog, orchestra = default agent (`358a010`)
- [x] Quick wins: profiles only raise anchors, free contract months, claims pool, fixed terms (`78774e4`)
- [x] Learn from the teammate engine: floor target, early concession, holds, alternatives, blind refs - sandbox 80.6 vs 58-61 (`b23d10d`, [[0006 Learn from the engine]])
- [x] What moves suppliers, from our logs (no emulator: their first counter ignores our ask; movement and rivals matter)

- [x] Kit cloned, repo + vault set up
- [x] Research: negotiation techniques and sources → [[Research - negotiation techniques]] (experiments list inside)
- [x] Review of the practice standings and the zeros → [[Review 2026-10-10 - where the points are]]




%% kanban:settings
```
{"kanban-plugin":"basic"}
```
%%
