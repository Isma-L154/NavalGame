import { $ } from "./dom.js";

export class LobbyView {
  #code = "";

  constructor() {
    $("copy-link").addEventListener("click", () => this.#copy(this.#inviteLink(), "Invite link copied."));
    $("copy-code").addEventListener("click", () => this.#copy(this.#code, "Room code copied."));
  }

  update(state) {
    this.#code = state.room_code;
    $("lobby-code").textContent = state.room_code;
  }

  #inviteLink() {
    return `${location.origin}/?room=${this.#code}`;
  }

  async #copy(text, done) {
    const feedback = $("copy-feedback");
    try {
      await navigator.clipboard.writeText(text);
      feedback.textContent = done;
    } catch {
      feedback.textContent = `Copy this: ${text}`;
    }
  }
}
