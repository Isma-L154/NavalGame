# Security Policy

## Supported versions

Only the version currently deployed at https://naval.cloudils.com (the `main` branch) receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report it privately through GitHub's **Report a vulnerability** button in the [Security tab](https://github.com/Isma-L154/NavalGame/security/advisories/new). Include the affected endpoint or file, steps to reproduce and the impact you observed.

You can expect an acknowledgement within 7 days. Once a fix is deployed, the advisory is published with credit to the reporter unless you prefer to stay anonymous.

## Baseline security controls

1. **Secrets in environment variables: implemented.** The app has no secrets. Runtime config (`ALLOWED_ORIGINS`) comes from Wrangler `vars`, and the Worker answers 500 and logs the missing key when it is absent instead of falling back to a default. The Cloudflare deploy token lives only as a GitHub Actions secret in the `production` environment. Seat tokens are generated server-side with `secrets.token_urlsafe(32)` and stored as SHA-256 hashes.
2. **CORS: implemented.** The frontend is same-origin, so the API sends no CORS headers. Because CORS does not protect WebSockets or simple `POST`s, the Worker checks `Origin` against `ALLOWED_ORIGINS` on the WebSocket upgrade and on `POST /api/rooms` and rejects anything else with 403.
3. **Backend validation: implemented.** Every WebSocket message and HTTP input is parsed by a strict Pydantic model (`extra="forbid"`, strict types, bounded ranges). Messages over 4 KB are rejected before parsing, and the room code in the path must match the room-code alphabet exactly.
4. **Sanitize before storage: implemented.** Durable Object storage is key/value, so no SQL is built at all. The browser renders user text with `textContent` only, and no user input reaches a shell, a template engine or a deserializer beyond `json.loads` plus the schema.
5. **Rate limiting: implemented.** A `RateLimiter` Durable Object per scope and hashed client IP allows 10 room creations and 30 WebSocket upgrades per minute, and each connection has a message budget inside `GameRoom`. There are no accounts, so per-account limiting is per-seat. Every limit is triggered by an integration test. An edge WAF rule on `/api/rooms` is pending, and there is no reverse proxy layer.
6. **Row Level Security: N/A.** There is no shared database or user accounts: each room is an isolated Durable Object. The equivalent risk, one player seeing the other's fleet, is covered by a test proving a seat's view never contains the opponent's ship positions before `game_over`.
7. **Content Security Policy: implemented.** Static assets (`public/_headers`) and Worker responses send `default-src 'self'` with no `unsafe-inline` or `unsafe-eval`, `frame-ancestors 'none'`, `object-src 'none'` and `base-uri 'self'`, plus HSTS, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`.
