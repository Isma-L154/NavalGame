import json
from functools import partial
from http import HTTPStatus
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

from workers import Response, WorkerEntrypoint

from naval.limits.window import ROOM_CREATION, WS_UPGRADE, Limit, limiter_name
from naval.protocol.requests import (
    MAX_REQUEST_BYTES,
    CreateRoomRequest,
    InvalidRequest,
    parse_create_room,
)
from naval.rooms.codes import new_room_code
from naval.worker.policy import (
    MissingConfig,
    is_origin_allowed,
    parse_allowed_origins,
    parse_ws_path,
)
from naval.worker.responses import error_response, json_response
from naval.worker.retry import GaveUp, call_with_retry

_CODE_ATTEMPTS = 5


class Default(WorkerEntrypoint):
    async def fetch(self, request: Any) -> Response:
        path = urlparse(request.url).path
        if path == "/api/health":
            # The deploy sets BUILD_VERSION to the commit, so CI can wait for this exact build.
            version = getattr(self.env, "BUILD_VERSION", None) or "dev"
            return json_response({"status": "ok", "version": str(version)}, HTTPStatus.OK)
        try:
            allowed_origins = parse_allowed_origins(getattr(self.env, "ALLOWED_ORIGINS", None))
        except MissingConfig as error:
            print(f"configuration error: {error}")
            return error_response("misconfigured", HTTPStatus.INTERNAL_SERVER_ERROR)
        try:
            if path == "/api/rooms":
                return await self._create_room(request, allowed_origins)
            code = parse_ws_path(path)
            if code is not None:
                return await self._open_room_socket(request, code, allowed_origins)
        except GaveUp as error:
            print(f"durable object call failed: {error}")
            return error_response("try_again", HTTPStatus.SERVICE_UNAVAILABLE)
        return error_response("not_found", HTTPStatus.NOT_FOUND)

    async def _create_room(self, request: Any, allowed_origins: frozenset[str]) -> Response:
        if request.method != "POST":
            return error_response("method_not_allowed", HTTPStatus.METHOD_NOT_ALLOWED)
        rejection = await self._guard(request, allowed_origins, ROOM_CREATION)
        if rejection is not None:
            return rejection
        creation = await self._read_creation(request)
        if creation is None:
            return error_response("invalid_request", HTTPStatus.BAD_REQUEST)
        for _ in range(_CODE_ATTEMPTS):
            code = new_room_code()
            # The nonce makes a retried /init recognisable, so it cannot orphan a room.
            body = json.dumps(
                {"code": code, "nonce": uuid4().hex, "opponent": creation.opponent.value}
            )
            result = await call_with_retry(partial(self._init_room, code, body))
            if result.status == HTTPStatus.CREATED:
                return json_response({"code": code}, HTTPStatus.CREATED)
        return error_response("try_again", HTTPStatus.SERVICE_UNAVAILABLE)

    @staticmethod
    async def _read_creation(request: Any) -> CreateRoomRequest | None:
        """The validated request body, or None when it is not one.

        Only a body that declares a small enough length is read, so a large or unannounced
        (chunked) one is never buffered: without a Content-Length, the request has no body.
        """
        declared = request.headers.get("Content-Length")
        if declared is None:
            body = ""
        elif not declared.isdigit() or int(declared) > MAX_REQUEST_BYTES:
            return None
        else:
            body = await request.text()
        try:
            return parse_create_room(body)
        except InvalidRequest:
            return None

    async def _init_room(self, code: str, body: str) -> Any:
        # A fresh stub per call: a stub that failed can stay broken.
        return await self.env.GAME_ROOM.getByName(code).fetch(
            "https://room/init", method="POST", body=body
        )

    async def _open_room_socket(
        self, request: Any, code: str, allowed_origins: frozenset[str]
    ) -> Response:
        if request.method != "GET":
            return error_response("method_not_allowed", HTTPStatus.METHOD_NOT_ALLOWED)
        if (request.headers.get("Upgrade") or "").lower() != "websocket":
            return error_response("upgrade_required", HTTPStatus.UPGRADE_REQUIRED)
        rejection = await self._guard(request, allowed_origins, WS_UPGRADE)
        if rejection is not None:
            return rejection
        return await call_with_retry(lambda: self.env.GAME_ROOM.getByName(code).fetch(request))

    async def _guard(
        self, request: Any, allowed_origins: frozenset[str], limit: Limit
    ) -> Response | None:
        """Origin check (CORS does not protect WebSockets or simple POSTs), then the IP limit."""
        if not is_origin_allowed(request.headers.get("Origin"), allowed_origins):
            return error_response("forbidden_origin", HTTPStatus.FORBIDDEN)
        client_ip = request.headers.get("CF-Connecting-IP") or "unknown"
        name = limiter_name(limit, client_ip)
        # A retried check carries the same id, so it is not counted twice.
        rule = json.dumps({"limit": limit.limit, "period": limit.period, "request_id": uuid4().hex})
        result = await call_with_retry(
            lambda: self.env.RATE_LIMITER.getByName(name).fetch(
                "https://limiter/consume",
                method="POST",
                body=rule,
            )
        )
        if not json.loads(await result.text())["allowed"]:
            return error_response("rate_limited", HTTPStatus.TOO_MANY_REQUESTS)
        return None
