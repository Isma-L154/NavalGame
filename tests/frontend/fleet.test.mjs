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
