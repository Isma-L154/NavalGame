import random

from hypothesis import given
from hypothesis import strategies as st

from naval.domain.board import Board, ShotOutcome
from naval.domain.coordinates import BOARD_SIZE, Coordinate
from naval.domain.cpu import choose_shot, random_fleet
from naval.domain.fleet import Orientation, Placement, ShipKind
from tests.strategies import valid_fleets

seeds = st.integers(min_value=0, max_value=2**32 - 1)
HIT, MISS, SUNK = ShotOutcome.HIT, ShotOutcome.MISS, ShotOutcome.SUNK


def _neighbours(cell: Coordinate) -> set[Coordinate]:
    around = [(cell.row + dr, cell.col + dc) for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1))]
    return {Coordinate(r, c) for r, c in around if 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE}


def _open_hits(board: Board) -> set[Coordinate]:
    sunk = {cell for ship in board.sunk_ships for cell in ship.cells()}
    return {c for c, outcome in board.shots_received.items() if outcome is not MISS} - sunk


def _play(board: Board, rng: random.Random) -> int:
    """Fires the CPU at `board` until the fleet is sunk; a repeated shot raises."""
    shots = 0
    while not board.all_sunk:
        board.receive_shot(choose_shot(board.shots_received, board.sunk_ships, rng))
        shots += 1
    return shots


@given(seeds)
def test_random_fleets_are_valid(seed: int) -> None:
    Board.from_placements(random_fleet(random.Random(seed)))


@given(valid_fleets(), seeds)
def test_the_cpu_sinks_any_fleet_without_repeating_a_shot(
    fleet: list[Placement], seed: int
) -> None:
    assert _play(Board.from_placements(fleet), random.Random(seed)) <= BOARD_SIZE * BOARD_SIZE


@given(valid_fleets(), seeds)
def test_while_a_ship_is_hit_but_afloat_the_cpu_fires_next_to_a_hit(
    fleet: list[Placement], seed: int
) -> None:
    board = Board.from_placements(fleet)
    rng = random.Random(seed)
    while not board.all_sunk:
        free = {
            cell
            for hit in _open_hits(board)
            for cell in _neighbours(hit)
            if cell not in board.shots_received
        }
        target = choose_shot(board.shots_received, board.sunk_ships, rng)
        if free:
            assert target in free
        board.receive_shot(target)


def test_two_hits_in_a_row_are_followed_along_their_line() -> None:
    shots = {Coordinate(4, 4): HIT, Coordinate(4, 5): HIT}
    targets = {choose_shot(shots, [], random.Random(seed)) for seed in range(30)}
    assert targets == {Coordinate(4, 3), Coordinate(4, 6)}


def test_a_single_hit_is_probed_on_every_side() -> None:
    shots = {Coordinate(4, 4): HIT}
    targets = {choose_shot(shots, [], random.Random(seed)) for seed in range(60)}
    assert targets == _neighbours(Coordinate(4, 4))


def test_hits_on_a_sunk_ship_are_not_followed() -> None:
    destroyer = Placement(ShipKind.DESTROYER, Coordinate(0, 0), Orientation.HORIZONTAL)
    open_cells = {Coordinate(1, 0), Coordinate(9, 9)}
    shots = {
        Coordinate(row, col): MISS
        for row in range(BOARD_SIZE)
        for col in range(BOARD_SIZE)
        if Coordinate(row, col) not in open_cells
    }
    shots |= {Coordinate(0, 0): HIT, Coordinate(0, 1): SUNK}
    targets = {choose_shot(shots, [destroyer], random.Random(seed)) for seed in range(30)}
    assert targets == open_cells


def test_the_cpu_needs_far_fewer_shots_than_firing_at_random() -> None:
    # Firing at random needs about 95 shots to sink the whole fleet.
    rng = random.Random(2026)
    games = [_play(Board.from_placements(random_fleet(rng)), rng) for _ in range(200)]
    assert sum(games) / len(games) < 75
