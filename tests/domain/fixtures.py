from naval.domain.coordinates import Coordinate
from naval.domain.fleet import Orientation, Placement, ShipKind

# Every ship horizontal, one per row, starting at column 0: rows 0-4.
ROW_FLEET = [
    Placement(ShipKind.CARRIER, Coordinate(0, 0), Orientation.HORIZONTAL),
    Placement(ShipKind.BATTLESHIP, Coordinate(1, 0), Orientation.HORIZONTAL),
    Placement(ShipKind.CRUISER, Coordinate(2, 0), Orientation.HORIZONTAL),
    Placement(ShipKind.SUBMARINE, Coordinate(3, 0), Orientation.HORIZONTAL),
    Placement(ShipKind.DESTROYER, Coordinate(4, 0), Orientation.HORIZONTAL),
]


def fleet_cells(fleet: list[Placement]) -> list[Coordinate]:
    return [cell for placement in fleet for cell in placement.cells()]
