import { $ } from "./dom.js";

/** Shows an error at the top of the page until the next action clears it. */
export function notify(text) {
  const notice = $("notice");
  notice.textContent = text;
  notice.hidden = false;
}

export function clearNotice() {
  $("notice").hidden = true;
}

export function setConnectionStatus(text) {
  const status = $("connection-status");
  status.textContent = text ?? "";
  status.hidden = !text;
}
