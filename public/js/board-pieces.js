import { el } from "./dom.js";
import { shipByKind, shipCells } from "./fleet.js";
import { SHIP_BEAM, SHIP_INSET, peakAt, shipModel } from "./ship-models.js";
import { prism } from "./solid.js";

const keyOf = (row, col) => row * 10 + col;
// A peg is a red block with a cross on top, this wide and tall, in cells.
const PEG_SIDE = 0.36;
const PEG_HEIGHT = 0.13;

/**
 * The 3D pieces on one table: ship models, the pegs of hits, ships going down. Only a view:
 * it draws what the placements and the grid's cell states say.
 */
export class BoardPieces {
  #layer;
  // Cell key -> the ship covering it: { ship, model, parts, placement }.
  #ships = new Map();
  // Cell key -> the peg on it.
  #pegs = new Map();
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
    // Pegs on water only exist on the enemy board, which never has ships: none are lost here.
    this.#pegs.clear();
    this.#layer.replaceChildren(
      ...placements.map((placement) => this.#ship(placement, placement.kind === selected)),
    );
  }

  /**
   * Follows one cell's state: a hit gets a peg, and a ship whose cells are all sunk goes down
   * (animated when the sinking shot is the newest), taking its pegs with it.
   */
  markCell(row, col, { hit, sunk, isNew }) {
    const at = keyOf(row, col);
    const entry = this.#ships.get(at);
    if (entry) {
      entry.ship.classList.toggle("is-sunk", sunk);
      if (!sunk) entry.ship.classList.remove("is-sinking");
      else if (isNew) entry.ship.classList.add("is-sinking");
    }
    if (hit && !sunk) this.#peg(at, row, col, entry, isNew);
    else if (!(sunk && entry)) this.#dropPeg(at);
  }

  #peg(at, row, col, entry, isNew) {
    if (this.#pegs.has(at)) return;
    const half = PEG_SIDE / 2;
    const turned = entry?.placement.orientation === "vertical";
    const body = el("div", { className: "peg-body" }, [
      prism([[-half, -half], [half, -half], [half, half], [-half, half]], PEG_HEIGHT, {
        part: "peg",
        marks: [{ x: -0.12, y: -0.12, w: 0.24, h: 0.24, kind: "cross" }],
        turned,
      }),
    ]);
    const peg = el("div", { className: "peg" }, [body]);
    peg.classList.toggle("is-new", isNew);
    if (entry) {
      const { placement, model, parts } = entry;
      const along = turned ? row - placement.row : col - placement.col;
      const x = along + 0.5 - SHIP_INSET;
      peg.style.setProperty("transform", `translate3d(${x}em, ${SHIP_BEAM / 2}em, ${peakAt(parts, x)}em)`);
      model.append(peg);
    } else {
      peg.style.setProperty("transform", `translate3d(${col + 0.5}em, ${row + 0.5}em, 0)`);
      this.#layer.append(peg);
    }
    this.#pegs.set(at, peg);
  }

  #dropPeg(at) {
    this.#pegs.get(at)?.remove();
    this.#pegs.delete(at);
  }

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
