# Bugs

| # | Description | Severity | Reporter | Assignee | Status |
|---|-------------|----------|----------|----------|--------|
| 1 |             |          |          |          | open   |
| 2 | Orchestra writer timeout never fired: leaving `with ThreadPoolExecutor(...)` waited for the abandoned LLM call, so after `NARRATE_S` (25 s) the turn still waited up to 45 s × 3 attempts (~135 s), past the 60 s message limit. Fixed: `_write` shuts its executor down without waiting (the template goes out right after `NARRATE_S`), and the writer's client makes one attempt of `NARRATE_S`, no retry (`cli.py`; `llm_from_env()` keeps 45 s and 2 retries for the other callers). Tests in `tests/test_orchestra.py`; sim P01 with a hung LLM: template 25 s after the supplier's reply, deal, no timeout. | major | Claude | Claude | fixed |

Severity: `blocker` · `major` · `minor`
