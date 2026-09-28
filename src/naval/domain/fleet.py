from dataclasses import dataclass
from enum import StrEnum

from naval.domain.coordinates import BOARD_SIZE, Coordinate
from naval.domain.errors import InvalidFleet


class ShipKind(StrEnum):
    CARRIER = "carrier"
    BATTLESHIP = "battleship"
    CRUISER = "cruiser"
    SUBMARINE = "submarine"
    DESTROYER = "destroyer"

    @property
    def length(self) -> int:
        return _LENGTHS[self]


_LENGTHS = {
    ShipKind.CARRIER: 5,
    ShipKind.BATTLESHIP: 4,
    ShipKind.CRUISER: 3,
    ShipKind.SUBMARINE: 3,
    ShipKind.DESTROYER: 2,
}

STANDARD_FLEET: tuple[ShipKind, ...] = tuple(ShipKind)


class Orientation(StrEnum):
    HORIZONTAL = "horizontal"
    VERTICAL = "vertical"


@dataclass(frozen=True, slots=True)
class Placement:
    kind: ShipKind
    origin: Coordinate
    orientation: Orientation

    def cells(self) -> tuple[Coordinate, ...]:
        d_row, d_col = (0, 1) if self.orientation is Orientation.HORIZONTAL else (1, 0)
        last_row = self.origin.row + d_row * (self.kind.length - 1)
        last_col = self.origin.col + d_col * (self.kind.length - 1)
        if last_row >= BOARD_SIZE or last_col >= BOARD_SIZE:
            raise InvalidFleet(f"{self.kind} does not fit on the board")
        return tuple(
            Coordinate(self.origin.row + d_row * i, self.origin.col + d_col * i)
            for i in range(self.kind.length)
        )
