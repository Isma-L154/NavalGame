import pytest

from naval.domain.coordinates import Coordinate
from naval.domain.errors import WrongPhase
from naval.domain.game import FinishReason, Phase
from naval.rooms.room import (
    IDLE_TIMEOUT_SECONDS,
    RECONNECT_GRACE_SECONDS,
    InvalidToken,
    OpponentMissing,
    Room,
    RoomFull,
)
from tests.domain.fixtures import ROW_FLEET, fleet_cells

T0 = 1_000.0


def _room_with_two_players() -> tuple[Room, str, str]:
    room = Room("ABCDEF", created_at=T0)
    seat_a, token_a = room.join("Ana", None, now=T0, first_shooter=0)
    seat_b, token_b = room.join("Bo", None, now=T0, first_shooter=0)
    assert (seat_a, seat_b) == (0, 1)
    assert token_a is not None
    assert token_b is not None
    return room, token_a, token_b


def _playing_room() -> Room:
    room, _, _ = _room_with_two_players()
    room.place_fleet(0, ROW_FLEET, now=T0)
    room.place_fleet(1, ROW_FLEET, now=T0)
    return room


def test_players_take_seats_in_order() -> None:
    room, token_a, token_b = _room_with_two_players()
    assert token_a != token_b
    players = room.players
    assert players[0] is not None
    assert players[0].nickname == "Ana"
    assert players[0].connected
    assert room.connected_seats() == [0, 1]


def test_third_player_is_refused() -> None:
    room, _, _ = _room_with_two_players()
    with pytest.raises(RoomFull):
        room.join("Cy", None, now=T0, first_shooter=0)


def test_reconnecting_with_the_token_keeps_seat_and_game() -> None:
    room, _, token_b = _room_with_two_players()
    room.place_fleet(0, ROW_FLEET, now=T0)
    room.place_fleet(1, ROW_FLEET, now=T0)
    room.disconnect(1, now=T0 + 5)
    assert room.connected_seats() == [0]
    assert room.join("Bo", token_b, now=T0 + 10, first_shooter=1) == (1, None)
    assert room.game.phase is Phase.PLAYING
    assert room.connected_seats() == [0, 1]


def test_wrong_token_is_rejected() -> None:
    room, _, _ = _room_with_two_players()
    with pytest.raises(InvalidToken):
        room.join("Cy", "x" * 43, now=T0, first_shooter=0)


def test_fleet_cannot_be_placed_without_an_opponent() -> None:
    room = Room("ABCDEF", created_at=T0)
    room.join("Ana", None, now=T0, first_shooter=0)
    with pytest.raises(OpponentMissing):
        room.place_fleet(0, ROW_FLEET, now=T0)


def test_joining_a_vacated_seat_starts_a_fresh_game() -> None:
    room, _, _ = _room_with_two_players()
    room.place_fleet(0, ROW_FLEET, now=T0)
    room.leave(1, now=T0)
    room.join("Cy", None, now=T0, first_shooter=1)
    assert room.game.boards == (None, None)
    assert room.game.first_shooter == 1


def test_disconnected_seat_survives_the_grace_period() -> None:
    room = _playing_room()
    room.disconnect(1, now=T0)
    assert room.expire(now=T0 + RECONNECT_GRACE_SECONDS - 1) == []
    assert room.players[1] is not None


def test_expired_seat_forfeits_and_is_released() -> None:
    room = _playing_room()
    room.disconnect(1, now=T0)
    assert room.expire(now=T0 + RECONNECT_GRACE_SECONDS) == [1]
    assert room.players[1] is None
    assert room.game.phase is Phase.FINISHED
    assert room.game.winner == 0
    assert room.game.finish_reason is FinishReason.FORFEIT


def test_leaving_mid_game_forfeits() -> None:
    room = _playing_room()
    room.leave(0, now=T0)
    assert room.players[0] is None
    assert room.game.winner == 1


def test_leaving_while_placing_just_frees_the_seat() -> None:
    room, _, _ = _room_with_two_players()
    room.leave(0, now=T0)
    assert room.players[0] is None
    assert room.game.phase is Phase.PLACING


def _finished_room() -> Room:
    room = _playing_room()
    misses = iter(Coordinate(row, col) for row in range(5, 10) for col in range(10))
    targets = fleet_cells(ROW_FLEET)
    for target in targets[:-1]:
        room.fire(0, target, now=T0)
        room.fire(1, next(misses), now=T0)
    room.fire(0, targets[-1], now=T0)
    assert room.game.phase is Phase.FINISHED
    return room


def test_rematch_needs_both_players() -> None:
    room = _finished_room()
    assert not room.request_rematch(0, first_shooter=1, now=T0)
    assert room.request_rematch(1, first_shooter=1, now=T0)
    assert room.game.phase is Phase.PLACING
    assert room.game.first_shooter == 1
    assert all(p is not None and not p.wants_rematch for p in room.players)


def test_rematch_before_the_end_is_rejected() -> None:
    with pytest.raises(WrongPhase):
        _playing_room().request_rematch(0, first_shooter=0, now=T0)


def test_rematch_without_an_opponent_is_rejected() -> None:
    room = _finished_room()
    room.leave(1, now=T0)
    with pytest.raises(OpponentMissing):
        room.request_rematch(0, first_shooter=0, now=T0)


def test_next_deadline_is_the_earliest_pending_timeout() -> None:
    room, _, _ = _room_with_two_players()
    assert room.next_deadline() == T0 + IDLE_TIMEOUT_SECONDS
    room.disconnect(0, now=T0 + 10)
    assert room.next_deadline() == T0 + 10 + RECONNECT_GRACE_SECONDS


def test_room_becomes_idle_after_an_hour_without_activity() -> None:
    room, _, _ = _room_with_two_players()
    assert not room.is_idle(now=T0 + IDLE_TIMEOUT_SECONDS - 1)
    assert room.is_idle(now=T0 + IDLE_TIMEOUT_SECONDS)


def test_a_second_disconnect_does_not_restart_the_grace_period() -> None:
    room, _, _ = _room_with_two_players()
    room.disconnect(1, now=T0)
    room.disconnect(1, now=T0 + 60)
    assert room.next_deadline() == T0 + RECONNECT_GRACE_SECONDS
