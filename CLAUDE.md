# ehl-tacto

Team of 4 at the EHL Grand Finale (Munich, 10-11 Oct 2026), Tacto track: an AI buyer agent that negotiates
by e-mail with hosted supplier bots on https://arena.tacto.ai. Forked from
[tacto-ai/negotiation-arena-kit](https://github.com/tacto-ai/negotiation-arena-kit) (`upstream` remote).

**Live Final: Sun 11 Oct 12:00, code freeze at the same moment.** No human in the loop; the agent must
not read `/v1/events`, `/screen`, `/leaderboard`, `/results` during the final.

## Shared knowledge: `vault/` (Obsidian)
Start every task by reading `vault/Home.md` and `vault/Plan/Board.md`. Write what you learn back:
- learnings that transfer to new suppliers → `vault/Playbook/` (`agent: true` notes go into the buyer agent's prompt - keep them short)
- observations about one supplier → its note in `vault/Suppliers/`, under `## Team notes`
- what a practice run showed → the `## Team notes` of its note in `vault/Runs/`
- decisions → `vault/Decisions/` (template in `vault/Templates/`)
- move your Board card when you start or finish a task
Generated notes (`Suppliers/`, `Cases/`, `Runs/`) are rewritten by `uv run arena vault …`; only `## Team notes` sections survive.
`vault/Source/` symlinks the raw data and the brief - read, never edit.

## Layout
- `brief/` the challenge: `brief.md` (rules, score), `api.md` (API, cost formula), `submission.md`
- `data/` data package v1 (CSV, `world.sqlite`, `facts.json`, contracts, correspondence)
- `starter-kit/` Python package `arena_kit` (uv, Python 3.12): client, `play.py` runner, `cost.py` (C), `agents/llm.py`, `vault.py`
- `vault/` the Obsidian vault

## Commands (from `starter-kit/`)
```bash
uv sync --all-extras
uv run arena me                                   # key works? practice quota
uv run arena play case:P01 --agent llm -v         # one practice case → note in vault/Runs
uv run arena run --set practice --agent llm --parallel 8
uv run arena vault suppliers|cases|runs           # regenerate vault notes
uv run arena data                                 # data package (+ Sunday release from Sun 08:00)
uv run pytest && uv run ruff check .
```
Local simulator (no quota): `uv run arena-sim serve --no-clock --data data/package`.

## Rules
- Secrets only in the root `.env` (git-ignored): `CLAUDE_API_KEY` (aliased to `ANTHROPIC_API_KEY`), `ARENA_API_KEY`. Never commit or print them.
- Practice quota: 200 sessions per rolling 24 h for the whole team. Ask before running a whole practice set.
- Numbers come from code, the model writes. Never cite a data ID that is not in `facts.json`.
- 60 s per message per thread; the 8-minute wave cap in the final. Keep LLM calls fast.
