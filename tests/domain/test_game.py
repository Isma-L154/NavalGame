import pytest

from naval.domain.board import ShotOutcome
from naval.domain.coordinates import Coordinate
from naval.domain.errors import (
    AlreadyFiredThere,
    FleetAlreadyPlaced,
    InvalidSeat,
    NotYourTurn,
    WrongPhase,
)
from naval.domain.game import FinishReason, Game, Phase, other
from tests.domain.fixtures import ROW_FLEET, fleet_cells

EMPTY_WATER = Coordinate(9, 9)


def _playing_game(first_shooter: int = 0) -> Game:
    game = Game(first_shooter)
    game.place_fleet(0, ROW_FLEET)
    game.place_fleet(1, ROW_FLEET)
    return game


def test_new_game_waits_for_fleets() -> None:
    game = Game(first_shooter=1)
    assert game.phase is Phase.PLACING
    assert game.turn is None
    assert game.boards == (None, None)


def test_game_keeps_placing_with_one_fleet() -> None:
    game = Game(first_shooter=1)
    game.place_fleet(0, ROW_FLEET)
    assert game.phase is Phase.PLACING


def test_game_starts_when_both_fleets_are_placed() -> None:
    game = _playing_game(first_shooter=1)
    assert game.phase is Phase.PLAYING
    assert game.turn == 1


def test_placing_twice_is_rejected() -> None:
    game = Game(first_shooter=0)
    game.place_fleet(0, ROW_FLEET)
    with pytest.raises(FleetAlreadyPlaced):
        game.place_fleet(0, ROW_FLEET)


def test_invalid_seat_is_rejected() -> None:
    with pytest.raises(InvalidSeat):
        Game(first_shooter=0).place_fleet(2, ROW_FLEET)
    with pytest.raises(InvalidSeat):
        Game(first_shooter=5)


def test_placing_after_the_game_started_is_rejected() -> None:
    with pytest.raises(WrongPhase):
        _playing_game().place_fleet(0, ROW_FLEET)


def test_firing_while_placing_is_rejected() -> None:
    with pytest.raises(WrongPhase):
        Game(first_shooter=0).fire(0, EMPTY_WATER)


def test_firing_out_of_turn_is_rejected() -> None:
    with pytest.raises(NotYourTurn):
        _playing_game(first_shooter=0).fire(1, EMPTY_WATER)


def test_turn_alternates_after_a_miss_and_after_a_hit() -> None:
    game = _playing_game(first_shooter=0)
    assert game.fire(0, EMPTY_WATER).outcome is ShotOutcome.MISS
    assert game.turn == 1
    assert game.fire(1, Coordinate(0, 0)).outcome is ShotOutcome.HIT
    assert game.turn == 0


def test_refiring_does_not_consume_the_turn() -> None:
    game = _playing_game(first_shooter=0)
    game.fire(0, EMPTY_WATER)
    game.fire(1, EMPTY_WATER)
    with pytest.raises(AlreadyFiredThere):
        game.fire(0, EMPTY_WATER)
    assert game.turn == 0


def test_sinking_the_whole_fleet_wins() -> None:
    game = _playing_game(first_shooter=0)
    misses = iter(Coordinate(row, col) for row in range(5, 10) for col in range(10))
    targets = fleet_cells(ROW_FLEET)
    for target in targets[:-1]:
        game.fire(0, target)
        game.fire(1, next(misses))
    game.fire(0, targets[-1])
    assert game.phase is Phase.FINISHED
    assert game.winner == 0
    assert game.finish_reason is FinishReason.FLEET_SUNK
    assert game.turn is None
    with pytest.raises(WrongPhase):
        game.fire(1, Coordinate(8, 8))


def test_forfeit_while_playing_gives_the_win_to_the_opponent() -> None:
    game = _playing_game()
    game.forfeit(0)
    assert game.phase is Phase.FINISHED
    assert game.winner == 1
    assert game.finish_reason is FinishReason.FORFEIT


def test_forfeit_outside_play_is_ignored() -> None:
    game = Game(first_shooter=0)
    game.forfeit(0)
    assert game.phase is Phase.PLACING
    assert game.winner is None


def test_other_seat() -> None:
    assert other(0) == 1
    assert other(1) == 0
