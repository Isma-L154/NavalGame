import { DragGesture } from "./drag-gesture.js";

const TURN_LIMIT = 40;
const TILT_MIN = 10;
const TILT_MAX = 60;
// Degrees per pixel of mouse movement.
const TURN_SPEED = 0.4;
const TILT_SPEED = 0.3;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value) => Math.round(value * 10) / 10;
const radians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Turns a board's table with the mouse: left and right turn it, up and down change its lean.
 * It stays where it is left, within limits that never show the grid upside down, and a
 * double-click off the grid brings back the default view. Touch never turns it, so a finger
 * keeps scrolling the page and tapping cells. `canTurn(event)` can refuse a press (one that
 * lifts a ship, say). While turned, the table scales itself so it stays inside its stage.
 */
export class TableCamera {
  #stage;
  #table;

  constructor(stage, table, { canTurn = () => true } = {}) {
    this.#stage = stage;
    this.#table = table;
    new DragGesture(stage, {
      start: (event) => (event.pointerType === "mouse" && canTurn(event) ? this.#grab(event) : null),
      move: (grab, x, y) => this.#turn(grab, x, y),
      drop: () => this.#release(),
      cancel: () => this.#release(),
    });
    // A double-click on a cell would also fire or place a ship: only one off the grid resets.
    stage.addEventListener("dblclick", (event) => {
      if (!event.target.closest(".cell")) this.reset();
    });
  }

  /** Back to the default view, animated. */
  reset() {
    this.#table.classList.add("is-resetting");
    for (const name of ["--turn", "--tilt", "--fit"]) this.#table.style.removeProperty(name);
  }

  #grab(event) {
    const view = getComputedStyle(this.#table);
    return {
      x: event.clientX,
      y: event.clientY,
      turn: Number.parseFloat(view.getPropertyValue("--turn")) || 0,
      tilt: Number.parseFloat(view.getPropertyValue("--tilt")),
      frame: null,
    };
  }

  #turn(grab, x, y) {
    // The first move past the drag threshold: the turn really starts.
    if (!grab.frame) {
      grab.frame = this.#frame();
      this.#table.classList.remove("is-resetting");
      this.#table.style.setProperty("will-change", "transform");
    }
    const turn = round(clamp(grab.turn + (x - grab.x) * TURN_SPEED, -TURN_LIMIT, TURN_LIMIT));
    const tilt = round(clamp(grab.tilt - (y - grab.y) * TILT_SPEED, TILT_MIN, TILT_MAX));
    this.#table.style.setProperty("--turn", `${turn}deg`);
    this.#table.style.setProperty("--tilt", `${tilt}deg`);
    this.#table.style.setProperty("--fit", String(fitScale(turn, tilt, grab.frame)));
  }

  #release() {
    this.#table.style.removeProperty("will-change");
  }

  /** Sizes the fit depends on, in CSS pixels, read once per turn (transforms do not change them). */
  #frame() {
    const stage = getComputedStyle(this.#stage);
    return {
      width: this.#table.offsetWidth,
      height: this.#table.offsetHeight,
      slab: this.#table.querySelector(".board-slab-south").offsetHeight,
      perspective: Number.parseFloat(stage.perspective),
      // The scale at rest: a turned table never grows past it, so a turn starts without a jump.
      restFit: Number.parseFloat(stage.getPropertyValue("--fit")),
      // The box is not centred on the table: the perspective shows more of the near half.
      originY: Number.parseFloat(stage.perspectiveOrigin.split(" ")[1]),
      boxWidth: this.#stage.clientWidth,
      boxHeight: this.#stage.clientHeight,
    };
  }
}

/**
 * The largest scale, up to the one at rest, at which the table, turned by `turn` degrees and
 * leaning back by `tilt`, still projects inside its box. It projects the corners of the table top and of its
 * edge's bottom exactly as the CSS does: scale, rotateZ, rotateX, then the stage's perspective,
 * seen from the perspective origin, where the table's centre is too.
 */
function fitScale(turn, tilt, { width, height, slab, perspective, restFit, originY, boxWidth, boxHeight }) {
  const [cosT, sinT] = [Math.cos(radians(turn)), Math.sin(radians(turn))];
  const [cosA, sinA] = [Math.cos(radians(tilt)), Math.sin(radians(tilt))];
  const corners = [];
  for (const x of [-width / 2, width / 2]) {
    for (const y of [-height / 2, height / 2]) corners.push([x, y, 0], [x, y, -slab]);
  }
  const fits = (scale) =>
    corners.every(([x, y, z]) => {
      const x1 = scale * (x * cosT - y * sinT);
      const y1 = scale * (x * sinT + y * cosT);
      const y2 = y1 * cosA - scale * z * sinA;
      const z2 = y1 * sinA + scale * z * cosA;
      const k = perspective / (perspective - z2);
      const top = y2 * k;
      return Math.abs(x1 * k) <= boxWidth / 2 && top >= -originY && top <= boxHeight - originY;
    });
  if (fits(restFit)) return restFit;
  let [low, high] = [0, restFit];
  for (let step = 0; step < 12; step += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return Math.round(low * 1000) / 1000;
}
