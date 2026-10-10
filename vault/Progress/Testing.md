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
| Final timing: margin by slowest round, round budget, watchdog (unit + sim e2e) | Claude (Arda) | 2026-10-10 | ✅ | `358a010`; a case 30 s from the cap closes at once; watchdog takes the best non-pending offer |
| Sandbox, 2 plays/case: engine curve + ported messages vs old curve | Claude (Arda) | 2026-10-10 | ✅ | engine2 D01 0.97 / D02 0.64 (80.6) · boulware2 0.83 / 0.52 (67.7) · before 58-61. [[0006 Learn from the engine]] |
| Sandbox: small-steps concession (my own idea) | Claude (Arda) | 2026-10-10 | ❌ | D01 0.75 (vs 0.77), D02 0.40/0.46 - no gain; replaced by the engine's early concession |
| `--agent hybrid` on arena-sim (P01 P05 P07 P08 P10 D02) + `tests/test_hybrid.py` | Claude (Arda) | 2026-10-10 | ✅ | routes by case type, one session per case; found the engine's RFQ wait when every final is dearer than the alternative (now capped at 8 min) |
| Sandbox head to head, 3 runs/case: Tugra's A3 via `--agent hybrid` vs orchestra | Claude (Arda) | 2026-10-10 | ✅ | hybrid D01 0.979, D02 0.740 (85.9, identical replies each run) · orchestra D01 0.964, D02 0.650 (80.7). [[Report 2026-10-10 - hybrid head to head on D01 D02]] |
| Engine writer A/B, 5 runs/case: template (fresh replies) vs Sonnet 5.5 rewriting the engine's e-mails | Claude (Arda) | 2026-10-10 | ❌ | template 83.3 vs Sonnet 80.0 (82.8 without one run lost to the RFQ accept bug): no gain, +3.1 s per e-mail. Templates stay. [[0005 Writer model]] |
| Bug #9 fix (`tests/test_engine_clock.py` + sandbox, A9 via the hybrid, fresh replies, 3 runs/case) | Claude (Arda) | 2026-10-10 | ✅ | every reply reaches the engine 0.0 s after HTTP return (was 17-21 s per quote PDF); accept 0.0 s after a final/agreed offer; 0 failed accepts. D01 0.962 (0.98/0.98/0.93), D02 0.563 (0.51/0.60/0.58) |
| RFQ settings on fresh sandbox replies, D02 ×3 each: A9's D02-search settings vs A6's RFQ play (= `A9h`) | Claude (Arda) | 2026-10-10 | ✅ | A9 0.563 (0.51/0.60/0.58) · **A9h 0.694** (0.68/0.68/0.72) · A3 0.691 (5 runs). The search was done on cached replies. The hybrid plays A9h. |
| **Practice, all 10 hosted cases through `arena run --set practice --agent hybrid` (A9h + clock fixes, 5 at a time, 10 sessions)** | Claude (Arda) | 2026-10-10 19:04 | ✅ | mean **0.694**, 10/10 deals, 0 failed accepts, 0 warnings. 7 cases replayed Tugra's A9 run exactly (identical e-mails → cached replies in 0.2-0.7 s): P01 0.956, P02 0.360, P03 0.923, P04 0.810, P07 0.710, P10 0.671, P11 0.710. Fresh: **P08 0.603, P18 0.532 (new team bests)**, P05 0.665 (= best; replies 17-112 s, accept 0.1 s after the final offer). [[Runs]] `hybrid+a9h-practice` |
| arena-sim, all 24 case files through `--agent hybrid` (A9, every type) | Claude (Arda) | 2026-10-10 | ✅ | 24/24 closed, 0 crashes; sim D02 (both finals dearer than the alternative) no deal = the right outcome (0.934), but only at the cap: A9 still waits there (the worktree's R-engine walks at once) |

Result: ✅ pass · ❌ fail · ⏳ not yet
