import json
from http import HTTPStatus
from typing import Any
from urllib.parse import urlparse

from workers import Response, WorkerEntrypoint

from naval.limits.window import ROOM_CREATION, WS_UPGRADE, Limit, limiter_name
from naval.rooms.codes import new_room_code
from naval.worker.headers import API_HEADERS
from naval.worker.policy import (
    MissingConfig,
    is_origin_allowed,
    parse_allowed_origins,
    parse_ws_path,
)

_CODE_ATTEMPTS = 5


def _json(body: dict[str, Any], status: HTTPStatus) -> Response:
    return Response.json(body, status=int(status), headers=dict(API_HEADERS))


def _error(code: str, status: HTTPStatus) -> Response:
    return _json({"error": code}, status)


class Default(WorkerEntrypoint):
    async def fetch(self, request: Any) -> Response:
        path = urlparse(request.url).path
        if path == "/api/health":
            return _json({"status": "ok"}, HTTPStatus.OK)
        try:
            allowed_origins = parse_allowed_origins(getattr(self.env, "ALLOWED_ORIGINS", None))
        except MissingConfig as error:
            print(f"configuration error: {error}")
            return _error("misconfigured", HTTPStatus.INTERNAL_SERVER_ERROR)
        if path == "/api/rooms":
            return await self._create_room(request, allowed_origins)
        code = parse_ws_path(path)
        if code is not None:
            return await self._open_room_socket(request, code, allowed_origins)
        return _error("not_found", HTTPStatus.NOT_FOUND)

    async def _create_room(self, request: Any, allowed_origins: frozenset[str]) -> Response:
        if request.method != "POST":
            return _error("method_not_allowed", HTTPStatus.METHOD_NOT_ALLOWED)
        rejection = await self._guard(request, allowed_origins, ROOM_CREATION)
        if rejection is not None:
            return rejection
        for _ in range(_CODE_ATTEMPTS):
            code = new_room_code()
            result = await self.env.GAME_ROOM.getByName(code).fetch(
                "https://room/init", method="POST", body=json.dumps({"code": code})
            )
            if result.status == HTTPStatus.CREATED:
                return _json({"code": code}, HTTPStatus.CREATED)
        return _error("try_again", HTTPStatus.SERVICE_UNAVAILABLE)

    async def _open_room_socket(
        self, request: Any, code: str, allowed_origins: frozenset[str]
    ) -> Response:
        if request.method != "GET":
            return _error("method_not_allowed", HTTPStatus.METHOD_NOT_ALLOWED)
        if (request.headers.get("Upgrade") or "").lower() != "websocket":
            return _error("upgrade_required", HTTPStatus.UPGRADE_REQUIRED)
        rejection = await self._guard(request, allowed_origins, WS_UPGRADE)
        if rejection is not None:
            return rejection
        return await self.env.GAME_ROOM.getByName(code).fetch(request)

    async def _guard(
        self, request: Any, allowed_origins: frozenset[str], limit: Limit
    ) -> Response | None:
        """Origin check (CORS does not protect WebSockets or simple POSTs), then the IP limit."""
        if not is_origin_allowed(request.headers.get("Origin"), allowed_origins):
            return _error("forbidden_origin", HTTPStatus.FORBIDDEN)
        client_ip = request.headers.get("CF-Connecting-IP") or "unknown"
        limiter = self.env.RATE_LIMITER.getByName(limiter_name(limit, client_ip))
        result = await limiter.fetch(
            "https://limiter/consume",
            method="POST",
            body=json.dumps({"limit": limit.limit, "period": limit.period}),
        )
        if not json.loads(await result.text())["allowed"]:
            return _error("rate_limited", HTTPStatus.TOO_MANY_REQUESTS)
        return None
