export const BOARD_SIZE = 10;
export const ROW_LABELS = "ABCDEFGHIJ";

export const SHIPS = [
  { kind: "carrier", name: "Carrier", length: 5 },
  { kind: "battleship", name: "Battleship", length: 4 },
  { kind: "cruiser", name: "Cruiser", length: 3 },
  { kind: "submarine", name: "Submarine", length: 3 },
  { kind: "destroyer", name: "Destroyer", length: 2 },
];

export const shipByKind = (kind) => SHIPS.find((ship) => ship.kind === kind);

export const cellKey = (row, col) => `${row},${col}`;

export const coordinateLabel = (row, col) => `${ROW_LABELS[row]}${col + 1}`;

export const flip = (orientation) => (orientation === "horizontal" ? "vertical" : "horizontal");

export function shipCells({ kind, row, col, orientation }) {
  const { length } = shipByKind(kind);
  const [dRow, dCol] = orientation === "horizontal" ? [0, 1] : [1, 0];
  return Array.from({ length }, (_, i) => [row + dRow * i, col + dCol * i]);
}

const inBounds = ([row, col]) => row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;

/** The fleet being placed; the server validates it again. */
export class FleetDraft {
  #placements = new Map();

  get placements() {
    return [...this.#placements.values()];
  }

  get isComplete() {
    return this.#placements.size === SHIPS.length;
  }

  has(kind) {
    return this.#placements.has(kind);
  }

  kindAt(row, col) {
    for (const placement of this.#placements.values()) {
      if (shipCells(placement).some(([r, c]) => r === row && c === col)) return placement.kind;
    }
    return null;
  }

  canPlace(placement) {
    const cells = shipCells(placement);
    if (!cells.every(inBounds)) return false;
    const taken = new Set();
    for (const [kind, other] of this.#placements) {
      if (kind === placement.kind) continue;
      for (const [r, c] of shipCells(other)) taken.add(cellKey(r, c));
    }
    return cells.every(([r, c]) => !taken.has(cellKey(r, c)));
  }

  place(placement) {
    if (!this.canPlace(placement)) return false;
    this.#placements.set(placement.kind, placement);
    return true;
  }

  placementOf(kind) {
    return this.#placements.get(kind) ?? null;
  }

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
    // One always fits: the other ships cover too few cells to block every position.
    this.#placements.set(kind, best.placement);
    return { placement: best.placement, moved: best.cost > 0 };
  }

  clear() {
    this.#placements.clear();
  }

  randomize() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      this.clear();
      if (SHIPS.every((ship) => this.#placeRandomly(ship.kind))) return;
    }
  }

  #placeRandomly(kind) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const placement = {
        kind,
        orientation: Math.random() < 0.5 ? "horizontal" : "vertical",
        row: Math.floor(Math.random() * BOARD_SIZE),
        col: Math.floor(Math.random() * BOARD_SIZE),
      };
      if (this.place(placement)) return true;
    }
    return false;
  }
}
