# Team flags (#39) Implementation Plan

> Executed task by task in a single session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each player flies one of the 26 International Code of Signals letter flags; the two players in a room always fly different flags; the flag can be chosen on the home screen and changed while placing ships.

**Architecture:** `Flag` is a pure enum in `naval.domain.flags`. `Room` owns the uniqueness rule (a taken or missing request gets the first free flag; `choose_flag` rejects a taken one and only works while placing). The protocol adds an optional `flag` to `join`, a `choose_flag` message and `players[i].flag` in `state`. The client gets an external SVG sprite with all 26 flags, a reusable radio-group picker, and shows flags next to names.

**Tech Stack:** Python 3.14, Pydantic v2 (strict), hypothesis, vanilla ES modules, Playwright.

## Global Constraints

- Dependencies point inward (`worker -> rooms -> protocol -> domain`); `domain` imports nothing from the project.
- Every client message is validated by a strict Pydantic model with `extra="forbid"`; an unknown flag is `invalid_message`.
- Stored rooms written before this change must still load (no format version bump): a missing `flag` reads as `None`.
- Client: `textContent` only, no inline scripts, styles or handlers; every module is `modulepreload`ed; colours come from tokens; flags are never told apart by colour alone (each has its own pattern and a name).

---

### Task 1: Flags in the domain, protocol and rooms

**Files:** Create `src/naval/domain/flags.py`, `tests/domain/test_flags.py`; modify `src/naval/protocol/messages.py`, `src/naval/protocol/views.py`, `src/naval/rooms/room.py`, `src/naval/rooms/service.py`, `src/naval/rooms/codec.py` and their tests.

**Interfaces produced:**
- `naval.domain.flags.Flag` — `StrEnum`, members `A`…`Z` with values `"a"`…`"z"`.
- `naval.rooms.room.FlagTaken(GameError)` — `code = "flag_taken"`.
- `Room.join(nickname, token, now, first_shooter, flag=None) -> tuple[int, str | None]`.
- `Room.choose_flag(seat, flag, now) -> None`.
- `Player.flag: Flag | None = None`; `PlayerView(nickname, flag, connected, wants_rematch)`.
- `ChooseFlagMessage(type="choose_flag", flag: Flag)`; `JoinMessage.flag: Flag | None = None`.
- `state.players[i]` = `{"nickname", "flag", "connected", "wants_rematch"}` (`flag` a letter or `null`).

- [ ] **Step 1: Failing tests** — room: requested flag kept; a taken or missing request gets the first free flag in alphabetical order; reconnect keeps the flag; `choose_flag` changes it in placing, raises `FlagTaken` for the opponent's flag and `WrongPhase` once playing; property test: whatever two requests (including `None`), the seated players fly different flags. Protocol: `join` with and without `flag`, unknown or uppercase flag rejected, `choose_flag` parsed, missing `flag` rejected; the `state` view carries both flags. Codec: flags round-trip; a stored room without `flag` loads with `None`. Service: `choose_flag` reaches both players' states; a taken flag answers `flag_taken`.
- [ ] **Step 2: Watch them fail**, then implement the interfaces above.
- [ ] **Step 3:** `uv run pytest`, `ruff`, `mypy` green. **Commit** `feat: players fly a signal flag, unique within a room`.

### Task 2: Flags in the client

**Files:** Create `public/flags.svg`, `public/js/flags.js`, `public/js/flag-picker.js`; modify `public/index.html`, `public/terms.html` (sprite moves out), `public/js/app.js`, `public/js/session.js`, `public/js/placement.js`, `public/js/battle.js`, `public/styles.css`; tests `e2e/flags.spec.js`, `tests/frontend/test_flags.py`.

- [ ] **Step 1: Failing tests** — `tests/frontend/test_flags.py`: `flags.svg` defines exactly `flag-a`…`flag-z` and the brand only references symbols that exist. `e2e/flags.spec.js`: a flag picked at home is the one shown for the player on the placement screen and in battle; a second player asking for the host's flag gets another one and is told so; the opponent's flag is disabled in the placement picker; changing the flag in placement updates both players' screens.
- [ ] **Step 2: Implement.** `flags.js` exports `FLAGS` (code and phonetic name) and `flagIcon(code)`; `FlagPicker` renders a disclosure whose summary shows the current flag, containing a `fieldset` of 26 radios (keyboard native), with `value`, `setValue(code)`, `setTaken(code)` and an `onChange` callback. Home: the picker follows the nickname's initial until the player picks one, then remembers it (`naval.flag`). Join sends the flag. Placement: header "You [flag] vs [flag] Opponent", picker with the opponent's flag disabled, `choose_flag` on change, a note when the server assigned a different flag. Battle: flags next to the board titles.
- [ ] **Step 3:** full E2E (desktop, mobile), axe checks, `pytest tests/frontend`. **Commit** `feat: pick and show each player's signal flag`.

### Task 3: Ship it

- [ ] Integration test over a real WebSocket (`tests/integration/test_rooms.py`): two players asking for the same flag end up with different ones; `choose_flag` is broadcast.
- [ ] PR (`Closes #39`), `sharp-edges` pass on the protocol change, `code-review`, `differential-review` (new message type), CI, squash-merge, production smoke.
