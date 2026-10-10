---
date: 2026-10-10
tags: [report, sandbox, hybrid]
---
# Head to head on the sandbox: Tugra's engine vs our orchestra (D01, D02)

**Setup.** Hosted sandbox (free, no practice quota), 3 runs per agent and case, all 12 sessions started together
(17:05-17:10).
- **hybrid** = the new `--agent hybrid`. Both sandbox cases go to **Tugra's engine, algorithm A3**
  (`starter-kit/proto/`, merged from branch `tugra`), played through our runner. That gives one session per case,
  our event log and dashboard, and the wave cap.
- **orchestra** = our agent on `arda` (engine curve, floor target, holds, mirroring, LLM writer).

## Result

| Agent | D01 (price increase) | D02 (RFQ) | Mean |
|---|---|---|---|
| **Tugra's engine A3, through `--agent hybrid`** | **0.979** (0.979 / 0.979 / 0.979) | **0.740** (0.740 / 0.740 / 0.740) | **85.9** |
| Our orchestra | 0.964 (0.969 / 0.977 / 0.947) | 0.650 (0.608 / 0.671 / 0.671) | 80.7 |
| *Reference: Tugra's own runs of A3* | 0.979 | 0.728 (0.740 / 0.740 / 0.703) | 85.4 |
| *Reference: Tugra's new `proto/final.py` rehearsal (A4, uncommitted, another session)* | 0.973 (6 runs, 0.89-1.00) | 0.684 (8 runs, 0.66-0.70) | ~83 |

**Deals**

| Case | Tugra's engine | Our orchestra |
|---|---|---|
| D01 | F1 €49.50, 30 days, 35 days lead, FCA, 24 months, from Dec 2026 | F1 €49.70-50.00, same terms, from Apr 2027 |
| D02 | J1 **€14.12**, **14 days** payment, **28 days** lead, DAP | J1 €14.50-14.80, 30 days, 35 days lead, DAP |

## What it shows
1. **Tugra's engine runs unchanged through our runner:** the same scores as his own runs.
2. **The gap is D02 (+0.09), i.e. the staggered RFQ opening.** His engine e-mails only the cheapest quote first
   (C1, €16.00). It then opens J1 citing C1's fresh offer ID (`offer:DEMO-C1-1`), and J1 drops €17.10 → €15.20 in one
   step. J1 then agrees to our second ask, €14.12. That's the whole case in 4 messages and 4 seconds. Our orchestra
   writes to both at once with no rival information, asks €13.19, and J1 crawls to a final offer of €14.50-14.80 over
   8-11 messages.
3. **The sandbox gives the same answer to the same e-mail.** Tugra's three runs got identical supplier replies,
   each within 1 s, so they count as one sample, not three. Our LLM-written e-mails differ every time, get fresh
   replies (20-40 s each) and real spread (0.61-0.67). Replies in the final will not be cached, so treat the 0.74 as
   one draw.

## Found on the way
- **The engine's RFQ loop can wait forever.** If every supplier has made a final offer and each is dearer than our
  alternative, `run_rfq` keeps waiting instead of walking away. Seen in arena-sim D02: both finals were above the
  alternative's €238,800, and it waited 7 minutes. In the final, the wave cap ends it, so it costs only time.
  `--agent hybrid` now always gives the engine an 8-minute cap. **For Tugra:** in `decide()`, walk when all live
  threads are final and no offer beats the alternative.
- **The 10-open-session limit.** The rehearsal of `proto/final.py` lost 2 D02 cases to `429: at most 10 open sessions
  per key` (no retry). Our `play_waves` does not retry either. Before the final: both runners must retry until the
  cap, and nobody may hold sessions on our key during the final. When this test started, all 10 slots were held by
  a teammate's sandbox runs from another machine.

## Evening update (19:00): A9 merged, bug #9 fixed, A9h is the hybrid's engine

- `origin/tugra` (A6, A8, A9) is merged into `arda` (`ddd9b13`). A9 played all 10 practice cases at 18:15: mean
  0.688, board 72.7 (#3); it won or tied every type against the orchestra, so **the hybrid now plays the engine for
  every case** (`HYBRID_ENGINE_TYPES=none` gives it back to the orchestra).
- **Bug #9 had three causes**, all fixed on `arda` ([[Progress/Bugs]]): a reply's attachments were downloaded and
  parsed before the engine saw the reply (17-21 s per quote PDF under load); a best final offer rested up to 90 s
  while a rival was still open; the accept call itself took 12 s. Now: attachments in the background, the reply
  acted on at HTTP return, a final offer accepted at once (at most 15 s grace for a rival's reply already in flight).
  Verified on fresh sandbox replies: reply-to-engine gap 0.0 s, accept 0.0 s after a final/agreed offer, 0 failed
  accepts (6 sessions).
- **A9's RFQ settings lose on fresh replies.** Tugra's D02 search (1 package, −8 % first ask, 3 pushes of 3 %) was
  run on cached sandbox replies ("0.765 ×4 identical"). With fresh replies, 3 runs each:

| Engine, D02 fresh replies | Scores | Mean |
|---|---|---|
| A3 (5 runs) | 0.66-0.70 | 0.691 |
| A9 (the search settings) | 0.51 / 0.60 / 0.58 | 0.563 |
| **A9h = A9 with A6's RFQ play** | 0.68 / 0.68 / 0.72 | **0.694** |

  D01 is unaffected (A9 0.98 / 0.98 / 0.93). **The hybrid's default is A9h** (`proto/variants.py`). Tell Tugra:
  his A9/`final.py` would play the search settings in the final.
- The worktree `.claude/worktrees/tugra` holds another session's uncommitted "R4" engine (A3 + re-implemented
  fixes + RFQ fact allocation + a package on the supplier's own levers; sandbox D02 ~0.79 fresh, never on
  practice). It conflicts with A9 in the same files. Its two RFQ ideas are not in A9h: worth porting if time allows.

## Next
- Decide the final agent with Tugra: `--agent hybrid` (his engine for price increase, renewal, RFQ and bundle; ours
  for raw material, capacity and quality), or his `proto/final.py` everywhere.
- Then one practice session per case type (~7) on exactly that build.
- Logs: `logs/sandbox-hybrid-a3-*-1705.log`, `logs/sandbox-orch-h2h-*-1705.log`; event log variants `hybrid-a3` and
  `orch-h2h` (`scripts/compare_runs.py hybrid-a3 orch-h2h`).
