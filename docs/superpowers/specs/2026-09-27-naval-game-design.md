# NavalGame — Design

**Date:** 2026-09-27
**Status:** Approved

## 1. Goal

A browser game for exactly two players based on the classic naval battle board game. A player creates a room and gets a short code; the second player joins with that code. Both place a fleet on a hidden 10x10 grid, then alternate firing at coordinates on the opponent's grid. The first player to sink the whole enemy fleet wins.

Non-goals for the first version: user accounts, match history, spectators, chat, AI opponent, more than two players per room, UI languages other than English.

## 2. Game rules

- Grid: 10x10. Rows `A`–`J`, columns `1`–`10`. Internally zero-based `(row, col)`, `0 <= row, col <= 9`.
- Fleet (one of each):

  | Kind | Length |
  |---|---|
  | `carrier` | 5 |
  | `battleship` | 4 |
  | `cruiser` | 3 |
  | `submarine` | 3 |
  | `destroyer` | 2 |

- Ships are placed horizontally or vertically, fully inside the grid, and may not overlap. Ships may touch.
- Both players place their fleets simultaneously. The battle starts when both have submitted a valid fleet.
- The first shooter is chosen at random by the server.
- One shot per turn, strictly alternating (a hit does not grant another shot).
- Firing at an already-targeted cell is rejected (`already_fired_there`) and does not consume the turn.
- Each shot resolves to `miss`, `hit` or `sunk`. On `sunk`, the ship kind is announced.
- A player wins when all opponent ships are sunk, or by forfeit when the opponent leaves or does not reconnect within the grace period.
- After a game ends, both players can request a rematch; when both accept, the room resets to placement with the same seats.

## 3. Hosting and architecture

A single Cloudflare **Python Worker** (`naval-game`) on the custom domain `naval.cloudils.com`.

```
Browser (HTML/CSS + vanilla JS, static)
   │  HTTPS  POST /api/rooms             → create a room, returns its code
   │  WSS    GET  /api/rooms/{code}/ws   → WebSocket into the room
   ▼
Worker entrypoint (Python)
   - routes requests, checks Origin, applies rate limits
   - static files served by Workers Static Assets (public/)
   │  env.GAME_ROOM.getByName(code)
   ▼
GameRoom Durable Object (one per room, Python, WebSocket Hibernation API)
   - at most two seats, enforced atomically (a DO processes one event at a time)
   - authoritative game state persisted in DO storage (survives hibernation)
   - alarms: reconnection grace period, idle-room cleanup
```

Rationale: a Durable Object per room gives a single, strongly consistent owner for each game, which is exactly what a two-seat turn-based room needs. With hibernation the cost at low traffic is effectively zero and there is no server to maintain.

**Python version:** 3.14, pinned to what the Workers Pyodide runtime supports (verified with `pywrangler dev`: the runtime reports 3.14.2). Local tooling uses the same version.

## 4. Components

Dependencies point inward: `worker → rooms → protocol → domain`.

### 4.1 `naval.domain` — pure game rules

No I/O and no Cloudflare imports.

- `Coordinate`: validated `(row, col)`.
- `ShipKind`: enum with lengths. `STANDARD_FLEET` lists the required kinds.
- `Placement`: `kind`, origin `Coordinate`, `Orientation` (`horizontal` / `vertical`); computes its cells.
- `Board`: built from a list of placements; validates the fleet (complete, in bounds, no overlaps); resolves a shot to `ShotResult` (`miss` / `hit` / `sunk` + kind); tracks shots received; knows when all ships are sunk.
- `Game`: state machine `PLACING → PLAYING → FINISHED` for two seats (`0` and `1`); holds both boards, whose turn it is and the winner. Operations: `place_fleet(seat, placements)`, `fire(seat, coordinate)`, `forfeit(seat)`, `rematch()`. Raises typed `GameError` subclasses with stable error codes.

### 4.2 `naval.protocol` — messages and views

- Pydantic v2 models for every client message, strict, `extra="forbid"`, discriminated by `type`.
- Builders for server messages.
- `view_for(game, seat)`: the per-player state. It contains the player's own ships and shots received, and only the player's shots at the opponent with their results. The opponent's ship positions are included **only** once the game is `FINISHED`.

### 4.3 `naval.rooms` — room lifecycle

- `RoomCode`: six characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0 O 1 I L`); generated with `secrets`.
- `SeatToken`: `secrets.token_urlsafe(32)`; only the SHA-256 hash is stored; comparison with `hmac.compare_digest`.
- `Room`: seats (nickname, token hash, connected flag), the `Game`, timestamps. Handles join (new seat, reconnect with token, reject when full), disconnect, rematch votes.
- `RoomStore` protocol (`load() -> Room | None`, `save(room)`, `delete()`), with an in-memory implementation for tests.
- `Clock` protocol for time, so timeouts are testable.

### 4.4 `naval.worker` — Cloudflare adapters

- `entry.py`: `WorkerEntrypoint` subclass. Routes `POST /api/rooms` and `GET /api/rooms/{code}/ws`, validates `Origin` against `ALLOWED_ORIGINS`, applies the Rate Limiting binding, forwards to the Durable Object. Everything else falls through to static assets.
- `game_room.py`: `GameRoom(DurableObject)`. Accepts hibernatable WebSockets, stores the seat index in the socket attachment, parses messages via `naval.protocol`, applies them through `naval.rooms`, broadcasts per-seat views, schedules alarms.
- `do_store.py`: `RoomStore` over Durable Object storage.
- `headers.py`: security headers applied to Worker responses.

### 4.5 Frontend (`public/`)

Plain HTML, CSS and ES-module JavaScript, no build step. Screens:

1. **Home:** nickname input, *Create room*, *Join* with a code field. A `?room=CODE` link pre-fills the code.
2. **Lobby:** large room code, *Copy link*, "Waiting for opponent…".
3. **Placement:** own grid, ship list, click to place, `R` / button to rotate, *Random*, *Ready*.
4. **Battle:** own grid and target grid, turn indicator, shot log.
5. **Game over:** result, revealed enemy fleet, *Rematch*, *Leave*.

The seat token is kept in `sessionStorage` keyed by room code to allow reconnection after a reload. User text is rendered with `textContent` only. The grids are keyboard-navigable, and hit/miss/sunk use distinct symbols as well as color.

## 5. Protocol

JSON text frames, at most 4 KB each; larger frames are rejected and the socket is closed.

**Client → server**

| `type` | Fields | Allowed when |
|---|---|---|
| `join` | `nickname`, optional `token` | first message on every connection |
| `place_fleet` | `ships: [{kind, row, col, orientation}]` (exactly the standard fleet) | `PLACING`, own fleet not yet placed |
| `fire` | `row`, `col` | `PLAYING`, own turn |
| `rematch` | none | `FINISHED` |
| `leave` | none | any time |

**Server → client**

| `type` | Fields |
|---|---|
| `joined` | `seat`, `token` (only on first join), `room_code` |
| `state` | full per-seat view (phase, own board, shots, opponent nickname and connection status, turn, winner) |
| `shot` | `by`, `row`, `col`, `result`, optional `kind` |
| `game_over` | `winner`, `reason` (`fleet_sunk` / `forfeit`), `opponent_fleet` |
| `error` | `code` (stable string), human-readable `message` |

HTTP:

- `POST /api/rooms` → `201 {"code": "K7QX2M"}`. The Worker picks a random code and asks the Durable Object to initialise; if that code is already taken it retries (up to 5 times, then `503`).
- `GET /api/rooms/{code}/ws` → `101` on success; `404` for an unknown room; `403` for a bad Origin; `429` when rate limited. A full room is reported over the socket (`error room_full`, then close) so the client gets a clear message.

## 6. Connection lifecycle and timeouts

- The first join gets a new seat and a token. A later `join` with a valid token reclaims the same seat (a new socket replaces the old one).
- A third player gets `room_full`.
- When a seated player's socket closes, they are marked disconnected and the opponent is notified. If they do not reconnect within **120 s** during `PLAYING`, the opponent wins by forfeit. In `PLACING` or `FINISHED`, the seat is simply released.
- A room with no activity for **60 min** deletes its storage (via a DO alarm).
- The server auto-responds `ping` → `pong` without waking the Durable Object (keep-alive).

## 7. Error handling

- Domain and room errors are typed and carry a stable `code`; the Durable Object turns them into `error` messages without closing the socket.
- Malformed JSON, schema violations and oversized frames get `error invalid_message`. Repeated violations close the socket with code `1008`.
- Unexpected exceptions are logged with the room code and seat (never tokens) and answered with `error internal_error`.
- The client always treats `state` as the source of truth and re-renders from it.

## 8. Security

The seven baseline controls and how they apply are recorded in `CLAUDE.md` (section "How the seven controls apply to NavalGame"). In summary: no app secrets; no CORS headers plus an Origin check on the WebSocket upgrade and on room creation; strict Pydantic validation with size limits; no string-built SQL and `textContent`-only rendering; rate limiting at the edge (WAF rule), per IP (Workers Rate Limiting binding) and per connection (message budget); RLS N/A, replaced by a test that seat A never sees seat B's fleet; a strict CSP without `unsafe-inline`/`unsafe-eval`, rolled out report-only first.

Repository: public, `main` protected by a ruleset (PR only, squash merge, linear history, required CI checks, no force push or deletion). Secret scanning with push protection, Dependabot alerts, security updates and weekly version updates (`uv`, `github-actions`), CodeQL default setup, private vulnerability reporting, `SECURITY.md`, Actions with read-only default token and SHA-pinned actions.

## 9. CI/CD

- **CI** (`ci.yml`, on every pull request and on push to `main`): `ruff check`, `ruff format --check`, `mypy`, `pytest`, Semgrep. These jobs are required status checks on `main`.
- **CD** (`deploy.yml`, on push to `main`): re-runs the test job, then deploys with `pywrangler deploy` from the `production` GitHub environment, which holds the Cloudflare API token secret.
- Dependabot PRs go through the same CI.

## 10. Testing

- **Unit (pytest):** `domain`, `protocol` and `rooms` on plain CPython 3.14 with the in-memory `RoomStore` and a fake `Clock`.
- **Property-based (hypothesis):** random valid fleets always validate; random overlapping or out-of-bounds fleets are always rejected; firing every occupied cell always ends the game; the view for seat A never contains seat B's ship cells before `FINISHED`.
- **Security tests:** Origin rejection, oversized frame rejection, room-full rejection, token reuse from another room rejected, and rate limits triggered.
- **E2E (Playwright):** two browser contexts against `pywrangler dev` play a full game; reload and reconnect mid-game; a third browser is refused.

## 11. Delivery plan (one issue + PR each)

1. Project foundation: `CLAUDE.md`, this spec, repo tooling, CI.
2. Worker skeleton + CD: minimal Worker serving `public/` with security headers on `naval.cloudils.com`, deploy workflow.
3. Game domain (`naval.domain`) with unit and property tests.
4. Protocol and rooms (`naval.protocol`, `naval.rooms`).
5. `GameRoom` Durable Object and HTTP/WebSocket routing, rate limiting.
6. Frontend UI.
7. E2E tests, CSP enforcement, WAF rule and the first full security audit.
