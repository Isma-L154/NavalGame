import { $, el } from "./dom.js";
import { FlagPicker } from "./flag-picker.js";
import { flagIcon, flagName } from "./flags.js";
import { FleetDraft, SHIPS, shipByKind, shipCells } from "./fleet.js";
import { Grid } from "./grid.js";
import { ShipDrag } from "./ship-drag.js";
import { shipArt } from "./ships.js";

const FLAG_SETTLE_MS = 400;
const flip = (orientation) => (orientation === "horizontal" ? "vertical" : "horizontal");
const clamp = (value, max) => Math.max(0, Math.min(max, value));

/**
 * Placing the fleet. A ship is selected from the dock or on the grid (it stays where it is);
 * a water cell places or moves the selected ship; selecting it again, R or Rotate turns it in
 * place. Ships can also be dragged from the dock or around the grid.
 */
export class PlacementView {
  #draft = new FleetDraft();
  #selected = SHIPS[0].kind;
  #orientation = "horizontal";
  #submitted = false;
  #locked = false;
  #shipButtons = new Map();
  #state = null;
  #flagTimer = null;
  #noteAbout = null;

  constructor({ onReady, onChooseFlag }) {
    this.onReady = onReady;
    this.flagPicker = new FlagPicker($("placement-flag"), {
      name: "placement-flag",
      onChange: (flag) => {
        this.setFlagNote(null);
        // Arrow keys step through every radio: send the flag once the player settles on one.
        clearTimeout(this.#flagTimer);
        this.#flagTimer = setTimeout(() => {
          this.#flagTimer = null;
          onChooseFlag(flag);
        }, FLAG_SETTLE_MS);
      },
    });
    this.grid = new Grid($("placement-grid"), {
      label: "Your waters. Place your fleet",
      onActivate: (row, col) => this.#activate(row, col),
      onHover: (row, col) => this.#preview(row, col),
      onLeave: () => this.grid.clearPreview(),
    });
    this.grid.root.classList.add("board-placement");
    this.#buildDock();
    new ShipDrag($("screen-placement"), {
      start: (event) => this.#dragStart(event),
      move: (ship, x, y) => this.#dragMove(ship, x, y),
      drop: (ship, x, y) => this.#dragDrop(ship, x, y),
      cancel: () => this.grid.clearPreview(),
    });
    $("rotate").addEventListener("click", () => this.#rotate());
    $("random-fleet").addEventListener("click", () => this.#randomize());
    $("clear-fleet").addEventListener("click", () => this.#clear());
    $("ready").addEventListener("click", () => this.#ready());
    document.addEventListener("keydown", (event) => {
      if ((event.key === "r" || event.key === "R") && this.#isActive(event)) {
        event.preventDefault();
        this.#rotate();
      }
    });
    this.#render();
  }

  /** Called with every server state while the game is in the placing phase. */
  update(state) {
    this.#state = state;
    const opponent = state.players[1 - state.seat];
    const opponentReady = state.fleet_placed[1 - state.seat];
    const line = [];
    if (opponent) {
      line.push("Opponent: ");
      if (opponent.flag) {
        line.push(flagIcon(opponent.flag, { className: "flag flag-inline" }));
        line.push(`${opponent.nickname} (${flagName(opponent.flag)})`);
      } else {
        line.push(opponent.nickname);
      }
      line.push(` · ${opponentReady ? "fleet ready" : "placing ships"}`);
      if (!opponent.connected) line.push(" · disconnected");
    }
    $("placement-opponent").replaceChildren(...line);
    // The note explains the opponent's flag; once that changes, it no longer holds.
    if (this.#noteAbout && opponent?.flag !== this.#noteAbout) this.setFlagNote(null);
    this.#syncFlag();
    this.#locked = state.fleet_placed[state.seat];
    if (!this.#locked && this.#submitted) this.#submitted = false;
    this.#render();
    if (this.#locked) {
      $("placement-status").textContent = opponentReady
        ? "Both fleets ready. Starting…"
        : `Fleet deployed. Waiting for ${opponent?.nickname ?? "your opponent"}…`;
    }
  }

  /** The server refused the last action; a refused flag change leaves a pending fleet alone. */
  rejected(code) {
    if (code !== "flag_taken") this.#submitted = false;
    this.#syncFlag();
    this.#render();
  }

  /** Explains that the server gave the player another flag than the one asked for; null clears. */
  setFlagNote(requested, flown) {
    this.#noteAbout = requested;
    $("placement-flag-note").textContent = requested
      ? `Your opponent already flies ${flagName(requested)}, so you fly ${flagName(flown)}. You can change it.`
      : "";
  }

  // The picker shows what the server says (also after a refused change), unless the player is
  // still choosing.
  #syncFlag() {
    const state = this.#state;
    if (!state) return;
    if (this.#flagTimer === null) this.flagPicker.setValue(state.players[state.seat]?.flag ?? null);
    this.flagPicker.setTaken(state.players[1 - state.seat]?.flag ?? null);
  }

  #buildDock() {
    const list = $("ship-list");
    for (const ship of SHIPS) {
      const art = el("span", { className: "ship-dock-art" }, [shipArt(ship.kind)]);
      art.style.setProperty("--len", String(ship.length));
      const button = el(
        "button",
        { className: "button ship-button", attrs: { type: "button", "aria-pressed": "false" } },
        [el("span", { className: "ship-name", text: `${ship.name} (${ship.length})` }), art],
      );
      button.dataset.kind = ship.kind;
      button.addEventListener("click", () => this.#select(ship.kind));
      this.#shipButtons.set(ship.kind, button);
      list.append(el("li", {}, [button]));
    }
  }

  #select(kind) {
    if (this.#frozen) return;
    this.#selected = kind;
    this.#render();
  }

  #activate(row, col) {
    if (this.#frozen) return;
    const occupant = this.#draft.kindAt(row, col);
    if (occupant) {
      if (occupant === this.#selected) this.#rotate();
      else this.#select(occupant);
      return;
    }
    if (this.#selected !== null) {
      this.#place({ kind: this.#selected, row, col, orientation: this.#orientationOf(this.#selected) });
    }
  }

  /** Places or moves a ship. A new one hands over to the next ship in the dock. */
  #place(placement) {
    // A drag can end after Ready was pressed: the fleet on its way must not change.
    if (this.#frozen) return;
    const moving = this.#draft.has(placement.kind);
    if (!this.#draft.place(placement)) {
      $("placement-status").textContent = "That ship does not fit there.";
      return;
    }
    this.#selected = moving
      ? placement.kind
      : (SHIPS.find((ship) => !this.#draft.has(ship.kind))?.kind ?? null);
    this.grid.clearPreview();
    this.#render();
  }

  #orientationOf(kind) {
    return this.#draft.placementOf(kind)?.orientation ?? this.#orientation;
  }

  #preview(row, col) {
    if (this.#frozen || this.#selected === null || this.#draft.kindAt(row, col)) {
      this.grid.clearPreview();
      return;
    }
    const placement = { kind: this.#selected, row, col, orientation: this.#orientationOf(this.#selected) };
    this.grid.setPreview(shipCells(placement), this.#draft.canPlace(placement));
  }

  /** Turns the selected ship where it lies, or the orientation for the next ship placed. */
  #rotate() {
    if (this.#frozen) return;
    const placed = this.#selected === null ? null : this.#draft.placementOf(this.#selected);
    if (placed) {
      if (this.#draft.place({ ...placed, orientation: flip(placed.orientation) })) this.#render();
      else $("placement-status").textContent = "No room to turn that ship where it lies.";
      return;
    }
    this.#orientation = flip(this.#orientation);
    $("orientation-label").textContent = this.#orientation;
    if (this.grid.root.contains(document.activeElement)) this.#preview(...this.grid.focusedCell);
  }

  /** A drag lifts a ship from the dock or the grid, remembering which of its cells was held. */
  #dragStart(event) {
    if (this.#frozen) return null;
    const button = event.target.closest?.(".ship-button");
    // By touch only the drawing is grabbed: a swipe on the name scrolls the page.
    if (button && event.pointerType === "touch" && !event.target.closest(".ship-dock-art")) return null;
    if (button) {
      const kind = button.dataset.kind;
      const length = shipByKind(kind).length;
      const art = button.querySelector(".ship-dock-art").getBoundingClientRect();
      const held = Math.floor(((event.clientX - art.left) / art.width) * length);
      return { kind, held: clamp(held, length - 1), orientation: this.#orientationOf(kind) };
    }
    const cell = this.grid.cellAt(event.clientX, event.clientY);
    if (!cell) return null;
    const [row, col] = cell;
    const kind = this.#draft.kindAt(row, col);
    if (!kind) return null;
    const placed = this.#draft.placementOf(kind);
    const held = placed.orientation === "horizontal" ? col - placed.col : row - placed.row;
    return { kind, held, orientation: placed.orientation };
  }

  #dragTarget(ship, x, y) {
    const cell = this.grid.cellAt(x, y);
    if (!cell) return null;
    const [row, col] = cell;
    const [dRow, dCol] = ship.orientation === "horizontal" ? [0, ship.held] : [ship.held, 0];
    return { kind: ship.kind, row: row - dRow, col: col - dCol, orientation: ship.orientation };
  }

  #dragMove(ship, x, y) {
    const placement = this.#dragTarget(ship, x, y);
    if (placement) this.grid.setPreview(shipCells(placement), this.#draft.canPlace(placement));
    else this.grid.clearPreview();
  }

  #dragDrop(ship, x, y) {
    this.grid.clearPreview();
    const placement = this.#dragTarget(ship, x, y);
    if (placement) this.#place(placement);
  }

  #randomize() {
    if (this.#frozen) return;
    this.#draft.randomize();
    this.#selected = null;
    this.#render();
  }

  #clear() {
    if (this.#frozen) return;
    this.#draft.clear();
    this.#selected = SHIPS[0].kind;
    this.#render();
  }

  #ready() {
    if (this.#frozen || !this.#draft.isComplete) return;
    this.#submitted = this.onReady(this.#draft.placements);
    this.#render();
    if (this.#submitted) $("placement-status").textContent = "Deploying fleet…";
  }

  get #frozen() {
    return this.#locked || this.#submitted;
  }

  #isActive(event) {
    const tag = event.target?.tagName;
    return !$("screen-placement").hidden && tag !== "INPUT" && !event.ctrlKey && !event.metaKey;
  }

  #render() {
    for (let row = 0; row < 10; row += 1) {
      for (let col = 0; col < 10; col += 1) {
        const kind = this.#draft.kindAt(row, col);
        let description = "water";
        const selected = kind === this.#selected && !this.#frozen;
        if (kind) description = `${shipByKind(kind).name}${selected ? ", selected" : ""}`;
        this.grid.setCell(row, col, { states: kind ? ["state-ship"] : [], description });
      }
    }
    this.grid.setShips(this.#draft.placements, { selected: this.#frozen ? null : this.#selected });
    for (const [kind, button] of this.#shipButtons) {
      button.setAttribute("aria-pressed", String(this.#selected === kind));
      button.classList.toggle("is-placed", this.#draft.has(kind));
      button.disabled = this.#frozen;
    }
    for (const id of ["rotate", "random-fleet", "clear-fleet"]) $(id).disabled = this.#frozen;
    $("ready").disabled = this.#frozen || !this.#draft.isComplete;
    this.grid.setInteractive(!this.#frozen);
    if (!this.#frozen) {
      const remaining = SHIPS.filter((ship) => !this.#draft.has(ship.kind)).length;
      $("placement-status").textContent = remaining
        ? `${remaining} ship${remaining === 1 ? "" : "s"} left to place.`
        : "All ships placed. Press Ready when you are happy with your layout.";
    }
  }
}
