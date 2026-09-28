# Game Implementation Plan (deliveries 3–7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (this project forbids subagents, see `CLAUDE.md`). Steps use checkbox (`- [ ]`) syntax for tracking. Every task is test-first: write the listed tests, watch them fail, implement, watch them pass, run `ruff`/`mypy`, commit.

**Goal:** A playable two-player naval battle at `https://naval.cloudils.com`: rooms with codes, simultaneous fleet placement, alternating shots, reconnection, rematch, all enforced by a Python Durable Object.

**Architecture:** `domain` (pure rules) ← `protocol` (Pydantic messages and per-seat views) ← `rooms` (room lifecycle and the `RoomService` application service, storage-agnostic) ← `worker` (thin Cloudflare adapters: entrypoint and `GameRoom` Durable Object). Everything except `worker` is unit-tested on CPython; `worker` is covered by integration tests against `pywrangler dev` and by Playwright E2E.

**Tech Stack:** Python 3.14 (Pyodide on Workers), Pydantic v2, pytest, hypothesis, Wrangler 4, Playwright, vanilla JS/CSS.

## Global Constraints

- Board 10x10, rows `A`–`J`, columns `1`–`10`, zero-based `(row, col)` internally.
- Fleet: carrier 5, battleship 4, cruiser 3, submarine 3, destroyer 2. Ships may touch, may not overlap.
- One shot per turn, strict alternation. Re-firing a cell is rejected and does not consume the turn.
- Reconnection grace 120 s; idle room deletion after 60 min.
- WebSocket frames ≤ 4096 bytes; 20 messages / 10 s per connection; 5th invalid message closes with 1008.
- `POST /api/rooms`: 10 / 60 s per IP. WebSocket upgrades: 30 / 60 s per IP.
- Room codes: 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`.
- Nickname: the raw value must match `^[A-Za-z0-9 _-]{1,20}$` (no trimming or other normalisation).
- Seat token: `secrets.token_urlsafe(32)` (43 chars), stored as SHA-256 hex, compared with `hmac.compare_digest`.
- The opponent's ship positions never leave the server before the game is `finished`.
- `workers` / `js` imports only in `src/naval/worker/entry.py` and `src/naval/worker/game_room.py`.
- UI text in English only; user-controlled text rendered with `textContent` only; no inline scripts, styles or handlers.

---

## Delivery 3 — `naval.domain`

### Task 3.1: Errors, coordinates and fleet

**Files:** `src/naval/domain/{__init__,errors,coordinates,fleet}.py`, tests in `tests/domain/`.

**Produces:**
- `GameError(Exception)` with class attribute `code: ClassVar[str]`; subclasses `InvalidCoordinate("invalid_coordinate")`, `InvalidFleet("invalid_fleet")`, `WrongPhase("wrong_phase")`, `NotYourTurn("not_your_turn")`, `AlreadyFiredThere("already_fired_there")`, `FleetAlreadyPlaced("fleet_already_placed")`, `InvalidSeat("invalid_seat")`.
- `BOARD_SIZE = 10`; `Coordinate(row: int, col: int)` frozen dataclass, raises `InvalidCoordinate` outside `0..9`.
- `ShipKind(StrEnum)` with `.length`; `STANDARD_FLEET: tuple[ShipKind, ...]`; `Orientation(StrEnum)` `horizontal` / `vertical`.
- `Placement(kind, origin: Coordinate, orientation)` frozen dataclass with `cells() -> tuple[Coordinate, ...]`, raising `InvalidFleet` when a cell leaves the board.

**Tests:** coordinate bounds (valid corners, −1 and 10 rejected); ship lengths; horizontal/vertical `cells()`; placement running off the right and bottom edges rejected.

### Task 3.2: Board

**Files:** `src/naval/domain/board.py`, `tests/domain/test_board.py`.

**Produces:**
- `ShotOutcome(StrEnum)` `miss` / `hit` / `sunk`; `ShotResult(outcome, kind: ShipKind | None)` frozen dataclass (`kind` only for `sunk`).
- `Board.from_placements(placements: Sequence[Placement]) -> Board`: raises `InvalidFleet` unless the kinds are exactly `STANDARD_FLEET` (as a multiset) and no two ships share a cell.
- `Board.placements: tuple[Placement, ...]`, `Board.shots_received: Mapping[Coordinate, ShotOutcome]`, `Board.receive_shot(target) -> ShotResult` (raises `AlreadyFiredThere`), `Board.all_sunk: bool`.

**Tests:** valid fleet accepted; missing ship, duplicate ship, extra ship and overlap rejected; miss/hit/sunk sequence on the destroyer; re-firing rejected; `all_sunk` only after the last cell. **Property tests (hypothesis):** a strategy that generates random valid fleets always builds a board; firing every occupied cell of a random fleet ends with `all_sunk` and exactly 5 `sunk` results; any fleet containing two placements that share a cell is rejected.

### Task 3.3: Game state machine

**Files:** `src/naval/domain/game.py`, `tests/domain/test_game.py`.

**Produces:**
- `Phase(StrEnum)` `placing` / `playing` / `finished`; `FinishReason(StrEnum)` `fleet_sunk` / `forfeit`; `SEATS = (0, 1)`.
- `Game(first_shooter: int)`; attributes `phase`, `turn: int | None`, `winner: int | None`, `finish_reason: FinishReason | None`, `boards: tuple[Board | None, Board | None]`.
- `place_fleet(seat, placements) -> None` (`WrongPhase`, `FleetAlreadyPlaced`, `InvalidSeat`, `InvalidFleet`); when both fleets are placed: `phase = playing`, `turn = first_shooter`.
- `fire(seat, target) -> ShotResult` (`WrongPhase`, `NotYourTurn`, `AlreadyFiredThere`); switches turn unless the shot ends the game (`winner = seat`, `fleet_sunk`).
- `forfeit(seat) -> None`: only while `playing`; `winner = other`, `forfeit`. No-op in other phases.
- `other(seat) -> int` helper.

**Tests:** placing twice rejected; firing during `placing` rejected; first shooter honoured; out-of-turn rejected; turn alternates on hit and miss; re-fire rejected and turn unchanged; full game ends with winner and `fleet_sunk`; forfeit during `playing`; forfeit ignored in `placing`.

## Delivery 4 — `naval.protocol` and `naval.rooms`

### Task 4.1: Client message schemas

**Files:** `src/naval/protocol/{__init__,messages}.py`, `tests/protocol/test_messages.py`. Adds runtime dependency `pydantic`.

**Produces:** Pydantic models (`ConfigDict(extra="forbid", strict=True, frozen=True)`): `JoinMessage(type="join", nickname, token: str | None)`, `ShipSpec(kind: ShipKind, row, col, orientation: Orientation)`, `PlaceFleetMessage(type="place_fleet", ships: list[ShipSpec] (length 5))`, `FireMessage(type="fire", row, col)`, `RematchMessage(type="rematch")`, `LeaveMessage(type="leave")`; `ClientMessage` discriminated union; `MAX_FRAME_BYTES = 4096`; `InvalidMessage(GameError, code="invalid_message")`; `parse_client_message(raw: str | bytes) -> ClientMessage` (rejects bytes frames, oversize frames, bad JSON, schema violations — never coerces). `ShipSpec.to_placement() -> Placement`.

**Tests:** each message type parses; unknown `type`, extra fields, wrong types (`"row": "1"`), out-of-range row/col, bad nickname (empty, 21 chars, `<script>`), malformed token, 4097-byte frame, binary frame, invalid JSON, deeply nested JSON → all `InvalidMessage`. Property test: arbitrary text never raises anything other than `InvalidMessage`.

### Task 4.2: Room codes and seat tokens

**Files:** `src/naval/rooms/{__init__,codes,tokens}.py`, tests.

**Produces:** `ROOM_CODE_ALPHABET`, `ROOM_CODE_LENGTH = 6`, `new_room_code() -> str`, `is_valid_room_code(value: str) -> bool`; `new_seat_token() -> str`, `hash_token(token) -> str`, `token_matches(token, token_hash) -> bool`.

**Tests:** generated codes are valid and vary; ambiguous characters and lowercase rejected; token hashes are 64 hex chars; matching and non-matching tokens.

### Task 4.3: Room aggregate

**Files:** `src/naval/rooms/room.py`, `tests/rooms/test_room.py`.

**Produces:**
- `RECONNECT_GRACE_SECONDS = 120`, `IDLE_TIMEOUT_SECONDS = 3600`.
- `RoomFull("room_full")`, `InvalidToken("invalid_token")`, `NotSeated("not_seated")` — all `GameError`.
- `Player(nickname, token_hash, connected: bool, disconnected_at: float | None, wants_rematch: bool)`.
- `Room(code, created_at)`; attributes `players: list[Player | None]` (2), `game: Game`, `last_activity: float`.
- `join(nickname, token, now, first_shooter) -> tuple[int, str | None]`: reconnect by token (returns `(seat, None)`), else take a vacant seat, start a fresh `Game(first_shooter)` and return `(seat, new_token)`. `RoomFull` / `InvalidToken`.
- `disconnect(seat, now)`, `leave(seat, now)`, `expire(now) -> list[int]` (released seats), `request_rematch(seat, first_shooter) -> bool`, `place_fleet`, `fire` (delegating to `Game`, updating `last_activity`), `next_deadline() -> float`, `is_idle(now) -> bool`, `connected_seats() -> list[int]`.

**Tests:** first/second join; third join `RoomFull`; reconnect with token keeps seat and does not reset the game; wrong token `InvalidToken`; join into vacated seat resets game; disconnect + expire before/after grace; expire during `playing` forfeits; leave during `playing` forfeits and releases; rematch needs both votes and resets flags; `next_deadline` is the earliest of grace deadlines and idle deadline.

### Task 4.4: Per-seat views and server messages

**Files:** `src/naval/protocol/views.py`, `tests/protocol/test_views.py`.

**Produces:** `PlayerView(nickname, connected)`; `state_message(room_code, seat, game, players: Sequence[PlayerView | None]) -> dict` with keys `type="state"`, `room_code`, `seat`, `phase`, `turn`, `winner`, `finish_reason`, `players`, `own_fleet` (list of ship dicts or `null`), `fleet_placed` (both seats as booleans), `shots_received` (list of `{row, col, result}`), `shots_fired` (same shape, results only), `opponent_fleet` (only when `finished`, else `null`); `joined_message(seat, room_code, token)`, `shot_message(by, target, result)`, `error_message(code)` (human text from a fixed table).

**Tests:** own fleet visible; opponent fleet `null` while `placing` and `playing`, present when `finished`. **Property test (the RLS-equivalent control):** for random fleets and random shot sequences before the game ends, serialising seat A's state never contains any of seat B's unhit ship cells, and never contains the substring of seat B's placements.

### Task 4.5: Room codec and `RoomService`

**Files:** `src/naval/rooms/{codec,service}.py`, tests.

**Produces:**
- `room_to_json(room) -> str`, `room_from_json(data) -> Room` (round-trips every field including boards and shots).
- `RoomStore` Protocol: `async load() -> Room | None`, `async save(room) -> None`, `async delete() -> None`; `InMemoryRoomStore`.
- `Clock` Protocol (`now() -> float`), `CoinFlip` Protocol (`__call__() -> int`).
- `Delivery(to_requester: list[dict], to_seats: dict[int, list[dict]], bind_seat: int | None, close_requester: bool)`.
- `RoomService(store, clock, coin_flip)`: `async create(code) -> bool`; `async exists() -> bool`; `async handle(seat: int | None, message: ClientMessage) -> Delivery` (join only when `seat is None`, everything else only when seated, `GameError` → `error` to requester); `async disconnected(seat) -> Delivery`; `async alarm() -> Delivery`; `async deadline() -> float | None` (`None` when the room was deleted).
- After every state change, `to_seats` carries a fresh `state` for each connected seat; `fire` also sends `shot` to both.

**Tests:** create twice → second `False`; full join/place/fire/win flow through the service with the in-memory store; errors go only to the requester; `join` while seated rejected; alarm after idle deletes the room; alarm after grace forfeits and notifies the remaining seat; codec round-trip property test on random games.

## Delivery 5 — `GameRoom` Durable Object and routing

### Task 5.1: Configuration and origin policy (pure)

**Files:** `src/naval/worker/{config,origin}.py`, tests.

**Produces:** `MissingConfig(Exception)`; `parse_allowed_origins(raw: str | None) -> frozenset[str]` (comma-separated, trimmed, each must be `https://host` or `http://localhost:port`; empty/missing → `MissingConfig`); `is_origin_allowed(origin: str | None, allowed) -> bool` (exact match, `None` → False); `ROOM_WS_PATH = re.compile(r"^/api/rooms/([A-Z0-9]{6})/ws$")` and `parse_ws_path(path) -> str | None` (also validated with `is_valid_room_code`).

### Task 5.2: Worker entrypoint and Durable Object

**Files:** `src/naval/worker/{entry,game_room}.py`, `src/entry.py`, `wrangler.toml`, `tests/integration/test_rooms_http.py`, `tests/integration/test_rooms_ws.py`.

- `wrangler.toml`: `GAME_ROOM` Durable Object binding + `new_sqlite_classes` migration, `ROOM_CREATION_LIMITER` (10/60) and `WS_UPGRADE_LIMITER` (30/60) rate-limit bindings, `[vars] ALLOWED_ORIGINS = "https://naval.cloudils.com"`, and `[env.dev]`-free local override through `.dev.vars` (`ALLOWED_ORIGINS=http://localhost:8787`), with a committed `.dev.vars.example`.
- Entry: `/api/health`; `POST /api/rooms` (config → origin → rate limit → up to 5 codes → DO `/init`); `GET /api/rooms/{code}/ws` (path → origin → upgrade → rate limit → DO `/ws`); JSON errors with `API_HEADERS`; misconfiguration → 500 + log.
- `GameRoom`: storage key `room` holds `room_to_json`; `/init` → `create`; `/ws` → 404 if no room, else accept hibernatable socket with attachment `{"conn": uuid4, "seat": null}`; `webSocketMessage` → budget → `parse_client_message` → `RoomService.handle` → deliver, rebinding attachment and closing replaced sockets (4000); `webSocketClose`/`webSocketError` → `disconnected` if no other socket holds that seat; `alarm` → `RoomService.alarm`; after each event reschedule alarm to `deadline()`.
- `MessageBudget` (pure, `src/naval/rooms/budget.py`, unit-tested): token bucket keyed by connection id, plus violation counter.

**Integration tests (`pytest -m integration`, `websockets` client as dev dependency):** create room 201 with valid code; bad Origin 403 on both endpoints; missing Origin 403; unknown room 404; malformed code 404; non-upgrade 426; two players play a scripted full game to `finished`; third player gets `room_full`; reconnect with token restores the seat and state; oversized frame → `invalid_message`; five invalid frames close with 1008; creation rate limit returns 429 on the 11th request.

## Delivery 6 — Frontend

**Files:** `public/index.html`, `public/styles.css`, `public/js/{app,api,connection,grid,placement,state,dom}.js`, `public/favicon.svg`.

Design with `ui-ux-pro-max` (dark naval/radar theme, WCAG AA contrast, 44 px touch targets, `prefers-reduced-motion`). Screens: home, lobby, placement, battle, game over, error banner. Grids are `role="grid"` with roving tabindex and arrow-key navigation; cells carry `aria-label`s like "B7, hit". Placement: select ship, hover preview, click to place, `R` to rotate, *Random*, *Clear*, *Ready*. Token stored in `sessionStorage` by room code; reconnect with exponential backoff and a visible "Reconnecting…" state. `?room=CODE` pre-fills the join form.

## Delivery 7 — QA, E2E, CSP enforcement, audit

- Playwright (`e2e/*.spec.ts` in JS, `@playwright/test` pinned): full game between two contexts, reconnect after reload, third player refused, keyboard-only placement and firing, no CSP violations in the console, mobile viewport screenshots. CI job `e2e` (required).
- Switch `Content-Security-Policy-Report-Only` to `Content-Security-Policy` once E2E shows zero violations.
- Full security audit per `CLAUDE.md` against production, with evidence, including triggering rate limits.
- Manual QA pass on production with Playwright MCP: every screen at desktop and 400 px widths, Lighthouse accessibility/performance.
- Edge WAF rate-limit rule: requires a token with zone WAF permissions — documented as a follow-up for the owner if not available.
