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
  try {
    response = await fetch("/api/rooms", { method: "POST", signal: controller.signal });
  } catch {
    throw new Error("Could not reach the server. Check your connection.");
  } finally {
    // The server has answered: reading the few bytes of the body is not cut short.
    clearTimeout(timer);
  }
  if (response.status !== 201) {
    throw new Error(CREATE_ERRORS[response.status] ?? "Could not create a room. Try again.");
  }
  const body = await response.json().catch(() => null);
  if (typeof body?.code !== "string") throw new Error("Could not create a room. Try again.");
  return body.code;
}
