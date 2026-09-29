# Playing against the CPU — Design

**Date:** 2026-09-29
**Status:** Approved
**Issue:** #55

## 1. Goal

A player with no friend available plays a full game against the computer. The first-version spec (`2026-09-27-naval-game-design.md`) listed "AI opponent" as a non-goal; this design lifts it.

Decisions taken with the owner:

- **One difficulty level** that plays like a person: random shots until it hits, then it finishes that ship.
- **Two entry points:** a *Play vs CPU* button on the home screen, and a way to switch to a CPU game while waiting in the lobby.
- The interface keeps the current design system. There is no new visual language, and CPU games look like any other game.

Non-goals: difficulty levels, CPU statistics, a CPU that chats or taunts, spectating CPU games.

## 2. Approach

The CPU is **the second seat of the room, played by the server**. The alternative was a CPU in the browser. It would need no server changes, but it would duplicate every game rule in JavaScript and put the CPU's fleet in the page, breaking the rule that the client is only a view.

With the CPU on the server:

- every rule stays in Python, and the CPU goes through the same `Game` operations as a person;
- the CPU's fleet never leaves the server before `game_over`, as for any opponent;
- reconnection, rematch, flags, the shot log and the animations work unchanged.

## 3. Components

### 3.1 `naval.domain.cpu` (new, pure)

- `random_fleet(rng: random.Random) -> tuple[Placement, ...]`: a valid standard fleet. Each ship is drawn uniformly from the placements that still fit (largest ship first), so it never fails.
- `choose_shot(shots: Mapping[Coordinate, ShotOutcome], sunk: Sequence[Placement], rng: random.Random) -> Coordinate`: the CPU's next target, from exactly what a player knows about the enemy board: its own shots with their outcomes, and the ships it has sunk (their placements are revealed to the shooter, as in the per-seat view).
  - An **open hit** is a hit cell that is not part of a sunk ship.
  - **Target mode**, when there are open hits:
    1. If two or more open hits are adjacent in a line, the candidates are the unfired cells just beyond both ends of each such line.
    2. Otherwise, the candidates are the unfired neighbours (up, down, left, right) of every open hit.
    3. If there are no candidates, fall back to hunt mode.
  - **Hunt mode:** any unfired cell.
  - The choice among candidates is uniform, using `rng`.
- The strategy keeps no memory between shots, so nothing new is persisted: the room replays shots as it does today.

### 3.2 `naval.rooms`

- `Player` gains `cpu: bool = False`. The codec writes it only when true, as it does `join_hash`.
- `Room.seat_cpu()` seats the CPU in seat 1 when the room is created. It flies Charlie ("C for CPU"), and its token hash comes from a fresh `new_seat_token()` that is never handed out, so nobody can reconnect as the CPU.
- **The CPU always yields its flag.** A person who joins or chooses the CPU's flag gets it, and the CPU moves to the first free flag. A person never gets `flag_taken` in a CPU room.
- `connected_seats()` leaves the CPU out: it has no connection to deliver to. Its `PlayerView` still shows it connected.
- **Rematch:** the CPU counts as always wanting one. Its view reports `wants_rematch: true`, which the client shows only once the game is over ("CPU wants a rematch.").
- **The CPU's turn:** `Room.cpu_turn_at()` returns `last_activity + CPU_THINK_SECONDS` (0.9 s) while it is the CPU's turn in the battle, and `next_deadline()` includes it. The room alarm therefore wakes the room to play the CPU. This survives hibernation, and it needs no new stored state.
- `RoomService` drives the CPU after every handled message and on every alarm (`_play_cpu`):
  - **Placing:** once a person is seated and the CPU's fleet is not placed, place `random_fleet(rng)`. Every new game (a new opponent, a rematch) therefore gets a new CPU fleet at once.
  - **Battle:** when `cpu_turn_at()` has passed, fire at `choose_shot(...)` computed from the person's board, and broadcast the `shot` and `state` like any shot.
- The service gets its randomness injected (`random.SystemRandom()` in the Worker, a seeded `random.Random` in tests), as `coin_flip` is today.
- Everything else is unchanged:
  - A person who leaves forfeits as usual. The CPU stays until the room is idle for an hour and is deleted.
  - A third visitor gets `room_full`.
  - The CPU acts only on its own turn, and only a person's action can give it the turn, so the CPU can never keep a room alive by itself.

### 3.3 Protocol and Worker

- `POST /api/rooms` accepts an optional JSON body: `{"opponent": "friend" | "cpu"}`, default `"friend"`.
  - Parsed by a strict Pydantic model in `naval.protocol` (`extra="forbid"`, strict types).
  - A body over 256 bytes, malformed JSON or an unknown field gets `400 {"error": "invalid_request"}`.
  - An empty body stays valid, so existing clients keep working.
  - The Origin check and the room-creation rate limit (10 per minute per IP) apply before the body is read. A CPU room costs the same as any room.
- The Worker passes `opponent` to the Durable Object's internal `/init`, and `GameRoom` creates the room with the CPU seated.
- WebSocket messages are unchanged. A CPU is simply an opponent whose nickname is "CPU".

### 3.4 Frontend

- `api.createRoom({ opponent })` sends the JSON body only for a CPU game.
- **Home:** a *Play vs CPU* button under *Create a room*, in the existing button style.
  - It uses the nickname and flag like *Create a room*, with the same busy state ("Starting…" while the room is created).
  - It is hidden in invite mode, like *Create a room*.
- **Lobby:** a *Play vs CPU instead* button with the lobby actions. It leaves the friend room (freeing it) and starts a CPU game with the same nickname and flag.
- **Everything else is the existing UI:**
  - the placement line reads "Opponent: [flag] CPU (Charlie) · fleet ready";
  - the banner says "CPU is aiming…" during its turn;
  - the log says "CPU fired at B4: miss.";
  - the result panel offers *Rematch*.

## 4. Error handling

- A CPU action goes through the same `Game` checks as a person's. A bug in the CPU therefore surfaces as a `GameError` or an unexpected exception inside `RoomService.handle` or `alarm`.
- In `handle` this becomes an `internal_error` for the person and is logged. In `alarm` it propagates, as any alarm failure does today: the runtime logs it and retries the alarm.
- `choose_shot` never returns a fired or off-board cell. This is covered by property tests.

## 5. Security

- **Room access:** the CPU seat's token is never delivered, and its hash is of 32 random bytes, so no client can join as the CPU or send moves for it. The CPU's fleet is stored like any fleet and appears in a view only after `game_over`.
- **Protocol:** the new request body is strictly validated and bounded. Its absence keeps the current behaviour.
- **Abuse:** a CPU room is created through the same rate-limited, Origin-checked endpoint. CPU work is bounded by the person's moves: at most one CPU shot per shot of theirs.
- **Review:** `sharp-edges` (protocol change) and `differential-review` (room access) before merging the rooms PR.

## 6. Testing

- **Domain (hypothesis):**
  - `random_fleet` always passes `Board.from_placements`.
  - `choose_shot` returns an unfired cell on the board.
  - With an open hit that has an unfired neighbour, the shot is next to an open hit, and on the line when there is one.
  - Playing `choose_shot` against any valid fleet sinks it within 100 shots.
  - Over a fixed set of seeded games, it needs clearly fewer shots than pure random firing.
- **Rooms and service:**
  - a CPU room seats the CPU, which yields its flag and places its fleet when a person joins;
  - its shot waits for `cpu_turn_at()`;
  - it fires first when the coin says so;
  - a rematch starts at once with a new CPU fleet;
  - a third visitor is refused;
  - leaving forfeits;
  - the codec round-trips `cpu`.
- **Integration (`pywrangler dev`):**
  - create a CPU room;
  - bad bodies get 400;
  - play until the CPU fires back;
  - the CPU seat cannot be taken.
- **E2E (desktop, mobile, tablet):**
  - start from the home screen and from the lobby;
  - place, fire, and see the CPU's shot in the log;
  - no console or CSP errors;
  - axe clean on the new controls.

## 7. Delivery

One issue (#55), three PRs:

1. Domain: `naval.domain.cpu`, with this spec and the implementation plan.
2. Rooms, protocol and Worker: CPU rooms, the creation body and alarm-driven CPU turns, with the two security reviews.
3. Frontend: home and lobby entry points and E2E. Also updates the first-version spec (non-goals, `POST /api/rooms`) and the README.
