# Responsive on phones and iPads (#36) Implementation Plan

> Executed task by task in a single session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen works and looks deliberate from a 320 px phone to a 1366 px iPad Pro, upright or on its side, with touch as a first-class input.

**Architecture:** CSS only, plus E2E coverage. An audit script screenshots home, lobby, invite, placement and battle at eleven viewports and reports horizontal overflow; its findings drive the fixes. A `tablet` Playwright project (iPad Mini, on Chromium) runs the visual flows on a touch screen.

**Tech Stack:** CSS (media queries on width, height and `hover`), Playwright.

## Global Constraints

- No horizontal scroll at any width from 320 px; boards fit the screen whole.
- Flat poster style and tokens unchanged; minimum touch targets of 44 px for buttons (grid cells are bounded by the 320 px width).

---

### Task 1: Audit and fixes

Audit viewports: 320×568, 375×667, 390×844, 412×915, 844×390, 768×1024, 820×1180, 1024×768, 1180×820, 1366×1024, 1440×900. The baseline had no overflow; its findings:

- [x] **Placement at 320 px:** "Rotate: horizontal" overflowed its button. Rotate now spans its own row.
- [x] **Phone on its side:** the sticky top bar covered the boards and a board was taller than the screen. On short screens (≤ 500 px high) the top bar scrolls away, and the cell size is also bounded by the height (`min(8vw, (100vh − 5rem) / 11)`).
- [x] **iPad upright:** the battle boards stacked, using about 60 % of the width, and the own fleet needed a scroll. From 720 px wide the boards sit side by side, sized from the width (the enemy board takes 55 %) and the height.
- [x] **Touch:** hover styles stuck after a tap. Every `:hover` rule is now inside `@media (hover: hover)`.
- [x] **Mobile toolbars:** `min-height: 100dvh` after the `100vh` fallback.

### Task 2: Tests

- [x] `e2e/responsive.spec.js`: at six viewports (small phone, phone, phone on its side, tablet both ways, laptop), no screen overflows, each board fits the screen whole, and from 720 px the boards are side by side. A tap on a touch screen leaves no hover highlight, and the top bar scrolls away on short screens.
- [x] `tablet` project in `playwright.config.js` for `board`, `flags`, `game` and `responsive` specs.

### Task 3: Ship it

- [ ] PR (`Closes #36`), `code-review`, CI, squash-merge, production check at phone and tablet sizes.
