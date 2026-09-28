# Differential security review — PR #10 (GameRoom Durable Object, routing, rate limits)

**Date:** 2026-09-28 · **Scope:** `feat/game-room-durable-object` vs `main` · **Strategy:** DEEP

## Risk classification

| File | Risk | Why |
|---|---|---|
| `src/naval/worker/entry.py` | HIGH | Public entry point: origin checks, rate limits, forwarding to rooms |
| `src/naval/worker/policy.py` | HIGH | Origin allowlist parsing (fail-closed configuration) |
| `src/naval/worker/game_room.py` | HIGH | Connection identity, seat binding, message budget |
| `wrangler.toml`, `.dev.vars.example` | MEDIUM | Bindings, limits, configured origins |
| `src/naval/worker/do_store.py` | LOW | Storage adapter |

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | LOW | Room codes are the only capability needed to take a free seat. An attacker guessing codes over WebSocket upgrades is limited to 30 per minute per IP against 31⁶ ≈ 887 million codes, and a guessed room with two seated players is useless. | Accepted by design: the spec makes rooms joinable by code. |
| 2 | LOW | Messages over budget get an error reply each and do not count as violations, so a flooding client stays connected. | Accepted: each reply is small; the per-IP upgrade limit bounds reconnect churn. |
| 3 | INFO | Local dev honours a client-supplied `CF-Connecting-IP`, which the integration tests rely on. | Production is unaffected: Cloudflare overwrites `CF-Connecting-IP` at the edge. To be confirmed in the production audit. |

No HIGH or MEDIUM findings. The code review's alarm-rounding and double-disconnect edge cases were fixed in `fix: keep the first disconnect time and round alarms up`.

## Evidence

- **The internal `/init` route cannot be reached from outside.** The Worker forwards to the Durable Object only after `parse_ws_path` matched `/api/rooms/{code}/ws` and the request is a GET with `Upgrade: websocket`. The Durable Object serves `/init` only for `path == "/init"` and `POST`, which a forwarded request can never be.
- **Origin (control 2).** `parse_allowed_origins` rejects empty, `*`, schemeless, `http://` non-localhost and trailing-slash values, so the Worker fails closed with a 500 (`tests/worker/test_policy.py`). Exact-match comparison, no reflection, no CORS headers emitted. Integration tests: foreign, missing and `127.0.0.1` origins get 403 on both entry points.
- **Rate limits (control 5), triggered in tests.** `test_room_creation_is_rate_limited_per_ip`: 10 × 201, then 429, and a different IP still gets 201. `test_message_budget_limits_floods`: `rate_limited` after the budget. `test_fifth_invalid_frame_closes_the_socket`: close code 1008.
- **Connection identity.** `_bind` and `_unbind_and_close` clear the attachment's seat before closing. `_connection_lost` reports `disconnected` only when no other socket holds the seat. Covered by `test_reconnecting_replaces_the_old_socket_without_a_disconnect` (the replaced socket closes with 4000, and the opponent never sees a disconnect).
- **No secrets in logs.** The only `print` calls log a configuration error message and an exception type name, never messages or tokens.

## Coverage limits

- The Cloudflare edge behaviour (`CF-Connecting-IP` overwrite, WAF) can only be verified in production (delivery 7 audit).
- The deploy token's permissions for Durable Object migrations and rate-limit bindings are verified by the first deploy of this PR.
