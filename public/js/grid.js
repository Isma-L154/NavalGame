import { el } from "./dom.js";
import { BOARD_SIZE, ROW_LABELS, coordinateLabel, shipByKind } from "./fleet.js";
import { shipArt } from "./ships.js";

const STATE_CLASSES = ["state-ship", "state-miss", "state-hit", "state-sunk", "state-revealed",
  "state-preview-ok", "state-preview-bad"];

/**
 * A 10x10 keyboard-navigable grid (ARIA grid pattern with a roving tabindex).
 * Callbacks receive (row, col); the grid itself holds no game rules. With `onNudge`,
 * Shift+arrow keys call it with the step (dRow, dCol) instead of only moving focus; focus
 * follows when it returns true.
 */
export class Grid {
  #cells = [];
  #focused = [0, 0];
  #shipsDrawn = null;

  constructor(container, { label, small = false, onActivate, onHover, onLeave, onNudge = null } = {}) {
    this.onActivate = onActivate ?? (() => {});
    this.onHover = onHover ?? (() => {});
    this.onLeave = onLeave ?? (() => {});
    this.onNudge = onNudge;
    this.root = el("div", {
      className: `board${small ? " board-small" : ""}`,
      attrs: { role: "grid", "aria-label": label },
    });
    // Drawn first so the cells paint over it; the cells carry every accessible description.
    this.shipLayer = el("div", { className: "ship-layer", attrs: { "aria-hidden": "true" } });
    this.root.append(this.shipLayer);
    this.#build();
    container.replaceChildren(this.root);
  }

  #build() {
    // Column numbers are decorative: every cell already announces its coordinate.
    const header = el("div", { className: "board-header", attrs: { "aria-hidden": "true" } }, [
      el("span", { className: "board-label", attrs: { "aria-hidden": "true" } }),
      ...Array.from({ length: BOARD_SIZE }, (_, col) =>
        el("span", { className: "board-label", text: String(col + 1), attrs: { "aria-hidden": "true" } })),
    ]);
    this.root.append(header);
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      const cells = [];
      const rowNode = el("div", { attrs: { role: "row" } }, [
        el("span", { className: "board-label row-label", text: ROW_LABELS[row], attrs: { "aria-hidden": "true" } }),
      ]);
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const button = el("button", {
          className: "cell",
          attrs: { type: "button", tabindex: row === 0 && col === 0 ? "0" : "-1" },
        });
        button.dataset.row = String(row);
        button.dataset.col = String(col);
        cells.push(button);
        rowNode.append(el("div", { attrs: { role: "gridcell" } }, [button]));
      }
      this.#cells.push(cells);
      this.root.append(rowNode);
    }
    this.root.addEventListener("click", (event) => this.#fromEvent(event, this.onActivate));
    this.root.addEventListener("pointerover", (event) => this.#fromEvent(event, this.onHover));
    this.root.addEventListener("focusin", (event) => this.#fromEvent(event, (row, col) => {
      this.#moveTabStop(row, col);
      this.onHover(row, col);
    }));
    this.root.addEventListener("pointerleave", () => this.onLeave());
    this.root.addEventListener("keydown", (event) => this.#onKeyDown(event));
  }

  #fromEvent(event, callback) {
    const cell = event.target.closest?.(".cell");
    if (!cell || !this.root.contains(cell)) return;
    if (event.type === "click" && cell.getAttribute("aria-disabled") === "true") return;
    callback(Number(cell.dataset.row), Number(cell.dataset.col));
  }

  #onKeyDown(event) {
    const moves = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    };
    const [row, col] = this.#focused;
    let target = null;
    if (moves[event.key]) {
      const [dRow, dCol] = moves[event.key];
      target = [clamp(row + dRow), clamp(col + dCol)];
      if (event.shiftKey && this.onNudge) {
        event.preventDefault();
        if (!this.onNudge(dRow, dCol)) return;
      }
    } else if (event.key === "Home") {
      target = [event.ctrlKey ? 0 : row, 0];
    } else if (event.key === "End") {
      target = [event.ctrlKey ? BOARD_SIZE - 1 : row, BOARD_SIZE - 1];
    }
    if (target) {
      event.preventDefault();
      this.#moveTabStop(...target);
      this.#cells[target[0]][target[1]].focus();
    }
  }

  #moveTabStop(row, col) {
    const [oldRow, oldCol] = this.#focused;
    this.#cells[oldRow][oldCol].tabIndex = -1;
    this.#cells[row][col].tabIndex = 0;
    this.#focused = [row, col];
  }

  /**
   * Sets the visual states and the spoken description of one cell. `isNew` marks the latest
   * shot for its animation; `step` delays it, so a sunk ship's cells turn over one by one.
   */
  setCell(row, col, { states = [], description, disabled = false, isNew = false, step = 0 }) {
    const cell = this.#cells[row][col];
    cell.classList.remove(...STATE_CLASSES, "is-new");
    cell.classList.add(...states);
    if (isNew) {
      cell.classList.add("is-new");
      cell.style.setProperty("--i", String(step));
    } else {
      cell.style.removeProperty("--i");
    }
    cell.setAttribute("aria-label", `${coordinateLabel(row, col)}, ${description}`);
    cell.setAttribute("aria-disabled", String(disabled));
  }

  /** Draws `placements` as ships under the cells; `selected` is the kind drawn as selected. */
  setShips(placements, { selected = null } = {}) {
    // Every state and every placement action calls this: only redraw what changed.
    const drawn = JSON.stringify([placements, selected]);
    if (drawn === this.#shipsDrawn) return;
    this.#shipsDrawn = drawn;
    this.shipLayer.replaceChildren(
      ...placements.map(({ kind, row, col, orientation }) => {
        const ship = el("div", { className: "ship" }, [shipArt(kind, orientation)]);
        ship.classList.toggle("is-vertical", orientation === "vertical");
        ship.classList.toggle("is-selected", kind === selected);
        ship.dataset.kind = kind;
        ship.style.setProperty("--row", String(row));
        ship.style.setProperty("--col", String(col));
        ship.style.setProperty("--len", String(shipByKind(kind).length));
        return ship;
      }),
    );
  }

  /** The [row, col] of the cell under a viewport point, or null outside this grid. */
  cellAt(x, y) {
    const cell = document.elementFromPoint(x, y)?.closest(".cell");
    if (!cell || !this.root.contains(cell)) return null;
    return [Number(cell.dataset.row), Number(cell.dataset.col)];
  }

  setPreview(cells, valid) {
    this.clearPreview();
    const cls = valid ? "state-preview-ok" : "state-preview-bad";
    for (const [row, col] of cells) {
      if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
        this.#cells[row][col].classList.add(cls);
      }
    }
  }

  clearPreview() {
    for (const cell of this.#cells.flat()) cell.classList.remove("state-preview-ok", "state-preview-bad");
  }

  setInteractive(interactive) {
    this.root.classList.toggle("is-interactive", interactive);
    this.root.setAttribute("aria-disabled", String(!interactive));
  }

  get focusedCell() {
    return [...this.#focused];
  }
}

const clamp = (value) => Math.max(0, Math.min(BOARD_SIZE - 1, value));
