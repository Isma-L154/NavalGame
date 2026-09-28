from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType

from naval.domain.coordinates import Coordinate
from naval.domain.errors import AlreadyFiredThere, InvalidFleet
from naval.domain.fleet import STANDARD_FLEET, Placement, ShipKind


class ShotOutcome(StrEnum):
    MISS = "miss"
    HIT = "hit"
    SUNK = "sunk"


@dataclass(frozen=True, slots=True)
class ShotResult:
    outcome: ShotOutcome
    kind: ShipKind | None = None


class Board:
    def __init__(self, placements: tuple[Placement, ...]) -> None:
        self._placements = placements
        self._ship_at: dict[Coordinate, Placement] = {
            cell: placement for placement in placements for cell in placement.cells()
        }
        self._shots: dict[Coordinate, ShotOutcome] = {}

    @classmethod
    def from_placements(cls, placements: Sequence[Placement]) -> Board:
        if Counter(p.kind for p in placements) != Counter(STANDARD_FLEET):
            raise InvalidFleet("the fleet must contain exactly one of each ship")
        occupied: set[Coordinate] = set()
        for placement in placements:
            cells = placement.cells()
            if not occupied.isdisjoint(cells):
                raise InvalidFleet("ships may not overlap")
            occupied.update(cells)
        return cls(tuple(placements))

    @property
    def placements(self) -> tuple[Placement, ...]:
        return self._placements

    @property
    def shots_received(self) -> Mapping[Coordinate, ShotOutcome]:
        return MappingProxyType(self._shots)

    @property
    def all_sunk(self) -> bool:
        return all(cell in self._shots for cell in self._ship_at)

    def receive_shot(self, target: Coordinate) -> ShotResult:
        if target in self._shots:
            raise AlreadyFiredThere(f"({target.row}, {target.col}) was already targeted")
        ship = self._ship_at.get(target)
        if ship is None:
            self._shots[target] = ShotOutcome.MISS
            return ShotResult(ShotOutcome.MISS)
        if all(cell in self._shots or cell == target for cell in ship.cells()):
            self._shots[target] = ShotOutcome.SUNK
            return ShotResult(ShotOutcome.SUNK, ship.kind)
        self._shots[target] = ShotOutcome.HIT
        return ShotResult(ShotOutcome.HIT)
