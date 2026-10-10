# Decisions

## 2026-10-10 – Writer model: Sonnet 5.5, GPT fallback, Opus offline
- **Decision (proposed):** the orchestra's e-mail writer runs on `claude-sonnet-5-5` (effort low), with `gpt-6.1-sol` (reasoning effort low) as fallback; Opus 5.5 builds the supplier profiles offline.
- **Why:** on the sandbox every writer, the no-LLM template included, scored within 0.03 per case: the numbers decide, not the prose. Sonnet is the fastest and steadiest (95th pct. 4.6 s).
- **Who:** proposed by Claude, needs the team's OK (and `LLM_MODEL` in the final machine's `.env`)
- Full note: [[0005 Writer model]]

## 2026-10-10 – Generalise, don't overfit
- **Decision:** Build supplier profiles for all 46 suppliers offline. Build a persona simulator from the profiles.
  Every variant passes sandbox → simulator → practice (top 2–3 only). Run evolutionary search only on the simulator,
  only over parameters.
- **Why:** Only 10 hosted practice cases plus 2 sandbox cases, while the final has ~50 hidden cases with new
  suppliers (likely the 24 data suppliers practice doesn't use). Hosted suppliers are noisy.
- **Who:** proposed by Claude for the team, needs the team's OK
- Full note: [[0003 Generalise, don't overfit]]

## YYYY-MM-DD – Title
- **Decision:**
- **Why:**
- **Who:**
