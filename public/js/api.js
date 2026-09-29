// A request that never answers must not leave the player on "Creating…" for good.
const CREATE_TIMEOUT_MS = 15_000;

const CREATE_ERRORS = {
  429: "Too many rooms created from your network. Wait a minute and try again.",
  403: "This page is not allowed to create rooms.",
};

export async function createRoom() {
  // AbortController with a timer, not AbortSignal.timeout: that is missing from older Safari.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CREATE_TIMEOUT_MS);
  let response;
  let body = null;
  try {
    response = await fetch("/api/rooms", { method: "POST", signal: controller.signal });
    if (response.status === 201) body = await response.json();
  } catch {
    throw new Error("Could not reach the server. Check your connection.");
  } finally {
    clearTimeout(timer);
  }
  if (!body) {
    throw new Error(CREATE_ERRORS[response.status] ?? "Could not create a room. Try again.");
  }
  return body.code;
}
