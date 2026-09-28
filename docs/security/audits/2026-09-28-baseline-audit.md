# Baseline security audit — 2026-09-28

**Target:** `https://naval.cloudils.com` (production, version `e593be71`) and `main` at `1e45cec`.
**Method:** the procedure in `CLAUDE.md` ("Auditing these controls"): evidence from real responses and commands, nothing fixed during the audit.

## Summary

| # | Control | Status | Evidence (one line) |
|---|---|---|---|
| 1 | Secrets in env vars | OK | No credential patterns in the full `git log --all -p`; 0 GitHub secret-scanning alerts; only `.dev.vars.example` is tracked; no secrets in `public/`. |
| 2 | CORS | OK | Responses carry no `Access-Control-*` headers for any Origin; a foreign-origin `POST /api/rooms` gets 403, a preflight gets 405. |
| 3 | Backend validation | OK | Strict Pydantic schemas for every frame (unit plus hypothesis tests); against production, oversized, binary and invalid frames got `invalid_message`, and the fifth closed with 1008 (integration suite run against prod). |
| 4 | Sanitisation | OK | No SQL; room state is JSON in Durable Object storage. The frontend has no `innerHTML`/`insertAdjacentHTML`/`eval` (guarded by `tests/frontend/test_index.py`). |
| 5 | Rate limiting | **MISSING (configured, not effective)** | 52 `POST /api/rooms` and 40 WebSocket upgrades from one IP within about 90 s were all accepted in production; the configured limits are 10/min and 30/min. |
| 6 | RLS equivalent (fleet isolation) | OK | Property test `test_a_player_never_sees_unhit_enemy_ships_before_the_end`; E2E confirms the enemy fleet only appears in the finished state. |
| 7 | CSP and headers | OK | A real response from `/`, `/js/app.js` and `/api/health` carries an enforced CSP (`default-src 'self'`, no `unsafe-*`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`), HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` and COOP. |

## Findings not OK

### 5 — Rate limiting is configured but not enforced in production

- **What:** `src/naval/worker/entry.py` (`Default._guard`) calls the Workers Rate Limiting bindings `ROOM_CREATION_LIMITER` (10/60 s) and `WS_UPGRADE_LIMITER` (30/60 s), keyed by `CF-Connecting-IP`. Locally (`wrangler dev`) the 11th creation returns 429 (covered by `test_room_creation_is_rate_limited_per_ip`). In production, the same sequence never returned 429:
  - `for i in 1..52: curl -X POST -H "Origin: https://naval.cloudils.com" https://naval.cloudils.com/api/rooms` → 52 × 201.
  - 40 sequential WebSocket upgrades to one room → 40 × 101.
- **Why, as far as can be observed:** Cloudflare documents the binding as "local to the Cloudflare location", "eventually consistent" and "intentionally designed to not be used as an accurate accounting system". The deploy lists both bindings and no warning. Whatever the cause, the observable behaviour is that the limit does not hold.
- **What an attacker gains:** unbounded room creation from one IP. Each room is a Durable Object with storage and an alarm, so a script can create rooms indefinitely, driving Durable Object requests, storage writes and alarms up. That is cost amplification on the owner's account, not a data breach. Unbounded upgrades let a client open sockets at will; each is still limited by the per-connection message budget (which **was** verified in production).
- **Smallest fix:** an accurate per-IP limiter in the application layer: a small `RateLimiter` Durable Object keyed by `scope:ip` with a fixed window persisted in its storage (strongly consistent, single-threaded per key). Keep the Worker guard as the call site, then verify by triggering it in production.
- **Also missing:** an edge-layer rule (Cloudflare WAF rate limiting on `/api/rooms`). It needs a token with zone WAF permissions, which this session does not have.

## What could not be verified

- **Fail-closed on missing `ALLOWED_ORIGINS` in production:** proven by unit tests and the code path, but not triggered in production (doing so would break the live site).
- **Edge WAF configuration of the `cloudils.com` zone:** needs a token with zone WAF/rulesets read permission.
- **The Cloudflare account's Web Analytics setting**, which injects the beacon now allowed by the CSP: needs dashboard access.

## Risk order for this project

1. **Rate limiting (control 5):** the only finding, and the only one with direct cost impact. Fix first.
2. Everything else is OK with evidence.

---

## Remediation follow-up

Tracked in the same PR as this report (see below, appended after the fix was deployed and re-verified).
