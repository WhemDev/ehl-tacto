---
tags: [plan]
---
# Timeline

## Saturday 10 Oct
- 10:00 kickoff · 12:00-13:00 deep dive (challenge selection closes 13:00)
- Afternoon: baseline on the board, data mining, cost optimiser, first practice loop
- Evening: Tacto goes offline (announced on Discord). Budget: **200 practice sessions per rolling 24 h** - plan them, log every run.

## Sunday 11 Oct
- 08:00 Sunday release → `uv run arena data` + `uv run arena vault suppliers`
- 09:00 pre-flight: one practice case through the final setup (machine, network, LLM keys)
- 11:30 checklist: `arena me` works, data has the release, runner logs to a file, laptop on power, no sleep
- **12:00 code freeze** + submit on ehl.gg · Live Final: `uv run arena run --set final --agent orchestra --parallel 10` (orchestra is the default agent)
- 13:00 top-10 pitch · 14:30 track winners · 15:30 Grand Final · 16:30 awards

## Practice budget
| Block | Sessions | Purpose |
|---|---|---|
| Sat afternoon | ~60 | baseline on all 10 hosted cases, then targeted experiments |
| Sat evening | ~80 | iterate on the weakest case types |
| Sun morning | ~50 | regression run of the final setup, rehearsal at --parallel 10 |
