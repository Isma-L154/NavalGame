import { $ } from "./dom.js";

const HERO_IDS = ["home-kicker", "home-title", "home-lede"];

/** The home screen: the usual welcome, or a one-step join when opened from an invite link. */
export class HomeView {
  #invitedTo = null;
  // The welcome text lives in the HTML; remember it to restore after an invitation.
  #welcome = new Map(HERO_IDS.map((id) => [id, $(id).textContent]));
  #createLabel = $("create-room").textContent;

  constructor({ onLeaveInvite }) {
    $("leave-invite").addEventListener("click", onLeaveInvite);
  }

  get invitedTo() {
    return this.#invitedTo;
  }

  /**
   * While a room is being created or joined, Create and Join are marked unavailable. They stay
   * focusable (aria-disabled, not disabled) so focus does not jump; the caller ignores presses.
   */
  setBusy(busy, { creating = false } = {}) {
    for (const id of ["create-room", "join-submit"]) $(id).setAttribute("aria-disabled", String(busy));
    $("create-room").textContent = creating ? "Creating…" : this.#createLabel;
  }

  /**
   * Shows the invitation to room `code`, or the usual welcome when `code` is null. `retryCode`
   * fills the join field of the welcome, for a join worth trying again.
   */
  show(code, { retryCode = null } = {}) {
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
    const field = $("room-code");
    field.value = code ?? retryCode ?? "";
    field.removeAttribute("aria-invalid");
  }
}
