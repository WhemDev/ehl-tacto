---
tags: [home]
---
# Tacto Negotiation Arena · Team Home

> Build an AI buyer agent that negotiates by e-mail with industrial supplier bots, gets the best total deal and can explain how it got there.

**Now:** [[Board]] · **Plan:** [[Timeline]] · **What the agent reads:** [[Playbook/README|Playbook]] · **Brief:** [[Source/Brief/brief|brief]] · [[Source/Brief/api|API]] · [[Source/Brief/submission|submission]]

## Team
| Who | Role | Owns |
|---|---|---|
| _name_ | Supplier research | `Suppliers/`, pre-case dossier, citable claims |
| _name_ | Deal maths | cost model, C_best estimate, term-sheet optimiser, accept/walk rules |
| _name_ | Agent and runner | prompts, e-mail writing, timing, parallel runner, final setup |
| _name_ | Practice and pitch | practice plan, replay mining → `Runs/` + `Playbook/`, README, slides |

## Deadlines
- **Sun 08:00** Sunday data release → `uv run arena data`, then `uv run arena vault suppliers`
- **Sun 09:00** pre-flight: one practice case through the final setup
- **Sun 11:30** final checklist ([[Source/Brief/submission|submission]])
- **Sun 12:00** code freeze + ehl.gg submission (repo, commit hash, description, slides) · Live Final starts
- **Sun 13:00** top-10 pitch (5 min + 2 min Q&A)

## Practice: best score per case
```dataview
TABLE WITHOUT ID case AS "Case", max(rows.score) AS "Best", length(rows) AS "Runs", max(rows.file.ctime) AS "Last"
FROM "Runs" WHERE set = "practice"
GROUP BY case SORT case ASC
```

## Latest runs
```dataview
TABLE case, score, deal, supplier, rounds, agent, commit
FROM "Runs" SORT file.ctime DESC LIMIT 15
```

## How the vault works
- **Lives in git** (`vault/` in [WhemDev/ehl-tacto](https://github.com/WhemDev/ehl-tacto)). Obsidian Git pulls and pushes it; Claude Code and other agents read and write the same files.
- **Generated notes** (`Suppliers/`, `Cases/`, `Runs/`) are rewritten by `uv run arena vault …`. Everything under `## Team notes` survives regeneration: write there.
- **The buyer agent reads** every `Playbook/` note with `agent: true` and the `## Team notes` of each supplier in its case. Edit those and the next run behaves differently. Keep them short, they go into every prompt.
- `Source/` links the raw data (contracts, letters, notes) and the brief. Read-only.
