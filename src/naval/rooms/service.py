import traceback
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

from naval.domain.coordinates import Coordinate
from naval.domain.errors import GameError
from naval.protocol.messages import (
    ClientMessage,
    FireMessage,
    JoinMessage,
    LeaveMessage,
    PlaceFleetMessage,
    RematchMessage,
)
from naval.protocol.views import (
    Message,
    PlayerView,
    error_message,
    joined_message,
    shot_message,
    state_message,
)
from naval.rooms.codec import room_from_json, room_to_json
from naval.rooms.room import Room


class RoomStore(Protocol):
    async def load(self) -> Room | None: ...
    async def save(self, room: Room) -> None: ...
    async def delete(self) -> None: ...


class Clock(Protocol):
    def now(self) -> float: ...


class AlreadyJoined(GameError):
    code = "already_joined"


class NotJoined(GameError):
    code = "not_joined"


class RoomClosed(GameError):
    code = "room_closed"


_INTERNAL_ERROR = "internal_error"


class InMemoryRoomStore:
    """Keeps the serialised form, so tests exercise the same codec as production."""

    def __init__(self) -> None:
        self._data: str | None = None

    async def load(self) -> Room | None:
        return None if self._data is None else room_from_json(self._data)

    async def save(self, room: Room) -> None:
        self._data = room_to_json(room)

    async def delete(self) -> None:
        self._data = None


@dataclass
class Delivery:
    """What the transport must send after an event, and to whom."""

    to_requester: list[Message] = field(default_factory=list)
    to_seats: dict[int, list[Message]] = field(default_factory=dict)
    bind_seat: int | None = None
    close_requester: bool = False
    close_all: bool = False


class RoomService:
    def __init__(self, store: RoomStore, clock: Clock, coin_flip: Callable[[], int]) -> None:
        self._store = store
        self._clock = clock
        self._coin_flip = coin_flip

    async def create(self, code: str) -> bool:
        if await self._store.load() is not None:
            return False
        await self._store.save(Room(code, created_at=self._clock.now()))
        return True

    async def exists(self) -> bool:
        return await self._store.load() is not None

    async def deadline(self) -> float | None:
        room = await self._store.load()
        return None if room is None else room.next_deadline()

    async def handle(self, seat: int | None, message: ClientMessage) -> Delivery:
        room: Room | None = None
        try:
            room = await self._store.load()
            if room is None:
                return Delivery(to_requester=[error_message(RoomClosed.code)], close_requester=True)
            return await self._handle(room, seat, message)
        except Exception:
            # A bug or an outage must not leave the player waiting. Log the traceback, never the
            # message: a join carries the seat token.
            where = room.code if room is not None else "an unreadable room"
            print(
                f"internal error in {where}, seat {seat}, handling {message.type}:\n"
                f"{traceback.format_exc()}"
            )
            return Delivery(
                to_requester=[error_message(_INTERNAL_ERROR)],
                close_requester=_is_first_join(seat, message),
            )

    async def _handle(self, room: Room, seat: int | None, message: ClientMessage) -> Delivery:
        delivery = Delivery()
        try:
            self._apply(room, seat, message, delivery)
            await self._store.save(room)
        except GameError as error:
            return Delivery(
                to_requester=[error_message(error.code)],
                close_requester=_is_first_join(seat, message),
            )
        self._broadcast_state(room, delivery)
        return delivery

    async def disconnected(self, seat: int) -> Delivery:
        """Call only when no open connection is bound to `seat` any more.

        The transport owns connection identity: it must unbind a connection before closing
        it after a reconnect or a leave, so that a late close event cannot mark the seat's
        new occupant as disconnected.
        """
        room = await self._store.load()
        if room is None or room.players[seat] is None:
            return Delivery()
        room.disconnect(seat, self._clock.now())
        await self._store.save(room)
        delivery = Delivery()
        self._broadcast_state(room, delivery)
        return delivery

    async def alarm(self) -> Delivery:
        room = await self._store.load()
        if room is None:
            return Delivery()
        now = self._clock.now()
        if room.is_idle(now):
            await self._store.delete()
            closed = [error_message(RoomClosed.code)]
            return Delivery(
                to_seats={s: list(closed) for s in room.connected_seats()}, close_all=True
            )
        delivery = Delivery()
        if room.expire(now):
            await self._store.save(room)
            self._broadcast_state(room, delivery)
        return delivery

    def _apply(
        self, room: Room, seat: int | None, message: ClientMessage, delivery: Delivery
    ) -> None:
        now = self._clock.now()
        if isinstance(message, JoinMessage):
            if seat is not None:
                raise AlreadyJoined("this connection already has a seat")
            new_seat, token = room.join(message.nickname, message.token, now, self._coin_flip())
            delivery.bind_seat = new_seat
            delivery.to_requester.append(joined_message(new_seat, room.code, token))
            return
        if seat is None:
            raise NotJoined("send join first")
        if isinstance(message, PlaceFleetMessage):
            room.place_fleet(seat, [ship.to_placement() for ship in message.ships], now)
        elif isinstance(message, FireMessage):
            target = Coordinate(message.row, message.col)
            shot = shot_message(seat, target, room.fire(seat, target, now))
            for s in room.connected_seats():
                delivery.to_seats.setdefault(s, []).append(shot)
        elif isinstance(message, RematchMessage):
            room.request_rematch(seat, self._coin_flip(), now)
        elif isinstance(message, LeaveMessage):
            room.leave(seat, now)
            delivery.close_requester = True

    @staticmethod
    def _broadcast_state(room: Room, delivery: Delivery) -> None:
        players = [
            None if p is None else PlayerView(p.nickname, p.connected, p.wants_rematch)
            for p in room.players
        ]
        for seat in room.connected_seats():
            state = state_message(room.code, seat, room.game, players)
            delivery.to_seats.setdefault(seat, []).append(state)


def _is_first_join(seat: int | None, message: ClientMessage) -> bool:
    """A connection whose join failed holds no seat and must not linger."""
    return seat is None and isinstance(message, JoinMessage)
