from typing import ClassVar


class GameError(Exception):
    """A rule violation the client can be told about; `code` is part of the wire protocol."""

    code: ClassVar[str] = "game_error"


class InvalidCoordinate(GameError):
    code = "invalid_coordinate"


class InvalidFleet(GameError):
    code = "invalid_fleet"


class InvalidSeat(GameError):
    code = "invalid_seat"


class WrongPhase(GameError):
    code = "wrong_phase"


class NotYourTurn(GameError):
    code = "not_your_turn"


class AlreadyFiredThere(GameError):
    code = "already_fired_there"


class FleetAlreadyPlaced(GameError):
    code = "fleet_already_placed"
