import { $ } from "./dom.js";

const HERO_IDS = ["home-kicker", "home-title", "home-lede"];
const ACTION_IDS = ["create-room", "join-submit", "leave-invite"];

/** The home screen: the usual welcome, or a one-step join when opened from an invite link. */
export class HomeView {
  #invitedTo = null;
  // The welcome text lives in the HTML; remember it to restore after an invitation.
  #welcome = new Map(HERO_IDS.map((id) => [id, $(id).textContent]));

  constructor({ onLeaveInvite }) {
    $("leave-invite").addEventListener("click", () => {
      this.show(null);
      onLeaveInvite();
    });
  }

  get invitedTo() {
    return this.#invitedTo;
  }

  /** Shows the invitation to room `code`, or the usual welcome when `code` is null. */
  show(code) {
    this.#invitedTo = code;
    const invited = code !== null;
    const text = invited
      ? {
        "home-kicker": "You're invited",
        "home-title": `Join room ${code}`,
        "home-lede": "A friend opened this room for you. Choose a nickname and join the battle.",
      }
      : Object.fromEntries(this.#welcome);
    for (const id of HERO_IDS) $(id).textContent = text[id];
    $("create-room").hidden = invited;
    $("room-code-field").hidden = invited;
    $("leave-invite").hidden = !invited;
    $("join-submit").classList.toggle("button-primary", invited);
    $("join-form").classList.toggle("is-invite", invited);
    $("room-code").value = code ?? "";
  }

  /** While a room is being created or joined, no second action may start. */
  setBusy(busy, { creating = false } = {}) {
    for (const id of ACTION_IDS) $(id).disabled = busy;
    if (creating) $("create-room").textContent = "Creating…";
    if (!busy) $("create-room").textContent = "Create a room";
  }

  /** After a join that could not connect, keep the code ready for another try. */
  offerRetry(code) {
    $("room-code").value = code;
  }
}
