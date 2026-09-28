import asyncio
import json

import pytest
from websockets.exceptions import ConnectionClosed, InvalidStatus

from naval.rooms.codes import is_valid_room_code
from tests.integration.client import (
    FLEET_CELLS,
    ROW_FLEET,
    close_code,
    create_room,
    fake_ip,
    http,
    join,
    open_socket,
    receive,
    send,
)

pytestmark = pytest.mark.integration


def test_create_room_returns_a_valid_code() -> None:
    assert is_valid_room_code(create_room())


@pytest.mark.parametrize("origin", ["https://evil.com", "http://127.0.0.1:8787", None])
def test_room_creation_rejects_foreign_or_missing_origins(origin: str | None) -> None:
    status, body = http("POST", "/api/rooms", origin=origin)
    assert (status, body) == (403, {"error": "forbidden_origin"})


def test_room_creation_needs_post() -> None:
    assert http("GET", "/api/rooms")[0] == 405


def test_room_creation_is_rate_limited_per_ip() -> None:
    ip = fake_ip()
    statuses = [http("POST", "/api/rooms", ip=ip)[0] for _ in range(11)]
    assert statuses == [201] * 10 + [429]
    assert http("POST", "/api/rooms", ip=fake_ip())[0] == 201


def test_websocket_path_without_upgrade_is_426() -> None:
    assert http("GET", f"/api/rooms/{create_room()}/ws")[0] == 426


@pytest.mark.parametrize("path", ["/api/rooms/abcdef/ws", "/api/rooms/ABCDE0/ws", "/api/nope"])
def test_malformed_paths_are_404(path: str) -> None:
    assert http("GET", path)[0] == 404


async def test_unknown_room_is_404() -> None:
    with pytest.raises(InvalidStatus) as error:
        await open_socket("ZZZZZZ")
    assert error.value.response.status_code == 404


async def test_websocket_rejects_a_foreign_origin() -> None:
    with pytest.raises(InvalidStatus) as error:
        await open_socket(create_room(), origin="https://evil.com")
    assert error.value.response.status_code == 403


async def test_full_game_between_two_players() -> None:
    code = create_room()
    ana, joined_a = await join(code, "Ana")
    bo, joined_b = await join(code, "Bo")
    assert (joined_a["seat"], joined_b["seat"]) == (0, 1)

    await send(ana, {"type": "place_fleet", "ships": ROW_FLEET})
    await send(bo, {"type": "place_fleet", "ships": ROW_FLEET})
    state = await receive(ana, "state", lambda m: m["phase"] == "playing")
    assert state["opponent_fleet"] is None

    first = state["turn"]
    shooter, target = (ana, bo) if first == 0 else (bo, ana)
    misses = iter((r, c) for r in range(5, 10) for c in range(10))
    for row, col in FLEET_CELLS[:-1]:
        await send(shooter, {"type": "fire", "row": row, "col": col})
        await receive(target, "shot", lambda m: m["by"] == first)
        miss_row, miss_col = next(misses)
        await send(target, {"type": "fire", "row": miss_row, "col": miss_col})
        await receive(shooter, "shot", lambda m: m["by"] != first)
    last_row, last_col = FLEET_CELLS[-1]
    await send(shooter, {"type": "fire", "row": last_row, "col": last_col})
    final = await receive(target, "state", lambda m: m["phase"] == "finished")
    assert final["finish_reason"] == "fleet_sunk"
    assert final["winner"] != final["seat"]
    assert len(final["opponent_fleet"]) == 5
    await ana.close()
    await bo.close()


async def test_third_player_gets_room_full() -> None:
    code = create_room()
    await join(code, "Ana")
    await join(code, "Bo")
    third = await open_socket(code)
    await send(third, {"type": "join", "nickname": "Cy"})
    error = await receive(third, "error")
    assert error["code"] == "room_full"
    with pytest.raises(ConnectionClosed):
        await third.recv()


async def test_reconnecting_replaces_the_old_socket_without_a_disconnect() -> None:
    code = create_room()
    ana, _ = await join(code, "Ana")
    bo, joined = await join(code, "Bo")
    bo_again, rejoined = await join(code, "Bo", token=joined["token"])
    assert rejoined["seat"] == 1
    assert rejoined["token"] is None
    assert await close_code(bo) == 4000

    # A late close of the replaced socket must not mark the seat as disconnected.
    states = []
    try:
        async with asyncio.timeout(2):
            while True:
                message = json.loads(await ana.recv())
                if message["type"] == "state":
                    states.append(message)
    except TimeoutError:
        pass
    if states:
        assert states[-1]["players"][1]["connected"] is True
    await send(bo_again, {"type": "leave"})


async def test_disconnect_is_visible_to_the_opponent() -> None:
    code = create_room()
    ana, _ = await join(code, "Ana")
    bo, _ = await join(code, "Bo")
    await bo.close()
    await receive(ana, "state", lambda m: m["players"][1]["connected"] is False)


async def test_invalid_and_oversized_frames() -> None:
    code = create_room()
    ws, _ = await join(code, "Ana")
    await ws.send("x" * 5000)
    assert (await receive(ws, "error"))["code"] == "invalid_message"
    await ws.send(b"\x00\x01")
    assert (await receive(ws, "error"))["code"] == "invalid_message"
    await send(ws, {"type": "fire", "row": "1", "col": 1})
    assert (await receive(ws, "error"))["code"] == "invalid_message"


async def test_fifth_invalid_frame_closes_the_socket() -> None:
    ws = await open_socket(create_room())
    for _ in range(5):
        await ws.send("{")
    assert await close_code(ws) == 1008


async def test_message_budget_limits_floods() -> None:
    ws, _ = await join(create_room(), "Ana")
    for _ in range(25):
        await send(ws, {"type": "rematch"})
    codes = []
    try:
        async with asyncio.timeout(3):
            while True:
                message = json.loads(await ws.recv())
                if message["type"] == "error":
                    codes.append(message["code"])
    except TimeoutError:
        pass
    assert "rate_limited" in codes


async def test_ping_gets_pong() -> None:
    ws = await open_socket(create_room())
    await ws.send("ping")
    async with asyncio.timeout(5):
        assert await ws.recv() == "pong"
