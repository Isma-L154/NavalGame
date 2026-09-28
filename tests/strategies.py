from hypothesis import strategies as st

from naval.domain.coordinates import BOARD_SIZE, Coordinate
from naval.domain.fleet import STANDARD_FLEET, Orientation, Placement


def _fitting_placements(kind_index: int, occupied: set[Coordinate]) -> list[Placement]:
    kind = STANDARD_FLEET[kind_index]
    options = []
    for orientation in Orientation:
        for row in range(BOARD_SIZE):
            for col in range(BOARD_SIZE):
                d_row, d_col = (0, 1) if orientation is Orientation.HORIZONTAL else (1, 0)
                if row + d_row * (kind.length - 1) >= BOARD_SIZE:
                    continue
                if col + d_col * (kind.length - 1) >= BOARD_SIZE:
                    continue
                placement = Placement(kind, Coordinate(row, col), orientation)
                if occupied.isdisjoint(placement.cells()):
                    options.append(placement)
    return options


@st.composite
def valid_fleets(draw: st.DrawFn) -> list[Placement]:
    occupied: set[Coordinate] = set()
    fleet = []
    for index in range(len(STANDARD_FLEET)):
        placement = draw(st.sampled_from(_fitting_placements(index, occupied)))
        occupied.update(placement.cells())
        fleet.append(placement)
    return fleet


coordinates = st.builds(
    Coordinate,
    st.integers(min_value=0, max_value=BOARD_SIZE - 1),
    st.integers(min_value=0, max_value=BOARD_SIZE - 1),
)
