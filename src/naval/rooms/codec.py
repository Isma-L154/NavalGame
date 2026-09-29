"""Persists a room as JSON; the game is stored as events and rebuilt by replaying them."""

import json
from dataclasses import asdict
from typing import Any

from naval.domain.coordinates import Coordinate
from naval.domain.flags import Flag
from naval.domain.game import FinishReason, Game, other
from naval.protocol.ships import ship_from_dict, ship_to_dict
from naval.rooms.room import Player, Room

_FORMAT_VERSION = 1


def room_to_json(room: Room) -> str:
    game = room.game
    forfeited_by = (
        other(game.winner)
        if game.finish_reason is FinishReason.FORFEIT and game.winner is not None
        else None
    )
    return json.dumps(
        {
            "version": _FORMAT_VERSION,
            "code": room.code,
            "created_at": room.created_at,
            "last_activity": room.last_activity,
            "players": [None if p is None else _player_to_dict(p) for p in room.players],
            "game": {
                "first_shooter": game.first_shooter,
                "fleets": [
                    None if board is None else [ship_to_dict(p) for p in board.placements]
                    for board in game.boards
                ],
                "shots": [[seat, c.row, c.col] for seat, c in game.shot_log],
                "forfeited_by": forfeited_by,
            },
        }
    )


def room_from_json(data: str) -> Room:
    raw = json.loads(data)
    if raw["version"] != _FORMAT_VERSION:
        raise ValueError(f"unsupported room format {raw['version']}")
    return Room(
        raw["code"],
        created_at=raw["created_at"],
        players=[None if p is None else _player(p) for p in raw["players"]],
        game=_replay(raw["game"]),
        last_activity=raw["last_activity"],
    )


def _player_to_dict(player: Player) -> dict[str, Any]:
    # join_hash and cpu are written only while set, so rooms stay readable by older versions.
    stored = asdict(player)
    if stored["join_hash"] is None:
        del stored["join_hash"]
    if not stored["cpu"]:
        del stored["cpu"]
    return stored


def _player(raw: dict[str, Any]) -> Player:
    return Player(**{**raw, "flag": Flag(raw["flag"])})


def _replay(raw: dict[str, Any]) -> Game:
    game = Game(raw["first_shooter"])
    for seat, fleet in enumerate(raw["fleets"]):
        if fleet is not None:
            game.place_fleet(seat, [ship_from_dict(ship) for ship in fleet])
    for seat, row, col in raw["shots"]:
        game.fire(seat, Coordinate(row, col))
    if raw["forfeited_by"] is not None:
        game.forfeit(raw["forfeited_by"])
    return game
