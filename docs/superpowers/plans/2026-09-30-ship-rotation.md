# Turning a placed ship (#65) Implementation Plan

> Executed task by task in a single session (this project uses no parallel agents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A placed ship always turns: about the cell the player touches, sliding to the nearest free position when the turned ship does not fit there.

**Architecture:**
- `FleetDraft.rotate(kind, pivot)` in `fleet.js` holds the geometry: the ideal position, the search for the nearest free one, and whether the ship moved.
- `PlacementView` in `placement.js` only chooses the pivot (clicked cell, or the grid's focused cell) and reports the result.
- The server and the protocol do not change.

**Tech Stack:** vanilla ES modules, Node's built-in test runner (`node:test`), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-ship-rotation-design.md`

## Global Constraints

- No new dependency. Frontend only; CSP unchanged.
- The pivot keeps its index along the ship through the turn.
- Search order: positions covering the pivot first, then any other; within each group nearest to the ideal position by Manhattan distance; ties to the upper row, then the left column.
- Status text when the ship slid: `<Ship name> turned and moved to fit.`
- "No room to turn that ship where it lies." is removed.
- Commits authored as `ismaleonsaenz@gmail.com`; the PR says `Closes #65`.

## File Structure

| File | Responsibility |
|---|---|
| `public/js/fleet.js` | Adds `flip(orientation)` and `FleetDraft.rotate(kind, pivot)`. |
| `tests/js/fleet.test.mjs` (new) | Unit and seeded property tests of `FleetDraft.rotate`. |
| `.github/workflows/ci.yml` | The `test` job also runs the frontend unit tests. |
| `public/js/placement.js` | Passes the pivot to `rotate`; status line when the ship slid. |
| `public/index.html` | Placement hint. |
| `e2e/board.spec.js` | Pivot, the reported blocked case, `R` and the Rotate button. |
| `CLAUDE.md`, `README.md` | The new test command. |
| `docs/superpowers/specs/2026-09-28-open-issues-design.md` | Points the old rotation sentence at the new spec. |

---

### Task 1: `FleetDraft.rotate`

**Files:**
- Create: `tests/js/fleet.test.mjs`
- Modify: `public/js/fleet.js`
- Modify: `.github/workflows/ci.yml` (job `test`)
- Modify: `CLAUDE.md` (Commands), `README.md` (test commands)

**Interfaces:**
- Produces: `flip(orientation) -> "horizontal" | "vertical"` and `FleetDraft.rotate(kind, pivot = null) -> { placement, moved } | null`, where `pivot` is `[row, col]` or `null`.

- [ ] **Step 1: Write the failing tests**

`tests/js/fleet.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { BOARD_SIZE, FleetDraft, SHIPS, shipCells } from "../../public/js/fleet.js";

const ROW_FLEET = [
  { kind: "carrier", row: 0, col: 0, orientation: "horizontal" },
  { kind: "battleship", row: 1, col: 0, orientation: "horizontal" },
  { kind: "cruiser", row: 2, col: 0, orientation: "horizontal" },
  { kind: "submarine", row: 3, col: 0, orientation: "horizontal" },
  { kind: "destroyer", row: 4, col: 0, orientation: "horizontal" },
];

function draftOf(placements) {
  const draft = new FleetDraft();
  for (const placement of placements) assert.ok(draft.place(placement), JSON.stringify(placement));
  return draft;
}

// mulberry32: a failing fleet reproduces from the seed in the assertion message.
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFleet(random) {
  const draft = new FleetDraft();
  for (const { kind } of SHIPS) {
    let placed = false;
    while (!placed) {
      placed = draft.place({
        kind,
        orientation: random() < 0.5 ? "horizontal" : "vertical",
        row: Math.floor(random() * BOARD_SIZE),
        col: Math.floor(random() * BOARD_SIZE),
      });
    }
  }
  return draft.placements;
}

const covers = (placement, [row, col]) => shipCells(placement).some(([r, c]) => r === row && c === col);

test("a ship turns about the given cell when the turned ship fits there", () => {
  const draft = draftOf([{ kind: "carrier", row: 4, col: 2, orientation: "horizontal" }]);
  assert.deepEqual(draft.rotate("carrier", [4, 5]), {
    placement: { kind: "carrier", row: 1, col: 5, orientation: "vertical" },
    moved: false,
  });
  assert.deepEqual(draft.placementOf("carrier"), { kind: "carrier", row: 1, col: 5, orientation: "vertical" });
});

test("turning twice about the same cell restores the placement", () => {
  const start = { kind: "battleship", row: 5, col: 3, orientation: "vertical" };
  const draft = draftOf([start]);
  draft.rotate("battleship", [6, 3]);
  assert.deepEqual(draft.rotate("battleship", [6, 3]), { placement: start, moved: false });
});

test("without a pivot, or with one off the ship, the middle cell is the pivot", () => {
  for (const pivot of [null, [9, 9]]) {
    const carrier = draftOf([{ kind: "carrier", row: 4, col: 2, orientation: "horizontal" }]);
    assert.deepEqual(carrier.rotate("carrier", pivot).placement,
      { kind: "carrier", row: 2, col: 4, orientation: "vertical" });
    const battleship = draftOf([{ kind: "battleship", row: 5, col: 3, orientation: "horizontal" }]);
    assert.deepEqual(battleship.rotate("battleship", pivot).placement,
      { kind: "battleship", row: 4, col: 4, orientation: "vertical" });
  }
});

test("a ship against the edge slides along its new axis and still covers the pivot", () => {
  const right = draftOf([{ kind: "carrier", row: 0, col: 8, orientation: "vertical" }]);
  assert.deepEqual(right.rotate("carrier", [0, 8]), {
    placement: { kind: "carrier", row: 0, col: 5, orientation: "horizontal" },
    moved: true,
  });
  const top = draftOf([{ kind: "carrier", row: 0, col: 0, orientation: "horizontal" }]);
  assert.deepEqual(top.rotate("carrier", [0, 2]), {
    placement: { kind: "carrier", row: 0, col: 2, orientation: "vertical" },
    moved: true,
  });
});

test("with every position through the pivot blocked, the ship takes the nearest free one", () => {
  const draft = draftOf(ROW_FLEET);
  assert.deepEqual(draft.rotate("carrier", [0, 0]), {
    placement: { kind: "carrier", row: 0, col: 4, orientation: "vertical" },
    moved: true,
  });
});

test("a ship that is not placed is not turned", () => {
  const draft = draftOf([{ kind: "carrier", row: 0, col: 0, orientation: "horizontal" }]);
  assert.equal(draft.rotate("destroyer", [0, 0]), null);
  assert.equal(draft.placements.length, 1);
});

test("any ship of any fleet turns about any of its cells into a valid position", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const fleet = randomFleet(seeded(seed));
    for (const ship of fleet) {
      const pivots = shipCells(ship);
      for (const [index, pivot] of pivots.entries()) {
        const where = `seed ${seed}, ${ship.kind} about cell ${index}`;
        const draft = draftOf(fleet);
        const orientation = ship.orientation === "horizontal" ? "vertical" : "horizontal";
        const ideal = orientation === "vertical"
          ? { kind: ship.kind, row: pivot[0] - index, col: pivot[1], orientation }
          : { kind: ship.kind, row: pivot[0], col: pivot[1] - index, orientation };
        const idealFits = draft.canPlace(ideal);
        const through = pivots.map((_, i) => (orientation === "vertical"
          ? { ...ideal, row: pivot[0] - i }
          : { ...ideal, col: pivot[1] - i }));
        const anyThroughFits = through.some((placement) => draft.canPlace(placement));

        const turned = draft.rotate(ship.kind, pivot);

        assert.ok(turned, where);
        assert.equal(turned.placement.orientation, orientation, where);
        assert.deepEqual(draft.placementOf(ship.kind), turned.placement, where);
        assert.equal(turned.moved, !idealFits, where);
        if (idealFits) assert.deepEqual(turned.placement, ideal, where);
        assert.equal(covers(turned.placement, pivot), anyThroughFits, where);
        // The whole fleet is still a legal one, and the other ships did not move.
        const cells = draft.placements.flatMap(shipCells);
        assert.ok(cells.every(([r, c]) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE), where);
        assert.equal(new Set(cells.map(String)).size, 17, where);
        for (const other of fleet) {
          if (other.kind !== ship.kind) assert.deepEqual(draft.placementOf(other.kind), other, where);
        }
      }
    }
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "tests/js/*.test.mjs"`
Expected: FAIL with `draft.rotate is not a function` (the last test included).

- [ ] **Step 3: Implement**

In `public/js/fleet.js`, after `coordinateLabel`:

```js
export const flip = (orientation) => (orientation === "horizontal" ? "vertical" : "horizontal");
```

In `FleetDraft`, after `placementOf`:

```js
  /**
   * Turns a placed ship a quarter about `pivot`, one of its cells as [row, col] (its middle
   * cell when null or off the ship). The pivot stays put when the turned ship fits there;
   * otherwise the ship slides to the nearest free position and `moved` is true. Returns
   * { placement, moved }, or null when the ship is not placed.
   */
  rotate(kind, pivot = null) {
    const placed = this.placementOf(kind);
    if (!placed) return null;
    const cells = shipCells(placed);
    const isPivot = ([row, col]) => pivot !== null && row === pivot[0] && col === pivot[1];
    const found = cells.findIndex(isPivot);
    const index = found === -1 ? Math.floor((cells.length - 1) / 2) : found;
    const [pivotRow, pivotCol] = cells[index];
    const orientation = flip(placed.orientation);
    const [idealRow, idealCol] = orientation === "vertical"
      ? [pivotRow - index, pivotCol]
      : [pivotRow, pivotCol - index];
    let best = null;
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const placement = { kind, row, col, orientation };
        if (!this.canPlace(placement)) continue;
        const distance = Math.abs(row - idealRow) + Math.abs(col - idealCol);
        const coversPivot = shipCells(placement).some(([r, c]) => r === pivotRow && c === pivotCol);
        // A position covering the pivot is under a ship's length away, so it always wins.
        const cost = coversPivot ? distance : distance + cells.length;
        if (best === null || cost < best.cost) best = { placement, cost };
      }
    }
    if (best === null) return null;
    this.#placements.set(kind, best.placement);
    return { placement: best.placement, moved: best.cost > 0 };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "tests/js/*.test.mjs"`
Expected: 7 tests pass.

- [ ] **Step 5: Run them in CI and document the command**

In `.github/workflows/ci.yml`, job `test`, after `uv run pytest`:

```yaml
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
      - name: Frontend unit tests
        run: node --test "tests/js/*.test.mjs"
```

In `CLAUDE.md`, under Commands, after the unit test line:

```markdown
- Test (frontend unit): `node --test "tests/js/*.test.mjs"` (pure modules of `public/js/`, no dependencies)
```

In `README.md`, after the `uv run pytest` line of the test commands:

```
node --test "tests/js/*.test.mjs"                                      # frontend unit tests (pure modules)
```

- [ ] **Step 6: Commit**

```bash
git add public/js/fleet.js tests/js/fleet.test.mjs .github/workflows/ci.yml CLAUDE.md README.md docs/superpowers
git commit -m "fix: a ship turns about a cell and slides to the nearest free position"
```

---

### Task 2: The placement screen turns ships about the cell touched

**Files:**
- Modify: `public/js/placement.js`
- Modify: `public/index.html:158`
- Modify: `e2e/board.spec.js`
- Modify: `docs/superpowers/specs/2026-09-28-open-issues-design.md:63`

**Interfaces:**
- Consumes: `flip(orientation)` and `FleetDraft.rotate(kind, pivot) -> { placement, moved } | null` from Task 1.

- [ ] **Step 1: Write the failing E2E tests**

In `e2e/board.spec.js`, replace the test "a placed ship is selected with a click and turned with a second one" with:

```js
test("a placed ship is selected with a click and turned about that cell with a second one", async ({ browser }, testInfo) => {
  const { ana } = await placementScreen(browser, testInfo);
  await cell(ana, PLACEMENT, "C1").click();
  await expect(cell(ana, PLACEMENT, "C5")).toHaveAttribute("aria-label", "C5, Carrier");
  await cell(ana, PLACEMENT, "C3").click();
  await expect(cell(ana, PLACEMENT, "C3")).toHaveAttribute("aria-label", "C3, Carrier, selected");
  await expect(ship(ana, "carrier")).toHaveClass(/is-selected/);
  await cell(ana, PLACEMENT, "C3").click();
  await expect(ship(ana, "carrier")).toHaveClass(/is-vertical/);
  await expect(cell(ana, PLACEMENT, "A3")).toHaveAttribute("aria-label", "A3, Carrier, selected");
  await expect(cell(ana, PLACEMENT, "E3")).toHaveAttribute("aria-label", "E3, Carrier, selected");
  await expect(cell(ana, PLACEMENT, "C1")).toHaveAttribute("aria-label", "C1, water");
  await expect(ana.locator("#placement-status")).toHaveText("4 ships left to place.");
  // A selected ship moves to the water cell chosen next, keeping its orientation.
  await cell(ana, PLACEMENT, "B5").click();
  await expect(cell(ana, PLACEMENT, "F5")).toHaveAttribute("aria-label", "F5, Carrier, selected");
  await expect(cell(ana, PLACEMENT, "A3")).toHaveAttribute("aria-label", "A3, water");
});

test("a ship with no room to turn where it lies slides to the nearest free place", async ({ browser }, testInfo) => {
  const { ana } = await placementScreen(browser, testInfo);
  // The whole fleet in rows A-E from column 1: the carrier cannot turn down about A1.
  for (const row of FLEET_ROWS) await cell(ana, PLACEMENT, `${row}1`).click();
  await cell(ana, PLACEMENT, "A1").click();
  await cell(ana, PLACEMENT, "A1").click();
  await expect(ship(ana, "carrier")).toHaveClass(/is-vertical/);
  await expect(cell(ana, PLACEMENT, "A5")).toHaveAttribute("aria-label", "A5, Carrier, selected");
  await expect(cell(ana, PLACEMENT, "E5")).toHaveAttribute("aria-label", "E5, Carrier, selected");
  await expect(cell(ana, PLACEMENT, "A1")).toHaveAttribute("aria-label", "A1, water");
  await expect(ana.locator("#placement-status")).toHaveText("Carrier turned and moved to fit.");
  await expect(ana.getByRole("button", { name: "Ready" })).toBeEnabled();
});

test("R and Rotate turn the selected ship about the focused cell", async ({ browser }, testInfo) => {
  const { ana } = await placementScreen(browser, testInfo);
  await cell(ana, PLACEMENT, "E1").click();
  await cell(ana, PLACEMENT, "E2").click();
  await ana.keyboard.press("r");
  await expect(cell(ana, PLACEMENT, "D2")).toHaveAttribute("aria-label", "D2, Carrier, selected");
  await expect(cell(ana, PLACEMENT, "H2")).toHaveAttribute("aria-label", "H2, Carrier, selected");
  await expect(cell(ana, PLACEMENT, "E1")).toHaveAttribute("aria-label", "E1, water");
  await ana.locator("#rotate").click();
  await expect(cell(ana, PLACEMENT, "E1")).toHaveAttribute("aria-label", "E1, Carrier, selected");
  await expect(cell(ana, PLACEMENT, "E5")).toHaveAttribute("aria-label", "E5, Carrier, selected");
  await expect(cell(ana, PLACEMENT, "D2")).toHaveAttribute("aria-label", "D2, water");
});
```

Add `FLEET_ROWS` to the import from `./helpers.js`.

- [ ] **Step 2: Run them to verify they fail**

Run (dev server running): `npx playwright test e2e/board.spec.js --project=desktop`
Expected: the three tests fail: the carrier turns about its first cell (`A3` stays water), and the blocked turn shows "No room to turn that ship where it lies."

- [ ] **Step 3: Implement**

`public/js/placement.js`:

- Import `flip` from `./fleet.js` and delete the local `flip`.
- Class comment: "selecting it again, R or Rotate turns it about that cell".
- In `#activate`, pass the clicked cell: `if (occupant === this.#selected) this.#rotate([row, col]);`
- Replace `#rotate`:

```js
  /** Turns the selected ship about `pivot`, or the orientation for the next ship placed. */
  #rotate(pivot = this.grid.focusedCell) {
    if (this.#frozen) return;
    const turned = this.#selected === null ? null : this.#draft.rotate(this.#selected, pivot);
    if (turned) {
      this.#render();
      if (turned.moved) {
        $("placement-status").textContent = `${shipByKind(this.#selected).name} turned and moved to fit.`;
      }
      return;
    }
    this.#orientation = flip(this.#orientation);
    this.#render();
    if (this.grid.root.contains(document.activeElement)) this.#preview(...this.grid.focusedCell);
  }
```

`public/index.html:158`, the hint:

```html
<p class="field-hint">Drag a ship onto the grid, or select it and choose a cell. Select a placed ship to move it; select it again, press <kbd>R</kbd> or use Rotate to turn it about that cell. <kbd>Shift</kbd> + arrow keys move it one cell.</p>
```

`docs/superpowers/specs/2026-09-28-open-issues-design.md:63`: after "rotates it in place when it fits." add "(Since #65 it turns about the cell selected and always fits: see `2026-09-30-ship-rotation-design.md`.)"

- [ ] **Step 4: Run the checks**

Run: `node --test "tests/js/*.test.mjs"` — 7 pass.
Run (dev server running): `npx playwright test` — every project passes.
Run: `uv run ruff check . && uv run ruff format --check . && uv run mypy src tests && uv run pytest` — clean.

- [ ] **Step 5: Commit**

```bash
git add public/js/placement.js public/index.html e2e/board.spec.js docs/superpowers/specs/2026-09-28-open-issues-design.md
git commit -m "fix: the placement screen turns a ship about the cell touched"
```

---

## Delivery

One PR, `Closes #65`: review of the diff, CI green, squash merge, then check the turn on `https://naval.cloudils.com` once deployed.
