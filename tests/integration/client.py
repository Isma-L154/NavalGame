"""Helpers for driving a running Worker (NAVAL_BASE_URL) over HTTP and WebSocket."""

import asyncio
import json
import os
import random
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

from websockets.asyncio.client import ClientConnection, connect
from websockets.typing import Origin

BASE_URL = os.environ.get("NAVAL_BASE_URL", "")
ORIGIN = os.environ.get("NAVAL_ORIGIN", BASE_URL)

ROW_FLEET: list[dict[str, Any]] = [
    {"kind": "carrier", "row": 0, "col": 0, "orientation": "horizontal"},
    {"kind": "battleship", "row": 1, "col": 0, "orientation": "horizontal"},
    {"kind": "cruiser", "row": 2, "col": 0, "orientation": "horizontal"},
    {"kind": "submarine", "row": 3, "col": 0, "orientation": "horizontal"},
    {"kind": "destroyer", "row": 4, "col": 0, "orientation": "horizontal"},
]
_LENGTHS = {"carrier": 5, "battleship": 4, "cruiser": 3, "submarine": 3, "destroyer": 2}
FLEET_CELLS = [
    (ship["row"], ship["col"] + i) for ship in ROW_FLEET for i in range(_LENGTHS[ship["kind"]])
]


# Only the local dev server honours a client-supplied CF-Connecting-IP; Cloudflare's edge
# rejects it (error 1000), so against a deployed Worker the real client IP is used.
SPOOF_CLIENT_IP = "://localhost" in BASE_URL


# Cloudflare's Browser Integrity Check blocks urllib's default User-Agent.
USER_AGENT = "NavalGame-integration-tests/1.0"


def _ip_headers() -> dict[str, str]:
    return {"CF-Connecting-IP": fake_ip()} if SPOOF_CLIENT_IP else {}


def fake_ip() -> str:
    """Each test gets its own client IP so per-IP limits do not leak between tests."""
    return f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"  # noqa: S311


def http(
    method: str, path: str, *, origin: str | None = ORIGIN, ip: str | None = None
) -> tuple[int, dict[str, Any]]:
    request = urllib.request.Request(BASE_URL + path, method=method)  # noqa: S310
    request.add_header("User-Agent", USER_AGENT)
    if origin is not None:
        request.add_header("Origin", origin)
    if SPOOF_CLIENT_IP:
        request.add_header("CF-Connecting-IP", ip or fake_ip())
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def create_room(ip: str | None = None) -> str:
    status, body = http("POST", "/api/rooms", ip=ip)
    assert status == 201, body
    return str(body["code"])


def ws_url(code: str) -> str:
    return BASE_URL.replace("http", "ws", 1) + f"/api/rooms/{code}/ws"


async def open_socket(code: str, *, origin: str = ORIGIN) -> ClientConnection:
    return await connect(
        ws_url(code),
        origin=Origin(origin),
        additional_headers=_ip_headers(),
        user_agent_header=USER_AGENT,
    )


async def close_code(ws: ClientConnection, timeout: float = 5) -> int | None:
    async with asyncio.timeout(timeout):
        await ws.wait_closed()
    return ws.close_code


async def send(ws: ClientConnection, payload: dict[str, Any]) -> None:
    await ws.send(json.dumps(payload))


async def receive(
    ws: ClientConnection,
    message_type: str,
    where: Callable[[dict[str, Any]], bool] = lambda _: True,
    timeout: float = 10,
) -> dict[str, Any]:
    """Returns the next message of `message_type` matching `where`, skipping the rest."""
    async with asyncio.timeout(timeout):
        while True:
            message = json.loads(await ws.recv())
            if message["type"] == message_type and where(message):
                return message  # type: ignore[no-any-return]


async def join(
    code: str, nickname: str, token: str | None = None
) -> tuple[ClientConnection, dict[str, Any]]:
    ws = await open_socket(code)
    payload: dict[str, Any] = {"type": "join", "nickname": nickname}
    if token is not None:
        payload["token"] = token
    await send(ws, payload)
    joined = await receive(ws, "joined")
    await receive(ws, "state")
    return ws, joined
