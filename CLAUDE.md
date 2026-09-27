# NavalGame

A two-player online naval battle game (the classic "sink the fleet" board game). A player creates a room, shares its six-character code, the opponent joins, both place their fleets on a 10x10 grid and take turns firing at each other's grid until one fleet is sunk. Players are anonymous (nickname only); rooms hold exactly two players. Public at `https://naval.cloudils.com`.

The approved design lives in `docs/superpowers/specs/2026-09-27-naval-game-design.md`. Read it before changing architecture, the protocol or the game rules.

## Stack

- **Language:** Python 3.14 (the version the Cloudflare Workers Pyodide runtime ships; it reports 3.14.2 at `compatibility_date` 2026-09-27. Never raise it past what the runtime supports). Frontend is plain HTML/CSS and minimal vanilla JavaScript: no framework, no build step.
- **Runtime:** Cloudflare Python Workers + Durable Objects (one `GameRoom` Durable Object per room, WebSocket Hibernation API).
- **Package manager:** `uv` (Python), `npm` only for Wrangler and Playwright.
- **Database:** none. Room state lives in each Durable Object's own storage.
- **Deployment target:** Cloudflare Workers, custom domain `naval.cloudils.com` (zone `cloudils.com`). Deployed by GitHub Actions on merge to `main`.
- **Key libraries:** `pydantic` (message schemas), `workers-py` / `pywrangler` (Workers CLI), `pytest`, `hypothesis`, `ruff`, `mypy`, Playwright (E2E).

## Commands

- Install: `uv sync`
- Dev server: `uv run pywrangler dev`
- Deploy (CI does this; manual only in emergencies): `uv run pywrangler deploy`
- Test (unit): `uv run pytest`
- Test (e2e): `npx playwright test` (requires the dev server running)
- Lint / format: `uv run ruff check . && uv run ruff format --check .`
- Type check: `uv run mypy src tests`

## Architecture & Conventions

```
src/naval/
  domain/     Pure game rules: coordinates, fleet, board, game state machine. No I/O, no Cloudflare imports.
  protocol/   Pydantic message schemas and per-player filtered views of the game state.
  rooms/      Room lifecycle: seats, reconnection tokens, room codes, timeouts. Depends on the RoomStore abstraction.
  worker/     Cloudflare adapters only: Worker entrypoint, GameRoom Durable Object, RoomStore over DO storage, security headers.
public/       Static frontend served by Workers Static Assets, including the `_headers` file.
tests/        Mirrors src/naval/. e2e/ holds Playwright specs.
```

- **Dependencies point inward:** `worker -> rooms -> protocol -> domain`. `domain` imports nothing from the project; only `worker` may import `workers` or `js`. This is what keeps the logic testable on plain CPython.
- **Server-authoritative:** every rule is enforced in Python on the server. The client is a view. It must never receive the opponent's ship positions before `game_over`.
- **Durable Object state:** anything that must survive hibernation goes to DO storage; in-memory fields are caches rebuilt in `__init__`.
- **Frontend:** render user-controlled text with `textContent` only, never `innerHTML`. No inline `<script>`, no inline event handlers, no inline `style=""` (the CSP forbids them).
- **Naming:** `snake_case` modules and functions, `PascalCase` classes, protocol message `type` values in `snake_case`.
- All code, comments, commits, issues and PRs in English. UI text is English only.

---

# Engineering Workflow (Superpowers)

This project uses the `superpowers` plugin as its default engineering discipline. Follow this loop for any non-trivial change:

1. **Brainstorm** (`superpowers:brainstorming`): before writing a new feature or component, clarify intent and requirements. Don't skip this because the ask "sounds simple."
2. **Plan** (`superpowers:writing-plans`): for multi-step work, write the plan before touching code.
3. **Test-first** (`superpowers:test-driven-development`): write the failing test before the implementation, for both bugfixes and features.
4. **Debug systematically** (`superpowers:systematic-debugging`): on any bug or unexpected behavior, diagnose the root cause before proposing a fix. No speculative patches.
5. **Isolate risky work** (`superpowers:using-git-worktrees`): for exploratory or large feature work, use a worktree instead of the main working copy.
6. **Verify before claiming done** (`superpowers:verification-before-completion`): never say "this works" without having actually run it and shown the output. Evidence before assertions.
7. **Request review** (`superpowers:requesting-code-review` / `receiving-code-review`): before merging, run a review pass and actually engage with the feedback (not blind acceptance, not dismissal).
8. **Close out** (`superpowers:finishing-a-development-branch`): once tests are green and reviewed, decide how to integrate explicitly rather than leaving branches dangling.

---

# Model Selection

Don't run everything on one model. Pick per task:

| Task type | Model | Why |
|---|---|---|
| Architecture, Durable Object / protocol design, multi-file feature work, hardest debugging | **Opus 5.5** (`opus`) | Strongest on difficult, long-horizon work. Default for this project's early phase. |
| The genuinely hardest problem in the codebase (rare) | **Fable 5.1** (`fable`) | Most capable, roughly 2x Opus cost. Reserve for problems Opus actually struggles with. |
| Routine coding, well-specified implementation, most PR work | **Sonnet 5** (`sonnet`) | Near-Opus quality at a fraction of the cost. Best default once the architecture is in place. |
| Narrow mechanical work (bulk edits, boilerplate, simple classification) | **Haiku 4.5** (`haiku`) | Fastest and cheapest, fine for well-scoped work. |

**How to pin a model in Claude Code:**

| Mechanism | Scope | Example |
|---|---|---|
| `/model` | Current interactive session | `/model sonnet` |
| `--model` CLI flag | One session at launch | `claude --model opus` |
| `model` in `settings.json` | Persistent default (user or project scope) | `{"model": "opus"}` |

## Required: annotate every plan with a model recommendation

Whenever you produce a plan, task breakdown or list of next steps for this project, tag each task with a recommended model and a one-line reason, using the table above:

```
1. Implement the GameRoom Durable Object — [Opus 5.5: concurrency, hibernation, security-sensitive]
2. Add unit tests for fleet placement — [Sonnet 5: well-specified, routine]
3. Rename a message field across files — [Haiku 4.5: mechanical]
```

If a task doesn't clearly need a specific model, say so ("any model is fine here") instead of defaulting to Opus.

---

# Security

Security tooling is mandatory for this project. Apply these at the stages noted:

| Skill | When to run it |
|---|---|
| `semgrep` | Continuously while coding: SAST feedback on every meaningful change. |
| `static-analysis` (CodeQL + Semgrep + SARIF) | Before opening a PR and before any release or deploy: full scan. |
| `differential-review` | On every PR, before merging any feature branch: diff-focused review with blast-radius estimation. |
| `insecure-defaults` | Whenever touching config, env var handling, origin checks, or anything with a fallback value. |
| `sharp-edges` | When designing or reviewing the WebSocket protocol, config schema or a shared utility. |
| `supply-chain-risk-auditor` | Whenever a dependency is added or upgraded (including Dependabot PRs). |
| `semgrep-rule-creator` | When a bug pattern shows up more than once: turn it into a reusable rule. |
| `second-opinion` | For security-sensitive changes (seat tokens, origin validation, rate limiting): get an independent review before merging. |

**Non-negotiables:**
- Never hardcode secrets, API keys or credentials. Everything sensitive goes through env vars (`.env` / `.dev.vars`, never committed) or GitHub Actions secrets.
- Any change to seat tokens, room access, origin validation or rate limiting requires a `differential-review` pass before merge, no exceptions.

## Baseline security controls

Seven controls that must be **deliberately decided**: implemented, or ruled out in writing with the reason. "We didn't think about it" is not a decision.

### 1. Secrets in environment variables

*Applies: always.*

Everything sensitive (credentials, API keys, tokens, connection strings, signing keys) comes from the environment. Never in source, never in a committed config file, never in a commit message, an issue or a PR.

- Every `.env` / `.dev.vars` has a committed `.example` with keys and no values.
- The app **fails to start** if a required variable is missing. A silent fallback to a default is how a development key reaches production.
- Never pass a secret as a command-line argument: `ps` is world-readable.
- Client-side bundles inline anything they can read. A key in frontend code is public: if the browser needs it, it is not a secret.

### 2. CORS restricted to known origins

*Applies: any HTTP API called from a browser.*

- Allowlist explicit origins. **Never `*`**, and never reflect the incoming `Origin` header back.
- `Access-Control-Allow-Credentials: true` with a wildcard origin is rejected by browsers and signals a misunderstanding of the model: fix the origin, not the symptom.
- Origins come from configuration, not hardcoded, so staging and production differ without a code change.
- **CORS is not authorization.** It restrains browsers, not `curl`. It never substitutes for authentication on the endpoint.

### 3. Validation on the backend

*Applies: any server that accepts input.*

Client-side validation is a convenience for the user, not a control. Anything the client can send, an attacker can send without a client.

- Validate on the server **every** input: body, query, path params, headers, WebSocket messages.
- Validate against a **schema**, allowlisting the shape and rejecting the rest, not a list of patterns to block.
- Reject invalid input outright. Do not silently coerce or truncate: that turns a rejection into corrupted data.
- Enforce size and depth limits on payloads: a deeply nested JSON body is a denial-of-service vector.

### 4. Sanitize input before it reaches storage

*Applies: anything persisted, rendered, or passed to another system.*

- **Parameterized queries, always.** String concatenation into SQL is not mitigated by escaping.
- Normalize and validate encoding at the boundary, so the same value cannot be interpreted two ways later.
- Escape **on output**, according to the destination: HTML, SQL, shell, a log line. Sanitizing once on input and assuming it is safe everywhere is the classic mistake.
- Filenames and paths from users get validated against traversal, never concatenated into a path.
- Uploaded files: validate the actual content type, not the extension or the declared header.

### 5. Rate limiting, in depth

*Applies: any exposed endpoint.*

Apply at every layer that exists in the project. Each covers what the others cannot:

- **Edge / CDN**: stops abuse before it consumes origin resources.
- **Reverse proxy**: covers traffic that never passes the edge.
- **Application**: covers the client that misbehaves once connected.
- **Per-account, not just per-IP**: IPs are shared and rotated.

Stricter limits on the expensive paths. **A limit that was never triggered is not a limit.** Each one is verified by provoking it and observing the rejection.

### 6. Row Level Security

*Applies: any store holding data belonging to more than one user or tenant.*

Isolation belongs in the database, not only in the query layer.

- Enable RLS on every table with per-user data, with an explicit default-deny.
- The application connects as a role **subject to** the policies, never as an owner or superuser that bypasses them.
- Test the negative case: a request authenticated as user A must not be able to read user B's row. **That test is the control.**

### 7. Content Security Policy

*Applies: anything served to a browser.*

- Start from `default-src 'self'` and widen only where proven necessary.
- **No `unsafe-inline` and no `unsafe-eval`.** If inline scripts are needed, use nonces or hashes.
- Set `frame-ancestors` to control embedding, `object-src 'none'` and `base-uri 'self'`.
- Ship the rest of the headers with it: HSTS, `X-Content-Type-Options: nosniff` and `Referrer-Policy`.
- Deploy in report-only first to find what breaks, then enforce.

## How the seven controls apply to NavalGame

| # | Control | Status | How |
|---|---|---|---|
| 1 | Secrets | Applies | The app itself has no secrets. Runtime config (`ALLOWED_ORIGINS`) comes from Wrangler `vars`; the Worker refuses requests with a 500 and logs the missing key if it is absent, never falling back to a default. The Cloudflare deploy token exists only as a GitHub Actions secret in the `production` environment. Seat tokens are generated server-side with `secrets.token_urlsafe(32)` and stored as SHA-256 hashes. |
| 2 | CORS | Applies | The frontend is same-origin, so the API emits **no** CORS headers. Because CORS does not protect WebSockets (cross-site WebSocket hijacking) or simple `POST`s, the Worker checks the `Origin` header against `ALLOWED_ORIGINS` on the WebSocket upgrade and on `POST /api/rooms`, and rejects with 403 otherwise. |
| 3 | Backend validation | Applies | Every WebSocket message and HTTP input is parsed by a strict Pydantic model (`extra="forbid"`, strict types, bounded ranges). Messages over 4 KB are rejected before parsing. The room code path param must match the room-code alphabet exactly. Nickname: `^[A-Za-z0-9 _-]{1,20}$`. |
| 4 | Sanitization | Applies | No SQL is built from strings: DO storage is key/value, and any future SQL must use bound parameters. Output escaping happens in the browser by using `textContent` only. No user input reaches a shell, a template engine or a deserializer beyond `json.loads` + schema. |
| 5 | Rate limiting | Applies | Edge: a Cloudflare WAF rate-limiting rule on `/api/rooms`. Application: the Workers Rate Limiting binding per IP on room creation and WebSocket upgrades, plus a per-connection message budget inside `GameRoom`. There are no accounts, so "per-account" means per-seat. Reverse proxy layer: N/A, there is none. Each limit has a test or documented check that triggers it. |
| 6 | Row Level Security | N/A | There is no shared database: each room is an isolated Durable Object and there are no user accounts. The equivalent isolation risk is one player seeing the other's fleet, so the control is a test proving the per-player view for seat A never contains seat B's ship positions before `game_over`. |
| 7 | CSP | Applies | Served for static assets through `public/_headers` and on Worker responses: `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`, plus HSTS, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. Rolled out as `Content-Security-Policy-Report-Only` first, then enforced. |

## Auditing these controls

Reviewing at change time is not enough. Re-run the audit **after every change to an exposed surface** (a new endpoint or message type, a new dependency, a change to what is published), not on a calendar. Run it on a clean tree.

**Audit rules (evidence over opinion):**

1. Ground every finding in evidence: cite file and line, or the command run and its output. Anything not verified is marked **UNVERIFIED**. Never infer a control is present because a library that could provide it is installed or a config file mentions it.
2. Distinguish "not applicable" from "missing". N/A only when the project structurally cannot have the control, with the structural reason. If unsure, treat it as applicable and report it missing.
3. Report what could NOT be checked and why (no access to the running service, code outside the repo). An audit that hides its blind spots manufactures confidence.
4. Do not fix anything during the audit. Report first; fixing while auditing loses track of the original state.
5. Where a control is partially present, say which part. "CORS is configured" is not a finding; "the Origin check covers the WebSocket upgrade but not `POST /api/rooms`" is.

**What to check per control:**

1. **Secrets:** hardcoded credentials in source, config or committed files; search the git **history**, not just the tree; `.example` files carry keys without values; the app fails when a required variable is missing; no secrets as CLI arguments; nothing secret reaches `public/`.
2. **CORS:** no wildcard, no reflected `Origin`; no `Allow-Credentials` with a permissive origin; origins come from config; no endpoint whose only protection is that a browser would refuse the request.
3. **Validation:** every endpoint and message type validated server-side, schema-based and allowlisting; path params and headers too; invalid input rejected, not coerced; size and nesting limits in place.
4. **Sanitization:** no SQL by concatenation; escaping on output per destination; no user paths concatenated; no user input reaching a shell, template engine or unsafe deserializer.
5. **Rate limiting:** which layers limit; expensive paths stricter; per-seat not only per-IP; **evidence each limit was triggered**.
6. **RLS equivalent:** a test proving seat A's view never contains seat B's fleet before `game_over`.
7. **CSP:** inspect a **real response** (`curl -sI https://naval.cloudils.com`), not the config; no `unsafe-inline`/`unsafe-eval`; `frame-ancestors`, `object-src`, `base-uri` set; HSTS, nosniff and Referrer-Policy present.

**Audit output:** a table first (control, status OK / PARTIAL / MISSING / N/A / UNVERIFIED, one line of evidence). Then, for everything not OK: what exactly is wrong with file and line, what an attacker concretely gains, and the smallest fix. Then what could not be verified and what access would be needed. Finally, order findings by real risk in this project, not generic severity. Wait for a decision before fixing anything.

---

# QA & Testing

| Skill | Use for |
|---|---|
| `code-review` / `simplify` | Every PR: correctness bugs, coverage gaps, silent failures, stale comments, unnecessary complexity. |
| `playwright` | Browser E2E: two browser contexts playing a full game, reconnection, room-full rejection. |
| `property-based-testing` | Fleet placement, shot resolution and message parsing: prefer `hypothesis` property tests over example-only tests. |
| `mutation-testing` | Periodically on `domain/` and `rooms/`, to check the suite actually catches regressions. |
| `testing-handbook-skills` | If protocol parsing ever needs fuzzing (`atheris`). |

QA gate before merge: `code-review` + `differential-review` + Playwright E2E if the change touches user-facing flows.

---

# UI/UX

- Use `ui-ux-pro-max` for anything touching layout, components, color, typography or the design system. Don't invent styling ad hoc.
- Accessibility is required: the game must be playable with the keyboard, and hit/miss/sunk must not be distinguishable by color alone.

---

# Git & Commit Discipline

- `main` is protected by a ruleset: changes land only through squash-merged PRs, no force pushes, no deletion.
- Every piece of work starts with a GitHub Issue. Branch names: `feat/<short-topic>`, `fix/<short-topic>`, `chore/<short-topic>`, `docs/<short-topic>`. The PR references the issue (`Closes #N`).
- Commits are authored as `ismaleonsaenz@gmail.com`. Check `git config user.email` before committing.
- Stop at logical checkpoints and commit with a clear semantic message (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).
- No mention of AI tools or assistants in commits, branches, issues, PRs or comments.
- Before merging: CI green, `differential-review` clean (or findings triaged), `code-review` run.

---

# Notes for Claude

- **Single session, no subagents.** All work happens in the one interactive session. Never dispatch subagents, parallel agents, background agents or worktree-isolated agents, and do not suggest them. If a task is large, sequence it or split it, in this session.
- The skills referenced above are installed globally (`user` scope) and are available in this project automatically.
- Don't force a skill that doesn't fit the task: this file sets default discipline and when to reach for each tool, not a mandatory checklist for every change.
- Project-specific sections win over the general defaults above when they conflict.
- Python Workers constraints: only pure-Python or Pyodide-provided packages work; check a new dependency runs under `pywrangler dev` before relying on it. JS interop (`from js import ...`) is confined to `src/naval/worker/`.
- `workers` and `js` cannot be imported on CPython, so Worker adapters are covered by integration tests (`pytest -m integration` against `pywrangler dev`), not unit tests. Keep them thin.
- Use the standalone `uv` binary (`winget install astral-sh.uv`), never `python -m uv`: the pip-installed copy forces its parent interpreter and makes `pywrangler sync` install into the wrong Python.
- Wrangler's `main` directory is the Python import root, which is why `src/entry.py` is a one-line shim over `naval.worker.entry`.
