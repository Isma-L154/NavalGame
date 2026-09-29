import { $ } from "./dom.js";

const WELCOME = {
  kicker: "2 players · 10 × 10 grid · 5 ships",
  title: "Sink the enemy fleet",
  lede: "Create a room, send the link to a friend, hide your ships and take turns firing. First fleet to go under loses.",
};

/** The home screen: the usual welcome, or a one-step join when opened from an invite link. */
export class HomeView {
  #invitedTo = null;

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
    $("home-kicker").textContent = invited ? "You're invited" : WELCOME.kicker;
    $("home-title").textContent = invited ? `Join room ${code}` : WELCOME.title;
    $("home-lede").textContent = invited
      ? "A friend opened this room for you. Choose a nickname and join the battle."
      : WELCOME.lede;
    $("create-room").hidden = invited;
    $("room-code-field").hidden = invited;
    $("leave-invite").hidden = !invited;
    $("join-submit").classList.toggle("button-primary", invited);
    $("join-form").classList.toggle("is-invite", invited);
    $("room-code").value = code ?? "";
  }
}
