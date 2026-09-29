# Differential security review: PR #41 (deep clean)

**Date:** 2026-09-28 · **Scope:** `chore/deep-clean` vs `main` (20 files, +191 / −95) · **Strategy:** DEEP (small codebase)

## Risk classification

| File | Risk | Why |
|---|---|---|
| `src/naval/worker/rate_limiter.py` | HIGH | Rate limiting (control 5): a stored-format reader was removed |
| `src/naval/rooms/service.py` | HIGH | Catch-all around every client message; logs near seat tokens |
| `src/naval/worker/entry.py`, `game_room.py`, `responses.py` | MEDIUM | Public entry point and Durable Object responses refactored |
| `.github/actions/start-dev-server/action.yml`, `.github/workflows/ci.yml` | MEDIUM | CI code path executed on pull requests |
| `package.json`, `package-lock.json` | MEDIUM | Dependency override (undici) |
| `public/js/app.js`, `battle.js`, `notice.js`, `dom.js`, `connection.js` | LOW | Client error handling and dead-code removal |
| `pyproject.toml`, `CLAUDE.md`, tests, E2E helper | LOW | Tooling, docs, tests |

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | LOW | The rate limiter no longer tolerates a stored window without `request_ids`. If one existed, `KeyError` would make every limiter call for that IP and scope fail and the Worker would answer 503 until the key was removed. | Accepted: no such window can exist (evidence below). |
| 2 | LOW | Internal-error logs now carry a full traceback. A traceback holds source lines and the exception text, not local values, so a token would only appear if an exception message embedded it. No code on the covered path formats the message or token into an exception. | Accepted, and pinned by `test_internal_errors_are_logged_with_room_and_seat_but_never_the_token`. |
| 3 | INFO | Logs now contain the room code, as the design spec (section 7) requires. A room code only lets someone take a free seat, and Worker logs are visible only to the account owner. | Accepted. |

No HIGH or MEDIUM findings.

## Evidence

- **Removed legacy reader (finding 1).** `git show 875fbe4:src/naval/worker/rate_limiter.py` (PR #17) shows the first version always called `storage.put(...)` and then `storage.setAlarm(started_at + period)`, and the alarm runs `deleteAll()`. Durable Object alarms are retried until they succeed, so every window in the old format was deleted about a minute after it was written. The new format has been the only one written since PR #25 (`3bab7a6`). The guard was also not a security control: it only chose a fresh window instead of an error.
- **Catch-all scope (`service.py`).** It covers `load`, `_apply`, `save` and `_broadcast_state` for one client message. `GameError` is still handled first, with the same reply and close behaviour as before. Unexpected exceptions now answer `internal_error` and never close a seated connection. A failed first join closes the seatless socket, as every other failed join already did (`_is_first_join`). The log line is `internal error in {room code}, seat {seat}, handling {message type}` plus the traceback. The message object, nickname and token are never interpolated.
- **Token path.** The only code under the catch that touches the token is `Room._reconnect`, then `token_matches`, then `hash_token`. `JoinMessage` already restricts the token to `^[A-Za-z0-9_-]{43}$`, so `token.encode()` cannot raise. `hmac.compare_digest` raises only on a type mismatch, and both sides are `str`. The test reconnects with a real token, makes `save` fail, and asserts the token is absent from stdout.
- **Refactored responses.** `json_response`/`error_response` still send `API_HEADERS`, which is the security headers plus `Cache-Control: no-store`. Status codes are unchanged (`404`, `409`, `201`, `403`, `405`, `426`, `429`, `500`, `503`). The Origin check and the IP limit in `_guard` are untouched. `partial(self._init_room, code, body)` still builds a fresh stub on each retry. Integration tests: 25 passed against `pywrangler dev`.
- **Client error handling.** Server error text still reaches the page only through `notify()`, and `notify()` writes `textContent`. Unlocking pending actions after an error grants nothing: the server re-validates turn, phase and fleet on every message.
- **CI.** The composite action runs the same commands the two jobs ran before. The CI workflow keeps `permissions: contents: read`. `deploy.yml` calls CI without `secrets: inherit`, so the action never sees the Cloudflare token. A fork PR could already change these commands before this PR.
- **undici override.** Scoped to `miniflare`, pinned to `7.29.1`, and fetched from `registry.npmjs.org` with an integrity hash in the lockfile. It is published by the Node.js project, and the release is three weeks old, beyond the project's seven-day cooldown. It is dev-only (`"dev": true`) and never reaches the Worker bundle. `npm audit` reports 0 findings.

## Test coverage

- New unit tests: a failed first join (internal error and close), a failed action (the seat is kept), an unreadable room, and a log that names the room but not the token.
- The client unlock path has no automated test. An `internal_error` or `rate_limited` reply cannot be provoked through the UI, and the project has no JS unit test harness.

## Coverage limits

- Production logging format (Cloudflare Workers Logs) was not inspected. The analysis relies on `print` going to stdout, which the Python Workers runtime forwards to logs.
- Whether old-format rate-limit windows still exist in production storage was reasoned from the code history, not by listing Durable Object storage (no tooling for that).
