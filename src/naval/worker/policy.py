import re

from naval.rooms.codes import is_valid_room_code

_ORIGIN = re.compile(r"^(https://[a-z0-9.-]+|http://localhost:\d{1,5})$")
_WS_PATH = re.compile(r"^/api/rooms/([A-Z0-9]{6})/ws$")


class MissingConfig(Exception):
    pass


def parse_allowed_origins(raw: str | None) -> frozenset[str]:
    """Fails instead of falling back to a permissive default (baseline control 1)."""
    origins = frozenset(o.strip() for o in (raw or "").split(",") if o.strip())
    if not origins:
        raise MissingConfig("ALLOWED_ORIGINS is not set")
    invalid = sorted(o for o in origins if not _ORIGIN.fullmatch(o))
    if invalid:
        raise MissingConfig(f"ALLOWED_ORIGINS contains invalid origins: {invalid}")
    return origins


def is_origin_allowed(origin: str | None, allowed: frozenset[str]) -> bool:
    return origin is not None and origin in allowed


def parse_ws_path(path: str) -> str | None:
    match = _WS_PATH.fullmatch(path)
    if match is None or not is_valid_room_code(match.group(1)):
        return None
    return match.group(1)
