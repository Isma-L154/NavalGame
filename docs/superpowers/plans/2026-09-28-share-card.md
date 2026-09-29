# Share card and page metadata (#37) Implementation Plan

> **For agentic workers:** executed inline in this session (the project forbids subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Links to NavalGame unfurl as a poster-style card, and both public pages carry complete Open Graph and Twitter metadata.

**Architecture:** Static tags in `public/*.html`. The share image is a committed PNG rendered from a committed HTML source by a Playwright script, so deploys need no build step. Tests read the HTML and the PNG header.

**Tech Stack:** HTML, Playwright (Chromium, already a dev dependency), pytest.

## Global Constraints

- No inline `<script>`, `<style>` or `style=""` in `public/` (the CSP forbids them; `tests/frontend/test_index.py` enforces it).
- Design: paper `#f7f5f0`, ink `#111111`, red `#d6231d`, yellow `#f4c20d`, blue `#1d4e9e`; flat blocks, 2px ink rules, no shadows, no rounded corners; Barlow / Barlow Condensed.
- Origin: `https://naval.cloudils.com`. All code, comments and copy in English.

---

### Task 1: Metadata tags and share image — [Sonnet 5: well-specified, static assets]

**Files:**
- Create: `design/og-image.html`, `design/apple-touch-icon.html`, `scripts/render-og-image.mjs`
- Create (generated, committed): `public/og-image.png` (1200×630), `public/apple-touch-icon.png` (180×180)
- Modify: `public/index.html`, `public/terms.html` (head)
- Test: `tests/frontend/test_seo.py`

- [ ] **Step 1: Write the failing tests**

```python
import struct

SOCIAL_TAGS = (
    "og:type", "og:site_name", "og:title", "og:description", "og:url", "og:image",
    "og:image:width", "og:image:height", "og:image:alt", "og:locale",
)
TWITTER_TAGS = ("twitter:card", "twitter:title", "twitter:description", "twitter:image",
                "twitter:image:alt")


def _meta(html: str, attr: str, key: str) -> str | None:
    match = re.search(rf'<meta {attr}="{re.escape(key)}" content="([^"]*)">', html)
    return match.group(1) if match else None


def _png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", path.name
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def test_every_page_has_a_complete_share_card() -> None:
    for url, page in PAGES.items():
        html = (PUBLIC / page).read_text(encoding="utf-8")
        for key in SOCIAL_TAGS:
            assert _meta(html, "property", key), f"{page}: {key}"
        for key in TWITTER_TAGS:
            assert _meta(html, "name", key), f"{page}: {key}"
        assert _meta(html, "property", "og:url") == url
        assert _meta(html, "name", "twitter:card") == "summary_large_image"


def test_the_share_image_is_a_1200_by_630_png_on_this_site() -> None:
    for page in PAGES.values():
        html = (PUBLIC / page).read_text(encoding="utf-8")
        image = _meta(html, "property", "og:image")
        assert image == f"{ORIGIN}/og-image.png"
        assert _meta(html, "name", "twitter:image") == image
        assert _meta(html, "property", "og:image:width") == "1200"
        assert _meta(html, "property", "og:image:height") == "630"
    assert _png_size(PUBLIC / "og-image.png") == (1200, 630)


def test_the_apple_touch_icon_is_linked_and_180_pixels() -> None:
    for page in PAGES.values():
        html = (PUBLIC / page).read_text(encoding="utf-8")
        assert '<link rel="apple-touch-icon" href="/apple-touch-icon.png">' in html
    assert _png_size(PUBLIC / "apple-touch-icon.png") == (180, 180)
```

- [ ] **Step 2: Run to verify they fail** — `uv run pytest tests/frontend/test_seo.py -v` → the three new tests FAIL (tags and files missing).

- [ ] **Step 3: Design sources and render script.** `design/og-image.html` is a 1200×630 poster: paper ground, 2px ink frame, the N-A-V-A-L flag hoist, the wordmark "NAVALGAME", the headline "Sink the enemy fleet", the line "2 players · 10 × 10 grid · 5 ships · free, in the browser", a stylised 10×10 grid fragment with a blue hull, a red hit ✕, and a flag "O" sunk cell. `design/apple-touch-icon.html` is a 180×180 flag "N" on paper with an ink rule. Both load fonts from `/fonts/` and flags from `/flags.svg`-free inline SVG. `scripts/render-og-image.mjs`:

```js
// Renders the committed share images: node scripts/render-og-image.mjs
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const TYPES = { ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const TARGETS = [
  { source: "design/og-image.html", output: "public/og-image.png", width: 1200, height: 630 },
  { source: "design/apple-touch-icon.html", output: "public/apple-touch-icon.png", width: 180, height: 180 },
];

const browser = await chromium.launch();
for (const { source, output, width, height } of TARGETS) {
  const page = await browser.newPage({ viewport: { width, height } });
  // Serve design/ and public/fonts from disk: file:// pages cannot load web fonts.
  await page.route("http://render.local/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = normalize(join(ROOT, path.startsWith("/fonts/") ? "public" : "", path));
    await route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] });
  });
  await page.goto(`http://render.local/${source}`);
  await page.evaluate(() => document.fonts.ready);
  await writeFile(join(ROOT, output), await page.screenshot({ type: "png" }));
  await page.close();
}
await browser.close();
```

Run: `node scripts/render-og-image.mjs`, then open both PNGs and check them visually.

- [ ] **Step 4: Tags.** Add to the `<head>` of each page (values per page; `og:url` equals the canonical):

```html
<meta property="og:type" content="website">
<meta property="og:site_name" content="NavalGame">
<meta property="og:title" content="NavalGame: sink the enemy fleet">
<meta property="og:description" content="Two-player online naval battle. Create a room, share the link and sink the enemy fleet.">
<meta property="og:url" content="https://naval.cloudils.com/">
<meta property="og:image" content="https://naval.cloudils.com/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="NavalGame poster: signal flags, a 10 by 10 grid with a ship, hits, misses and a sunk ship.">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="NavalGame: sink the enemy fleet">
<meta name="twitter:description" content="Two-player online naval battle. Create a room, share the link and sink the enemy fleet.">
<meta name="twitter:image" content="https://naval.cloudils.com/og-image.png">
<meta name="twitter:image:alt" content="NavalGame poster: signal flags, a 10 by 10 grid with a ship, hits, misses and a sunk ship.">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

- [ ] **Step 5: Run tests** — `uv run pytest tests/frontend -v` → PASS. Also `npx playwright test e2e/pages.spec.js` against the dev server (no console or CSP errors).

- [ ] **Step 6: Commit** — `feat: share card and Open Graph metadata for every page`.

### Task 2: Ship it — [any model is fine here]

- [ ] Record the Search Console DNS verification as an owner action (memory + PR description).
- [ ] Push, open the PR (`Closes #37`), run `code-review`, fix findings, wait for CI, squash-merge, check production with `curl -s https://naval.cloudils.com/ | grep og:` and `curl -sI https://naval.cloudils.com/og-image.png`.
