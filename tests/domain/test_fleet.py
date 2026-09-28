import pytest

from naval.domain.coordinates import BOARD_SIZE, Coordinate
from naval.domain.errors import GameError, InvalidCoordinate, InvalidFleet
from naval.domain.fleet import STANDARD_FLEET, Orientation, Placement, ShipKind


@pytest.mark.parametrize(("row", "col"), [(0, 0), (0, 9), (9, 0), (9, 9)])
def test_corner_coordinates_are_valid(row: int, col: int) -> None:
    assert Coordinate(row, col) == Coordinate(row, col)


@pytest.mark.parametrize(("row", "col"), [(-1, 0), (0, -1), (10, 0), (0, 10)])
def test_coordinates_outside_the_board_are_rejected(row: int, col: int) -> None:
    with pytest.raises(InvalidCoordinate):
        Coordinate(row, col)


def test_errors_carry_stable_codes() -> None:
    assert InvalidCoordinate.code == "invalid_coordinate"
    assert issubclass(InvalidFleet, GameError)


def test_board_is_ten_by_ten() -> None:
    assert BOARD_SIZE == 10


def test_standard_fleet_lengths() -> None:
    assert [kind.length for kind in STANDARD_FLEET] == [5, 4, 3, 3, 2]
    assert ShipKind.CARRIER.value == "carrier"


def test_horizontal_placement_cells() -> None:
    placement = Placement(ShipKind.DESTROYER, Coordinate(2, 3), Orientation.HORIZONTAL)
    assert placement.cells() == (Coordinate(2, 3), Coordinate(2, 4))


def test_vertical_placement_cells() -> None:
    placement = Placement(ShipKind.CRUISER, Coordinate(7, 0), Orientation.VERTICAL)
    assert placement.cells() == (Coordinate(7, 0), Coordinate(8, 0), Coordinate(9, 0))


@pytest.mark.parametrize(
    ("origin", "orientation"),
    [(Coordinate(0, 6), Orientation.HORIZONTAL), (Coordinate(6, 0), Orientation.VERTICAL)],
)
def test_placement_running_off_the_board_is_rejected(
    origin: Coordinate, orientation: Orientation
) -> None:
    with pytest.raises(InvalidFleet):
        Placement(ShipKind.CARRIER, origin, orientation).cells()
