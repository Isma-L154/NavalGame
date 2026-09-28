from naval.rooms.room import Room
from naval.worker.do_store import DurableObjectRoomStore


class FakeStorage:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.cleared = False

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def put(self, key: str, value: str) -> None:
        self.values[key] = value

    async def deleteAll(self) -> None:  # noqa: N802 - Durable Object storage API name
        self.values.clear()
        self.cleared = True


async def test_room_round_trips_through_storage() -> None:
    storage = FakeStorage()
    store = DurableObjectRoomStore(storage)
    assert await store.load() is None
    room = Room("ABCDEF", created_at=1.0)
    room.join("Ana", None, now=2.0, first_shooter=0)
    await store.save(room)
    loaded = await store.load()
    assert loaded is not None
    assert loaded.players == room.players


async def test_delete_clears_all_storage() -> None:
    storage = FakeStorage()
    store = DurableObjectRoomStore(storage)
    await store.save(Room("ABCDEF", created_at=1.0))
    await store.delete()
    assert storage.cleared
    assert await store.load() is None
