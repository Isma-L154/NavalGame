from dataclasses import dataclass

from naval.domain.errors import InvalidCoordinate

BOARD_SIZE = 10


@dataclass(frozen=True, slots=True, order=True)
class Coordinate:
    row: int
    col: int

    def __post_init__(self) -> None:
        if not (0 <= self.row < BOARD_SIZE and 0 <= self.col < BOARD_SIZE):
            raise InvalidCoordinate(f"({self.row}, {self.col}) is outside the board")
