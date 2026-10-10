# Testing

| Feature | Tested by | Date | Result | Notes |
|---------|-----------|------|--------|-------|
| Sandbox runner `experiments/run.py`, variant `template` (orchestra, no LLM) | Claude | 2026-10-10 | ✅ | D01 0.83 · D02 0.38 (1 play each: plumbing check, not a benchmark) |
| Profile builder, `tests/test_profiles.py` (dossier, cache, invented IDs dropped) | Claude | 2026-10-10 | ✅ | 4 tests pass; a real Opus profile of sup:70110 matched the P01 letter and notes |
| Writer model race on the sandbox: Sonnet / GPT-6.1-sol / Opus / Haiku / template, 3 plays per case | Claude | 2026-10-10 | ✅ | All within 0.03 per case (D01 0.81–0.84, D02 0.36–0.38): the writer does not move the score. Sonnet fastest (p95 4.6 s). [[0005 Writer model]] |
| Writer bench: the same 20 real prompts through 4 models (`experiments/writer_bench.py`) | Claude | 2026-10-10 | ✅ | All keep every hard rule; over 140 words: GPT 0 %, Opus 25 %, Sonnet 45 %, Haiku 65 % |
| `DataPackage.query` under 10 threads (one shared SQLite connection) | Claude | 2026-10-10 | ✅ | Before the lock: 32 of 600 queries failed (and `analysis._q` hid it as `[]`); after: 0 |
| GPT through the kit (`LLM_PROVIDER=openai`, `LLM_REASONING_EFFORT`, `OPENAI_API_KEY` fallback) | Claude | 2026-10-10 | ✅ | gpt-6.1-sol played 6 sandbox cases, 0 failed calls |
| Orchestra on arena-sim, all 24 cases (template writer), after each change | Claude (Arda) | 2026-10-10 | ✅ | plumbing only: no crash, every case closes (sim supplier is a script) |
| Profile hook dry run: tactics + first MESO sheets for the 10 hosted cases (no arena) | Claude (Arda) | 2026-10-10 | ✅ | sensible per type (cash-short → 14-day payment trade, hungry → 36 months); P10 anchor capped |
| Practice A/B batch 1: orchestra + profiles vs none, all 10 cases (11 sessions) | Claude (Arda) | 2026-10-10 | ❌ | P02/P03 crashed (partial quote terms), P05 accepted an opening at r0, 7 cases blocked by the 10-open-session limit. Fixed `dce12e5`. [[Report 2026-10-10 - profile hook and practice A-B]] |
| Practice A/B batch 2: 8 cases × 2 arms (16 sessions) | Claude (Arda) | 2026-10-10 | ✅ | profiles 51.9 vs none 51.0 on these 8; over all 10: 58.0 vs 56.8 - no measurable gain; P02 none-arm 0 (deal above opening, fixed `3d78de2`). [[Report 2026-10-10 - profile hook and practice A-B]] |
| Sandbox checks after fixes (D01, D02) | Claude (Arda) | 2026-10-10 | ✅ | D01 0.77, D02 0.46 / 0.40 - no walk-aways, RFQ hold logic works |
| Practice validation of `3d78de2` on P02, P05, P18 (3 sessions) | Claude (Arda) | 2026-10-10 | ✅ | P02 0.16 → 0.18, P05 0.29 → 0.41, P18 0.39 → 0.32 (went final at r3). Board 60.1, #2, 10/10 deals |

Result: ✅ pass · ❌ fail · ⏳ not yet
