from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from naval.domain.coordinates import BOARD_SIZE, Coordinate
from naval.domain.errors import GameError
from naval.domain.flags import Flag
from naval.domain.fleet import STANDARD_FLEET, Orientation, Placement, ShipKind

MAX_FRAME_BYTES = 4096

# Letters, digits, space, underscore and hyphen; no leading or trailing space.
NICKNAME_PATTERN = r"^[A-Za-z0-9_-](?:[A-Za-z0-9 _-]{0,18}[A-Za-z0-9_-])?$"
TOKEN_PATTERN = r"^[A-Za-z0-9_-]{43}$"  # noqa: S105 - a format, not a credential

GridIndex = Annotated[int, Field(ge=0, lt=BOARD_SIZE)]


class InvalidMessage(GameError):
    code = "invalid_message"


class _Message(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class JoinMessage(_Message):
    type: Literal["join"]
    nickname: Annotated[str, Field(pattern=NICKNAME_PATTERN)]
    token: Annotated[str, Field(pattern=TOKEN_PATTERN)] | None = None
    # Optional so that a page loaded before flags existed can still join.
    flag: Flag | None = None
    # Random per fresh join, repeated if the reply carrying the token was lost (see Room.join).
    join_id: Annotated[str, Field(pattern=TOKEN_PATTERN)] | None = None


class ChooseFlagMessage(_Message):
    type: Literal["choose_flag"]
    flag: Flag


class ShipSpec(_Message):
    kind: ShipKind
    row: GridIndex
    col: GridIndex
    orientation: Orientation

    def to_placement(self) -> Placement:
        return Placement(self.kind, Coordinate(self.row, self.col), self.orientation)


class PlaceFleetMessage(_Message):
    type: Literal["place_fleet"]
    ships: Annotated[
        list[ShipSpec], Field(min_length=len(STANDARD_FLEET), max_length=len(STANDARD_FLEET))
    ]


class FireMessage(_Message):
    type: Literal["fire"]
    row: GridIndex
    col: GridIndex


class RematchMessage(_Message):
    type: Literal["rematch"]


class LeaveMessage(_Message):
    type: Literal["leave"]


ClientMessage = Annotated[
    JoinMessage
    | ChooseFlagMessage
    | PlaceFleetMessage
    | FireMessage
    | RematchMessage
    | LeaveMessage,
    Field(discriminator="type"),
]

_client_message: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


def parse_client_message(raw: str | bytes) -> ClientMessage:
    if not isinstance(raw, str):
        raise InvalidMessage("only text frames are accepted")
    try:
        size = len(raw.encode())
    except UnicodeEncodeError as error:
        raise InvalidMessage("frame is not valid text") from error
    if size > MAX_FRAME_BYTES:
        raise InvalidMessage("frame too large")
    try:
        return _client_message.validate_json(raw)
    except (ValidationError, ValueError) as error:
        raise InvalidMessage("message does not match the protocol") from error
