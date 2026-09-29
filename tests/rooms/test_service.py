from typing import Any

import pytest

from naval.domain.flags import Flag
from naval.protocol.messages import (
    ChooseFlagMessage,
    FireMessage,
    JoinMessage,
    LeaveMessage,
    PlaceFleetMessage,
    RematchMessage,
    ShipSpec,
)
from naval.protocol.views import error_message
from naval.rooms.room import IDLE_TIMEOUT_SECONDS, RECONNECT_GRACE_SECONDS, Room
from naval.rooms.service import Delivery, InMemoryRoomStore, RoomService
from tests.domain.fixtures import ROW_FLEET, fleet_cells


class FakeClock:
    def __init__(self) -> None:
        self.current = 1_000.0

    def now(self) -> float:
        return self.current


PLACE = PlaceFleetMessage(
    type="place_fleet",
    ships=[
        ShipSpec(kind=p.kind, row=p.origin.row, col=p.origin.col, orientation=p.orientation)
        for p in ROW_FLEET
    ],
)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
async def service(clock: FakeClock) -> RoomService:
    svc = RoomService(InMemoryRoomStore(), clock, coin_flip=lambda: 0)
    assert await svc.create("ABCDEF")
    return svc


def _types(messages: list[dict[str, Any]]) -> list[str]:
    return [m["type"] for m in messages]


def _last_state(delivery: Delivery, seat: int) -> dict[str, Any]:
    return [m for m in delivery.to_seats[seat] if m["type"] == "state"][-1]


async def _two_players(service: RoomService) -> tuple[str, str]:
    a = await service.handle(None, JoinMessage(type="join", nickname="Ana"))
    b = await service.handle(None, JoinMessage(type="join", nickname="Bo"))
    return a.to_requester[0]["token"], b.to_requester[0]["token"]


async def test_create_is_idempotent_and_rejects_duplicates(service: RoomService) -> None:
    assert await service.exists()
    assert not await service.create("ABCDEF")


async def test_missing_room_does_not_exist(clock: FakeClock) -> None:
    svc = RoomService(InMemoryRoomStore(), clock, coin_flip=lambda: 0)
    assert not await svc.exists()
    assert await svc.deadline() is None


async def test_join_binds_the_seat_and_broadcasts_state(service: RoomService) -> None:
    first = await service.handle(None, JoinMessage(type="join", nickname="Ana"))
    assert first.bind_seat == 0
    assert _types(first.to_requester) == ["joined"]
    assert first.to_requester[0]["token"]
    assert _last_state(first, 0)["players"][1] is None

    second = await service.handle(None, JoinMessage(type="join", nickname="Bo"))
    assert second.bind_seat == 1
    assert _last_state(second, 0)["players"][1] == {
        "nickname": "Bo",
        "flag": "b",
        "connected": True,
        "wants_rematch": False,
    }
    assert _last_state(second, 1)["seat"] == 1


async def test_third_player_gets_room_full_and_is_closed(service: RoomService) -> None:
    await _two_players(service)
    third = await service.handle(None, JoinMessage(type="join", nickname="Cy"))
    assert third.bind_seat is None
    assert third.close_requester
    assert third.to_requester[0]["code"] == "room_full"
    assert third.to_seats == {}


async def test_actions_before_joining_are_rejected(service: RoomService) -> None:
    delivery = await service.handle(None, FireMessage(type="fire", row=0, col=0))
    assert delivery.to_requester[0]["code"] == "not_joined"


async def test_joining_twice_is_rejected(service: RoomService) -> None:
    await _two_players(service)
    delivery = await service.handle(0, JoinMessage(type="join", nickname="Ana"))
    assert delivery.to_requester[0]["code"] == "already_joined"


async def test_errors_only_reach_the_requester(service: RoomService) -> None:
    await _two_players(service)
    await service.handle(0, PLACE)
    await service.handle(1, PLACE)
    delivery = await service.handle(1, FireMessage(type="fire", row=0, col=0))
    assert delivery.to_requester == [
        {"type": "error", "code": "not_your_turn", "message": "Wait for your turn."}
    ]
    assert delivery.to_seats == {}


async def test_full_game_through_the_service(service: RoomService) -> None:
    await _two_players(service)
    await service.handle(0, PLACE)
    started = await service.handle(1, PLACE)
    assert _last_state(started, 0)["phase"] == "playing"

    misses = iter((r, c) for r in range(5, 10) for c in range(10))
    targets = fleet_cells(ROW_FLEET)
    for target in targets[:-1]:
        shot = await service.handle(0, FireMessage(type="fire", row=target.row, col=target.col))
        assert _types(shot.to_seats[1]) == ["shot", "state"]
        row, col = next(misses)
        await service.handle(1, FireMessage(type="fire", row=row, col=col))
    final = await service.handle(
        0, FireMessage(type="fire", row=targets[-1].row, col=targets[-1].col)
    )
    state = _last_state(final, 1)
    assert state["phase"] == "finished"
    assert state["winner"] == 0
    assert state["opponent_fleet"] is not None

    vote = await service.handle(0, RematchMessage(type="rematch"))
    assert _last_state(vote, 1)["players"][0]["wants_rematch"] is True
    rematch = await service.handle(1, RematchMessage(type="rematch"))
    assert _last_state(rematch, 0)["phase"] == "placing"


async def test_reconnect_with_token(service: RoomService, clock: FakeClock) -> None:
    _, token_b = await _two_players(service)
    left = await service.disconnected(1)
    assert _last_state(left, 0)["players"][1]["connected"] is False
    assert 1 not in left.to_seats
    clock.current += 30
    back = await service.handle(None, JoinMessage(type="join", nickname="Bo", token=token_b))
    assert back.bind_seat == 1
    assert back.to_requester[0]["token"] is None
    assert _last_state(back, 0)["players"][1]["connected"] is True


async def test_leave_closes_the_requester_and_notifies_the_opponent(service: RoomService) -> None:
    await _two_players(service)
    delivery = await service.handle(1, LeaveMessage(type="leave"))
    assert delivery.close_requester
    assert _last_state(delivery, 0)["players"][1] is None
    assert 1 not in delivery.to_seats


async def test_alarm_forfeits_after_the_grace_period(
    service: RoomService, clock: FakeClock
) -> None:
    await _two_players(service)
    await service.handle(0, PLACE)
    await service.handle(1, PLACE)
    await service.disconnected(1)
    assert await service.deadline() == clock.current + RECONNECT_GRACE_SECONDS
    clock.current += RECONNECT_GRACE_SECONDS
    delivery = await service.alarm()
    state = _last_state(delivery, 0)
    assert state["phase"] == "finished"
    assert state["finish_reason"] == "forfeit"
    assert state["players"][1] is None


async def test_alarm_deletes_an_idle_room(service: RoomService, clock: FakeClock) -> None:
    await _two_players(service)
    clock.current += IDLE_TIMEOUT_SECONDS
    delivery = await service.alarm()
    assert delivery.close_all
    assert delivery.to_seats[0][0]["code"] == "room_closed"
    assert not await service.exists()
    assert await service.deadline() is None


async def test_messages_to_a_deleted_room_close_the_connection(
    service: RoomService, clock: FakeClock
) -> None:
    clock.current += IDLE_TIMEOUT_SECONDS
    await service.alarm()
    delivery = await service.handle(None, JoinMessage(type="join", nickname="Ana"))
    assert delivery.close_requester
    assert delivery.to_requester[0]["code"] == "room_closed"


class FailingSaveStore(InMemoryRoomStore):
    """Accepts saves until `failing` is set."""

    def __init__(self) -> None:
        super().__init__()
        self.failing = False

    async def save(self, room: Room) -> None:
        if self.failing:
            raise RuntimeError("storage unavailable")
        await super().save(room)


class FailingLoadStore(InMemoryRoomStore):
    async def load(self) -> Room | None:
        raise ValueError("unsupported room format")


async def test_a_failed_first_join_answers_internal_error_and_closes(clock: FakeClock) -> None:
    store = FailingSaveStore()
    svc = RoomService(store, clock, coin_flip=lambda: 0)
    assert await svc.create("ABCDEF")
    store.failing = True
    delivery = await svc.handle(None, JoinMessage(type="join", nickname="Ana"))
    assert delivery.to_requester == [error_message("internal_error")]
    assert delivery.to_seats == {}
    assert delivery.bind_seat is None
    assert delivery.close_requester


async def test_a_failed_action_answers_internal_error_and_keeps_the_seat(clock: FakeClock) -> None:
    store = FailingSaveStore()
    svc = RoomService(store, clock, coin_flip=lambda: 0)
    assert await svc.create("ABCDEF")
    await _two_players(svc)
    store.failing = True
    delivery = await svc.handle(0, PLACE)
    assert delivery.to_requester == [error_message("internal_error")]
    assert not delivery.close_requester


async def test_a_room_that_cannot_be_loaded_answers_internal_error(clock: FakeClock) -> None:
    svc = RoomService(FailingLoadStore(), clock, coin_flip=lambda: 0)
    delivery = await svc.handle(0, PLACE)
    assert delivery.to_requester == [error_message("internal_error")]


async def test_a_failed_first_join_leaves_the_seat_free(clock: FakeClock) -> None:
    store = FailingSaveStore()
    svc = RoomService(store, clock, coin_flip=lambda: 0)
    assert await svc.create("ABCDEF")
    store.failing = True
    await svc.handle(None, JoinMessage(type="join", nickname="Ana"))
    store.failing = False
    delivery = await svc.handle(None, JoinMessage(type="join", nickname="Bo"))
    assert delivery.bind_seat == 0


async def test_internal_errors_are_logged_with_room_and_seat(
    clock: FakeClock, capsys: pytest.CaptureFixture[str]
) -> None:
    store = FailingSaveStore()
    svc = RoomService(store, clock, coin_flip=lambda: 0)
    assert await svc.create("ABCDEF")
    await _two_players(svc)
    store.failing = True
    await svc.handle(1, PLACE)
    log = capsys.readouterr().out
    assert "ABCDEF, seat 1, handling place_fleet" in log
    assert "Traceback" in log
    assert "storage unavailable" in log


async def test_internal_error_logs_never_contain_the_seat_token(
    clock: FakeClock, capsys: pytest.CaptureFixture[str]
) -> None:
    store = FailingSaveStore()
    svc = RoomService(store, clock, coin_flip=lambda: 0)
    assert await svc.create("ABCDEF")
    token, _ = await _two_players(svc)
    store.failing = True
    await svc.handle(None, JoinMessage(type="join", nickname="Ana", token=token))
    log = capsys.readouterr().out
    assert "handling join" in log
    assert token not in log


async def test_a_new_flag_reaches_both_players(service: RoomService) -> None:
    await _two_players(service)
    delivery = await service.handle(1, ChooseFlagMessage(type="choose_flag", flag=Flag.T))
    for seat in (0, 1):
        assert [p["flag"] for p in _last_state(delivery, seat)["players"]] == ["a", "t"]


async def test_choosing_the_opponents_flag_is_refused(service: RoomService) -> None:
    await _two_players(service)
    delivery = await service.handle(1, ChooseFlagMessage(type="choose_flag", flag=Flag.A))
    assert delivery.to_requester == [error_message("flag_taken")]
    assert not delivery.close_requester


async def test_the_join_flag_request_is_honoured(service: RoomService) -> None:
    delivery = await service.handle(None, JoinMessage(type="join", nickname="Ana", flag=Flag.N))
    assert _last_state(delivery, 0)["players"][0]["flag"] == "n"


async def test_a_join_id_stops_reclaiming_once_the_seat_acts(service: RoomService) -> None:
    join_id = "j" * 43
    first = await service.handle(None, JoinMessage(type="join", nickname="Ana", join_id=join_id))
    assert first.bind_seat == 0
    # Even a refused action (no opponent yet) shows the token arrived.
    refused = await service.handle(0, PLACE)
    assert refused.to_requester == [error_message("waiting_for_opponent")]
    again = await service.handle(None, JoinMessage(type="join", nickname="Ana", join_id=join_id))
    assert again.bind_seat == 1


async def test_a_join_id_only_reclaims_for_the_same_nickname(service: RoomService) -> None:
    join_id = "j" * 43
    await service.handle(None, JoinMessage(type="join", nickname="Ana", join_id=join_id))
    other = await service.handle(None, JoinMessage(type="join", nickname="Eve", join_id=join_id))
    assert other.bind_seat == 1
