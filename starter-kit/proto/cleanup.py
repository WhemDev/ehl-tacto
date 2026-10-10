"""Walk away from sessions OUR search opened and never finished (e.g. after a kill).
Never touches any other session on the team key."""
import sys
from pathlib import Path

from arena_kit import ArenaClient
from arena_kit.cli import load_env

d = Path(sys.argv[1] if len(sys.argv) > 1 else "proto/runs/search")
opened = set((d / "opened.txt").read_text().split()) if (d / "opened.txt").exists() else set()
closed = set((d / "closed.txt").read_text().split()) if (d / "closed.txt").exists() else set()
load_env()
c = ArenaClient()
for sid in sorted(opened - closed):
    st = c.session(sid)
    if st.get("status") == "ended":
        continue
    c.send_message(sid, list(st["threads"])[0], {"action": {"type": "walk_away"}})
    print("closed our session", sid)
