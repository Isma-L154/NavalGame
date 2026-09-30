# The board as a 3D game table — Design

**Date:** 2026-09-29
**Status:** Approved
**Issues:** #59 (the table), #60 (the ship models)

## 1. Goal

The board reads as flat ruled paper. It should look like a real naval-battle game on a table: the board in perspective, ships that stand up off the water, hits you can see from the side. It must stay fast on a mid-range phone, keep today's keyboard and screen-reader play, and stay inside the signal-flag poster language.

Decisions taken with the owner, from working mockups:

- **A tilted table:** the board leans back like a board on a table, with a thick ink edge. The owner rejected an isometric diamond view (it wastes width and makes the arrow keys disagree with the screen) and raised tiles in a straight view (not 3D enough).
- **Turn it with the mouse:** dragging a board turns it. It **stays where it is left**, within **limits** (up to 40° each way, tilt between 10° and 60°), so the grid is never upside down. A double-click off the grid resets it.
- **Low-poly ship models:** real hulls with a pointed bow, a bridge, a funnel and gun turrets, flat-shaded in the poster colours. The owner rejected thick silhouette tokens (still flat) and grey toy ships.
- **Pale sea with printed wave marks** as the water, instead of white paper.
- **Bigger boards.**

Non-goals: WebGL or any 3D library; a full 360° turn; turning on touch screens; 3D art in the placement dock; enemy ships rising from the water at game over; detail levels per device.

## 2. Approach

The table is made of **CSS 3D transforms on ordinary DOM elements**. The 100 cells stay the same `<button>`s inside the same ARIA grid, so keyboard play, screen readers, focus handling, hit testing and every E2E spec keep working. The browser hit-tests transformed elements, so a click lands on the cell under the pointer at any angle.

The alternative was a WebGL canvas (for example three.js). It would draw richer models, but it adds a large dependency, needs an invisible DOM grid laid over the canvas for accessibility and input, and would rewrite most of the frontend. CSS 3D gets the owner's chosen look with none of that.

The cost of CSS 3D is that **every face of a 3D shape becomes its own compositor layer**. The design keeps that number small (section 6).

## 3. Look

### 3.1 The table

- The board leans back **35°** by default, seen through a CSS perspective about three times the board's width.
- The table top is paper, with an **ink slab edge** below it (four walls). The row and column labels sit on the paper rim, as today.
- The 10×10 cell area is **pale sea** with a **printed wave pattern**: two small wave marks per cell in a slightly darker sea tone, drawn as an SVG pattern. It is flat print, not a gradient. Cells keep their 1px ink rules.
- **Dark theme:** a **night sea**, dark blue water with lighter wave marks. It is a token swap like the rest of the dark palette.
- New colours are tokens in both palettes: `--sea`, `--sea-wave`, and in the second PR `--ship-hull`, `--ship-deck`, `--ship-waterline`, `--ship-bridge`, `--ship-gun`, `--ship-flight-deck`, `--ship-sub`.

### 3.2 Sizes

A tilted table takes less height than the flat board, so cells can grow. The rule:

- A cell is **never smaller than today's 40px** wherever today's board fitted the screen.
- It **grows while the whole table still fits under its screen's header**, so the board is seen whole without a scroll. The cap is **56px** for the placement board and enemy waters, and 40px for your fleet in battle.
- On the placement screen below 900px wide, the ship dock sits under the board, so the table also leaves room for the dock's first ships: they must be dragged up without a scroll.
- Phones keep fitting the width, as today.

At 1280×720 this gives about 48px cells when placing and 55px in battle. Screens about 730px tall or more get the full 56px.

The stage (the table's box) is exactly as tall as the table looks at rest. With `sin()` and `cos()`, CSS computes how far the perspective projects the table above its centre (`--far`) and below it (`--near`, the bottom of its edge). The table's centre, which is also the perspective origin, sits `--far` below the top of the box. A symmetric box around a centred table was tried first: the near half, enlarged by the perspective, overflowed onto the content below, and the far half left a gap under the heading.

### 3.3 Ships (second PR)

Each kind is a low-poly model, flat-shaded, sized in cells:

| Kind | Model |
|---|---|
| Carrier (5) | Blunt bow, dark flight deck with a white dashed centre line and yellow parked planes, white island on one side with an ink mast. |
| Battleship (4) | Pointed bow, two-tier white bridge with a mast, tall ink funnel, three gun turrets (two forward, one aft). |
| Cruiser (3) | Pointed bow, white bridge, ink funnel, two turrets (one forward, one aft). |
| Submarine (3) | Dark, low hull pointed at both ends, a conning tower with diving planes. |
| Destroyer (2) | Narrow hull, white bridge, ink funnel, one forward turret. |

- Hulls have a **red waterline band** under the blue topside. Turrets are hexagonal ink prisms with barrels.
- Hulls and bridges stay under 0.55 of a cell tall. Only thin masts rise higher, and they are narrow and centred.
- **Selected ship** (placement): its deck turns yellow, the selected colour everywhere else.
- Until the second PR, today's flat silhouettes lie on the table surface.

### 3.4 Marks and states

Every state keeps a distinct shape, never colour alone.

| State | On the table |
|---|---|
| Miss | Ink dot on the water, with today's splash ring. |
| Hit | A **red peg** with a white cross stands on the cell: on top of the ship on your board, on the water on the enemy board. The peg drops in. The cell itself keeps the sea: a red cell hid a red peg and showed red slivers around a ship's hull. The legend's red square with a white cross matches the peg's top. Until the second PR the cell is red, as today. |
| Sunk | Flag O cells as today. On your board (second PR) the ship **sinks below the surface** first; the table top hides it as it goes down. |
| Revealed enemy ship (game over) | Blue hatching, as today. |
| Placement preview, hover, keyboard focus | As today, on the table surface. Where a preview lies under another ship, that ship hides part of it; the red stripes on the free cells and the status line still explain the invalid spot. |

### 3.5 Motion

- Peg drop about 250 ms; sinking about 1 s; the reset of a turned board animates in about 0.5 s.
- `prefers-reduced-motion` cancels all of them through the existing global rule. Turning by drag stays: it follows the hand.
- Nothing animates while the board is idle.

## 4. Interaction

### 4.1 Turning with the mouse

- Only for `pointerType === "mouse"`. A press becomes a turn after **6px** of movement, the same threshold as ship dragging. Left and right turn the board; up and down change the tilt.
- **Limits:** turn −40° to +40°, tilt 10° to 60°. The board stays where it is released. A **double-click off the grid** (on the table rim, the labels or around the board) returns it to the default view with an animation. A double-click on a cell would also fire or place a ship, so it does not reset.
- The click that ends a turn is swallowed, so turning never fires a shot or selects a cell.
- Each board has its own view. Views are not kept across page loads.
- A hint is shown only when the primary pointer is a mouse (`@media (hover: hover) and (pointer: fine)`):
  - under the placement board: **"Drag the board to turn it · double-click off the grid to reset"**;
  - in the battle legend: **"Drag a board to turn it · double-click off the grid to reset"**.

### 4.2 Living with the other gestures

- **Firing:** a press that does not move is a click, as today.
- **Placing ships:** a press on a ship starts a ship drag, exactly as today. A press on empty water turns the board. The placement screen gives the camera a predicate so it never starts on a press the ship drag claimed.
- **Pressing a ship:** 3D pieces take no pointer events, so a press reaches the cell under it. Hulls and bridges are low and tall parts are narrow and centred, so at the default tilt what you see of a ship lies over its own cells; only a mast tip can reach past them.
- **Keyboard:** unchanged. Turning is a view only, and the arrow keys move across the grid as today.

### 4.3 Touch screens

No turning: two-finger turning would take over pinch-to-zoom. Coarse pointers get a fixed, gentler **25°** tilt, so the far rows stay easy to tap.

### 4.4 Auto-framing

A square turned by an angle θ covers `cos θ + sin θ` of its width (1.41 at 40°). A lower tilt makes it deeper, and the perspective enlarges its near edge.

While a board is turned, the camera computes the largest scale at which the table still projects inside its box, as follows:

1. It projects the corners of the table top and of the edge's bottom exactly as the CSS does: scale, rotateZ, rotateX, then the perspective, seen from the perspective origin.
2. It binary-searches the scale.

At rest, CSS scales the table by `--fit` (0.91, or 0.935 on coarse pointers), so its enlarged near edge exactly fills its box.

A formula without the perspective was tried and overshot the box by up to 8% at a 60° tilt.

As a result, two boards side by side never overlap, and the page never scrolls sideways.

## 5. Structure

```
.board-stage          perspective, receives the camera drag
  .board-table        rotateX(tilt) rotateZ(turn) scale(fit); the 3D context
    .board-slab       three ink walls under the table top (the far one never faces the camera)
    .board-surface    FLAT: today's .board (role=grid, labels, 100 cell buttons)
    .board-pieces     3D: ships and pegs over the 10×10 area, aria-hidden, no pointer events
```

- The surface is a single flat layer. Cells and labels must **not** sit inside the 3D context, or each one becomes a compositor layer (the mockup measured 100+ extra layers from the cells alone).
- Geometry is in **`em`**, with `font-size: var(--cell)` on the pieces layer. Models scale with the cell size and need no resize handling.
- All dynamic styles go through the CSSOM (`el.style.setProperty`), as `grid.js` does today, so the strict CSP stays unchanged.

### 5.1 Modules

| File | Responsibility |
|---|---|
| `js/drag-gesture.js` | Today's `ship-drag.js`, renamed: press, 6px threshold, pointer capture, swallowing the click after a drag. Used by ship dragging and by the camera. |
| `js/table-camera.js` | Turning: mouse-only drags, limits, double-click reset, auto-framing. Writes the table transform. Knows nothing about cells or ships. |
| `js/grid.js` | Builds the stage, table, slab, surface and pieces layer around today's grid; cells, keyboard and ARIA are unchanged. Delegates ships and pegs to `board-pieces.js`. |
| `js/solid.js` (second PR) | Builds one flat-shaded prism from a polygon and a height: walls plus a top face, in `em`. Leaves out the faces the camera can never see (6.1). |
| `js/ship-models.js` (second PR) | The five models as data: a list of prisms and deck markings per kind. Changing a model means changing data. |
| `js/board-pieces.js` (second PR) | Places ships and pegs, drops new pegs, sinks a ship once every one of its cells is sunk (animated only when the sinking shot is the newest). |

`ships.js` keeps drawing the dock silhouettes.

### 5.2 Colour and shading

- Faces take one of three shades, lit, mid or dark, from the angle between the face and a fixed light from the board's north-west.
- The shade is a class. CSS computes it with `color-mix(in srgb, var(--part) N%, #000)`, so no colour is written in JavaScript.
- Tops take the part's own token. Walls are flat colours: no blur, no gradient.

## 6. Performance

The mockup measured frame rates while turning continuously, with software rendering (the worst case) and CPU slowdown. The 4× slowdown is Lighthouse's mid-range phone.

| Version | Layers | Normal | CPU 4× | CPU 6× |
|---|---|---|---|---|
| Models, every face, cells in the 3D context | 394 | 37 fps | 35 fps | 25 fps |
| Models, invisible faces dropped, flat surface | 200 | 60 fps | 58 fps | 41 fps |

### 6.1 Rules

1. **Flat surface:** cells and labels paint into one layer (section 5).
2. **Face culling:** within the turn limits, the camera never sees a face whose outward normal (in board coordinates) points within 40° of the far edge. Those faces are never built.
3. **Thin parts are planes:** a part under 0.06 of a cell tall (gun barrels, diving planes) gets only its top face.
4. **Ships only where they are known:** your own board shows models; the enemy board shows pegs and flat cells until the end.
5. **Idle costs nothing:** no infinite animations. `will-change: transform` is set on the table only during a drag.

**Budget:** at most about 250 3D faces per board, with the whole fleet and 17 pegs.

**Verified by:** a Chrome performance trace with a 4× CPU slowdown on each PR. It must show at least 50 fps while turning and no task over 50 ms when a board is built. The numbers go in the PR description.

## 7. Accessibility and security

- Cells remain the only interactive elements, with the same labels and roving tabindex. The 3D layers are `aria-hidden`.
- Forced-colours mode: the pieces layer uses `forced-color-adjust: none`, as the drawn crosses do today, so ships stay visible.
- No new dependency, endpoint or protocol message. The CSP is unchanged; the E2E harness keeps failing on any CSP violation.

## 8. Testing

Every existing Playwright spec must pass unchanged, on the desktop, mobile and tablet profiles. `.board` keeps its role and `.ship[data-kind]` its selector.

New specs:

1. **Turn without firing:** dragging the enemy board changes its transform and fires nothing; a plain click on a cell fires.
2. **Limits and reset:** a long drag stops at 40° and 10°/60°; a double-click off the grid restores the default view.
3. **Placement:** dragging a placed ship moves it on a turnable board; dragging empty water turns the board and moves no ship.
4. **Touch:** on the mobile profile a drag does not turn the board.
5. **Pegs and sinking** (second PR): a hit shows a peg on the right cell; a sunk ship's model is gone and its cells show flag O.
6. **Auto-framing:** at the narrowest side-by-side layout, both boards fully turned leave no horizontal overflow and do not overlap.

## 9. Delivery

1. **#59:** table, slab, sea surface and night sea, bigger boards, the camera with auto-framing and the hint, `drag-gesture.js`. Today's silhouettes lie on the table.
2. **#60:** `solid.js`, `ship-models.js`, `board-pieces.js`, pegs, sinking and culling, with the performance trace.

## 10. Changes to the design system

The UI section of `CLAUDE.md` gains:

- The board is a 3D table. **Depth comes only from solid, flat-shaded faces**: no blurred shadow, no glow, no gradient. The rule "no shadows" still holds.
- The water is `--sea` with the printed wave pattern. Like the flag patterns on cells, it is an allowed pattern.
- Cell language: ship = low-poly blue model with a red waterline; hit = red cell with white ✕ plus a red peg; sunk = the ship sinks and leaves flag O cells.
