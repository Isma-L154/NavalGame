# NavalGame

A two-player online naval battle, playable at **https://naval.cloudils.com**.

Create a room, share its six-character code, place five ships on a 10 × 10 grid and take turns firing until one fleet is sunk. No accounts: pick a nickname and play. If your connection drops or you reload the page, you get your seat back within two minutes.

## How it works

- **Backend:** Python 3.14 on Cloudflare Workers (Pyodide). Each room is a Durable Object that owns the game state, enforces every rule and keeps exactly two seats. Players connect over hibernatable WebSockets.
- **Frontend:** plain HTML, CSS and ES modules served as static assets, with no build step and no framework. The client is only a view: it never learns where the enemy ships are until the game ends.
- **Code layout:** `src/naval/domain` (pure game rules) ← `protocol` (message schemas and per-player views) ← `rooms` (room lifecycle and the room service) ← `worker` (thin Cloudflare adapters), plus `limits` (per-client rate-limit windows). Everything except `worker` runs on plain CPython.

Design and decisions: [`docs/superpowers/specs/2026-09-27-naval-game-design.md`](docs/superpowers/specs/2026-09-27-naval-game-design.md).

## Development

Requirements: [uv](https://docs.astral.sh/uv/) (standalone binary), Node.js 24.

```sh
uv sync
npm ci
cp .dev.vars.example .dev.vars
uv run pywrangler dev            # http://localhost:8787
```

Tests:

```sh
uv run pytest                                                          # unit and property tests
NAVAL_BASE_URL=http://localhost:8787 uv run pytest -m integration      # HTTP and WebSocket, against the dev server
npx playwright install chromium && npx playwright test                 # browser end-to-end, desktop, mobile and tablet
uv run ruff check . && uv run ruff format --check . && uv run mypy src tests
```

The share card (`public/og-image.png`) and the home-screen icon (`public/apple-touch-icon.png`) are rendered from `design/` and committed: after changing either source, run `node scripts/render-og-image.mjs`.

On Windows, with the repository on a drive other than `C:`, see the note in [`CLAUDE.md`](CLAUDE.md#commands) about `UV_CACHE_DIR` and `UV_PYTHON_INSTALL_DIR`.

## Contributing

`main` only changes through pull requests that reference an issue. CI (lint, types, unit, Semgrep, integration and E2E tests) must pass, and every merge deploys automatically and plays a real game against production as a smoke test.

## Security

- Report vulnerabilities privately: see [`SECURITY.md`](SECURITY.md).
- Baseline controls and how they apply: [`CLAUDE.md`](CLAUDE.md#how-the-seven-controls-apply-to-navalgame).
- Audits and reviews: [`docs/security/`](docs/security/).

## License

[MIT](LICENSE)
