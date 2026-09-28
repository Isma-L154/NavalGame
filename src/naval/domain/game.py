from collections.abc import Sequence
from enum import StrEnum

from naval.domain.board import Board, ShotResult
from naval.domain.coordinates import Coordinate
from naval.domain.errors import FleetAlreadyPlaced, InvalidSeat, NotYourTurn, WrongPhase
from naval.domain.fleet import Placement

SEATS = (0, 1)


class Phase(StrEnum):
    PLACING = "placing"
    PLAYING = "playing"
    FINISHED = "finished"


class FinishReason(StrEnum):
    FLEET_SUNK = "fleet_sunk"
    FORFEIT = "forfeit"


def other(seat: int) -> int:
    return 1 - seat


def _check_seat(seat: int) -> None:
    if seat not in SEATS:
        raise InvalidSeat(f"seat {seat} does not exist")


class Game:
    def __init__(self, first_shooter: int) -> None:
        _check_seat(first_shooter)
        self.first_shooter = first_shooter
        self.phase = Phase.PLACING
        self.turn: int | None = None
        self.winner: int | None = None
        self.finish_reason: FinishReason | None = None
        self._boards: list[Board | None] = [None, None]
        self._shot_log: list[tuple[int, Coordinate]] = []

    @property
    def boards(self) -> tuple[Board | None, Board | None]:
        return self._boards[0], self._boards[1]

    @property
    def shot_log(self) -> tuple[tuple[int, Coordinate], ...]:
        """Every accepted shot in order, as (shooter seat, target)."""
        return tuple(self._shot_log)

    def place_fleet(self, seat: int, placements: Sequence[Placement]) -> None:
        _check_seat(seat)
        if self.phase is not Phase.PLACING:
            raise WrongPhase("fleets can only be placed before the battle")
        if self._boards[seat] is not None:
            raise FleetAlreadyPlaced("this fleet is already placed")
        self._boards[seat] = Board.from_placements(placements)
        if all(board is not None for board in self._boards):
            self.phase = Phase.PLAYING
            self.turn = self.first_shooter

    def fire(self, seat: int, target: Coordinate) -> ShotResult:
        _check_seat(seat)
        if self.phase is not Phase.PLAYING:
            raise WrongPhase("shots can only be fired during the battle")
        if seat != self.turn:
            raise NotYourTurn("wait for your turn")
        enemy_board = self._boards[other(seat)]
        if enemy_board is None:
            raise RuntimeError("both boards must exist while playing")
        result = enemy_board.receive_shot(target)
        self._shot_log.append((seat, target))
        if enemy_board.all_sunk:
            self._finish(winner=seat, reason=FinishReason.FLEET_SUNK)
        else:
            self.turn = other(seat)
        return result

    def forfeit(self, seat: int) -> None:
        _check_seat(seat)
        if self.phase is Phase.PLAYING:
            self._finish(winner=other(seat), reason=FinishReason.FORFEIT)

    def _finish(self, winner: int, reason: FinishReason) -> None:
        self.phase = Phase.FINISHED
        self.turn = None
        self.winner = winner
        self.finish_reason = reason
