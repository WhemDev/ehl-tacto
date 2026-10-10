---
date: 2026-10-10
status: proposed
tags: [decision, agent, llm]
---
# 0005 Writer model: Sonnet 5.5 writes, GPT as fallback, Opus builds profiles offline

**Question.** Which LLM should do the orchestra's one LLM job, writing the e-mail around numbers the code has
already chosen? Candidates: Claude Opus 5.5, Sonnet 5.5, Haiku 5.5, and OpenAI `gpt-6.1-sol` (the newest GPT
flagship on our key). Sandbox only, no practice quota.

**Test 1: hosted sandbox race** (`starter-kit/experiments/`, 2026-10-10)
- 5 writers × D01/D02 × 3 plays, played in random interleaved order, 4 at a time.
- Effort low for Claude, reasoning effort low for GPT. The control is `template` (no LLM).
- Two plays ended by a walk-away our agent never sent; they are excluded (`experiments/excluded.json`) and were
  replayed.

| Writer | mean | D01 | D02 | median / 95th pct. latency | avg words | failed answers |
|---|---|---|---|---|---|---|
| Sonnet 5.5 | 0.61 | 0.84 | 0.38 | **3.9 s / 4.6 s** | 134 | 1 of 27 (not JSON → template) |
| gpt-6.1-sol | 0.60 | 0.83 | 0.36 | 5.2 / 7.8 | 119 | 0 |
| template (no LLM) | 0.60 | 0.81 | 0.38 | – | – | – |
| Opus 5.5 | 0.59 | 0.82 | 0.37 | 5.2 / 7.0 | 137 | 0 |
| Haiku 5.5 | 0.59 | 0.81 | 0.36 | 5.8 / 7.7 | 142 | 0 |

**Test 2: the same 20 real writer prompts replayed through each model** (`experiments/writer_bench.py`).
All four kept every hard rule in 100 % of answers: valid JSON, every argument verbatim, no invented figure or
data ID, no leak, a question, the signature. Over the 140-word limit: GPT 0 %, Opus 25 %, Sonnet 45 %,
Haiku 65 %. Median latency: Sonnet 3.3 s, Opus 4.9 s, Haiku 5.6 s, GPT 5.8 s.

**Finding.** On the sandbox, the writer model does not move the score. Every writer, including the no-LLM template,
lands within 0.03 per case. The code's numbers decide the deal: D02 sits at ~0.37 whoever writes. The score lever
is the strategy (anchors, concessions, trades), not the prose.

**Decision (proposed).**
- **Writer: `claude-sonnet-5-5`, effort low.** Same score, the fastest and steadiest latency (95th pct. 4.6 s),
  which leaves more of each 60-second turn and of the 8-minute wave for rounds.
- **Fallback: `gpt-6.1-sol`, reasoning effort low**, on a 429 or timeout from Anthropic. It never broke JSON and keeps to the word
  limit. Wiring: `LLM_PROVIDER=openai`, `LLM_MODEL=gpt-6.1-sol`, `LLM_REASONING_EFFORT=low`; the key comes from
  `OPENAI_API_KEY` (`agents/llm.py` now supports both).
- **Opus 5.5 stays for offline work**: supplier profiles (`arena_kit/profiles.py`), where depth matters and time
  does not.
- **Not Haiku**: not faster than Sonnet here, and the longest e-mails.

**Caveats.**
- The sandbox's 3 demo suppliers may weigh wording less than the hidden suppliers. The brief says suppliers react
  to tone and relationship.
- Test 1 has only 3 plays per cell.
- If the team wants to check wording on real suppliers, an A/B of Sonnet vs template on 2–3 hosted practice cases
  would cost ~6 sessions. Ask first.

**Follow-ups.**
- Set `LLM_MODEL=claude-sonnet-5-5` in the final machine's `starter-kit/.env`. Today it says `claude-opus-5-5`.
- Ask the writer for structured output (`output_config.format`) so a non-JSON answer can't happen.
- Fix the writer timeout that never fires: see [[Progress/Bugs]].
