from hypothesis import given
from hypothesis import strategies as st

from naval.domain.coordinates import Coordinate
from naval.domain.errors import GameError
from naval.domain.fleet import Placement
from naval.protocol.views import PlayerView, state_message
from naval.rooms.codec import room_from_json, room_to_json
from naval.rooms.room import Room
from tests.domain.fixtures import ROW_FLEET
from tests.strategies import coordinates, valid_fleets


def _views(room: Room) -> list[dict[str, object]]:
    players = [None if p is None else PlayerView(p.nickname, p.connected) for p in room.players]
    return [state_message(room.code, seat, room.game, players) for seat in (0, 1)]


def _assert_same(room: Room, restored: Room) -> None:
    assert restored.code == room.code
    assert restored.created_at == room.created_at
    assert restored.last_activity == room.last_activity
    assert restored.players == room.players
    assert restored.game.shot_log == room.game.shot_log
    assert _views(restored) == _views(room)


def test_empty_room_round_trips() -> None:
    room = Room("ABCDEF", created_at=5.0)
    _assert_same(room, room_from_json(room_to_json(room)))


def test_forfeited_game_round_trips() -> None:
    room = Room("ABCDEF", created_at=5.0)
    room.join("Ana", None, now=6.0, first_shooter=1)
    room.join("Bo", None, now=7.0, first_shooter=1)
    room.place_fleet(0, ROW_FLEET, now=8.0)
    room.place_fleet(1, ROW_FLEET, now=8.0)
    room.fire(1, Coordinate(0, 0), now=9.0)
    room.disconnect(0, now=10.0)
    room.leave(0, now=11.0)
    _assert_same(room, room_from_json(room_to_json(room)))


@given(valid_fleets(), valid_fleets(), st.lists(coordinates, max_size=120), st.integers(0, 1))
def test_any_game_round_trips(
    fleet_a: list[Placement], fleet_b: list[Placement], shots: list[Coordinate], first: int
) -> None:
    room = Room("ABCDEF", created_at=0.0)
    room.join("Ana", None, now=1.0, first_shooter=first)
    room.join("Bo", None, now=1.0, first_shooter=first)
    room.place_fleet(0, fleet_a, now=2.0)
    room.place_fleet(1, fleet_b, now=2.0)
    for shot in shots:
        turn = room.game.turn
        if turn is None:
            break
        try:
            room.fire(turn, shot, now=3.0)
        except GameError:
            continue
    _assert_same(room, room_from_json(room_to_json(room)))
