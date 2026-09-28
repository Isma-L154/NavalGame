from typing import Any

from naval.domain.coordinates import Coordinate
from naval.domain.fleet import Orientation, Placement, ShipKind


def ship_to_dict(placement: Placement) -> dict[str, Any]:
    return {
        "kind": placement.kind.value,
        "row": placement.origin.row,
        "col": placement.origin.col,
        "orientation": placement.orientation.value,
    }


def ship_from_dict(data: dict[str, Any]) -> Placement:
    return Placement(
        ShipKind(data["kind"]),
        Coordinate(data["row"], data["col"]),
        Orientation(data["orientation"]),
    )
