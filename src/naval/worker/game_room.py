import contextlib
import json
import math
import secrets
import time
from dataclasses import dataclass, replace
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

from js import WebSocketPair, WebSocketRequestResponsePair
from workers import DurableObject, Response

from naval.protocol.messages import InvalidMessage, parse_client_message
from naval.protocol.views import Message, error_message
from naval.rooms.budget import MessageBudget
from naval.rooms.service import Delivery, RoomService
from naval.worker.do_store import DurableObjectRoomStore
from naval.worker.headers import API_HEADERS

_BUDGET_CAPACITY = 20
_BUDGET_WINDOW_SECONDS = 10.0
_CLOSE_NORMAL = 1000
_CLOSE_POLICY_VIOLATION = 1008
_CLOSE_REPLACED = 4000


class _SystemClock:
    def now(self) -> float:
        return time.time()


@dataclass(frozen=True)
class _Attachment:
    """Per-socket state that survives hibernation."""

    conn: str
    seat: int | None


def _attachment(ws: Any) -> _Attachment:
    return _Attachment(**json.loads(ws.deserializeAttachment()))


def _attach(ws: Any, attachment: _Attachment) -> None:
    ws.serializeAttachment(json.dumps({"conn": attachment.conn, "seat": attachment.seat}))


def _json(body: dict[str, Any], status: int) -> Response:
    return Response.json(body, status=status, headers=dict(API_HEADERS))


class GameRoom(DurableObject):
    def __init__(self, ctx: Any, env: Any) -> None:
        super().__init__(ctx, env)
        self._service = RoomService(
            DurableObjectRoomStore(ctx.storage), _SystemClock(), lambda: secrets.randbelow(2)
        )
        # In memory only: hibernation resets budgets, which only happens after idle time anyway.
        self._budgets: dict[str, MessageBudget] = {}
        ctx.setWebSocketAutoResponse(WebSocketRequestResponsePair.new("ping", "pong"))

    async def fetch(self, request: Any) -> Response:
        path = urlparse(request.url).path
        if path == "/init" and request.method == "POST":
            code = json.loads(await request.text())["code"]
            created = await self._service.create(code)
            if created:
                await self._schedule_alarm()
            return _json({"created": created}, 201 if created else 409)
        # The Worker forwards the original /api/rooms/{code}/ws request after validating it.
        if (request.headers.get("Upgrade") or "").lower() == "websocket":
            if not await self._service.exists():
                return _json({"error": "room_not_found"}, 404)
            client, server = WebSocketPair.new().object_values()
            self.ctx.acceptWebSocket(server)
            _attach(server, _Attachment(conn=uuid4().hex, seat=None))
            return Response(None, status=101, web_socket=client)
        return _json({"error": "not_found"}, 404)

    async def webSocketMessage(self, ws: Any, message: Any) -> None:  # noqa: N802 - runtime API
        attachment = _attachment(ws)
        budget = self._budgets.setdefault(
            attachment.conn, MessageBudget(_BUDGET_CAPACITY, _BUDGET_WINDOW_SECONDS)
        )
        if not budget.allow(time.time()):
            self._send(ws, error_message("rate_limited"))
            return
        try:
            client_message = parse_client_message(message if isinstance(message, str) else b"")
        except InvalidMessage:
            self._send(ws, error_message(InvalidMessage.code))
            if budget.record_violation():
                self._close(ws, _CLOSE_POLICY_VIOLATION, "too many invalid messages")
            return
        delivery = await self._service.handle(attachment.seat, client_message)
        self._deliver(delivery, requester=ws)
        await self._schedule_alarm()

    async def webSocketClose(self, ws: Any, code: int, reason: str, was_clean: bool) -> None:  # noqa: N802
        await self._connection_lost(ws)

    async def webSocketError(self, ws: Any, error: Any) -> None:  # noqa: N802 - runtime API
        await self._connection_lost(ws)

    async def alarm(self, *_: Any) -> None:
        self._deliver(await self._service.alarm(), requester=None)
        await self._schedule_alarm()

    async def _connection_lost(self, ws: Any) -> None:
        attachment = _attachment(ws)
        self._budgets.pop(attachment.conn, None)
        self._close(ws, _CLOSE_NORMAL, "closed")
        if attachment.seat is None:
            return
        still_seated = any(
            other.conn != attachment.conn and other.seat == attachment.seat
            for other in map(_attachment, self.ctx.getWebSockets())
        )
        if not still_seated:
            self._deliver(await self._service.disconnected(attachment.seat), requester=None)
            await self._schedule_alarm()

    def _deliver(self, delivery: Delivery, requester: Any | None) -> None:
        if requester is not None and delivery.bind_seat is not None:
            self._bind(requester, delivery.bind_seat)
        for message in delivery.to_requester:
            if requester is not None:
                self._send(requester, message)
        for ws in self.ctx.getWebSockets():
            seat = _attachment(ws).seat
            if seat is not None:
                for message in delivery.to_seats.get(seat, []):
                    self._send(ws, message)
        if requester is not None and delivery.close_requester:
            self._unbind_and_close(requester, _CLOSE_NORMAL, "left")
        if delivery.close_all:
            for ws in self.ctx.getWebSockets():
                self._unbind_and_close(ws, _CLOSE_NORMAL, "room closed")

    def _bind(self, requester: Any, seat: int) -> None:
        own = _attachment(requester)
        for ws in self.ctx.getWebSockets():
            other = _attachment(ws)
            if other.seat == seat and other.conn != own.conn:
                # Unbind first so the old socket's close event cannot disconnect the seat.
                self._unbind_and_close(ws, _CLOSE_REPLACED, "replaced by a new connection")
        _attach(requester, replace(own, seat=seat))

    def _unbind_and_close(self, ws: Any, code: int, reason: str) -> None:
        _attach(ws, replace(_attachment(ws), seat=None))
        self._close(ws, code, reason)

    async def _schedule_alarm(self) -> None:
        deadline = await self._service.deadline()
        if deadline is None:
            await self.ctx.storage.deleteAlarm()
        else:
            # Round up so the alarm never fires just before the deadline it serves.
            await self.ctx.storage.setAlarm(math.ceil(deadline * 1000))

    @staticmethod
    def _send(ws: Any, message: Message) -> None:
        try:
            ws.send(json.dumps(message))
        except Exception as error:
            print(f"send failed: {type(error).__name__}")

    @staticmethod
    def _close(ws: Any, code: int, reason: str) -> None:
        with contextlib.suppress(Exception):  # the socket may already be closed
            ws.close(code, reason)
