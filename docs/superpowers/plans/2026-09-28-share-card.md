# Share card and page metadata (#37) Implementation Plan

> Executed task by task in a single session (this project uses no parallel agents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Links to NavalGame unfurl as a poster-style card, and both public pages carry complete Open Graph metadata.

**Architecture:** Static tags in `public/*.html`. The share image and touch icon are committed PNGs rendered from committed HTML sources by a Playwright script, so deploys need no build step. Unit tests read the HTML and the PNG headers; an integration test (also in the production smoke) checks both images are served.

**Tech Stack:** HTML, Playwright (Chromium, already a dev dependency), pytest.

## Global Constraints

- No inline `<script>`, `<style>` or `style=""` in `public/` (the CSP forbids them; `tests/frontend/test_index.py` enforces it). `design/` is not served, so its sources may use inline styles.
- Design: paper `#f7f5f0`, ink `#111111`, red `#d6231d`, yellow `#f4c20d`, blue `#1d4e9e`; flat blocks, ink rules, no shadows, no rounded corners; Barlow Condensed for display.
- Origin: `https://naval.cloudils.com`. All code, comments and copy in English.

---

### Task 1: Metadata tags and share images

**Files:**
- Create: `design/og-image.html`, `design/apple-touch-icon.html`, `scripts/render-og-image.mjs`
- Create (generated, committed): `public/og-image.png` (1200×630), `public/apple-touch-icon.png` (180×180)
- Modify: `public/index.html`, `public/terms.html` (head), `.github/workflows/deploy.yml` (smoke selection)
- Test: `tests/frontend/test_seo.py`, `tests/integration/test_worker_http.py`

- [x] **Step 1: Failing tests.** In `tests/frontend/test_seo.py`: every page has each of `og:type`, `og:site_name`, `og:title`, `og:description`, `og:image`, `og:image:width`, `og:image:height`, `og:image:alt`, `og:locale`, `twitter:card` (`summary_large_image`) and `twitter:image:alt`, each exactly once; `og:description` equals the meta description; `og:url` is absent on `index.html` (invite links carry `?room=CODE`) and equals the canonical URL on `terms.html`; `og:image` is `https://naval.cloudils.com/og-image.png` with width 1200 and height 630, and the file is a PNG of exactly 1200×630 (IHDR bytes 16–24); both pages link `/apple-touch-icon.png`, a 180×180 PNG. In `tests/integration/test_worker_http.py`, `test_share_images_are_served`: both paths answer 200 `image/png` with the PNG signature.

- [x] **Step 2: Watch them fail** — `uv run pytest tests/frontend/test_seo.py -v`.

- [x] **Step 3: Design sources and render script.**
  - `design/og-image.html`: 1200×630 poster: framed paper, the N-A-V-A-L hoist and wordmark in a top band, the headline "Sink the enemy fleet", a facts strip ("2 players" on yellow, "10 × 10", "Free, in the browser"), and a 6×6 board fragment with a battleship hull under transparent cells, a hit, misses and a sunk ship (flag "O"). The ✕ marks are drawn as SVG, because the self-hosted fonts have no U+2715 and a fallback glyph would vary by machine.
  - `design/apple-touch-icon.html`: `public/favicon.svg` (flag N) on paper, 20 px margin (iOS rounds the corners).
  - `scripts/render-og-image.mjs`: launches Chromium, serves `/design/*` from the repo and every other path from `public/` through `page.route`, waits for `document.fonts.ready`, fails with the list of missing files if any request could not be served, and writes the screenshots.
  - Run `node scripts/render-og-image.mjs` and inspect both PNGs.

- [x] **Step 4: Tags** in each `<head>`, after the favicon: `apple-touch-icon` link, the Open Graph set above, `twitter:card` and `twitter:image:alt`. On `index.html` an HTML comment explains the missing `og:url`. The index meta description now says "share the link", matching `og:description`.

- [x] **Step 5: Verify** — `uv run pytest tests/frontend`, `NAVAL_BASE_URL=http://localhost:8787 uv run pytest -m integration -k "share_images or sitemap"`, `npx playwright test e2e/pages.spec.js e2e/theme.spec.js`, semgrep on `design/` and `scripts/`.

- [x] **Step 6: Commit.** Add `share_images` to the deploy smoke `-k` expression.

### Task 2: Ship it

- [ ] Search Console verification is an owner action: a Domain property verified by DNS TXT in the Cloudflare zone (recorded in the PR and the pending owner actions).
- [ ] PR (`Closes #37`), `code-review`, fix findings, CI green, squash-merge, then check production: `curl -s https://naval.cloudils.com/ | grep og:` and `curl -sI https://naval.cloudils.com/og-image.png`.
