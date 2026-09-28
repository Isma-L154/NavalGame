# Differential security review — PR #8 (protocol, rooms, room service)

**Date:** 2026-09-27 · **Scope:** `feat/protocol-and-rooms` vs `main` · **Strategy:** DEEP (small codebase, greenfield code: no removed code to blame)

## Risk classification

| File | Risk | Why |
|---|---|---|
| `src/naval/rooms/tokens.py` | HIGH | Seat credentials |
| `src/naval/rooms/room.py` | HIGH | Seat assignment and reconnection (access control) |
| `src/naval/protocol/messages.py` | HIGH | Only input validation boundary for WebSocket frames |
| `src/naval/protocol/views.py` | HIGH | Decides what each player can see (confidentiality of the fleet) |
| `src/naval/rooms/service.py`, `codec.py` | MEDIUM | State changes and persistence |
| `src/naval/rooms/codes.py`, `budget.py` | MEDIUM | Room addressing, abuse limits |

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | MEDIUM | A late close event from a replaced or leaving connection could mark the seat's current occupant as disconnected, which after 120 s forfeits their game. `RoomService.disconnected` cannot tell connections apart. | Mitigated by contract: the Durable Object must unbind a connection before closing it and only report `disconnected` when no open connection holds the seat (documented on `disconnected`). **Must be verified by an integration test in delivery 5.** |
| 2 | LOW | A wrong token gets `invalid_token` without closing the socket, so a client can retry tokens. | Accepted: tokens carry 256 bits of entropy (`token_urlsafe(32)`), and each connection is limited by the message budget and the per-IP upgrade limit. Online guessing is infeasible. |
| 3 | INFO | The token is sent to the client in `joined` and kept in `sessionStorage`; XSS would expose it. | Covered by baseline control 7 (strict CSP) and `textContent`-only rendering in the frontend. |

No HIGH findings.

## Evidence for the HIGH-risk properties

- **Tokens:** generated with `secrets.token_urlsafe(32)` (`tokens.py:6`), stored only as SHA-256 (`room.py:66`), compared with `hmac.compare_digest` (`tokens.py:14`). The codec persists `asdict(Player)`, which holds `token_hash` only (`codec.py`); views build `PlayerView(nickname, connected)`, never the hash. Tokens are per room: a token from another room matches no hash and raises `InvalidToken`.
- **Validation:** every client frame goes through `parse_client_message`, which checks text type, UTF-8 encodability and a 4096-byte limit before strict Pydantic validation (`extra="forbid"`, `strict=True`, bounded indices, allowlist patterns). Hypothesis tests over arbitrary Unicode, lone surrogates included, prove that only `InvalidMessage` can escape.
- **Isolation (RLS equivalent):** `state_message` includes `opponent_fleet` only when the phase is `finished` (`views.py`). `opponent_sunk` lists only ships whose every cell was hit. The property test `test_a_player_never_sees_unhit_enemy_ships_before_the_end` checks, for random fleets and shot sequences, that seat A's view mentions no cell of seat B it has not fired at.
- **Seat capacity:** `Room.join` refuses a third player (`RoomFull`); the Durable Object serialises events, so two simultaneous joins cannot both take the last seat (verified in delivery 5).

## Blast radius

The only consumers of these modules are `RoomService` and, in delivery 5, the `GameRoom` Durable Object. No existing production path changes in this PR; the deployed Worker still serves only `/api/health`.

## Coverage limits

- The transport (Durable Object), where finding 1 is actually enforced, does not exist yet.
- No fuzzing of Pydantic internals beyond hypothesis text strategies.
