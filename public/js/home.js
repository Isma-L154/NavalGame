import { $ } from "./dom.js";

const HERO_IDS = ["home-kicker", "home-title", "home-lede"];

/** The home screen: the usual welcome, or a one-step join when opened from an invite link. */
export class HomeView {
  #invitedTo = null;
  // The welcome text lives in the HTML; remember it to restore after an invitation.
  #welcome = new Map(HERO_IDS.map((id) => [id, $(id).textContent]));

  constructor({ onLeaveInvite }) {
    $("leave-invite").addEventListener("click", () => {
      $("room-code").value = "";
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
    const invitation = {
      "home-kicker": "You're invited",
      "home-title": `Join room ${code}`,
      "home-lede": "A friend opened this room for you. Choose a nickname and join the battle.",
    };
    for (const id of HERO_IDS) $(id).textContent = invited ? invitation[id] : this.#welcome.get(id);
    $("create-room").hidden = invited;
    $("room-code-field").hidden = invited;
    $("leave-invite").hidden = !invited;
    $("join-submit").classList.toggle("button-primary", invited);
    $("join-form").classList.toggle("is-invite", invited);
    if (invited) $("room-code").value = code;
  }
}
