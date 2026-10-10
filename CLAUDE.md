# ehl-tacto

Team of 4 at the EHL Grand Finale (Munich, 10-11 Oct 2026), Tacto track: an AI buyer agent that negotiates
by e-mail with hosted supplier bots on https://arena.tacto.ai. Forked from
[tacto-ai/negotiation-arena-kit](https://github.com/tacto-ai/negotiation-arena-kit) (`upstream` remote).

**Live Final: Sun 11 Oct 12:00, code freeze at the same moment.** No human in the loop; the agent must
not read `/v1/events`, `/screen`, `/leaderboard`, `/results` during the final.

## Shared knowledge: `vault/` (RxV00's Obsidian vault; our notes live in `vault/Team-Knowledge/`)
Start every task by reading `vault/Team-Knowledge/Home.md` and `vault/Team-Knowledge/Plan/Board.md`. Write what you learn back:
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

# free - use these for development
uv run arena play case:D01 --agent orchestra -v         # hosted sandbox: real-style suppliers, no quota
uv run arena run --set sandbox --agent orchestra        # both sandbox cases (D01 price increase, D02 RFQ)
uv run arena run --set sandbox --agent hybrid           # Tugra's engine (proto/) for price/renewal/RFQ/bundle cases, orchestra for the rest
ENGINE_WRITER=llm uv run arena run --set sandbox --agent hybrid   # the engine's e-mails rewritten by LLM_MODEL (template on any rule break)
../scripts/sim.sh play case:P05 --agent orchestra -v    # local arena-sim, any case P01-P19/D01/D02, scripted supplier
../scripts/sim.sh run --set practice --parallel 10   # every case locally (plumbing, timing)
../scripts/sim.sh stop

# costs practice sessions (200/24 h for the whole team) - needs --practice
uv run arena play case:P01 --agent orchestra -v --practice
uv run arena run --set practice --agent orchestra --parallel 8 --practice

# the Live Final (start before 12:00, leave it running; orchestra is also the default agent)
uv run arena run --set final --agent orchestra --parallel 10 -v > ../logs/final.log 2>&1

uv run arena dashboard                            # live view of every play/run: http://127.0.0.1:8765 (logs/events.jsonl)
uv run arena vault suppliers|cases|runs           # regenerate vault notes
uv run arena cases --save cases                   # refresh the saved case files arena-sim loads
uv run arena data                                 # data package (+ Sunday release from Sun 08:00)
uv run pytest && uv run ruff check .
```
The sandbox has 3 demo suppliers, not the practice ones. arena-sim's supplier is a plain script (opens +10 %,
concedes 2 % per term sheet): good for plumbing and timing, says nothing about real supplier behaviour.

## Rules
- Secrets only in the root `.env` (git-ignored): `CLAUDE_API_KEY` (aliased to `ANTHROPIC_API_KEY`), `ARENA_API_KEY`. Never commit or print them.
- Practice quota: 200 sessions per rolling 24 h for the whole team. Ask before running a whole practice set.
- Numbers come from code, the model writes. Never cite a data ID that is not in `facts.json`.
- 60 s per message per thread; the 8-minute wave cap in the final. Keep LLM calls fast.
