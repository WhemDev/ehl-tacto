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

**Addendum 2026-10-10 18:30: Sonnet on Tugra's engine.** The base agent is now Tugra's engine (A3), which writes
template e-mails only. `ENGINE_WRITER=llm` lets `claude-sonnet-5-5` (effort low) rewrite the engine's words
(`agents/engine_writer.py`).
- **Guards:** every sentence with a data ID stays verbatim; no figure that is not already in the draft, our sheets or
  the supplier's e-mail; signature; ≤ 220 words. Any break, a timeout (15 s) or an API error sends the template.
- **Control:** the template with a subject tag (`ENGINE_WRITER=vary`). The sandbox answers an identical e-mail
  identically and at once, so the plain template is a single cached draw, not a mean.
- **Setup:** 5 runs per variant and case, interleaved, 18:12-18:27.

| Engine writer | D01 | D02 | Mean |
|---|---|---|---|
| Template, fresh replies (`vary`) | 0.976 (0.969-0.987) | 0.691 (0.661-0.703) | **83.3** |
| Sonnet 5.5 (`llm`) | 0.959 (0.943-0.982) | 0.642 (0.417-0.724); 0.698 without the 0.417 | 80.0 (82.8 without it) |
| Template, cached (plain A3) | 0.979 | 0.740 | 85.9 (one draw) |

- **No gain from the model.**
  - D01: Sonnet deals landed €0.20-0.30 higher in 3 of 5 runs (€49.8-49.9 vs €49.5-49.6).
  - D02: equal once the one bad run is removed. That run was not the wording: the engine's RFQ accept bug lost a
    €13.90 final offer, see [[Progress/Bugs]] #9.
  - Cost: +3.1 s per e-mail (median, 95th pct. 4.7 s), one more API that can fail. 1 of 61 rewrites fell back to the template (it changed a sentence with a data ID).
- **The engine's real D02 is ~0.69, not 0.74.** The cached 0.740 was a lucky draw. Once replies are fresh, the
  template lands at 0.66-0.70.
- **Decision:** the engine keeps its templates. `ENGINE_WRITER=llm` stays available (off by default) for a practice
  A/B, if the team wants to check whether real suppliers reward wording (2-3 cases × 2 = 4-6 sessions, ask first).

**Addendum 2026-10-10 19:40: on the real practice suppliers.** Two fresh passes of the final build (A9h with 3
holds), all 10 cases at once, identical except for the writer: templates 0.721, Sonnet 5.5 rewriting 0.726. Per
case the writer moved P04 +0.05, P07 +0.01, P05 −0.02: parity within the noise (±0.05 per case), 40 rewrites at
2.4 s median, 0 fallbacks. So LLM wording costs nothing on real suppliers either, and may help a little; the
engine's numbers decide. A style search (`scripts/evolve_style.py`, ENGINE_STYLE) can only resolve effects larger
than that noise - its generation 0 (3 tones × 10 cases, 30 sessions) confirmed it: warm 0.721, brief 0.719,
collaborative 0.699 (the open "what would make it work for you?" invites "commit more volume"). **Decision
(19:50): the LLM writer is the default (`ENGINE_WRITER=llm`, plain prompt, template fallback); no further
language search.** `ENGINE_WRITER=template` switches it off.

**Follow-ups.**
- Set `LLM_MODEL=claude-sonnet-5-5` in the final machine's `starter-kit/.env`. Today it says `claude-opus-5-5`.
- Ask the writer for structured output (`output_config.format`) so a non-JSON answer can't happen.
- Fix the writer timeout that never fires: see [[Progress/Bugs]].
