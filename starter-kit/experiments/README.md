# Experiments: test ideas on the sandbox

The hosted sandbox (`case:D01` price increase, `case:D02` RFQ, 3 demo suppliers) is free: no practice quota.
Try every new idea here first, keep what survives, and only then spend practice sessions on it.

```bash
cd starter-kit
uv run python experiments/run.py baseline -n 3                     # D01 + D02, 3 plays each
uv run python experiments/run.py sonnet gpt template -n 3 --parallel 4   # compare variants side by side
uv run python experiments/run.py --report                          # table of everything in results.jsonl
uv run python experiments/writer_bench.py opus sonnet haiku gpt    # same writer prompts through each model
```

## A variant
One JSON file in `variants/`. Its name is the file name. Editing a file gives it a new hash, so old and new results
stay apart in the report.

```js
{
  "note": "what this tests and why",
  "agent": "orchestra",                       // or "llm", "naive"
  "env": {"LLM_MODEL": "claude-sonnet-5-5"},  // LLM_PROVIDER, LLM_MODEL, LLM_EFFORT, LLM_REASONING_EFFORT, ARENA_NARRATOR=template, ...
  "goals": {"leverage": {"anchor": 0.15, "e": 0.2}, "*": {"min_margin": 0.03}},  // patches analysis.GOALS ("*" = all)
  "rounds": 6                                 // orchestra's planned rounds
}
```

Variants that differ only in the model settings (`LLM_*`, `ARENA_NARRATOR`) are played **interleaved, in random
order**, so every variant meets the same suppliers at the same time. Goal patches and other env vars apply to the
whole process, so those variants run one after another.

A bigger idea (a new prompt, a new module) goes in a branch. Point a variant at it with an env flag your code reads.
Then the same runner compares it with `baseline`.

## Rules
- **Sandbox only.** `run.py` refuses other cases. Practice costs the team's quota: `arena run --practice`, and ask first.
- **The 10 open sessions per key are shared with the team.** Keep `--parallel` at 2–4; the runner waits when the
  arena says the sessions are in use.
- **The suppliers are noisy.** One play proves nothing. Use `-n 3` or more, and look at `sd` and `zeros`, not only the
  mean.
- **The sandbox is 2 cases and 3 suppliers.** Use it to catch bad ideas (timeouts, zeros, broken must-haves), not to
  fine-tune numbers. Tuning against it overfits by design: see `vault/Team-Knowledge/Decisions/0003 Generalise, don't overfit.md`.
- A play ended by something outside the agent (e.g. a walk-away it never sent) goes into `excluded.json` with the
  reason, and is played again.
- Write what you learned into `vault/Progress/Testing.md` (one row per idea), with the variant name and hash.

## Results so far
- 2026-10-10, writer model: Sonnet 5.5, gpt-6.1-sol, Opus 5.5, Haiku 5.5 and the template all score within 0.03 per
  case. The numbers decide, not the prose. Sonnet is the fastest. See `vault/Team-Knowledge/Decisions/0005 Writer model.md`.

## Files
- `run.py`: the runner and `--report` (score, deals, rounds, and per variant the writer's latency, failures, words).
- `writer_bench.py`: replays real writer prompts captured by `run.py` through several models. It checks
  latency and the writer's rules (JSON, ≤140 words, arguments verbatim, no invented figures or IDs, no leaks).
- `variants/`: one JSON per idea: `baseline` (as `.env` says), `template` (no LLM), `opus`, `sonnet`, `haiku`,
  `gpt`, `firm` (harder anchor).
- `results.jsonl`: one line per case played, committed so the team shares the history.
- `excluded.json`: plays not to score, with the reason.
- `out/`: our own event log, observations, every LLM call (`llm_calls.jsonl`) and the bench rows; git-ignored.
