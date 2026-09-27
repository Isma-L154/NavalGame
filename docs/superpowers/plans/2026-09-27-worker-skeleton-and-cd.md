# Worker Skeleton and CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (this project forbids subagents, see `CLAUDE.md`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A minimal Python Worker served at `https://naval.cloudils.com` (placeholder page + `/api/health`) with baseline security headers, validated in CI and deployed automatically on merge to `main`.

**Architecture:** `src/entry.py` is the Wrangler `main` and only re-exports `naval.worker.entry.Default`, because the directory of `main` is the Python import root. Static files in `public/` are served by Workers Static Assets with headers from `public/_headers`; `/api/*` runs the Worker first. Security headers live in one pure module (`naval.worker.headers`) that a unit test keeps in sync with `public/_headers`.

**Tech Stack:** Python 3.14 (Pyodide runtime), `workers-py` (`pywrangler`), `workers-runtime-sdk`, Wrangler 4 (pinned via `package.json`), GitHub Actions.

## Global Constraints

- Python `>=3.14,<3.15` everywhere (verified: the Workers runtime reports `3.14.2`; `compatibility_date = "2026-09-18"`, the newest date the pinned Wrangler's `workerd` supports, still selects 3.14).
- `uv` must be the standalone binary (`winget install astral-sh.uv`), never `python -m uv`: the pip-installed copy forces a "parent interpreter" and `pywrangler sync` installs into the wrong Python.
- `workers` and `js` cannot be imported on CPython. Only files under `src/naval/worker/` that are explicitly Worker adapters may import them; everything else must stay importable by plain `pytest`.
- Every action in a workflow is pinned by full commit SHA with the version in a trailing comment. Workflow token permissions default to `contents: read`.
- Dependencies resolve with a 7-day cooldown (`exclude-newer = "7 days"` in `[tool.uv]`).
- CSP ships as `Content-Security-Policy-Report-Only` in this plan; enforcement happens in delivery 7.

---

### Task 1: Move the toolchain to Python 3.14

**Files:**
- Modify: `pyproject.toml`, `.python-version`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-27-naval-game-design.md`

**Interfaces:** Produces the Python floor used by every later task.

- [ ] **Step 1:** In `pyproject.toml` set `requires-python = ">=3.14,<3.15"`, `[tool.ruff] target-version = "py314"`, `[tool.mypy] python_version = "3.14"`. Set `.python-version` to `3.14`.
- [ ] **Step 2:** In `CLAUDE.md` and the spec, replace "Python 3.13" with "Python 3.14" and state the runtime reports 3.14.2. In `CLAUDE.md` Notes for Claude, add the standalone-`uv` rule from Global Constraints.
- [ ] **Step 3:** Run `uv lock && uv sync --locked && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy src tests`. Expected: all pass.
- [ ] **Step 4:** Commit `chore: move the toolchain to Python 3.14`.

### Task 2: Security headers module kept in sync with `public/_headers`

**Files:**
- Create: `src/naval/worker/__init__.py` (empty), `src/naval/worker/headers.py`, `public/_headers`
- Test: `tests/worker/test_headers.py`

**Interfaces:**
- Produces: `naval.worker.headers.SECURITY_HEADERS: Mapping[str, str]` (Worker responses) and `naval.worker.headers.API_HEADERS: Mapping[str, str]` (= `SECURITY_HEADERS` + `Cache-Control: no-store`).

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path

from naval.worker.headers import API_HEADERS, SECURITY_HEADERS

HEADERS_FILE = Path(__file__).parents[2] / "public" / "_headers"


def _static_headers() -> dict[str, str]:
    lines = HEADERS_FILE.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "/*"
    parsed: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip():
            name, _, value = line.strip().partition(": ")
            parsed[name] = value
    return parsed


def test_static_assets_ship_the_same_security_headers() -> None:
    assert _static_headers() == dict(SECURITY_HEADERS)


def test_csp_has_no_unsafe_sources() -> None:
    csp = SECURITY_HEADERS["Content-Security-Policy-Report-Only"]
    assert "unsafe-inline" not in csp
    assert "unsafe-eval" not in csp
    for directive in (
        "default-src 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
    ):
        assert directive in csp


def test_api_responses_are_not_cached() -> None:
    assert API_HEADERS["Cache-Control"] == "no-store"
    assert SECURITY_HEADERS.items() <= API_HEADERS.items()
```

- [ ] **Step 2:** Run `uv run pytest tests/worker/test_headers.py -v`. Expected: FAIL, `ModuleNotFoundError: naval.worker.headers`.
- [ ] **Step 3: Implement**

```python
from collections.abc import Mapping
from types import MappingProxyType

_CSP = "; ".join(
    (
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    )
)

SECURITY_HEADERS: Mapping[str, str] = MappingProxyType(
    {
        # Report-only until the UI is verified against it (baseline control 7).
        "Content-Security-Policy-Report-Only": _CSP,
        "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Cross-Origin-Opener-Policy": "same-origin",
    }
)

API_HEADERS: Mapping[str, str] = MappingProxyType({**SECURITY_HEADERS, "Cache-Control": "no-store"})
```

`public/_headers` (two-space indented values under `/*`, same order and values):

```
/*
  Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Cross-Origin-Opener-Policy: same-origin
```

- [ ] **Step 4:** Run `uv run pytest -v`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: add baseline security headers for static and API responses`.

### Task 3: Worker entrypoint, Wrangler config and placeholder page

**Files:**
- Create: `src/entry.py`, `src/naval/worker/entry.py`, `wrangler.toml`, `public/index.html`, `public/styles.css`, `package.json`, `package-lock.json`
- Modify: `pyproject.toml` (dev group adds `workers-py`, `workers-runtime-sdk`; pytest marker `integration`; mypy/ruff excludes for the adapter), `.github/dependabot.yml` (npm ecosystem)
- Test: `tests/integration/test_worker_http.py`

**Interfaces:**
- Consumes: `API_HEADERS` from Task 2.
- Produces: `GET /api/health` → `200 {"status": "ok"}`; any other `/api/*` → `404 {"error": "not_found"}`; both with `API_HEADERS`. Integration tests read the base URL from `NAVAL_BASE_URL`.

- [ ] **Step 1: Write the failing integration test**

```python
import json
import os
import urllib.error
import urllib.request

import pytest

pytestmark = pytest.mark.integration


def _get(path: str) -> tuple[int, dict[str, str], bytes]:
    base_url = os.environ["NAVAL_BASE_URL"]
    try:
        with urllib.request.urlopen(base_url + path, timeout=30) as response:  # noqa: S310
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read()


def test_health_endpoint() -> None:
    status, headers, body = _get("/api/health")
    assert status == 200
    assert json.loads(body) == {"status": "ok"}
    assert headers["Cache-Control"] == "no-store"
    assert "Content-Security-Policy-Report-Only" in headers


def test_unknown_api_path_is_404() -> None:
    status, headers, body = _get("/api/does-not-exist")
    assert status == 404
    assert json.loads(body) == {"error": "not_found"}
    assert headers["X-Content-Type-Options"] == "nosniff"


def test_index_page_has_security_headers() -> None:
    status, headers, body = _get("/")
    assert status == 200
    assert b"NavalGame" in body
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert "Content-Security-Policy-Report-Only" in headers
```

In `pyproject.toml`: `[tool.pytest.ini_options] markers = ["integration: needs a running Worker at NAVAL_BASE_URL"]` and `addopts = ["--strict-markers", "--strict-config", "-m", "not integration"]`.

- [ ] **Step 2:** Run `uv run pytest -m integration` with `NAVAL_BASE_URL=http://localhost:8787` and no server. Expected: FAIL (connection refused).
- [ ] **Step 3: Implement**

`src/entry.py`:

```python
# Wrangler's `main` directory is the Python import root, so this shim lives in src/.
from naval.worker.entry import Default

__all__ = ["Default"]
```

`src/naval/worker/entry.py`:

```python
from urllib.parse import urlparse

from workers import Response, WorkerEntrypoint

from naval.worker.headers import API_HEADERS


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        if urlparse(request.url).path == "/api/health":
            return Response.json({"status": "ok"}, headers=dict(API_HEADERS))
        return Response.json({"error": "not_found"}, status=404, headers=dict(API_HEADERS))
```

`wrangler.toml`:

```toml
name = "naval-game"
main = "src/entry.py"
compatibility_date = "2026-09-18"
compatibility_flags = ["python_workers"]
workers_dev = false
routes = [{ pattern = "naval.cloudils.com", custom_domain = true }]

[assets]
directory = "./public"
run_worker_first = ["/api/*"]

[observability]
enabled = true
```

`package.json` pins Wrangler exactly (`"wrangler": "4.135.0"`, the newest release older than the 7-day cooldown in `devDependencies`, `"private": true`), and `npm install` generates `package-lock.json`. `pywrangler` resolves `wrangler` from `node_modules`.

`public/index.html`: a static placeholder with `<title>NavalGame</title>`, an `<h1>NavalGame</h1>`, a "Coming soon" line and `<link rel="stylesheet" href="/styles.css">`. No inline script or style.

Tooling: dev group gains `workers-py` and `workers-runtime-sdk`; `[tool.mypy]` gets `exclude = ["src/naval/worker/entry.py", "src/entry.py"]` (they import runtime-only modules); Dependabot gains an `npm` entry mirroring the others.

- [ ] **Step 4:** Run `uv run pywrangler dev --port 8787` in the background, then `NAVAL_BASE_URL=http://localhost:8787 uv run pytest -m integration -v`. Expected: 3 passed. Also run `uv run pywrangler deploy --dry-run --outdir .wrangler/dry-run`. Expected: exits 0.
- [ ] **Step 5:** Commit `feat: add the Worker entrypoint, Wrangler config and placeholder page`.

### Task 4: CI job that builds and exercises the Worker

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:** Produces the required check `worker`.

- [ ] **Step 1:** Add a `worker` job: checkout, `setup-uv`, `setup-node` (pinned SHA, Node 24, `cache: npm`), `npm ci`, `uv sync --locked`, `uv run pywrangler deploy --dry-run --outdir .wrangler/dry-run`, start `uv run pywrangler dev --port 8787` in the background, wait up to 120 s for `curl -sf http://localhost:8787/api/health`, then `uv run pytest -m integration` with `NAVAL_BASE_URL=http://localhost:8787`. Remove the `push: [main]` trigger (the deploy workflow calls CI through `workflow_call`).
- [ ] **Step 2:** Push and confirm all four jobs pass on the PR. Then add `worker` to the ruleset's required status checks.
- [ ] **Step 3:** Commit `ci: build the Worker and run integration tests against pywrangler dev`.

### Task 5: Deploy workflow and first production deploy

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:** Consumes the `production` environment secret `CLOUDFLARE_API_TOKEN` and variable `CLOUDFLARE_ACCOUNT_ID`.

- [ ] **Step 1:** Set the environment variable: `gh variable set CLOUDFLARE_ACCOUNT_ID --env production --body 51d7355a63c1a3eba08d8ef63a889b3b`.
- [ ] **Step 2:** Write `deploy.yml`: on `push` to `main` and `workflow_dispatch`; `concurrency: {group: deploy-production, cancel-in-progress: false}`; job `ci` uses `./.github/workflows/ci.yml`; job `deploy` needs `ci`, `environment: production`, runs checkout → setup-uv → setup-node → `npm ci` → `uv sync --locked` → `uv run pywrangler deploy`, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` passed as env only on that step. Finally `curl -sf https://naval.cloudils.com/api/health`, retrying for up to 60 s.
- [ ] **Step 3:** Commit `ci: deploy to Cloudflare on merge to main`, open the PR (`Closes #<issue>`), wait for green, squash-merge.
- [ ] **Step 4:** Watch the deploy run. Verify from outside: `curl -si https://naval.cloudils.com/` and `curl -si https://naval.cloudils.com/api/health` show 200 and the security headers.
