---
date: 2026-10-10
status: accepted
tags: [decision, final, agent]
---
# 0007 The final build: `arena run --set final --agent hybrid`

**Decided** (Arda, 2026-10-10 19:00-19:50). The Live Final runs on branch `arda` with our runner, not Tugra's
`proto/final.py`:

```bash
cd starter-kit && uv run arena run --set final --agent hybrid --parallel 10 -v > ../logs/final.log 2>&1
```

started before 12:00 and left running; `uv run arena dashboard` beside it. The commit hash at the freeze goes into
the ehl.gg submission (`git rev-parse HEAD` on the final machine).

**What it is**
- **Engine:** Tugra's deterministic engine (`starter-kit/proto/`), algorithm **A9h** (`proto/variants.py`): A9's
  generic rules (clause at our cheapest deadband, lead-time cap, cheaper orders elsewhere, falling drivers, answers,
  bottleneck anchor, never walk without an alternative, accept recovery) with **A6's RFQ play** (A9's RFQ-only search
  settings lose 0.13 on fresh sandbox D02) and **3 holds** while the supplier still gives ≥ 0.3 % a round.
- **Every case goes to the engine**; our orchestra is only the fallback if the engine cannot start on a case.
- **The e-mails:** the engine's template, rewritten by Sonnet 5.5 (`ENGINE_WRITER=llm`, the default): every data-ID
  sentence verbatim, no figure the code did not choose, the template on any failure or after 15 s.
- **Timing:** replies reach the engine at HTTP return (attachments load in the background); a best final or agreed
  offer is accepted at once (≤ 15 s grace for a rival's reply in flight); a case refused for the key's 10 open
  sessions is retried while the wave leaves ≥ 150 s; close `max(90 s, slowest round + 15 s)` before the cap.
- **Data:** `data/package` + `data/release-sunday` (merged by `DataPackage` once `uv run arena data` has unpacked
  Sunday's release).

**Evidence (practice, fresh replies, all 10 cases at once):** 0.692 → **0.721** (holds) → **0.726** (LLM writer);
60 practice sessions today, 60 deals, 0 failed accepts, every wave < 4 min. Sandbox D01 0.978, D02 0.710.
Records: P05 0.688, P08 0.607, P18 0.532 (ours), board 73.6 (#3). Details: [[Testing]],
[[Report 2026-10-10 - hybrid head to head on D01 D02]], [[Review 2026-10-10 - worst practice cases and upgrades]],
[[0005 Writer model]].

**Not changed after this** (overfitting guard): no rule is tuned to one practice case after 19:40; every rule fires
on a case feature (goal, type, a term the supplier insists on, a driver that fell), never on an ID. The last code
change before the final is the RFQ port from the R4 fork, if it passes the sandbox and P05.

**Sunday checklist**
- 08:00 `cd starter-kit && uv run arena data` → `data/release-sunday/` (merged automatically); `uv run pytest -q`.
- 09:00 pre-flight on the final machine: `uv run arena play case:P01 --agent hybrid --practice -v`.
- 11:30 `git pull`, `uv run pytest -q`, start the final command, open the dashboard; **nobody else on the key**.
- 11:55 submit on ehl.gg: repo, commit hash, description, slides.
