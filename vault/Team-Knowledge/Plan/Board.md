---
kanban-plugin: basic
---

## Backlog

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

- [ ] Final timing: close before the wave cap with max(90 s, slowest round + 15), rounds from `seconds_left`, final command = orchestra @Arda-Claude
- [ ] Strategy quick wins from the reviews: profiles only raise anchors, free contract months, claims pool (po/cost/news + case facts), say what is fixed @Arda-Claude
- [ ] Supplier emulator fitted to our logged practice + sandbox negotiations, to tune rounds / concession / anchors without quota @Arda-Claude

## Done

- [x] Kit cloned, repo + vault set up
- [x] Research: negotiation techniques and sources → [[Research - negotiation techniques]] (experiments list inside)
- [x] Review of the practice standings and the zeros → [[Review 2026-10-10 - where the points are]]




%% kanban:settings
```
{"kanban-plugin":"basic"}
```
%%
