from enum import StrEnum

from pydantic import BaseModel, ConfigDict, ValidationError

MAX_REQUEST_BYTES = 256


class Opponent(StrEnum):
    FRIEND = "friend"
    CPU = "cpu"


class InvalidRequest(Exception):
    pass


class CreateRoomRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    opponent: Opponent = Opponent.FRIEND


def parse_create_room(body: str) -> CreateRoomRequest:
    """The body of POST /api/rooms; an empty one asks for a game with a friend."""
    try:
        size = len(body.encode())
    except UnicodeEncodeError as error:
        raise InvalidRequest("request body is not valid text") from error
    if size > MAX_REQUEST_BYTES:
        raise InvalidRequest("request body too large")
    if not body.strip():
        return CreateRoomRequest()
    try:
        return CreateRoomRequest.model_validate_json(body)
    except (ValidationError, ValueError) as error:
        raise InvalidRequest("request does not match the protocol") from error
