"""`arena dashboard`: a live view of the agent's negotiations, read from the local event log
(`logs/events.jsonl`, written by `play()` - see `events.py`). Open http://127.0.0.1:8765 and start
`arena play` / `arena run` in another terminal; every step shows up as it happens."""

import asyncio
import json
from pathlib import Path

from .events import PATH

PAGE = Path(__file__).with_name("dashboard.html")


def create_app(path=PATH):
    from fastapi import FastAPI, Request
    from fastapi.responses import HTMLResponse, StreamingResponse

    app = FastAPI(title="arena dashboard")
    log = Path(path)

    @app.get("/", response_class=HTMLResponse)
    def page():
        return PAGE.read_text(encoding="utf-8")

    @app.get("/stream")
    async def stream(request: Request, start: int = 0):
        """Server-sent events: every line of the log from line `start` on, then new lines as they come."""
        first = int(request.headers.get("last-event-id", start - 1)) + 1

        async def lines():
            n, pos, buf, idle = 0, 0, "", 0
            yield "retry: 1000\n\n"
            while not await request.is_disconnected():
                if log.is_file():
                    if log.stat().st_size < pos:  # the log was cleared: start over
                        n, pos, buf = 0, 0, ""
                        yield "event: reset\ndata: {}\n\n"
                    with open(log, encoding="utf-8") as f:
                        f.seek(pos)
                        buf += f.read()
                        pos = f.tell()
                    *done, buf = buf.split("\n")
                    for line in done:
                        if line.strip() and n >= first:
                            try:
                                json.loads(line)
                            except ValueError:
                                n += 1
                                continue
                            yield f"id: {n}\ndata: {line}\n\n"
                        n += 1
                idle = idle + 1 if idle < 30 else 0
                if not idle:
                    yield ": keep-alive\n\n"
                await asyncio.sleep(0.4)

        return StreamingResponse(lines(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    return app


def serve(port=8765, host="127.0.0.1", path=PATH):
    import uvicorn

    print(f"arena dashboard: http://{host}:{port}  (log: {path})", flush=True)
    uvicorn.run(create_app(path), host=host, port=port, log_level="warning")
