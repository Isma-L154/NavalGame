// A press only becomes a drag after this much movement, so taps and clicks keep working.
const DRAG_THRESHOLD_PX = 6;

/**
 * Drags ships with Pointer Events, so mouse, touch and pen behave the same. `start(event)`
 * decides whether a press can start a drag and returns its payload (or null); `move` and
 * `drop` receive the payload and the pointer position; `cancel` ends a drag without a drop.
 */
export class ShipDrag {
  #press = null;
  #dragging = false;
  #swallowClick = false;

  constructor(root, { start, move, drop, cancel }) {
    this.callbacks = { start, move, drop, cancel };
    root.addEventListener("pointerdown", (event) => this.#onDown(event));
    root.addEventListener("pointermove", (event) => this.#onMove(event));
    root.addEventListener("pointerup", (event) => this.#onUp(event));
    root.addEventListener("pointercancel", (event) => {
      if (event.pointerId === this.#press?.id) this.#end(null);
    });
    // The click that follows a drop must not also select or place.
    root.addEventListener("click", (event) => {
      if (!this.#swallowClick) return;
      this.#swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  #onDown(event) {
    if (!event.isPrimary || event.button !== 0) return;
    // A drop that no click followed (a touch drag, a cancelled one) must not eat the next click,
    // and a press whose release was lost outside the page must not linger.
    this.#swallowClick = false;
    this.#press = null;
    this.#dragging = false;
    const payload = this.callbacks.start(event);
    if (!payload) return;
    this.#press = { payload, x: event.clientX, y: event.clientY, id: event.pointerId, target: event.target };
  }

  #onMove(event) {
    const press = this.#press;
    if (!press || event.pointerId !== press.id) return;
    if (!this.#dragging) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD_PX) return;
      this.#dragging = true;
      // Keep receiving moves when the pointer leaves the element it pressed.
      press.target.setPointerCapture?.(event.pointerId);
    }
    this.callbacks.move(press.payload, event.clientX, event.clientY);
  }

  #onUp(event) {
    const press = this.#press;
    if (!press || event.pointerId !== press.id) return;
    this.#end(this.#dragging ? { x: event.clientX, y: event.clientY } : null);
  }

  #end(dropAt) {
    const press = this.#press;
    const wasDragging = this.#dragging;
    this.#press = null;
    this.#dragging = false;
    if (!press || !wasDragging) return;
    this.#swallowClick = true;
    if (dropAt) this.callbacks.drop(press.payload, dropAt.x, dropAt.y);
    else this.callbacks.cancel(press.payload);
  }
}
