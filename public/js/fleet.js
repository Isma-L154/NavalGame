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
