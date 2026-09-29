from collections.abc import Sequence
from dataclasses import dataclass

from naval.domain.board import ShotResult
from naval.domain.coordinates import Coordinate
from naval.domain.errors import GameError, WrongPhase
from naval.domain.flags import Flag
from naval.domain.fleet import Placement
from naval.domain.game import SEATS, Game, Phase, other
from naval.rooms.tokens import hash_token, new_seat_token, token_matches

RECONNECT_GRACE_SECONDS = 120.0
IDLE_TIMEOUT_SECONDS = 3600.0

CPU_NICKNAME = "CPU"
CPU_FLAG = Flag.C  # C for CPU
CPU_THINK_SECONDS = 0.9
_CPU_SEAT = 1


class RoomFull(GameError):
    code = "room_full"


class InvalidToken(GameError):
    code = "invalid_token"


class OpponentMissing(GameError):
    code = "waiting_for_opponent"


class NotSeated(GameError):
    code = "not_seated"


class FlagTaken(GameError):
    code = "flag_taken"


@dataclass
class Player:
    nickname: str
    token_hash: str
    flag: Flag
    # Hash of the join id that took this seat, until the player proves they got the token.
    join_hash: str | None = None
    connected: bool = True
    disconnected_at: float | None = None
    wants_rematch: bool = False
    cpu: bool = False


class Room:
    def __init__(
        self,
        code: str,
        created_at: float,
        *,
        players: Sequence[Player | None] = (None, None),
        game: Game | None = None,
        last_activity: float | None = None,
    ) -> None:
        self.code = code
        self.created_at = created_at
        self.players: list[Player | None] = list(players)
        self.game = game if game is not None else Game(first_shooter=0)
        self.last_activity = created_at if last_activity is None else last_activity

    def join(  # noqa: PLR0913 - the one way in, for new and returning players alike
        self,
        nickname: str,
        token: str | None,
        now: float,
        first_shooter: int,
        *,
        flag: Flag | None = None,
        join_id: str | None = None,
    ) -> tuple[int, str | None]:
        """Returns the seat and, for a new seat only, the token that reclaims it later.

        A new player gets the flag they asked for, or the first free one when it is taken or
        missing; a returning player keeps theirs.

        A fresh join repeated with the same `join_id` and nickname (its reply, which carried the
        token, was lost with the connection) gets that seat back with a new token; the lost one
        stops working. The join id counts until the player shows they have the token: by
        reconnecting with it, or by any seated message (see `token_delivered`).
        """
        if token is not None:
            return self._reconnect(token, now), None
        if join_id is not None:
            reclaimed = self._reclaim(join_id, nickname, now)
            if reclaimed is not None:
                return reclaimed
        seat = next((s for s in SEATS if self.players[s] is None), None)
        if seat is None:
            raise RoomFull("this room already has two players")
        taken = self._flag_to_avoid(seat)
        # Compared by value: a plain "a" and Flag.A must count as the same flag.
        if flag is None or flag == taken:
            flag = next(f for f in Flag if f != taken)
        new_token = new_seat_token()
        self.players[seat] = Player(
            nickname=nickname,
            token_hash=hash_token(new_token),
            flag=flag,
            join_hash=None if join_id is None else hash_token(join_id),
        )
        self._cpu_yield_flag()
        self._start_new_game(first_shooter)
        self._touch(now)
        return seat, new_token

    def disconnect(self, seat: int, now: float) -> None:
        player = self._player(seat)
        if not player.connected:
            return
        player.connected = False
        player.disconnected_at = now
        self._touch(now)

    def leave(self, seat: int, now: float) -> None:
        self._player(seat)
        self.game.forfeit(seat)
        self.players[seat] = None
        self._clear_rematch_votes()
        self._touch(now)

    def expire(self, now: float) -> list[int]:
        """Releases seats whose reconnection grace period has run out."""
        expired = [
            seat
            for seat, player in enumerate(self.players)
            if player is not None
            and player.disconnected_at is not None
            and now - player.disconnected_at >= RECONNECT_GRACE_SECONDS
        ]
        for seat in expired:
            self.leave(seat, now)
        return expired

    def choose_flag(self, seat: int, flag: Flag, now: float) -> None:
        player = self._player(seat)
        if self.game.phase is not Phase.PLACING:
            raise WrongPhase("the flag can only change before the battle")
        if flag == self._flag_to_avoid(seat):
            raise FlagTaken("the opponent already flies this flag")
        player.flag = flag
        self._cpu_yield_flag()
        self._touch(now)

    def place_fleet(self, seat: int, placements: Sequence[Placement], now: float) -> None:
        self._player(seat)
        self._require_opponent(seat)
        self.game.place_fleet(seat, placements)
        self._touch(now)

    def fire(self, seat: int, target: Coordinate, now: float) -> ShotResult:
        self._player(seat)
        result = self.game.fire(seat, target)
        self._touch(now)
        return result

    def request_rematch(self, seat: int, first_shooter: int, now: float) -> bool:
        """Records a vote; returns True when both voted and a new game started."""
        player = self._player(seat)
        if self.game.phase is not Phase.FINISHED:
            raise WrongPhase("a rematch is only possible after the game ends")
        self._require_opponent(seat)
        player.wants_rematch = True
        self._touch(now)
        # The CPU is always up for another game.
        if all(p is not None and (p.wants_rematch or p.cpu) for p in self.players):
            self._start_new_game(first_shooter)
            return True
        return False

    def seat_cpu(self) -> None:
        """Seats the computer opponent; a CPU room is created with it in seat 1."""
        self.players[_CPU_SEAT] = Player(
            nickname=CPU_NICKNAME,
            # A token nobody is ever given: no client can take the CPU's seat.
            token_hash=hash_token(new_seat_token()),
            flag=CPU_FLAG,
            cpu=True,
        )

    @property
    def cpu_seat(self) -> int | None:
        return next((s for s, p in enumerate(self.players) if p is not None and p.cpu), None)

    def cpu_turn_at(self) -> float | None:
        """When the CPU fires next: a short pause after the move that gave it the turn."""
        seat = self.cpu_seat
        if seat is None or self.game.phase is not Phase.PLAYING or self.game.turn != seat:
            return None
        return self.last_activity + CPU_THINK_SECONDS

    def connected_seats(self) -> list[int]:
        """Seats with a connection to deliver to; the CPU has none."""
        return [
            s for s, p in enumerate(self.players) if p is not None and p.connected and not p.cpu
        ]

    def next_deadline(self) -> float:
        deadlines = [self.last_activity + IDLE_TIMEOUT_SECONDS]
        deadlines += [
            p.disconnected_at + RECONNECT_GRACE_SECONDS
            for p in self.players
            if p is not None and p.disconnected_at is not None
        ]
        cpu_turn = self.cpu_turn_at()
        if cpu_turn is not None:
            deadlines.append(cpu_turn)
        return min(deadlines)

    def is_idle(self, now: float) -> bool:
        return now - self.last_activity >= IDLE_TIMEOUT_SECONDS

    def _reconnect(self, token: str, now: float) -> int:
        for seat, player in enumerate(self.players):
            if player is not None and token_matches(token, player.token_hash):
                # The token arrived, so the join id has done its job.
                player.join_hash = None
                self._resume(player, now)
                return seat
        raise InvalidToken("this token does not belong to a seat in this room")

    def token_delivered(self, seat: int) -> bool:
        """The seat's player has their token: the join id no longer reclaims the seat.

        Returns whether that changed anything, so the caller knows to save the room.
        """
        player = self._player(seat)
        cleared = player.join_hash is not None
        player.join_hash = None
        return cleared

    def _reclaim(self, join_id: str, nickname: str, now: float) -> tuple[int, str] | None:
        for seat, player in enumerate(self.players):
            if (
                player is not None
                and player.join_hash is not None
                and player.nickname == nickname
                and token_matches(join_id, player.join_hash)
            ):
                new_token = new_seat_token()
                player.token_hash = hash_token(new_token)
                self._resume(player, now)
                return seat, new_token
        return None

    def _resume(self, player: Player, now: float) -> None:
        player.connected = True
        player.disconnected_at = None
        self._touch(now)

    def _start_new_game(self, first_shooter: int) -> None:
        self.game = Game(first_shooter)
        self._clear_rematch_votes()

    def _clear_rematch_votes(self) -> None:
        for player in self.players:
            if player is not None:
                player.wants_rematch = False

    def _player(self, seat: int) -> Player:
        player = self.players[seat] if seat in SEATS else None
        if player is None:
            raise NotSeated("this seat is empty")
        return player

    def _flag_to_avoid(self, seat: int) -> Flag | None:
        """The opponent's flag, unless the opponent is the CPU, which gives way instead."""
        opponent = self.players[other(seat)]
        return None if opponent is None or opponent.cpu else opponent.flag

    def _cpu_yield_flag(self) -> None:
        seat = self.cpu_seat
        person = None if seat is None else self.players[other(seat)]
        if seat is not None and person is not None:
            cpu = self._player(seat)
            if cpu.flag == person.flag:
                cpu.flag = next(f for f in Flag if f != person.flag)

    def _require_opponent(self, seat: int) -> None:
        if self.players[other(seat)] is None:
            raise OpponentMissing("waiting for an opponent to join")

    def _touch(self, now: float) -> None:
        self.last_activity = now
