# Turning a placed ship — Design

**Date:** 2026-09-30
**Status:** Approved
**Issue:** #65

## 1. Goal

A placed ship can always be turned. Today it often cannot, and a player who pressed Random and wants to rearrange the fleet is the one who notices.

The cause: turning keeps the ship's first cell fixed (the top cell of a vertical ship, the left cell of a horizontal one), which leaves exactly one position for the turned ship. When another ship lies there, or the position falls off the board, the turn is refused with "No room to turn that ship where it lies." With five ships on the board this is frequent, and a ship near the right or bottom edge can never turn.

Decisions taken with the owner:

- The ship turns about **the cell the player touches**.
- When the turned ship does not fit there, it **slides to the nearest position where it does**.

Non-goals: turning a ship while it is being dragged, animating the turn, sound effects (a separate issue).

## 2. Behaviour

### 2.1 The pivot

The pivot is one of the ship's cells. It keeps its place in the ship through the turn: the third cell of a horizontal carrier is the third cell of the vertical one. This is the quarter turn the 3D model already makes.

| How the player turns the ship | Pivot |
|---|---|
| Click or tap on the selected ship | The cell clicked |
| `R` or the Rotate button | The grid's focused cell when it is on the ship, otherwise the ship's middle cell |

The middle cell of a ship of length `n` is cell `floor((n - 1) / 2)`, counting from 0.

Turning twice about the same cell returns the ship to where it was, as long as both turns fit without sliding.

### 2.2 When the turn does not fit

The **ideal position** is the turned ship with the pivot cell unmoved. When it is off the board or overlaps another ship, the ship takes the first free position in this order:

1. positions that still cover the pivot cell, so the ship stays under the pointer;
2. any other position.

Within each group the nearest to the ideal position comes first, by Manhattan distance (rows plus columns moved). Ties go to the upper row, then to the left column.

Such a position always exists. To block every position of a ship of length `n` in one orientation, each of the ten lines needs `floor(10 / n)` occupied cells: 20 cells for the carrier and the battleship, 30 for the cruiser and the submarine, 50 for the destroyer. The other four ships cover at most 15.

### 2.3 What the player is told

- When the ship had to slide, the status line reads "*Ship* turned and moved to fit." It is a `role="status"` region, so a screen reader announces it.
- The placement hint under the ship list says that a ship turns about the cell selected.
- "No room to turn that ship where it lies." is removed with the case it described.

## 3. Components

### 3.1 `public/js/fleet.js`

`FleetDraft.rotate(kind, pivot)` turns a placed ship and stores the result.

- `pivot` is a `[row, col]` cell or `null`. A cell that is not on the ship counts as `null`, which means the middle cell.
- It returns `{ placement, moved }`, where `moved` says whether the ship left the ideal position, or `null` when the ship is not placed.
- It is pure game geometry: no DOM, and it uses the same `canPlace` check as placing and moving.

### 3.2 `public/js/placement.js`

`PlacementView` chooses the pivot and shows the result:

- a click on the selected ship passes the clicked cell;
- `R` and the Rotate button pass the grid's focused cell;
- after a turn it renders, and writes the status line when `moved` is true.

Turning a ship that is not placed yet keeps its meaning: it sets the orientation of the next ship placed.

### 3.3 Server and protocol

Unchanged. The client still sends `row`, `col` and `orientation` for each ship, and the server validates the fleet as before.

## 4. Testing

- **Unit, on `FleetDraft`** with Node's built-in test runner (no new dependency), run in CI:
  - for many seeded random fleets, every ship and every pivot: the turn succeeds, the orientation flips, the result is on the board and overlaps nothing;
  - when the ideal position is free, the pivot cell does not move and `moved` is false;
  - two turns about the same cell restore the placement when both fit;
  - a ship against the edge slides along its new axis and still covers the pivot;
  - with every position through the pivot blocked, the ship takes the nearest free one;
  - a pivot off the ship, or none, uses the middle cell;
  - a ship that is not placed returns `null` and changes nothing.
- **E2E (desktop, mobile, tablet):**
  - the reported case: with the whole fleet placed, a ship whose ideal position is blocked turns, and the status line says it moved;
  - a ship turns about the cell clicked;
  - the existing placement tests are updated to the new pivot.

## 5. Security

No exposed surface changes: no new endpoint, message type, dependency or published file type. The fleet a client sends is validated on the server exactly as before, so a client that turns ships differently gains nothing.
