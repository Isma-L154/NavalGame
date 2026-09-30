import { el } from "./dom.js";
import { shipByKind, shipCells } from "./fleet.js";
import { SHIP_BEAM, SHIP_INSET, shipModel } from "./ship-models.js";
import { prism } from "./solid.js";

const keyOf = (row, col) => row * 10 + col;

/**
 * The 3D pieces on one table: ship models, the pegs of hits, ships going down. Only a view:
 * it draws what the placements and the grid's cell states say.
 */
export class BoardPieces {
  #layer;
  // Cell key -> the ship covering it: { ship, model, parts, placement }.
  #ships = new Map();
  #drawn = null;

  constructor(layer) {
    this.#layer = layer;
  }

  /** Draws `placements` as models; `selected` is the kind drawn as selected. */
  setShips(placements, { selected = null } = {}) {
    // Every state and every placement action calls this: only redraw what changed.
    const drawn = JSON.stringify([placements, selected]);
    if (drawn === this.#drawn) return;
    this.#drawn = drawn;
    this.#ships.clear();
    this.#layer.replaceChildren(
      ...placements.map((placement) => this.#ship(placement, placement.kind === selected)),
    );
  }

  /** Follows one cell's state. Pegs and sinking come next. */
  markCell() {}

  #ship(placement, selected) {
    const { kind, row, col, orientation } = placement;
    const length = shipByKind(kind).length - 2 * SHIP_INSET;
    const turned = orientation === "vertical";
    const parts = shipModel(kind, length);
    const model = el(
      "div",
      { className: "ship-model" },
      parts.map((part) => prism(part.points, part.height, { ...part, turned })),
    );
    const ship = el("div", { className: "ship" }, [model]);
    ship.dataset.kind = kind;
    ship.classList.toggle("is-vertical", turned);
    ship.classList.toggle("is-selected", selected);
    ship.style.setProperty("width", `${length}em`);
    ship.style.setProperty("height", `${SHIP_BEAM}em`);
    // A vertical ship is the same model turned a quarter about its first cell, bow down.
    ship.style.setProperty("transform-origin", `${SHIP_BEAM / 2}em ${SHIP_BEAM / 2}em`);
    ship.style.setProperty(
      "transform",
      `translate(${col + SHIP_INSET}em, ${row + SHIP_INSET}em)${turned ? " rotateZ(90deg)" : ""}`,
    );
    const entry = { ship, model, parts, placement };
    for (const [r, c] of shipCells(placement)) this.#ships.set(keyOf(r, c), entry);
    return ship;
  }
}
