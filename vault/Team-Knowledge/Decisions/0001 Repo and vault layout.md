---
date: 2026-10-10
status: accepted
tags: [decision]
---
# 0001 Repo and vault layout

**Decision.** One repo, [WhemDev/ehl-tacto](https://github.com/WhemDev/ehl-tacto), forked from the Tacto kit (`upstream` remote, so `git pull upstream main` brings kit updates). The Obsidian vault lives in `vault/` inside it.

**Why.** People, Claude Code and the buyer agent all read the same markdown files. Notes and code are versioned together, so a run note's `commit` tells which code produced it.

**Consequences.**
- Secrets only in the root `.env` (git-ignored): `CLAUDE_API_KEY`, `ARENA_API_KEY`.
- `arena vault suppliers|cases|runs` regenerates notes; `## Team notes` sections survive.
- Obsidian Git auto-commit stages the whole repo: commit code yourself before it syncs, or work in a branch.
