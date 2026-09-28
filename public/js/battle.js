import { $, el } from "./dom.js";
import { BOARD_SIZE, SHIPS, cellKey, coordinateLabel, shipByKind, shipCells } from "./fleet.js";
import { Grid } from "./grid.js";

const RESULT_TEXT = { miss: "miss", hit: "hit", sunk: "sunk" };
const MAX_LOG_ENTRIES = 50;

export class BattleView {
  #state = null;
  #pendingShot = false;
  #lastShot = null;

  constructor({ onFire, onRematch }) {
    this.onFire = onFire;
    this.targetGrid = new Grid($("target-grid"), {
      label: "Enemy waters",
      onActivate: (row, col) => this.#fire(row, col),
    });
    this.ownGrid = new Grid($("own-grid"), { label: "Your fleet", small: true });
    $("rematch").addEventListener("click", () => {
      $("rematch").disabled = true;
      onRematch();
    });
  }

  /** A new game starts: forget the previous log. */
  reset() {
    $("shot-log").replaceChildren();
    this.#lastShot = null;
    this.#pendingShot = false;
  }

  update(state) {
    this.#state = state;
    this.#pendingShot = false;
    this.#renderTarget(state);
    this.#renderOwn(state);
    this.#renderBanner(state);
    renderFleetList($("enemy-fleet"), new Set(state.opponent_sunk.map((ship) => ship.kind)));
    renderFleetList($("own-fleet"), ownSunkKinds(state));
    this.#renderResult(state);
    // Highlight a shot only in the render that follows it.
    this.#lastShot = null;
  }

  recordShot(message, state) {
    const mine = message.by === state?.seat;
    const shooter = mine ? "You" : (state?.players[message.by]?.nickname ?? "Opponent");
    const where = coordinateLabel(message.row, message.col);
    const outcome =
      message.result === "sunk"
        ? `sank the ${shipByKind(message.kind)?.name.toLowerCase() ?? "ship"}`
        : RESULT_TEXT[message.result];
    const log = $("shot-log");
    log.prepend(el("li", { text: `${shooter} fired at ${where}: ${outcome}.` }));
    while (log.children.length > MAX_LOG_ENTRIES) log.lastElementChild.remove();
    this.#lastShot = { mine, key: cellKey(message.row, message.col) };
  }

  shotRejected() {
    this.#pendingShot = false;
  }

  #fire(row, col) {
    const state = this.#state;
    if (!state || this.#pendingShot || state.phase !== "playing" || state.turn !== state.seat) {
      return;
    }
    if (state.shots_fired.some((shot) => shot.row === row && shot.col === col)) return;
    this.#pendingShot = this.onFire(row, col);
  }

  #renderTarget(state) {
    const shots = new Map(state.shots_fired.map((s) => [cellKey(s.row, s.col), s.result]));
    const sunk = cellsByName(state.opponent_sunk);
    const revealed = cellsByName(state.opponent_fleet ?? []);
    const myTurn = state.phase === "playing" && state.turn === state.seat;
    this.targetGrid.setInteractive(myTurn);
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const key = cellKey(row, col);
        const result = sunk.has(key) ? "sunk" : shots.get(key);
        const states = result ? [`state-${result}`] : [];
        let description = result ? RESULT_TEXT[result] : "not fired at";
        if (sunk.has(key)) {
          description = `sunk ${sunk.get(key)}`;
        } else if (!result && revealed.has(key)) {
          states.push("state-ship", "state-revealed");
          description = `unhit ${revealed.get(key)}`;
        }
        this.targetGrid.setCell(row, col, {
          states,
          description,
          disabled: !myTurn || Boolean(result),
          isNew: Boolean(this.#lastShot?.mine) && this.#lastShot.key === key,
        });
      }
    }
  }

  #renderOwn(state) {
    const ships = cellsByName(state.own_fleet ?? []);
    const shots = new Map(state.shots_received.map((s) => [cellKey(s.row, s.col), s.result]));
    const sunkCells = cellsByName(
      (state.own_fleet ?? []).filter((p) => ownSunkKinds(state).has(p.kind)),
    );
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const key = cellKey(row, col);
        const ship = ships.get(key);
        const shot = shots.get(key);
        const result = shot && sunkCells.has(key) ? "sunk" : shot;
        const states = [];
        if (ship) states.push("state-ship");
        if (result) states.push(`state-${result}`);
        const parts = [ship ?? "water"];
        if (result) parts.push(RESULT_TEXT[result]);
        this.ownGrid.setCell(row, col, {
          states,
          description: parts.join(", "),
          disabled: true,
          isNew: Boolean(this.#lastShot) && !this.#lastShot.mine && this.#lastShot.key === key,
        });
      }
    }
  }

  #renderBanner(state) {
    const banner = $("turn-banner");
    const opponent = state.players[1 - state.seat];
    banner.hidden = state.phase === "finished";
    const myTurn = state.turn === state.seat;
    banner.classList.toggle("is-your-turn", myTurn);
    let text = myTurn
      ? "Your turn: choose a cell in the enemy waters."
      : `${opponent?.nickname ?? "Opponent"} is aiming…`;
    if (opponent && !opponent.connected) {
      text += ` ${opponent.nickname} disconnected and has two minutes to return.`;
    }
    banner.textContent = text;
  }

  #renderResult(state) {
    const panel = $("result-panel");
    const finished = state.phase === "finished";
    panel.hidden = !finished;
    if (!finished) {
      $("rematch").hidden = false;
      $("rematch").disabled = false;
      $("rematch-status").textContent = "";
      return;
    }
    const won = state.winner === state.seat;
    const opponent = state.players[1 - state.seat];
    const me = state.players[state.seat];
    panel.classList.toggle("is-victory", won);
    panel.classList.toggle("is-defeat", !won);
    $("result-title").textContent = won ? "Victory" : "Defeat";
    let reason = won ? "You sank the whole enemy fleet." : "Your fleet was sunk.";
    if (state.finish_reason === "forfeit") {
      reason = won ? "Your opponent left the game or lost connection." : "You left the game.";
    }
    $("result-detail").textContent = reason;
    $("rematch").hidden = !opponent;
    $("rematch").disabled = Boolean(me?.wants_rematch);
    // A forfeit already explains an empty seat, so only mention it after a normal ending.
    let status = "";
    if (opponent && me?.wants_rematch) {
      status = `Waiting for ${opponent.nickname} to accept the rematch…`;
    } else if (opponent?.wants_rematch) {
      status = `${opponent.nickname} wants a rematch.`;
    } else if (!opponent && state.finish_reason !== "forfeit") {
      status = "Your opponent left the room.";
    }
    $("rematch-status").textContent = status;
  }
}

function cellsByName(placements) {
  const cells = new Map();
  for (const placement of placements) {
    const { name } = shipByKind(placement.kind);
    for (const [row, col] of shipCells(placement)) cells.set(cellKey(row, col), name);
  }
  return cells;
}

function ownSunkKinds(state) {
  const shots = new Set(state.shots_received.map((s) => cellKey(s.row, s.col)));
  return new Set(
    (state.own_fleet ?? [])
      .filter((p) => shipCells(p).every(([r, c]) => shots.has(cellKey(r, c))))
      .map((p) => p.kind),
  );
}

function renderFleetList(list, sunkKinds) {
  list.replaceChildren(
    ...SHIPS.map((ship) =>
      el("li", {
        className: sunkKinds.has(ship.kind) ? "is-sunk" : "",
        text: `${ship.name}${sunkKinds.has(ship.kind) ? " (sunk)" : ""}`,
      }),
    ),
  );
}
