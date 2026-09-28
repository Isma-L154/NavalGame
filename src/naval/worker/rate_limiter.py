import json
import math
import time
from dataclasses import asdict
from typing import Any

from workers import DurableObject, Response

from naval.limits.window import Window, consume

_WINDOW_KEY = "window"


class RateLimiter(DurableObject):
    """One instance per (scope, client): a strongly consistent fixed-window counter.

    Replaces the Workers Rate Limiting binding, which never rejected a request in production
    (see docs/security/audits/2026-09-28-baseline-audit.md).
    """

    async def fetch(self, request: Any) -> Response:
        rule = json.loads(await request.text())
        stored = await self.ctx.storage.get(_WINDOW_KEY)
        window = None if stored is None else Window(**json.loads(str(stored)))
        allowed, window = consume(window, time.time(), rule["limit"], rule["period"])
        if allowed:
            # Rejections change nothing, so a flood costs reads only, not writes.
            await self.ctx.storage.put(_WINDOW_KEY, json.dumps(asdict(window)))
            # Forget the client once its window is over, so storage does not grow per IP.
            await self.ctx.storage.setAlarm(math.ceil((window.started_at + rule["period"]) * 1000))
        return Response.json({"allowed": allowed})

    async def alarm(self, *_: Any) -> None:
        await self.ctx.storage.deleteAll()
