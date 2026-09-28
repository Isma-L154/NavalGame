const CREATE_ERRORS = {
  429: "Too many rooms created from your network. Wait a minute and try again.",
  403: "This page is not allowed to create rooms.",
};

export async function createRoom() {
  let response;
  try {
    response = await fetch("/api/rooms", { method: "POST" });
  } catch {
    throw new Error("Could not reach the server. Check your connection.");
  }
  if (response.status !== 201) {
    throw new Error(CREATE_ERRORS[response.status] ?? "Could not create a room. Try again.");
  }
  const { code } = await response.json();
  return code;
}
