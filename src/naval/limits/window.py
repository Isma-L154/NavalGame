import hashlib
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Limit:
    scope: str
    limit: int
    period: float


ROOM_CREATION = Limit("room-creation", limit=10, period=60.0)
WS_UPGRADE = Limit("ws-upgrade", limit=30, period=60.0)


@dataclass(frozen=True, slots=True)
class Window:
    started_at: float
    count: int


def consume(window: Window | None, now: float, limit: int, period: float) -> tuple[bool, Window]:
    """Fixed-window counter: returns whether this request fits and the updated window."""
    if window is None or now - window.started_at >= period:
        window = Window(started_at=now, count=0)
    if window.count >= limit:
        return False, window
    return True, Window(started_at=window.started_at, count=window.count + 1)


def limiter_name(limit: Limit, client_ip: str) -> str:
    """Durable Object name for one client and scope; the IP itself is never stored."""
    return hashlib.sha256(f"{limit.scope}:{client_ip}".encode()).hexdigest()
