"""The computer opponent: a fleet placed at random, and shots chosen the way a person would."""

import random
from collections.abc import Iterable, Mapping, Sequence

from naval.domain.board import ShotOutcome
from naval.domain.coordinates import BOARD_SIZE, Coordinate
from naval.domain.fleet import STANDARD_FLEET, Orientation, Placement, ShipKind

_LINES = ((0, 1), (1, 0))


def random_fleet(rng: random.Random) -> tuple[Placement, ...]:
    """A valid standard fleet: each ship, largest first, anywhere it still fits."""
    occupied: set[Coordinate] = set()
    fleet = []
    for kind in STANDARD_FLEET:
        placement = rng.choice(_fitting(kind, occupied))
        occupied.update(placement.cells())
        fleet.append(placement)
    return tuple(fleet)


def choose_shot(
    shots: Mapping[Coordinate, ShotOutcome], sunk: Sequence[Placement], rng: random.Random
) -> Coordinate:
    """The next target, from what the shooter knows: its shots and the ships it has sunk.

    While a ship is hit but afloat, fire along a line of hits, else next to a hit; otherwise
    anywhere not yet fired at.
    """
    sunk_cells = {cell for ship in sunk for cell in ship.cells()}
    open_hits = {c for c, outcome in shots.items() if outcome is not ShotOutcome.MISS} - sunk_cells
    candidates = _line_ends(open_hits, shots) or _free_neighbours(open_hits, shots)
    if not candidates:
        candidates = {cell for cell in _board() if cell not in shots}
    return rng.choice(sorted(candidates))


def _fitting(kind: ShipKind, occupied: set[Coordinate]) -> list[Placement]:
    options = []
    for orientation in Orientation:
        placements = (Placement(kind, cell, orientation) for cell in _board())
        options += [p for p in placements if _fits(p) and occupied.isdisjoint(p.cells())]
    return options


def _fits(placement: Placement) -> bool:
    d_row, d_col = (0, 1) if placement.orientation is Orientation.HORIZONTAL else (1, 0)
    end = placement.kind.length - 1
    return _step(placement.origin, d_row * end, d_col * end) is not None


def _line_ends(
    open_hits: set[Coordinate], shots: Mapping[Coordinate, ShotOutcome]
) -> set[Coordinate]:
    """The free cells just beyond each run of two or more open hits in a row or a column."""
    ends: set[Coordinate] = set()
    for hit in open_hits:
        for d_row, d_col in _LINES:
            if _step(hit, -d_row, -d_col) in open_hits:
                continue  # each run is walked from its first cell only
            run = [hit]
            while (following := _step(run[-1], d_row, d_col)) in open_hits:
                run.append(following)
            if len(run) > 1:
                beyond = (_step(run[0], -d_row, -d_col), _step(run[-1], d_row, d_col))
                ends.update(_free(beyond, shots))
    return ends


def _free_neighbours(
    open_hits: set[Coordinate], shots: Mapping[Coordinate, ShotOutcome]
) -> set[Coordinate]:
    around = (
        _step(hit, d_row * sign, d_col * sign)
        for hit in open_hits
        for d_row, d_col in _LINES
        for sign in (1, -1)
    )
    return _free(around, shots)


def _free(
    cells: Iterable[Coordinate | None], shots: Mapping[Coordinate, ShotOutcome]
) -> set[Coordinate]:
    return {cell for cell in cells if cell is not None and cell not in shots}


def _step(cell: Coordinate, d_row: int, d_col: int) -> Coordinate | None:
    row, col = cell.row + d_row, cell.col + d_col
    return Coordinate(row, col) if 0 <= row < BOARD_SIZE and 0 <= col < BOARD_SIZE else None


def _board() -> list[Coordinate]:
    return [Coordinate(row, col) for row in range(BOARD_SIZE) for col in range(BOARD_SIZE)]
