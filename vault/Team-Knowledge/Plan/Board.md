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

- [ ] Decide the final agent with Tugra: `--agent hybrid` or his `proto/final.py` - [[Report 2026-10-10 - hybrid head to head on D01 D02]]
- [ ] First practice pass of the chosen final build, one case per type (~7 sessions, needs the team's quota OK)
- [ ] Final runner: retry `429 at most 10 open sessions` until the cap (`play_waves` and `proto/final.py`)


## Done

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
