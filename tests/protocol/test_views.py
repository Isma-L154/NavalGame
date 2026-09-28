import json

from hypothesis import given
from hypothesis import strategies as st

from naval.domain.board import ShotOutcome, ShotResult
from naval.domain.coordinates import Coordinate
from naval.domain.errors import GameError
from naval.domain.fleet import Orientation, Placement, ShipKind
from naval.domain.game import Game
from naval.protocol.views import (
    PlayerView,
    error_message,
    joined_message,
    shot_message,
    state_message,
)
from tests.domain.fixtures import ROW_FLEET, fleet_cells
from tests.strategies import coordinates, valid_fleets

PLAYERS = (
    PlayerView("Ana", connected=True, wants_rematch=False),
    PlayerView("Bo", connected=False, wants_rematch=True),
)


def _playing_game() -> Game:
    game = Game(first_shooter=0)
    game.place_fleet(0, ROW_FLEET)
    game.place_fleet(1, ROW_FLEET)
    return game


def test_state_while_playing_hides_the_opponent_fleet() -> None:
    game = _playing_game()
    game.fire(0, Coordinate(4, 0))
    game.fire(1, Coordinate(9, 9))
    view = state_message("ABCDEF", 0, game, PLAYERS)
    assert view["type"] == "state"
    assert view["room_code"] == "ABCDEF"
    assert view["seat"] == 0
    assert view["phase"] == "playing"
    assert view["turn"] == 0
    assert view["winner"] is None
    assert view["players"] == [
        {"nickname": "Ana", "connected": True, "wants_rematch": False},
        {"nickname": "Bo", "connected": False, "wants_rematch": True},
    ]
    assert view["fleet_placed"] == [True, True]
    assert view["own_fleet"][0] == {
        "kind": "carrier",
        "row": 0,
        "col": 0,
        "orientation": "horizontal",
    }
    assert view["shots_received"] == [{"row": 9, "col": 9, "result": "miss"}]
    assert view["shots_fired"] == [{"row": 4, "col": 0, "result": "hit"}]
    assert view["opponent_sunk"] == []
    assert view["opponent_fleet"] is None


def test_state_before_placement() -> None:
    view = state_message("ABCDEF", 1, Game(first_shooter=0), (PLAYERS[0], None))
    assert view["own_fleet"] is None
    assert view["fleet_placed"] == [False, False]
    assert view["players"][1] is None
    assert view["shots_fired"] == []


def test_finished_state_reveals_the_opponent_fleet() -> None:
    game = _playing_game()
    game.forfeit(1)
    view = state_message("ABCDEF", 0, game, PLAYERS)
    assert view["phase"] == "finished"
    assert view["winner"] == 0
    assert view["finish_reason"] == "forfeit"
    assert len(view["opponent_fleet"]) == 5


def test_sunk_opponent_ships_are_listed() -> None:
    game = _playing_game()
    game.fire(0, Coordinate(4, 0))
    game.fire(1, Coordinate(9, 9))
    game.fire(0, Coordinate(4, 1))
    view = state_message("ABCDEF", 0, game, PLAYERS)
    assert view["opponent_sunk"] == [
        {"kind": "destroyer", "row": 4, "col": 0, "orientation": "horizontal"}
    ]


def test_server_messages() -> None:
    assert joined_message(1, "ABCDEF", "tok") == {
        "type": "joined",
        "seat": 1,
        "room_code": "ABCDEF",
        "token": "tok",
    }
    assert shot_message(0, Coordinate(2, 3), ShotResult(ShotOutcome.SUNK, ShipKind.CRUISER)) == {
        "type": "shot",
        "by": 0,
        "row": 2,
        "col": 3,
        "result": "sunk",
        "kind": "cruiser",
    }
    error = error_message("not_your_turn")
    assert error["type"] == "error"
    assert error["code"] == "not_your_turn"
    assert error["message"]


def test_every_error_code_has_a_message() -> None:
    codes = {cls.code for cls in _all_subclasses(GameError)}
    for code in codes | {"rate_limited", "internal_error", "already_joined", "not_joined"}:
        assert error_message(code)["message"] != error_message("__unknown__")["message"], code


def _all_subclasses(cls: type[GameError]) -> set[type[GameError]]:
    direct = set(cls.__subclasses__())
    return direct.union(*(_all_subclasses(c) for c in direct))


def _opponent_cells_mentioned(view: dict[str, object]) -> set[tuple[int, int]]:
    """Every cell the view discloses about the opponent's board."""
    cells: set[tuple[int, int]] = set()
    for shot in view["shots_fired"]:  # type: ignore[attr-defined]
        cells.add((shot["row"], shot["col"]))
    for ship in view["opponent_sunk"]:  # type: ignore[attr-defined]
        placement = Placement(
            ShipKind(ship["kind"]),
            Coordinate(ship["row"], ship["col"]),
            Orientation(ship["orientation"]),
        )
        cells.update((c.row, c.col) for c in placement.cells())
    return cells


@given(
    valid_fleets(),
    valid_fleets(),
    st.lists(coordinates, max_size=60),
    st.lists(coordinates, max_size=60),
)
def test_a_player_never_sees_unhit_enemy_ships_before_the_end(
    fleet_a: list[Placement],
    fleet_b: list[Placement],
    shots_a: list[Coordinate],
    shots_b: list[Coordinate],
) -> None:
    game = Game(first_shooter=0)
    game.place_fleet(0, fleet_a)
    game.place_fleet(1, fleet_b)
    for shot_a, shot_b in zip(shots_a, shots_b, strict=False):
        for seat, shot in ((0, shot_a), (1, shot_b)):
            if game.phase.value != "playing":
                break
            try:
                game.fire(seat, shot)
            except GameError:
                game.fire(seat, next(c for c in _all_cells() if (seat, c) not in game.shot_log))
    if game.phase.value == "finished":
        return
    fired_by_a = {(c.row, c.col) for seat, c in game.shot_log if seat == 0}
    view = state_message("ABCDEF", 0, game, PLAYERS)
    assert view["opponent_fleet"] is None
    assert _opponent_cells_mentioned(view) <= fired_by_a
    unhit_b = {(c.row, c.col) for c in fleet_cells(fleet_b)} - fired_by_a
    serialized = json.dumps(
        {k: v for k, v in view.items() if k not in ("own_fleet", "shots_received")}
    )
    for row, col in unhit_b:
        assert f'"row": {row}, "col": {col}' not in serialized


def _all_cells() -> list[Coordinate]:
    return [Coordinate(r, c) for r in range(10) for c in range(10)]
