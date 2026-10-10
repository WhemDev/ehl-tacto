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
- [ ] Review sandbox replay notes and derive the agent orchestration plan
- [ ] Rehearse the final: `arena run --set practice --parallel 10` from the final machine
- [ ] README (setup, env vars without values, command) + approach description
- [ ] Slides + pick one replay to walk the jury through
- [ ] Make the repo readable for the jury and tum.ai before Sun 12:00

## Doing


## Done

- [x] Record Sudeep's D01 manual run findings and prepare the chat CLI branch
- [x] Save completed manual demo chats automatically and backfill existing sandbox runs
- [x] Add an interactive REST chat command for the local simulator and hosted practice/sandbox sellers
- [x] Kit cloned, repo + vault set up




%% kanban:settings
```
{"kanban-plugin":"basic"}
```
%%
