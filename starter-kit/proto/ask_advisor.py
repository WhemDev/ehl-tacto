"""Ask an OpenAI model for optimisation advice: sends proto/advisor_briefing.md, saves the answer.

    PYTHONPATH=. uv run python proto/ask_advisor.py [model] [effort]     # default gpt-6.1-sol, xhigh

The key is read from OPENAI_API_KEY (starter-kit/.env, git-ignored). Nothing else from .env is sent.
"""

import json
import os
import sys
import time
from pathlib import Path

import httpx

from arena_kit.cli import load_env

MODEL = sys.argv[1] if len(sys.argv) > 1 else "gpt-6.1-sol"
EFFORT = sys.argv[2] if len(sys.argv) > 2 else "xhigh"
OUT = Path("proto/runs/advisor")


def main():
    load_env()
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        sys.exit("OPENAI_API_KEY missing in .env")
    briefing = Path("proto/advisor_briefing.md").read_text()
    body = {"model": MODEL, "reasoning": {"effort": EFFORT}, "input": briefing}
    t0 = time.time()
    r = httpx.post("https://api.openai.com/v1/responses", json=body, timeout=1800,
                   headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    dt = time.time() - t0
    OUT.mkdir(parents=True, exist_ok=True)
    if r.status_code != 200:
        print(f"HTTP {r.status_code} after {dt:.0f}s: {r.text[:1500]}")
        sys.exit(1)
    data = r.json()
    text = data.get("output_text") or "\n".join(
        c.get("text", "") for item in data.get("output", []) if item.get("type") == "message"
        for c in item.get("content", []) if c.get("type") in ("output_text", "text"))
    stamp = time.strftime("%Y%m%d-%H%M%S")
    (OUT / f"advice-{MODEL}-{EFFORT}-{stamp}.md").write_text(text)
    (OUT / f"advice-{MODEL}-{EFFORT}-{stamp}.json").write_text(json.dumps(
        {"model": data.get("model"), "usage": data.get("usage"), "seconds": round(dt)}, indent=1))
    print(f"model {data.get('model')} · {dt:.0f}s · usage {data.get('usage')}")
    print(f"saved {OUT}/advice-{MODEL}-{EFFORT}-{stamp}.md")


if __name__ == "__main__":
    main()
