import { $ } from "./dom.js";

const AUTO_HIDE_MS = 6000;
let timer = null;

/** Shows a message at the top of the page; errors stay until the next action, info fades. */
export function notify(text, { kind = "error" } = {}) {
  const notice = $("notice");
  clearTimeout(timer);
  notice.textContent = text;
  notice.classList.toggle("notice-info", kind === "info");
  notice.hidden = false;
  if (kind === "info") timer = setTimeout(clearNotice, AUTO_HIDE_MS);
}

export function clearNotice() {
  clearTimeout(timer);
  $("notice").hidden = true;
}

export function setConnectionStatus(text) {
  const status = $("connection-status");
  status.textContent = text ?? "";
  status.hidden = !text;
}
