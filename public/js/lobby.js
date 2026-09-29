import { $, el } from "./dom.js";

export class LobbyView {
  #code = "";

  constructor() {
    // Where the browser offers a share sheet (phones, tablets, some desktops), sharing is the
    // natural way to send a link; elsewhere, copying is.
    if (typeof navigator.share === "function") {
      $("share-link").hidden = false;
      $("copy-link").classList.remove("button-primary");
      $("share-link").addEventListener("click", () => this.#share());
    }
    $("copy-link").addEventListener("click", () => this.#copy(this.#inviteLink(), "Invite link copied."));
    $("copy-code").addEventListener("click", () => this.#copy(this.#code, "Room code copied."));
  }

  update(state) {
    this.#code = state.room_code;
    $("lobby-code").replaceChildren(
      ...[...state.room_code].map((char) => el("span", { className: "code-char", text: char })),
    );
  }

  #inviteLink() {
    return `${location.origin}/?room=${this.#code}`;
  }

  async #share() {
    const url = this.#inviteLink();
    const feedback = $("copy-feedback");
    feedback.textContent = "";
    try {
      await navigator.share({ title: "NavalGame", text: `Join my NavalGame room ${this.#code}.`, url });
      feedback.textContent = "Invite shared.";
    } catch (error) {
      // Closing the sheet is a choice, and a second tap while it is open changes nothing; any
      // other failure still gets the link out by copying it.
      if (error.name === "AbortError" || error.name === "InvalidStateError") return;
      await this.#copy(url, "Invite link copied.");
    }
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
