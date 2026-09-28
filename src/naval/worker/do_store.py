from typing import Any

from naval.rooms.codec import room_from_json, room_to_json
from naval.rooms.room import Room

_ROOM_KEY = "room"


class DurableObjectRoomStore:
    """RoomStore over Durable Object storage (`ctx.storage`)."""

    def __init__(self, storage: Any) -> None:
        self._storage = storage

    async def load(self) -> Room | None:
        data = await self._storage.get(_ROOM_KEY)
        return None if data is None else room_from_json(str(data))

    async def save(self, room: Room) -> None:
        await self._storage.put(_ROOM_KEY, room_to_json(room))

    async def delete(self) -> None:
        # deleteAll also drops any leftover keys, so an idle room costs nothing afterwards.
        await self._storage.deleteAll()
