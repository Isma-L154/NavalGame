from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from naval.domain.board import ShotOutcome, ShotResult
from naval.domain.coordinates import Coordinate
from naval.domain.fleet import Placement
from naval.domain.game import Game, Phase, other
from naval.protocol.ships import ship_to_dict

Message = dict[str, Any]

_ERROR_TEXT = {
    "invalid_message": "That message could not be understood.",
    "invalid_coordinate": "That cell is outside the board.",
    "invalid_fleet": "Place each ship exactly once, inside the board, without overlaps.",
    "invalid_seat": "That seat does not exist.",
    "wrong_phase": "That action is not available right now.",
    "not_your_turn": "Wait for your turn.",
    "already_fired_there": "You already fired at that cell.",
    "fleet_already_placed": "Your fleet is already placed.",
    "room_full": "This room already has two players.",
    "invalid_token": "Your session for this room is no longer valid.",
    "waiting_for_opponent": "Wait for an opponent to join.",
    "not_seated": "You are not seated in this room.",
    "already_joined": "You already joined this room.",
    "not_joined": "Join the room first.",
    "rate_limited": "Slow down: too many messages.",
    "internal_error": "Something went wrong on our side.",
    "room_closed": "This room has closed.",
}
_UNKNOWN_ERROR_TEXT = "Something went wrong."


@dataclass(frozen=True, slots=True)
class PlayerView:
    nickname: str
    connected: bool


def state_message(
    room_code: str, seat: int, game: Game, players: Sequence[PlayerView | None]
) -> Message:
    own_board = game.boards[seat]
    enemy_board = game.boards[other(seat)]
    finished = game.phase is Phase.FINISHED
    return {
        "type": "state",
        "room_code": room_code,
        "seat": seat,
        "phase": game.phase.value,
        "turn": game.turn,
        "winner": game.winner,
        "finish_reason": game.finish_reason.value if game.finish_reason else None,
        "players": [
            None if p is None else {"nickname": p.nickname, "connected": p.connected}
            for p in players
        ],
        "fleet_placed": [board is not None for board in game.boards],
        "own_fleet": _ships(own_board.placements) if own_board else None,
        "shots_received": _shots(own_board.shots_received) if own_board else [],
        "shots_fired": _shots(enemy_board.shots_received) if enemy_board else [],
        "opponent_sunk": _ships(enemy_board.sunk_ships) if enemy_board else [],
        # The opponent's fleet stays on the server until the game is over.
        "opponent_fleet": _ships(enemy_board.placements) if finished and enemy_board else None,
    }


def joined_message(seat: int, room_code: str, token: str | None) -> Message:
    return {"type": "joined", "seat": seat, "room_code": room_code, "token": token}


def shot_message(by: int, target: Coordinate, result: ShotResult) -> Message:
    return {
        "type": "shot",
        "by": by,
        "row": target.row,
        "col": target.col,
        "result": result.outcome.value,
        "kind": result.kind.value if result.kind else None,
    }


def error_message(code: str) -> Message:
    return {"type": "error", "code": code, "message": _ERROR_TEXT.get(code, _UNKNOWN_ERROR_TEXT)}


def _ships(placements: Sequence[Placement]) -> list[Message]:
    return [ship_to_dict(p) for p in placements]


def _shots(shots: Mapping[Coordinate, ShotOutcome]) -> list[Message]:
    return [
        {"row": c.row, "col": c.col, "result": outcome.value}
        for c, outcome in sorted(shots.items())
    ]
