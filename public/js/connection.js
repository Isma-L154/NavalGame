const KEEPALIVE_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 12;
// Server-side closes that must not trigger a reconnect.
const FINAL_CLOSE_CODES = new Set([1000, 1008, 4000]);

/**
 * One WebSocket to a room, reconnecting with backoff after network drops.
 * Events: "open", "message" (detail: parsed message), "reconnecting" (detail: attempt),
 * "closed" (detail: { code, everOpened }).
 */
export class RoomConnection extends EventTarget {
  #code;
  #socket = null;
  #attempt = 0;
  #everOpened = false;
  #stopped = false;
  #keepalive = null;
  #retryTimer = null;

  constructor(code) {
    super();
    this.#code = code;
  }

  connect() {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}/api/rooms/${this.#code}/ws`);
    this.#socket = socket;
    socket.addEventListener("open", () => {
      this.#attempt = 0;
      this.#everOpened = true;
      this.#keepalive = setInterval(() => this.#sendRaw("ping"), KEEPALIVE_MS);
      this.dispatchEvent(new Event("open"));
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data === "pong") return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        // Only JSON protocol messages matter; anything else is not ours to act on.
        return;
      }
      this.dispatchEvent(new CustomEvent("message", { detail: message }));
    });
    socket.addEventListener("close", (event) => this.#onClose(event.code));
  }

  send(message) {
    return this.#sendRaw(JSON.stringify(message));
  }

  /** Closes for good: no reconnection. */
  stop() {
    this.#stopped = true;
    clearTimeout(this.#retryTimer);
    clearInterval(this.#keepalive);
    this.#socket?.close(1000, "bye");
  }

  #sendRaw(data) {
    if (this.#socket?.readyState !== WebSocket.OPEN) return false;
    this.#socket.send(data);
    return true;
  }

  #onClose(code) {
    clearInterval(this.#keepalive);
    if (this.#stopped) return;
    const retry = this.#everOpened && !FINAL_CLOSE_CODES.has(code)
      && this.#attempt < MAX_RECONNECT_ATTEMPTS;
    if (!retry) {
      this.#stopped = true;
      this.dispatchEvent(new CustomEvent("closed", { detail: { code, everOpened: this.#everOpened } }));
      return;
    }
    this.#attempt += 1;
    this.dispatchEvent(new CustomEvent("reconnecting", { detail: this.#attempt }));
    const delay = Math.min(10_000, 500 * 2 ** this.#attempt);
    this.#retryTimer = setTimeout(() => this.connect(), delay);
  }
}
