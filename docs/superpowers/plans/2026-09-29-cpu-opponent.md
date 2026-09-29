# Playing against the CPU (#55) Implementation Plan

> Executed task by task in a single session (this project uses no parallel agents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player with no friend available plays a full game against a computer opponent that fires like a person.

**Architecture:** The CPU is the second seat of a room, played by the server.
- A pure domain module (`naval.domain.cpu`) places a random fleet and chooses shots from what a player knows.
- `RoomService` makes the CPU act after each handled message and on each room alarm.
- `Room.cpu_turn_at()` turns the CPU's pause into an alarm deadline.
- Rooms are created with the CPU through an optional JSON body on `POST /api/rooms`.
- The frontend adds two buttons and otherwise reuses the existing screens.

**Tech Stack:** Python 3.14, Pydantic v2, Cloudflare Durable Objects (alarms), vanilla ES modules, pytest + hypothesis, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-cpu-opponent-design.md`

## Global Constraints

- Dependencies point inward: `worker -> rooms -> protocol -> domain`. `naval.domain.cpu` imports only from `naval.domain`.
- Every rule stays server-side. The CPU's fleet never appears in a view before `game_over`.
- CPU constants: nickname `"CPU"`, seat `1`, default flag `Flag.C` (Charlie), `CPU_THINK_SECONDS = 0.9`.
- Room creation body: `{"opponent": "friend" | "cpu"}`, optional, at most 256 bytes, strict. Anything else gets `400 {"error": "invalid_request"}`.
- Frontend: `textContent` only; no inline scripts, styles or handlers (CSP); existing button classes only; UI copy in English.
- Commits authored as `ismaleonsaenz@gmail.com`; one PR per part, each referencing #55 (the last one closes it).

## File Structure

| File | Part | Responsibility |
|---|---|---|
| `src/naval/domain/cpu.py` (new) | 1 | `random_fleet`, `choose_shot` |
| `tests/domain/test_cpu.py` (new) | 1 | Properties and examples for the CPU |
| `pyproject.toml` | 1 | Allow `random` in tests (S311) |
| `src/naval/rooms/room.py` | 2 | CPU seat, flag yielding, rematch, `cpu_turn_at`, deadlines |
| `src/naval/rooms/codec.py` | 2 | Persist `cpu` only when true |
| `src/naval/rooms/service.py` | 2 | `create(code, cpu=)`, `_play_cpu`, injected `rng` |
| `src/naval/protocol/requests.py` (new) | 2 | `CreateRoomRequest`, `parse_create_room` |
| `src/naval/worker/entry.py`, `game_room.py` | 2 | Read the body, pass `opponent` to `/init` |
| `tests/rooms/test_room.py`, `test_service.py`, `test_codec.py`, `tests/protocol/test_requests.py` (new) | 2 | Unit tests |
| `tests/integration/client.py`, `test_rooms.py` | 2 | Real Worker tests |
| `.github/workflows/deploy.yml` | 2 | Smoke-test a CPU game in production |
| `public/js/api.js`, `home.js`, `lobby.js`, `app.js`, `public/index.html` | 3 | Entry points |
| `e2e/cpu.spec.js` (new) | 3 | Browser tests |
| `docs/superpowers/specs/2026-09-27-naval-game-design.md`, `README.md`, `CLAUDE.md` | 3 | Docs |

---

## Part 1 — Domain (PR 1, `feat/cpu-domain`)

### Task 1: `random_fleet` and `choose_shot`

**Files:** Create `src/naval/domain/cpu.py`, `tests/domain/test_cpu.py`. Modify `pyproject.toml` (`"tests/**" = ["S101", "PLR2004", "S311"]`), `tests/integration/client.py` (drop its now-unneeded `# noqa: S311`).

**Interfaces:**
- Produces: `random_fleet(rng: random.Random) -> tuple[Placement, ...]`
- Produces: `choose_shot(shots: Mapping[Coordinate, ShotOutcome], sunk: Sequence[Placement], rng: random.Random) -> Coordinate`

- [ ] **Step 1: Failing tests** (`tests/domain/test_cpu.py`):

```python
import random

from hypothesis import given
from hypothesis import strategies as st

from naval.domain.board import Board, ShotOutcome
from naval.domain.coordinates import BOARD_SIZE, Coordinate
from naval.domain.cpu import choose_shot, random_fleet
from naval.domain.fleet import Orientation, Placement, ShipKind
from tests.strategies import valid_fleets

seeds = st.integers(min_value=0, max_value=2**32 - 1)
HIT, MISS, SUNK = ShotOutcome.HIT, ShotOutcome.MISS, ShotOutcome.SUNK


def _neighbours(cell: Coordinate) -> set[Coordinate]:
    around = [(cell.row + dr, cell.col + dc) for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1))]
    return {Coordinate(r, c) for r, c in around if 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE}


def _open_hits(board: Board) -> set[Coordinate]:
    sunk = {cell for ship in board.sunk_ships for cell in ship.cells()}
    return {c for c, o in board.shots_received.items() if o is not MISS} - sunk


def _play(board: Board, rng: random.Random) -> int:
    """Fires the CPU at `board` until the fleet is sunk; a repeated shot raises."""
    shots = 0
    while not board.all_sunk:
        board.receive_shot(choose_shot(board.shots_received, board.sunk_ships, rng))
        shots += 1
    return shots


@given(seeds)
def test_random_fleets_are_valid(seed: int) -> None:
    Board.from_placements(random_fleet(random.Random(seed)))


@given(valid_fleets(), seeds)
def test_the_cpu_sinks_any_fleet_without_repeating_a_shot(
    fleet: list[Placement], seed: int
) -> None:
    assert _play(Board.from_placements(fleet), random.Random(seed)) <= BOARD_SIZE * BOARD_SIZE


@given(valid_fleets(), seeds)
def test_while_a_ship_is_hit_but_afloat_the_cpu_fires_next_to_a_hit(
    fleet: list[Placement], seed: int
) -> None:
    board = Board.from_placements(fleet)
    rng = random.Random(seed)
    while not board.all_sunk:
        free = {
            n
            for hit in _open_hits(board)
            for n in _neighbours(hit)
            if n not in board.shots_received
        }
        target = choose_shot(board.shots_received, board.sunk_ships, rng)
        if free:
            assert target in free
        board.receive_shot(target)


def test_two_hits_in_a_row_are_followed_along_their_line() -> None:
    shots = {Coordinate(4, 4): HIT, Coordinate(4, 5): HIT}
    targets = {choose_shot(shots, [], random.Random(seed)) for seed in range(30)}
    assert targets == {Coordinate(4, 3), Coordinate(4, 6)}


def test_hits_on_a_sunk_ship_are_not_followed() -> None:
    destroyer = Placement(ShipKind.DESTROYER, Coordinate(0, 0), Orientation.HORIZONTAL)
    open_cells = {Coordinate(1, 0), Coordinate(9, 9)}
    shots = {
        Coordinate(r, c): MISS
        for r in range(BOARD_SIZE)
        for c in range(BOARD_SIZE)
        if Coordinate(r, c) not in open_cells
    }
    shots |= {Coordinate(0, 0): HIT, Coordinate(0, 1): SUNK}
    targets = {choose_shot(shots, [destroyer], random.Random(seed)) for seed in range(30)}
    assert targets == open_cells


def test_the_cpu_needs_far_fewer_shots_than_firing_at_random() -> None:
    # Firing at random needs about 95 shots to sink the whole fleet.
    rng = random.Random(2026)
    games = [_play(Board.from_placements(random_fleet(rng)), rng) for _ in range(200)]
    assert sum(games) / len(games) < 75
```

- [ ] **Step 2: Run** `uv run pytest tests/domain/test_cpu.py` → FAIL (`ModuleNotFoundError: naval.domain.cpu`).

- [ ] **Step 3: Implement** `src/naval/domain/cpu.py`:

```python
"""The computer opponent: a fleet placed at random, and shots chosen the way a person would."""

import random
from collections.abc import Iterable, Mapping, Sequence

from naval.domain.board import ShotOutcome
from naval.domain.coordinates import BOARD_SIZE, Coordinate
from naval.domain.fleet import STANDARD_FLEET, Orientation, Placement, ShipKind

_LINES = ((0, 1), (1, 0))


def random_fleet(rng: random.Random) -> tuple[Placement, ...]:
    """A valid standard fleet: each ship, largest first, anywhere it still fits."""
    occupied: set[Coordinate] = set()
    fleet = []
    for kind in STANDARD_FLEET:
        placement = rng.choice(_fitting(kind, occupied))
        occupied.update(placement.cells())
        fleet.append(placement)
    return tuple(fleet)


def choose_shot(
    shots: Mapping[Coordinate, ShotOutcome], sunk: Sequence[Placement], rng: random.Random
) -> Coordinate:
    """The next target, from what the shooter knows: its shots and the ships it has sunk.

    While a ship is hit but afloat, fire along a line of hits, else next to a hit; otherwise
    anywhere not yet fired at.
    """
    sunk_cells = {cell for ship in sunk for cell in ship.cells()}
    open_hits = {c for c, outcome in shots.items() if outcome is not ShotOutcome.MISS} - sunk_cells
    candidates = _line_ends(open_hits, shots) or _free_neighbours(open_hits, shots)
    if not candidates:
        candidates = {cell for cell in _board() if cell not in shots}
    return rng.choice(sorted(candidates))


def _fitting(kind: ShipKind, occupied: set[Coordinate]) -> list[Placement]:
    options = []
    for orientation in Orientation:
        placements = (Placement(kind, cell, orientation) for cell in _board())
        options += [p for p in placements if _fits(p) and occupied.isdisjoint(p.cells())]
    return options


def _fits(placement: Placement) -> bool:
    d_row, d_col = (0, 1) if placement.orientation is Orientation.HORIZONTAL else (1, 0)
    end = placement.kind.length - 1
    return _step(placement.origin, d_row * end, d_col * end) is not None


def _line_ends(
    open_hits: set[Coordinate], shots: Mapping[Coordinate, ShotOutcome]
) -> set[Coordinate]:
    """The free cells just beyond each run of two or more open hits in a row or a column."""
    ends: set[Coordinate] = set()
    for hit in open_hits:
        for d_row, d_col in _LINES:
            if _step(hit, -d_row, -d_col) in open_hits:
                continue  # only walk each run from its first cell
            run = [hit]
            while (following := _step(run[-1], d_row, d_col)) in open_hits:
                run.append(following)
            if len(run) > 1:
                beyond = (_step(run[0], -d_row, -d_col), _step(run[-1], d_row, d_col))
                ends.update(_free(beyond, shots))
    return ends


def _free_neighbours(
    open_hits: set[Coordinate], shots: Mapping[Coordinate, ShotOutcome]
) -> set[Coordinate]:
    around = (
        _step(hit, d_row * sign, d_col * sign)
        for hit in open_hits
        for d_row, d_col in _LINES
        for sign in (1, -1)
    )
    return _free(around, shots)


def _free(
    cells: Iterable[Coordinate | None], shots: Mapping[Coordinate, ShotOutcome]
) -> set[Coordinate]:
    return {cell for cell in cells if cell is not None and cell not in shots}


def _step(cell: Coordinate, d_row: int, d_col: int) -> Coordinate | None:
    row, col = cell.row + d_row, cell.col + d_col
    return Coordinate(row, col) if 0 <= row < BOARD_SIZE and 0 <= col < BOARD_SIZE else None


def _board() -> list[Coordinate]:
    return [Coordinate(row, col) for row in range(BOARD_SIZE) for col in range(BOARD_SIZE)]
```

- [ ] **Step 4: Run** `uv run pytest tests/domain/test_cpu.py` → PASS; then `uv run ruff check . && uv run ruff format --check . && uv run mypy src tests && uv run pytest`.
- [ ] **Step 5: Commit** `feat: a CPU that places a random fleet and fires like a person` (with the spec and this plan).
- [ ] **Step 6: Ship:** PR "Refs #55", code review, CI green, squash merge.

---

## Part 2 — Rooms, protocol and Worker (PR 2, `feat/cpu-rooms`)

### Task 2: CPU seat in `Room` and the codec

**Files:** Modify `src/naval/rooms/room.py`, `src/naval/rooms/codec.py`; Test `tests/rooms/test_room.py`, `tests/rooms/test_codec.py`.

**Interfaces:**
- Produces: `Player.cpu: bool = False`; `Room.seat_cpu() -> None`; `Room.cpu_seat -> int | None` (property); `Room.cpu_turn_at() -> float | None`; constants `CPU_NICKNAME`, `CPU_FLAG`, `CPU_THINK_SECONDS`.
- Changes: `connected_seats()` excludes the CPU; `request_rematch` counts the CPU as willing; `next_deadline()` includes `cpu_turn_at()`; `join` and `choose_flag` never refuse a person the CPU's flag (the CPU moves).

- [ ] **Step 1: Failing tests** (append to `tests/rooms/test_room.py`):

```python
def _cpu_room() -> Room:
    room = Room("ABCDEF", created_at=T0)
    room.seat_cpu()
    return room


def test_a_cpu_room_has_the_cpu_in_seat_one() -> None:
    room = _cpu_room()
    cpu = room.players[1]
    assert cpu is not None
    assert (cpu.nickname, cpu.flag, cpu.cpu) == ("CPU", Flag.C, True)
    assert room.cpu_seat == 1
    assert room.connected_seats() == []


def test_a_person_joins_the_free_seat_and_a_third_is_refused() -> None:
    room = _cpu_room()
    assert room.join("Ana", None, now=T0, first_shooter=0)[0] == 0
    assert room.connected_seats() == [0]
    with pytest.raises(RoomFull):
        room.join("Cy", None, now=T0, first_shooter=0)


def test_the_cpu_gives_up_its_flag_to_the_person() -> None:
    room = _cpu_room()
    room.join("Ana", None, now=T0, first_shooter=0, flag=Flag.C)
    assert _flags(room) == [Flag.C, Flag.A]
    room.choose_flag(0, Flag.A, now=T0)
    assert _flags(room) == [Flag.A, Flag.B]


def test_the_cpu_always_accepts_a_rematch() -> None:
    room = _cpu_room()
    room.join("Ana", None, now=T0, first_shooter=0)
    room.place_fleet(0, ROW_FLEET, now=T0)
    room.place_fleet(1, ROW_FLEET, now=T0)
    misses = iter([Coordinate(row, col) for row in range(5, 10) for col in range(10)])
    for target in fleet_cells(ROW_FLEET):
        room.fire(0, target, now=T0)
        if room.game.phase is Phase.PLAYING:
            room.fire(1, next(misses), now=T0)
    assert room.game.phase is Phase.FINISHED
    assert room.request_rematch(0, first_shooter=0, now=T0)
    assert room.game.phase is Phase.PLACING


def test_the_cpu_fires_a_short_pause_after_it_gets_the_turn() -> None:
    room = _cpu_room()
    room.join("Ana", None, now=T0, first_shooter=0)
    room.place_fleet(0, ROW_FLEET, now=T0)
    room.place_fleet(1, ROW_FLEET, now=T0)
    assert room.cpu_turn_at() is None  # the person fires first
    room.fire(0, Coordinate(9, 9), now=T0 + 5)
    assert room.cpu_turn_at() == T0 + 5 + CPU_THINK_SECONDS
    assert room.next_deadline() == T0 + 5 + CPU_THINK_SECONDS


def test_rooms_without_a_cpu_are_unchanged() -> None:
    room, _, _ = _room_with_two_players()
    assert room.cpu_seat is None
    assert room.cpu_turn_at() is None
```

  (`test_the_cpu_fires...`: `ROW_FLEET` misses at row 9 col 9. Row 9 is empty.) Append to `tests/rooms/test_codec.py`:

```python
def test_cpu_rooms_round_trip_and_other_seats_store_no_cpu_key() -> None:
    room = Room("ABCDEF", created_at=5.0)
    room.seat_cpu()
    room.join("Ana", None, now=6.0, first_shooter=0)
    stored = room_to_json(room)
    assert stored.count('"cpu"') == 1
    _assert_same(room, room_from_json(stored))
```

  Import `CPU_THINK_SECONDS`, `Phase`, `Coordinate` where missing.

- [ ] **Step 2: Run** `uv run pytest tests/rooms` → FAIL (`seat_cpu` missing).

- [ ] **Step 3: Implement.** In `room.py`:

```python
CPU_NICKNAME = "CPU"
CPU_FLAG = Flag.C  # C for CPU
CPU_THINK_SECONDS = 0.9
_CPU_SEAT = 1


@dataclass
class Player:
    ...  # existing fields
    cpu: bool = False
```

  New and changed `Room` methods:

```python
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
```

- In `join`, replace `taken = self._opponent_flag(seat)` with `taken = self._flag_to_avoid(seat)`, and call `self._cpu_yield_flag()` after seating the player.
- In `choose_flag`, use `self._flag_to_avoid(seat)` and call `self._cpu_yield_flag()` after setting the flag.
- Replace `_opponent_flag` with:

```python
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
```

  Then:
- `connected_seats`: add `and not p.cpu`, with the docstring "Seats with a connection to deliver to; the CPU has none."
- `request_rematch`: `all(p is not None and (p.wants_rematch or p.cpu) for p in self.players)`.
- `next_deadline`: append `cpu_turn_at()` when it is not `None`.
- Codec `_player_to_dict`: also drop `cpu` when false ("written only when set, like join_hash").

- [ ] **Step 4: Run** `uv run pytest tests/rooms` → PASS.
- [ ] **Step 5: Commit** `feat: rooms can seat the CPU, which gives way on flags and rematches`.

### Task 3: `RoomService` drives the CPU

**Files:** Modify `src/naval/rooms/service.py`; Test `tests/rooms/test_service.py`.

**Interfaces:**
- Consumes: `random_fleet`, `choose_shot` (Task 1); `Room.seat_cpu`, `cpu_seat`, `cpu_turn_at` (Task 2).
- Produces: `RoomService(store, clock, coin_flip, *, rng: random.Random = <SystemRandom>)`; `RoomService.create(code: str, *, cpu: bool = False) -> bool`.

- [ ] **Step 1: Failing tests** (append to `tests/rooms/test_service.py`):

```python
@pytest.fixture
async def cpu_service(clock: FakeClock) -> RoomService:
    svc = RoomService(InMemoryRoomStore(), clock, coin_flip=lambda: 0, rng=random.Random(7))
    assert await svc.create("ABCDEF", cpu=True)
    return svc


async def test_joining_a_cpu_room_finds_the_cpu_ready(cpu_service: RoomService) -> None:
    joined = await cpu_service.handle(None, JoinMessage(type="join", nickname="Ana"))
    state = _last_state(joined, 0)
    assert state["players"][1]["nickname"] == "CPU"
    assert state["fleet_placed"] == [False, True]
    assert 1 not in joined.to_seats  # nothing is delivered to the CPU


async def test_the_cpu_fires_back_when_the_alarm_is_due(
    cpu_service: RoomService, clock: FakeClock
) -> None:
    await cpu_service.handle(None, JoinMessage(type="join", nickname="Ana"))
    await cpu_service.handle(0, PLACE)
    await cpu_service.handle(0, FireMessage(type="fire", row=9, col=9))
    assert (await cpu_service.alarm()).to_seats == {}  # not yet: the CPU is thinking
    due = await cpu_service.deadline()
    assert due == clock.current + CPU_THINK_SECONDS
    clock.current = due
    delivery = await cpu_service.alarm()
    assert _types(delivery.to_seats[0]) == ["shot", "state"]
    assert delivery.to_seats[0][0]["by"] == 1
    assert _last_state(delivery, 0)["turn"] == 0


async def test_the_cpu_fires_first_when_the_coin_says_so(clock: FakeClock) -> None:
    svc = RoomService(InMemoryRoomStore(), clock, coin_flip=lambda: 1, rng=random.Random(7))
    assert await svc.create("ABCDEF", cpu=True)
    await svc.handle(None, JoinMessage(type="join", nickname="Ana"))
    placed = await svc.handle(0, PLACE)
    assert _last_state(placed, 0)["turn"] == 1
    clock.current += CPU_THINK_SECONDS
    assert _types((await svc.alarm()).to_seats[0]) == ["shot", "state"]


async def test_a_rematch_against_the_cpu_starts_at_once(clock: FakeClock) -> None:
    # The person sinks the CPU's random fleet, read from the store, to finish a game.
    store = InMemoryRoomStore()
    cpu_service = RoomService(store, clock, coin_flip=lambda: 0, rng=random.Random(7))
    assert await cpu_service.create("ABCDEF", cpu=True)
    await cpu_service.handle(None, JoinMessage(type="join", nickname="Ana"))
    await cpu_service.handle(0, PLACE)
    room = await store.load()
    assert room is not None
    cpu_board = room.game.boards[1]
    assert cpu_board is not None
    for cell in [c for ship in cpu_board.placements for c in ship.cells()]:
        delivery = await cpu_service.handle(0, FireMessage(type="fire", row=cell.row, col=cell.col))
        if _last_state(delivery, 0)["phase"] == "finished":
            break
        clock.current = await cpu_service.deadline() or clock.current
        await cpu_service.alarm()
    rematch = await cpu_service.handle(0, RematchMessage(type="rematch"))
    state = _last_state(rematch, 0)
    assert state["phase"] == "placing"
    assert state["fleet_placed"] == [False, True]


async def test_a_room_created_without_the_cpu_has_none(service: RoomService) -> None:
    joined = await service.handle(None, JoinMessage(type="join", nickname="Ana"))
    assert _last_state(joined, 0)["players"][1] is None
```

  Import `random` and `CPU_THINK_SECONDS`.

- [ ] **Step 2: Run** → FAIL (`create()` has no `cpu`, `rng` unknown).

- [ ] **Step 3: Implement** in `service.py`:

```python
_SYSTEM_RANDOM = random.SystemRandom()


class RoomService:
    def __init__(
        self,
        store: RoomStore,
        clock: Clock,
        coin_flip: Callable[[], int],
        *,
        rng: random.Random = _SYSTEM_RANDOM,
    ) -> None:
        self._store = store
        self._clock = clock
        self._coin_flip = coin_flip
        self._rng = rng

    async def create(self, code: str, *, cpu: bool = False) -> bool:
        if await self._store.load() is not None:
            return False
        room = Room(code, created_at=self._clock.now())
        if cpu:
            room.seat_cpu()
        await self._store.save(room)
        return True
```

- In `handle`, call `self._play_cpu(room, delivery)` right after `self._apply(...)`.
- In `alarm`, replace the expire block with:

```python
        delivery = Delivery()
        expired = room.expire(now)
        played = self._play_cpu(room, delivery)
        if expired or played:
            await self._store.save(room)
            self._broadcast_state(room, delivery)
        return delivery
```

  Move the fire delivery into `_fire` and add `_play_cpu`:

```python
def _play_cpu(self, room: Room, delivery: Delivery) -> bool:
    """Lets the CPU act if it can: place its fleet, or take a turn that is due."""
    seat = room.cpu_seat
    if seat is None or room.players[other(seat)] is None:
        return False
    game, now = room.game, self._clock.now()
    if game.phase is Phase.PLACING and game.boards[seat] is None:
        room.place_fleet(seat, random_fleet(self._rng), now)
        return True
    due, target_board = room.cpu_turn_at(), game.boards[other(seat)]
    if due is None or now < due or target_board is None:
        return False
    target = choose_shot(target_board.shots_received, target_board.sunk_ships, self._rng)
    self._fire(room, seat, target, now, delivery)
    return True


@staticmethod
def _fire(room: Room, seat: int, target: Coordinate, now: float, delivery: Delivery) -> None:
    shot = shot_message(seat, target, room.fire(seat, target, now))
    for s in room.connected_seats():
        delivery.to_seats.setdefault(s, []).append(shot)
```

  `_apply`'s `FireMessage` branch becomes `self._fire(room, seat, Coordinate(message.row, message.col), now, delivery)`. In `_broadcast_state`, the CPU's view counts it as willing: `PlayerView(p.nickname, p.flag, p.connected, p.wants_rematch or p.cpu)`.

- [ ] **Step 4: Run** `uv run pytest` → PASS (the existing service tests still pass: without a CPU, `_play_cpu` returns at once).
- [ ] **Step 5: Commit** `feat: the room service plays the CPU's fleet and turns`.

### Task 4: The room-creation request and the Worker

**Files:** Create `src/naval/protocol/requests.py`, `tests/protocol/test_requests.py`. Modify `src/naval/worker/entry.py`, `src/naval/worker/game_room.py`, `tests/integration/client.py`, `tests/integration/test_rooms.py`, `.github/workflows/deploy.yml`.

**Interfaces:**
- Produces: `Opponent(StrEnum)` with `FRIEND`, `CPU`; `CreateRoomRequest(opponent: Opponent = Opponent.FRIEND)`; `parse_create_room(body: str) -> CreateRoomRequest`, raising `InvalidRequest`; `MAX_REQUEST_BYTES = 256`.

- [ ] **Step 1: Failing unit tests** (`tests/protocol/test_requests.py`):

```python
import pytest

from naval.protocol.requests import MAX_REQUEST_BYTES, InvalidRequest, Opponent, parse_create_room


@pytest.mark.parametrize("body", ["", "  ", "{}", '{"opponent": "friend"}'])
def test_a_plain_request_is_a_game_with_a_friend(body: str) -> None:
    assert parse_create_room(body).opponent is Opponent.FRIEND


def test_a_cpu_game_can_be_requested() -> None:
    assert parse_create_room('{"opponent": "cpu"}').opponent is Opponent.CPU


@pytest.mark.parametrize(
    "body",
    [
        '{"opponent": "robot"}',
        '{"opponent": "cpu", "level": 3}',
        '{"opponent": 1}',
        '["cpu"]',
        "not json",
        '{"opponent": "cpu"' + " " * MAX_REQUEST_BYTES + "}",
    ],
)
def test_anything_else_is_refused(body: str) -> None:
    with pytest.raises(InvalidRequest):
        parse_create_room(body)
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement** `src/naval/protocol/requests.py`:

```python
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
    if len(body.encode()) > MAX_REQUEST_BYTES:
        raise InvalidRequest("request body too large")
    if not body.strip():
        return CreateRoomRequest()
    try:
        return CreateRoomRequest.model_validate_json(body)
    except (ValidationError, ValueError) as error:
        raise InvalidRequest("request does not match the protocol") from error
```

  In `entry.py` `_create_room`, after `_guard` passes:

```python
        # Checked before reading, so an oversized body is never buffered.
        declared = request.headers.get("Content-Length")
        if declared is not None and declared.isdigit() and int(declared) > MAX_REQUEST_BYTES:
            return error_response("invalid_request", HTTPStatus.BAD_REQUEST)
        try:
            creation = parse_create_room(await request.text())
        except InvalidRequest:
            return error_response("invalid_request", HTTPStatus.BAD_REQUEST)
```

  Add `"opponent": creation.opponent.value` to the `/init` body. In `game_room.py` `_init`: `await self._service.create(body["code"], cpu=body.get("opponent") == Opponent.CPU)`.

- [ ] **Step 4: Integration tests.** In `client.py`, give `http` a `body: str | None = None` (sent as `data=body.encode()` with `Content-Type: application/json`). Give `create_room` an `opponent: str | None = None` that sends `{"opponent": ...}`. In `test_rooms.py`:

```python
@pytest.mark.parametrize(
    "body", ['{"opponent": "robot"}', '{"opponent": "cpu", "x": 1}', "{" + " " * 300 + "}"]
)
def test_room_creation_refuses_a_malformed_request(body: str) -> None:
    assert http("POST", "/api/rooms", body=body) == (400, {"error": "invalid_request"})


async def test_the_cpu_plays_back_and_its_seat_cannot_be_taken() -> None:
    code = create_room(opponent="cpu")
    ws, joined = await join(code, "Ana")
    assert joined["seat"] == 0
    await send(ws, {"type": "place_fleet", "ships": ROW_FLEET})
    state = await receive(ws, "state", lambda s: s["phase"] == "playing")
    assert state["players"][1]["nickname"] == "CPU"
    if state["turn"] == 0:
        await send(ws, {"type": "fire", "row": 9, "col": 9})
    cpu_shot = await receive(ws, "shot", lambda s: s["by"] == 1, timeout=10)
    assert 0 <= cpu_shot["row"] < 10
    intruder = await open_socket(code)
    await send(intruder, {"type": "join", "nickname": "Cy"})
    assert (await receive(intruder, "error"))["code"] == "room_full"
    await ws.close()
```

  In `deploy.yml`, add `or cpu_plays_back` to the smoke `-k` expression.

- [ ] **Step 5: Run** `uv run pytest` and, with `pywrangler dev` running, `NAVAL_BASE_URL=http://localhost:8787 uv run pytest -m integration` → PASS. Run the bundle check: `uv run pywrangler deploy --dry-run --outdir .wrangler/dry-run`.
- [ ] **Step 6: Commit** `feat: create a room against the CPU`.
- [ ] **Step 7: Ship:**
  1. Run `sharp-edges` on the new request and `differential-review` on the room access changes (report in `docs/security/reviews/`).
  2. Open the PR "Refs #55", run a code review, get CI green, squash merge.
  3. The production smoke test now plays against the CPU.

---

## Part 3 — Frontend (PR 3, `feat/cpu-frontend`)

### Task 5: Entry points on the home screen and in the lobby

**Files:** Modify `public/index.html`, `public/js/api.js`, `public/js/home.js`, `public/js/lobby.js`, `public/js/app.js`; Create `e2e/cpu.spec.js`.

**Interfaces:**
- Consumes: `POST /api/rooms` with `{"opponent": "cpu"}` (Task 4).
- Produces: `createRoom({ opponent })` in `api.js`; `HomeView.setBusy(busy, { starting })`, where `starting` is the id of the pressed button; `LobbyView({ onPlayCpu })`.

- [ ] **Step 1: Failing E2E tests** (`e2e/cpu.spec.js`):

```js
import { expect, test } from "@playwright/test";
import { cell, createRoom, joinRoom, newPlayer, openHome, watchConsole } from "./helpers.js";

async function playUntilTheCpuFires(page) {
  const banner = page.locator("#turn-banner");
  await expect(banner).toBeVisible();
  if ((await banner.textContent()).startsWith("Your turn")) {
    await cell(page, "Enemy waters", "A1").click();
  }
  await expect(page.locator("#shot-log")).toContainText("CPU fired at");
  await expect(banner).toHaveText(/^Your turn/);
}

test("a player can play the CPU from the home screen", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  const problems = watchConsole(page);
  await openHome(page, "Ana");
  await page.getByRole("button", { name: "Play vs CPU" }).click();
  await expect(page.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  await expect(page.locator("#placement-opponent")).toContainText("CPU (Charlie) · fleet ready");
  await page.getByRole("button", { name: "Random" }).click();
  await page.getByRole("button", { name: "Ready" }).click();
  await playUntilTheCpuFires(page);
  expect(problems).toEqual([]);
});

test("a player waiting in the lobby can switch to the CPU", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const code = await createRoom(ana, "Ana");
  await ana.getByRole("button", { name: "Play vs CPU instead" }).click();
  await expect(ana.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  await expect(ana.locator("#placement-opponent")).toContainText("CPU");
  // The friend room was left, so its seat is free again.
  const bo = await newPlayer(browser, testInfo);
  await joinRoom(bo, "Bo", code);
  await expect(bo.getByRole("heading", { name: "Waiting for an opponent" })).toBeVisible();
});

test("an invite link offers no CPU game", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.goto("/?room=ABCDEF");
  await expect(page.getByRole("button", { name: "Play vs CPU" })).toBeHidden();
});
```

- [ ] **Step 2: Run** `npx playwright test e2e/cpu.spec.js` → FAIL (no button).

- [ ] **Step 3: Implement.**

`index.html`:
- after `#create-room`, add `<button id="play-cpu" class="button button-wide" type="button">Play vs CPU</button>`;
- in `.lobby-actions`, after `#copy-code`, add `<button id="lobby-cpu" class="button" type="button">Play vs CPU instead</button>`.

`api.js`: `export async function createRoom({ opponent = "friend" } = {})` posts `JSON.stringify({ opponent })` with `headers: { "Content-Type": "application/json" }`.

`home.js`:

```js
const STARTING_LABELS = { "create-room": "Creating…", "play-cpu": "Starting…" };
// in the class:
#labels = new Map(Object.keys(STARTING_LABELS).map((id) => [id, $(id).textContent]));

setBusy(busy, { starting = null } = {}) {
  for (const id of ["create-room", "play-cpu", "join-submit"]) $(id).setAttribute("aria-disabled", String(busy));
  if (starting) $(starting).textContent = STARTING_LABELS[starting];
  if (!busy) for (const [id, label] of this.#labels) $(id).textContent = label;
}
// in show(): $("play-cpu").hidden = invited;
```

`lobby.js`: `constructor({ onPlayCpu })` wires `$("lobby-cpu").addEventListener("click", onPlayCpu)`.

`app.js`:
- store `game.nickname` in `enterRoom`;
- replace `onCreateRoom` with `onStartRoom(opponent)` (validation, then `startRoom`) and `startRoom(nickname, opponent)` (the busy state and the `createRoom({ opponent })` call);
- wire `#create-room` to `onStartRoom("friend")` and `#play-cpu` to `onStartRoom("cpu")`;
- add `playCpuInstead()`: if not `creating`, keep `game.nickname`, `leaveRoom()`, then `startRoom(nickname, "cpu")`;
- construct `new LobbyView({ onPlayCpu: playCpuInstead })`.

- [ ] **Step 4: Run** `npx playwright test` (all projects) and `uv run pytest tests/frontend` → PASS. Check screenshots of home and lobby on a phone (390 wide) and a laptop, in both themes: the new buttons use the existing styles, and nothing overflows.
- [ ] **Step 5: Docs.**
  - `2026-09-27-naval-game-design.md`: drop "AI opponent" from the non-goals and point to the CPU spec; describe the `POST /api/rooms` body.
  - README: "play a friend or the CPU".
  - `CLAUDE.md`: the project summary mentions the CPU.
- [ ] **Step 6: Commit** `feat: play the CPU from the home screen or while waiting in the lobby`.
- [ ] **Step 7: Ship:**
  1. PR "Closes #55": code review, CI green, squash merge.
  2. After the deploy, play a CPU game in production on desktop and a phone profile, with no console or CSP errors.
