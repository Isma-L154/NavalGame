# Differential security review: team flags (#39)

**Date:** 2026-09-28 · **Scope:** `feat/team-flags` vs `main` after #43 · **Strategy:** DEEP (protocol change) · **Includes:** the `sharp-edges` pass on the protocol change

## Risk classification

| File | Risk | Why |
|---|---|---|
| `src/naval/protocol/messages.py` | HIGH | New client message type (`choose_flag`) and a new field on `join`, which is the first message on every connection |
| `src/naval/rooms/room.py`, `src/naval/rooms/service.py` | MEDIUM | New state change on a seat; uniqueness rule between two players |
| `src/naval/rooms/codec.py` | MEDIUM | Reads a new field from stored rooms, including rooms stored before it existed |
| `src/naval/protocol/views.py` | LOW | One more public field per player (`flag`) |
| `public/flags.svg`, `public/js/flags.js`, `public/js/flag-picker.js`, views | LOW | Rendering; no new sink (textContent and `createElementNS` only) |

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | LOW | Uniqueness compared flags by identity (`is`). A plain string such as `"k"` equals `Flag.K` but is not identical to it, so a future caller passing text would have broken the "two different flags" rule. | Fixed: compared by value, with a test that passes plain text. |
| 2 | INFO | `choose_flag` makes the room broadcast a state to both players, an amplification factor of 2. | Accepted: the per-connection budget (20 messages per 10 s) bounds it like every other message. |
| 3 | INFO | A stored room with an invalid `flag` would make every message on it fail with `internal_error`. | Accepted: only the server writes room storage; it is not reachable from outside. |

No HIGH or MEDIUM findings.

## Evidence

- **Validation (control 3).** `flag` is `Flag | None` on `join` and `Flag` on `choose_flag`, parsed by the strict models with `extra="forbid"` and only in JSON mode. `"K"`, `"kk"`, `1`, `""`, `null` (on `choose_flag`), `"ä"` and extra keys are all rejected as `invalid_message` (`tests/protocol/test_messages.py`). The 4 KB frame limit and the budget apply unchanged.
- **Authorization.** `choose_flag` needs a seat (`NotJoined` otherwise) and changes only that seat's flag. It is refused outside the placing phase (`WrongPhase`), and it is refused with `flag_taken` for the flag the opponent flies. The Durable Object handles one event at a time, so two players cannot race to the same flag.
- **Defaults (sharp edges).** A missing or taken flag on `join` becomes the first free flag, never the opponent's. The hypothesis test `test_the_two_players_always_fly_different_flags` covers every pair of requests, including `None`. A reconnect with a token ignores `flag`, so a replayed or forged `join` cannot change a seated player's flag.
- **RLS equivalent (control 6).** The view adds only the players' flags, which are public by design. `test_a_player_never_sees_unhit_enemy_ships_before_the_end` still passes.
- **Storage compatibility.** `test_a_room_stored_before_flags_existed_still_loads`: a room without the key loads with `flag = None`, and that seat can still choose a flag.
- **Output (control 4).** Flag names come from a fixed client table. Nicknames still reach the page only through `textContent`, and the sprite is a static same-origin file. No CSP change was needed: `/flags.svg` is loaded as an image from `'self'`.

## Coverage limits

- Old browser bundles that do not send `flag` were tested at the protocol level (`flag` is optional), not with an old bundle in a browser.
