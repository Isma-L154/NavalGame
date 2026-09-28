import random
from collections import Counter

import pytest
from hypothesis import given
from hypothesis import strategies as st

from naval.domain.board import Board, ShotOutcome, ShotResult
from naval.domain.coordinates import Coordinate
from naval.domain.errors import AlreadyFiredThere, InvalidFleet
from naval.domain.fleet import Orientation, Placement, ShipKind
from tests.domain.fixtures import ROW_FLEET, fleet_cells
from tests.strategies import valid_fleets


def test_valid_fleet_is_accepted() -> None:
    board = Board.from_placements(ROW_FLEET)
    assert board.placements == tuple(ROW_FLEET)
    assert not board.all_sunk


def test_missing_ship_is_rejected() -> None:
    with pytest.raises(InvalidFleet):
        Board.from_placements(ROW_FLEET[:-1])


def test_duplicate_ship_is_rejected() -> None:
    fleet = [*ROW_FLEET[:-1], Placement(ShipKind.CARRIER, Coordinate(5, 0), Orientation.HORIZONTAL)]
    with pytest.raises(InvalidFleet):
        Board.from_placements(fleet)


def test_extra_ship_is_rejected() -> None:
    extra = Placement(ShipKind.DESTROYER, Coordinate(6, 0), Orientation.HORIZONTAL)
    with pytest.raises(InvalidFleet):
        Board.from_placements([*ROW_FLEET, extra])


def test_overlapping_ships_are_rejected() -> None:
    fleet = [
        *ROW_FLEET[:-1],
        Placement(ShipKind.DESTROYER, Coordinate(3, 0), Orientation.VERTICAL),
    ]
    with pytest.raises(InvalidFleet):
        Board.from_placements(fleet)


def test_miss_hit_and_sunk() -> None:
    board = Board.from_placements(ROW_FLEET)
    assert board.receive_shot(Coordinate(9, 9)) == ShotResult(ShotOutcome.MISS, None)
    assert board.receive_shot(Coordinate(4, 0)) == ShotResult(ShotOutcome.HIT, None)
    assert board.receive_shot(Coordinate(4, 1)) == ShotResult(ShotOutcome.SUNK, ShipKind.DESTROYER)
    assert board.shots_received == {
        Coordinate(9, 9): ShotOutcome.MISS,
        Coordinate(4, 0): ShotOutcome.HIT,
        Coordinate(4, 1): ShotOutcome.SUNK,
    }


def test_firing_the_same_cell_twice_is_rejected() -> None:
    board = Board.from_placements(ROW_FLEET)
    board.receive_shot(Coordinate(5, 5))
    with pytest.raises(AlreadyFiredThere):
        board.receive_shot(Coordinate(5, 5))


def test_all_sunk_only_after_the_last_cell() -> None:
    board = Board.from_placements(ROW_FLEET)
    *all_but_last, last = fleet_cells(ROW_FLEET)
    for cell in all_but_last:
        board.receive_shot(cell)
    assert not board.all_sunk
    board.receive_shot(last)
    assert board.all_sunk


@given(valid_fleets())
def test_any_generated_fleet_is_valid(fleet: list[Placement]) -> None:
    Board.from_placements(fleet)


@given(valid_fleets(), st.randoms())
def test_firing_every_ship_cell_sinks_the_whole_fleet(
    fleet: list[Placement], rng: random.Random
) -> None:
    board = Board.from_placements(fleet)
    cells = fleet_cells(fleet)
    rng.shuffle(cells)
    results = [board.receive_shot(cell) for cell in cells]
    assert board.all_sunk
    sunk = Counter(r.kind for r in results if r.outcome is ShotOutcome.SUNK)
    assert sunk == Counter(ShipKind)


@given(valid_fleets(), st.data())
def test_fleets_with_a_shared_cell_are_rejected(
    fleet: list[Placement], data: st.DataObject
) -> None:
    moved_index = data.draw(st.integers(min_value=1, max_value=len(fleet) - 1))
    target = fleet[data.draw(st.integers(min_value=0, max_value=moved_index - 1))]
    moved = fleet[moved_index]
    overlapping = Placement(moved.kind, target.origin, moved.orientation)
    try:
        overlapping.cells()
    except InvalidFleet:
        return
    fleet[moved_index] = overlapping
    with pytest.raises(InvalidFleet):
        Board.from_placements(fleet)


def test_sunk_ships_lists_only_fully_hit_ships() -> None:
    board = Board.from_placements(ROW_FLEET)
    board.receive_shot(Coordinate(4, 0))
    assert len(board.sunk_ships) == 0
    board.receive_shot(Coordinate(4, 1))
    assert list(board.sunk_ships) == [ROW_FLEET[4]]
