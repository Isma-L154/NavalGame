# Differential security review: retry budget and asset caching (#52)

**Date:** 2026-09-29 · **Scope:** `fix/deploy-retries-and-asset-caching` vs `main` · **Strategy:** DEEP (the retry wrapper carries every rate-limit check: mandatory review per `CLAUDE.md`)

## Change

- `call_with_retry` defaults go from 3 attempts with backoff up to 0.05/0.1 s, to 5 attempts with full-jitter backoff up to 0.2, 0.4, 0.8 and 1.6 s. What gets retried is unchanged: only errors the runtime marks `retryable` and not `overloaded`.
- `public/_headers` gains `Cache-Control` for `/fonts/*` (a year, `immutable`) and `/flags.svg` (a day).
- Comments and documentation only in `public/flags.svg` and `CLAUDE.md`.

## Risk classification

| File | Risk | Why |
|---|---|---|
| `src/naval/worker/retry.py` | HIGH | Wraps the three Durable Object calls of the Worker: room `/init`, the WebSocket upgrade, and the per-IP rate-limit check |
| `public/_headers` | MEDIUM | Static-asset headers, next to the site-wide security headers |
| `public/flags.svg`, `CLAUDE.md` | LOW | Comments |

## Blast radius

`call_with_retry` has three callers, all in `src/naval/worker/entry.py`: `_create_room` (line 57), `_open_room_socket` (line 78) and `_guard` (line 90).

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | LOW | More attempts means more Durable Object calls per request when the platform fails: at most 5 instead of 3. | Accepted: only errors the runtime marks retryable are retried, and a client cannot cause them. Overloaded errors are still never retried, which keeps backpressure. The sleeps cost wall time, not CPU. |
| 2 | INFO | A rate-limit check that is retried could count one request twice. | Already handled: each check carries one `request_id` across its retries, and `consume` ignores an id it has seen (`tests/limits/test_window.py`). The budget change does not alter this. |
| 3 | INFO | A long-cached asset could keep stale security headers. | Not the case: the `/*` block still applies to the cached paths. The new integration test asserts `X-Content-Type-Options` and the CSP on `/fonts/*` and `/flags.svg`. HTML, scripts and styles keep `must-revalidate`, so a CSP change still reaches every page load. |

No HIGH or MEDIUM findings.

## Evidence

- `tests/worker/test_retry.py::test_the_default_budget_waits_out_a_durable_object_restart` pins 5 attempts and the delay caps. The existing tests still show that overloaded and non-retryable errors are not retried.
- `tests/integration/test_worker_http.py::test_fonts_and_the_flag_sprite_are_cached_and_pages_are_revalidated` against `pywrangler dev`.
- The rate limits are unchanged: `pytest -m integration` still triggers both limits (29 passed).

## Coverage limits

- The Worker logs for the 503 seen after the #48 deploy were not read, so the error class behind it (retryable or not) is unconfirmed. If it was not marked retryable, this change does not help, and the next post-deploy failure should be checked in Workers Logs.
