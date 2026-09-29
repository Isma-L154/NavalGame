# NavalGame: design for issues #35–#39

**Date:** 2026-09-28
**Status:** Approved (the owner delegated the decisions; every open question from the issues is answered here)

Five open issues, shipped as five PRs in this order: **#37** (share card), **#38** (invite link), **#39** (team flags), **#35** (board UI), **#36** (responsive pass). Responsive work goes last so it covers the UI the others add. The existing design system (`CLAUDE.md` → UI/UX) is kept: flat signal-flag poster, 2px ink rules, no shadows, no rounded chrome, no gradients except flag patterns, and every state keeps a distinct shape.

## 1. #37: share card and page metadata

**Decision:** static Open Graph and Twitter card tags on both public pages, plus a 1200×630 PNG share image in the poster style.

- `index.html` and `terms.html` get `og:type` (`website`), `og:site_name`, `og:title`, `og:description` (equal to the meta description), `og:image` (absolute URL), `og:image:width`/`height`/`alt`, `og:locale` (`en_US`), `twitter:card` (`summary_large_image`) and `twitter:image:alt`. X falls back to the `og:` values for title, description and image, so those are not repeated.
- `og:url` equals the canonical URL on `/terms`, but the game page has **none**: invite links are `/?room=CODE`, and scrapers that honour `og:url` would send them to the bare home page.
- `public/og-image.png` (1200×630) is rendered from a committed source, `design/og-image.html`, by `scripts/render-og-image.mjs` (Playwright, already a dev dependency). The PNG is committed, so there is no build step at deploy time.
- `public/apple-touch-icon.png` (180×180): iOS home-screen icon and some share previews.
- **Search Console verification is not code.** A `google-site-verification` meta tag needs a token from the owner's Google account. The better route is a *Domain* property verified by a DNS TXT record in the Cloudflare zone, which also covers every subdomain. This is recorded as an owner action. No placeholder token is committed.
- JSON-LD structured data is **out**: a browser game is not eligible for any rich result, and it would be the only inline `<script>`.
- Tests (`tests/frontend/test_seo.py`): every page carries the full tag set; `og:url` equals the canonical; the image exists, is a PNG and is exactly 1200×630 (read from the IHDR header).

## 2. #38: invitation link

**Decisions** (the issue's open questions):
- **Link structure:** keep `https://naval.cloudils.com/?room=CODE`. It already exists and is in the spec and the E2E suite. A path route would need Worker routing for static pages, for no user benefit.
- **Where to share:** the lobby, which is the only moment the host needs to invite someone.

Behaviour:
- **Share invite** (primary) uses the Web Share API (`navigator.share({ title, text, url })`) when the browser has it: mobile, iPadOS, Safari, Edge. Otherwise the primary button is **Copy invite link**. **Copy code** stays in both cases. A cancelled share sheet (`AbortError`) shows nothing. Any other failure falls back to copying.
- **Invited landing.** Opening `/?room=CODE` without a seat for that room shows the home screen in *invite mode*: kicker "You're invited", heading "Join room CODE", the nickname (and flag, see #39), and a primary **Join room** button. **Create a room** and the code field are hidden, and a secondary "Start a new room instead" link leaves invite mode. An invalid code in the URL is ignored (normal home).
- Pressing Enter in the nickname field submits whichever primary action is visible.
- Tests (E2E): an init script stubs or removes `navigator.share` to cover both paths (Share invite hands the link to the share sheet; without it, Copy invite link is the primary action); the invite link lands in invite mode and joins with one click; "Start a new room instead" restores the normal home.

## 3. #39: team flag per player

**Decisions:**
- **Source of flags:** the 26 letter flags of the International Code of Signals (Alfa to Zulu). They already form the brand, they read well at 27×18 px, and each one is a distinct pattern, not just a colour.
- **Where to choose:** on the home screen, next to the nickname, before creating or joining. It can be changed later on the placement screen for as long as the room is in the placing phase. Default: the flag of the nickname's first letter, otherwise Alfa. The choice is remembered in `localStorage` (`naval.flag`), like the nickname.
- **Uniqueness:** the two players in a room always fly different flags. If a joining player asks for the flag the opponent already flies, the server gives them the first free flag in alphabetical order. The client says so in the placement status line, and the player can pick another one. Choosing a taken flag later is rejected with `flag_taken`.

Protocol (additive, backwards compatible for one deploy):
- `Flag`: a `StrEnum` of `"a"`…`"z"` in `naval.domain.flags`. It is pure, and both `protocol` and `rooms` depend on it.
- `join` gains an optional `flag`. When it is missing, the server picks the first free one, so a browser still running the previous bundle can join.
- New client message `choose_flag {flag}`, allowed only in `placing`. It raises `wrong_phase` otherwise and `flag_taken` if the opponent holds that flag.
- `state.players[i]` gains `flag` (a letter, or `null` for a seat stored before this change; such a seat can pick one).
- `Player.flag` is persisted. The codec reads an older room without it as `null`, so no format version bump is needed.

UI:
- The flags move out of the inline sprites into one cached external sprite, `public/flags.svg` (26 symbols). Both pages reference `/flags.svg#flag-x`.
- The picker is a radio group (`fieldset` with 26 radio inputs whose labels show the flag and its name), inside a disclosure whose summary shows the current flag. It is keyboard-operable natively. The opponent's flag is disabled in the placement picker.
- Flags appear next to names on the placement header ("Ana vs Bo"), both board titles in battle, and the result panel.
- Security: a new message type and a new enum field go through the same strict Pydantic validation. The per-connection message budget bounds `choose_flag` spam. A `sharp-edges` pass on the protocol change goes in the PR.

## 4. #35: board UI, placement, animations, 3D

### 4.1 Ships drawn as ships
- Each board gets a **ship layer**: an absolutely positioned grid child spanning exactly the 10×10 cell area (`grid-row: 2 / span 10; grid-column: 2 / span 10`). An absolutely positioned grid item takes its grid area as containing block and does not disturb auto-placement.
- One inline SVG per ship, placed by percentages (`left = col × 10%`, and so on). The silhouettes are flat: a blue hull with a pointed bow, plus ink and white deck details per kind. The carrier has a flight-deck stripe and an island, the battleship three turrets, the cruiser two, the submarine a slim hull and a conning tower, the destroyer one. Vertical ships use the same drawing rotated inside the SVG.
- Paint order does the layering without z-index games. The layer comes first in the DOM. Intact ship cells are transparent, so the hull shows through. Hit and sunk cells keep their full-cell fills and marks on top. The grid rules and focus ring stay above the hull.
- Drawn on the placement grid and on "Your fleet". The enemy grid keeps the existing cell language (hit, sunk flag "O", hatching for revealed ships).

### 4.2 Placement interface
- The ship list becomes a **dock**. Each ship button shows its silhouette at its real length, replacing the pips.
- **Interaction:** a ship is *selected* either from the dock or by clicking it on the grid. Selecting a placed ship keeps it on the board, outlined. Choosing a water cell places or moves the selected ship. Clicking the selected ship again, or pressing **R** / **Rotate**, rotates it in place when it fits. Otherwise **R** changes the orientation for the next placement. This replaces "pick up", which removed the ship from the board.
- **Drag and drop** (Pointer Events, so mouse, touch and pen all work): drag a ship from the dock or from the grid. The grid previews the drop where the ship will land, keeping the grab offset along the hull. Dropping on a valid spot places it; dropping anywhere else cancels. A drag starts only after 6 px of movement, so taps stay clicks. `touch-action: none` applies only to dock ships and placed ship cells, so the page still scrolls from water cells.
- The keyboard path stays complete: dock buttons, arrow keys on the grid, Enter to place, select or rotate, and **R**.

### 4.3 Shot animations
Only the newest shot animates (the UX rule is one or two animated elements per view). Transform and opacity only, `ease-out`, 250–500 ms.
- **Miss:** a splash ring expands from the dot and fades.
- **Hit:** the cell turns over in 3D (`rotateX` from −90° with perspective) to reveal the red ✕, followed by a short burst.
- **Sunk:** every cell of the sunk ship turns over in sequence (60 ms stagger), then shows flag "O".
- Both boards animate: your shot on the enemy grid, and the opponent's shot on "Your fleet".
- `prefers-reduced-motion: reduce` removes all of it. Final states never depend on an animation running.

### 4.4 3D elements
**Decision:** CSS 3D transforms only: the cell turn-over above and the result title swinging in like a hoisted flag. **WebGL and three.js are rejected.** They would add hundreds of KB to a page that has no build step, force a canvas renderer that would lose the accessible grid, and clash with the flat poster style. The transform-only animations run on the compositor, so they do not degrade performance.

## 5. #36: responsive on phones and iPads

**Decision:** support any width from 320 px, verified at these viewports: 320×568, 375×667, 390×844, 412×915 (Pixel 7), 844×390 (phone landscape), 768×1024 (iPad Mini portrait), 820×1180 (iPad Air portrait), 1024×768 and 1180×820 (iPad landscape), and 1366×1024 (iPad Pro landscape).

- An audit at each viewport (screenshots of home, lobby, placement, battle and result) drives the fixes. Known issues going in:
  - Hover styles stick after a tap on touch screens: every `:hover` rule moves under `@media (hover: hover)`.
  - `100vh` is wrong on mobile Safari: use `100dvh` with the `vh` fallback.
  - On tablets in portrait, the two battle boards stack although they would fit side by side: size cells from the available width in that range.
  - On a phone in landscape, cell size also has to respect the viewport height.
- Tests: a Playwright `tablet` project (iPad Mini viewport and touch, Chromium), and an E2E spec that loads each screen at every viewport above and asserts no horizontal overflow and a fully visible board.

## 6. Delivery

| PR | Issue | Scope |
|---|---|---|
| 1 | #37 share card + metadata | Static assets and tags |
| 2 | #38 invite link | Small client flow, E2E-tested |
| 3 | #39 team flags | Protocol, persistence and UI across layers |
| 4 | #35 board UI | Layering, drag and drop, animation |
| 5 | #36 responsive | Audit-driven CSS fixes |

Each PR: issue → branch → tests first → implementation → local unit, integration and E2E → `code-review` → `differential-review` where the protocol changes (#39) → CI green → squash merge → production smoke.
