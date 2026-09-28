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
        before = None if stored is None else _window_from_json(str(stored))
        allowed, window = consume(
            before, time.time(), rule["limit"], rule["period"], rule["request_id"]
        )
        if window != before:
            # Rejections and retried requests change nothing, so they cost no writes.
            await self.ctx.storage.put(_WINDOW_KEY, json.dumps(asdict(window)))
            # Forget the client once its window is over, so storage does not grow per IP.
            await self.ctx.storage.setAlarm(math.ceil((window.started_at + rule["period"]) * 1000))
        return Response.json({"allowed": allowed})

    async def alarm(self, *_: Any) -> None:
        await self.ctx.storage.deleteAll()


def _window_from_json(data: str) -> Window | None:
    raw = json.loads(data)
    if "request_ids" not in raw:
        # A window stored by the previous version expires within a minute; start afresh.
        return None
    return Window(started_at=raw["started_at"], request_ids=tuple(raw["request_ids"]))
