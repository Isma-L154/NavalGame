import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, newPlayer, watchConsole } from "./helpers.js";

// The message type of a frame the page sent; keepalive pings are not JSON.
function frameType(frame) {
  try {
    return JSON.parse(frame).type;
  } catch {
    return frame;
  }
}

test("the host hands the invite link to the share sheet", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  await ana.addInitScript(() => {
    navigator.share = async (data) => {
      window.sharedInvite = data;
    };
  });
  const code = await createRoom(ana, "Ana");
  await ana.getByRole("button", { name: "Share invite" }).click();
  await expect(ana.getByText("Invite shared.")).toBeVisible();
  const shared = await ana.evaluate(() => window.sharedInvite);
  expect(shared.url).toBe(new URL(`/?room=${code}`, ana.url()).href);
  expect(shared.text).toContain(code);
});

test("without a share sheet the invite link is copied", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo, { permissions: ["clipboard-read", "clipboard-write"] });
  await ana.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "share", { value: undefined, configurable: true });
  });
  const code = await createRoom(ana, "Ana");
  await expect(ana.getByRole("button", { name: "Share invite" })).toBeHidden();
  await ana.getByRole("button", { name: "Copy invite link" }).click();
  await expect(ana.getByText("Invite link copied.")).toBeVisible();
  expect(await ana.evaluate(() => navigator.clipboard.readText())).toContain(`/?room=${code}`);
});

test("an invite link opens a one-step join", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const bo = await newPlayer(browser, testInfo);
  const problems = [ana, bo].map(watchConsole);
  const code = await createRoom(ana, "Ana");
  await bo.goto(`/?room=${code}`);
  await expect(bo.getByRole("heading", { name: `Join room ${code}` })).toBeVisible();
  await expect(bo.getByRole("button", { name: "Create a room" })).toBeHidden();
  await expect(bo.getByLabel("Or join with a code")).toBeHidden();
  await bo.getByLabel("Your nickname").fill("Bo");
  await bo.getByLabel("Your nickname").press("Enter");
  await expect(bo.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  expect(problems.flat()).toEqual([]);
});

test("an invited visitor can start their own room instead", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.goto("/?room=ABCDEF");
  await page.getByRole("button", { name: "Start a new room instead" }).click();
  await expect(page.getByRole("heading", { name: "Sink the enemy fleet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create a room" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("a malformed room in the link shows the normal home", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.goto("/?room=nope");
  await expect(page.getByRole("heading", { name: "Sink the enemy fleet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create a room" })).toBeVisible();
});

test("pressing Enter in the nickname creates a room from the normal home", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.goto("/");
  await page.getByLabel("Your nickname").fill("Ana");
  await page.getByLabel("Your nickname").press("Enter");
  await expect(page.getByRole("heading", { name: "Waiting for an opponent" })).toBeVisible();
});

test("cancelling the share sheet shows nothing, a failing one copies the link", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo, { permissions: ["clipboard-read", "clipboard-write"] });
  await ana.addInitScript(() => {
    window.shareOutcome = "AbortError";
    navigator.share = async () => {
      window.shareCalls = (window.shareCalls ?? 0) + 1;
      throw new DOMException("share", window.shareOutcome);
    };
  });
  const code = await createRoom(ana, "Ana");
  await ana.getByRole("button", { name: "Copy code" }).click();
  await expect(ana.getByText("Room code copied.")).toBeVisible();
  await ana.getByRole("button", { name: "Share invite" }).click();
  await expect.poll(() => ana.evaluate(() => window.shareCalls)).toBe(1);
  // Give a wrong fallback time to run: a cancelled share must neither copy nor report.
  await ana.waitForTimeout(300);
  await expect(ana.locator("#copy-feedback")).toHaveText("");
  expect(await ana.evaluate(() => navigator.clipboard.readText())).toBe(code);

  await ana.evaluate(() => {
    window.shareOutcome = "NotAllowedError";
  });
  await ana.getByRole("button", { name: "Share invite" }).click();
  await expect(ana.getByText("Invite link copied.")).toBeVisible();
  expect(await ana.evaluate(() => navigator.clipboard.readText())).toContain(`/?room=${code}`);
});

test("no second room can be created while the first one is being joined", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  let creations = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/rooms")) creations += 1;
  });
  // Hold the room's WebSocket unanswered, so the home screen stays up after the room exists.
  let socketOpened;
  const opened = new Promise((resolve) => {
    socketOpened = resolve;
  });
  await page.routeWebSocket(/\/api\/rooms\/[A-Z0-9]+\/ws$/, () => socketOpened());
  await page.goto("/");
  await page.getByLabel("Your nickname").fill("Ana");
  await page.getByLabel("Your nickname").press("Enter");
  await opened;
  await page.getByLabel("Your nickname").press("Enter");
  // Marked unavailable until the room answers; a press anyway (force skips that check) must
  // change nothing.
  const create = page.getByRole("button", { name: "Creating…" });
  await expect(create).toHaveAttribute("aria-disabled", "true");
  await create.click({ force: true });
  await page.waitForTimeout(300);
  expect(creations).toBe(1);
});

test("a join submitted while a room is being created is ignored", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  const sockets = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  // Slow the creation down so the second action lands while it is in flight.
  await page.route("**/api/rooms", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Your nickname").fill("Ana");
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.getByRole("button", { name: "Creating…" })).toBeFocused();
  await page.getByLabel("Or join with a code").fill("ABCDEF");
  await expect(page.getByRole("button", { name: "Join room" })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Join room" }).click({ force: true });
  await expect(page.getByRole("heading", { name: "Waiting for an opponent" })).toBeVisible();
  expect(sockets.filter((url) => url.includes("/ABCDEF/"))).toEqual([]);
});

test("abandoning a join that was already sent leaves the seat free", async ({ browser }, testInfo) => {
  const [ana, bo, cy] = await Promise.all([0, 1, 2].map(() => newPlayer(browser, testInfo)));
  const code = await createRoom(ana, "Ana");
  // Hold back the server's answer to Bo, so his join is out but not yet answered.
  await bo.routeWebSocket(/\/api\/rooms\/[A-Z0-9]+\/ws$/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage(() => {});
  });
  await bo.goto(`/?room=${code}`);
  await bo.getByLabel("Your nickname").fill("Bo");
  const joinSent = bo.waitForEvent("websocket").then((socket) =>
    socket.waitForEvent("framesent", (frame) => frame.payload.includes('"join"')));
  await bo.getByRole("button", { name: "Join room" }).click();
  await joinSent;
  await bo.getByRole("button", { name: "Start a new room instead" }).click();
  await expect(bo.getByRole("heading", { name: "Sink the enemy fleet" })).toBeVisible();
  await joinRoom(cy, "Cy", code);
  await expect(cy.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
});

test("a join that is never answered gives up and keeps the code", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  const sent = [];
  await page.clock.install();
  await page.routeWebSocket(/\/api\/rooms\/[A-Z0-9]+\/ws$/, (ws) => {
    ws.onMessage((message) => sent.push(frameType(message)));
  });
  await page.goto("/?room=ABCDEF");
  await page.getByLabel("Your nickname").fill("Ana");
  await page.getByRole("button", { name: "Join room" }).click();
  await expect.poll(() => sent).toEqual(["join"]);
  await page.clock.runFor(15_000);
  await expect(page.getByRole("alert")).toContainText("Could not join room ABCDEF");
  await expect(page.getByLabel("Or join with a code")).toHaveValue("ABCDEF");
  // The join may still reach the room later: the player leaves, so it cannot hold a seat.
  await expect.poll(() => sent).toEqual(["join", "leave"]);
});

test("a room creation that never answers gives up", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.clock.install();
  await page.route("**/api/rooms", () => {});
  await page.goto("/");
  await page.getByLabel("Your nickname").fill("Ana");
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.getByRole("button", { name: "Creating…" })).toHaveAttribute("aria-disabled", "true");
  await page.clock.runFor(15_000);
  await expect(page.getByRole("alert")).toHaveText("Could not reach the server. Check your connection.");
  await expect(page.getByRole("button", { name: "Create a room" })).toHaveAttribute("aria-disabled", "false");
});

test("a seated player whose reconnect is never answered is told the connection was lost", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.clock.install();
  let first = null;
  const rejoins = [];
  await page.routeWebSocket(/\/api\/rooms\/[A-Z0-9]+\/ws$/, (ws) => {
    // The first socket really reaches the room; the reconnects are never answered.
    if (first === null) {
      first = ws;
      ws.connectToServer();
      return;
    }
    ws.onMessage((message) => rejoins.push(frameType(message)));
  });
  const code = await createRoom(page, "Ana");
  await first.close({ code: 1011, reason: "network drop" });
  await expect(page.locator("#connection-status")).toHaveText("Connection lost. Reconnecting…");
  await page.clock.runFor(1_000);
  await expect.poll(() => rejoins).toEqual(["join"]);
  await page.clock.runFor(15_000);
  await expect(page.getByRole("alert")).toHaveText("The connection to the room was lost.");
  await expect(page.getByLabel("Or join with a code")).toHaveValue(code);
});

test("a room that closes a seated player's socket without a word sends them home", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  let first = null;
  await page.routeWebSocket(/\/api\/rooms\/[A-Z0-9]+\/ws$/, (ws) => {
    first ??= ws;
    ws.connectToServer();
  });
  const code = await createRoom(page, "Ana");
  await first.close({ code: 1000, reason: "closed" });
  await expect(page.getByRole("alert")).toHaveText("The connection to the room was lost.");
  await expect(page.getByLabel("Or join with a code")).toHaveValue(code);
  await expect(page.getByRole("button", { name: "Create a room" })).toHaveAttribute("aria-disabled", "false");
});

test("a room that drops every socket before answering is given up on", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.clock.install();
  let sockets = 0;
  await page.routeWebSocket(/\/api\/rooms\/[A-Z0-9]+\/ws$/, (ws) => {
    sockets += 1;
    ws.onMessage(() => ws.close({ code: 1011, reason: "dropped" }));
  });
  await page.goto("/?room=ABCDEF");
  await page.getByLabel("Your nickname").fill("Ana");
  await page.getByRole("button", { name: "Join room" }).click();
  await expect.poll(() => sockets).toBeGreaterThan(0);
  const alert = page.getByRole("alert");
  // One backoff step at a time: advance the clock, then wait for that retry's socket.
  for (let step = 0; step < 20 && !(await alert.isVisible()); step += 1) {
    const seen = sockets;
    await page.clock.runFor(10_000);
    await expect.poll(async () => sockets > seen || (await alert.isVisible())).toBe(true);
  }
  await expect(alert).toContainText("Could not join room ABCDEF");
  expect(sockets).toBeLessThanOrEqual(13);
});

test("a room that closes before answering the join sends the player home with the code", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.routeWebSocket(/\/api\/rooms\/[A-Z0-9]+\/ws$/, (ws) => {
    ws.onMessage(() => ws.close({ code: 1000, reason: "closed" }));
  });
  await page.goto("/?room=ABCDEF");
  await page.getByLabel("Your nickname").fill("Ana");
  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not join room ABCDEF");
  await expect(page.getByLabel("Or join with a code")).toHaveValue("ABCDEF");
  await expect(page.getByRole("button", { name: "Create a room" })).toBeEnabled();
});

test("after leaving a joined room, Enter starts a new room instead of rejoining", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const bo = await newPlayer(browser, testInfo);
  const code = await createRoom(ana, "Ana");
  await bo.goto(`/?room=${code}`);
  await bo.getByLabel("Your nickname").fill("Bo");
  await bo.getByRole("button", { name: "Join room" }).click();
  await expect(bo.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  await bo.getByRole("button", { name: "Leave room" }).first().click();
  await expect(bo.getByLabel("Or join with a code")).toHaveValue("");
  await bo.getByLabel("Your nickname").press("Enter");
  await expect(bo.getByRole("heading", { name: "Waiting for an opponent" })).toBeVisible();
  await expect(bo.locator("#lobby-code")).not.toHaveText(code);
});

test("a second tap on Share while the sheet is open changes nothing", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo, { permissions: ["clipboard-read", "clipboard-write"] });
  await ana.addInitScript(() => {
    navigator.share = () => {
      window.shareCalls = (window.shareCalls ?? 0) + 1;
      // The first sheet stays open; browsers reject a second share while one is pending.
      return window.shareCalls === 1
        ? new Promise(() => {})
        : Promise.reject(new DOMException("An earlier share has not yet completed.", "InvalidStateError"));
    };
  });
  const code = await createRoom(ana, "Ana");
  await ana.getByRole("button", { name: "Copy code" }).click();
  await expect(ana.getByText("Room code copied.")).toBeVisible();
  await ana.getByRole("button", { name: "Share invite" }).click();
  await ana.getByRole("button", { name: "Share invite" }).click();
  await expect.poll(() => ana.evaluate(() => window.shareCalls)).toBe(2);
  await ana.waitForTimeout(300);
  expect(await ana.evaluate(() => navigator.clipboard.readText())).toBe(code);
});

test("Enter joins when a code is already typed", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const bo = await newPlayer(browser, testInfo);
  const code = await createRoom(ana, "Ana");
  await bo.goto("/");
  await bo.getByLabel("Or join with a code").fill(code);
  await bo.getByLabel("Your nickname").fill("Bo");
  await bo.getByLabel("Your nickname").press("Enter");
  await expect(bo.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
});

test("a failed join keeps the code ready for another try", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.goto("/?room=ZZZZZZ");
  await page.getByLabel("Your nickname").fill("Ana");
  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not join room ZZZZZZ");
  await expect(page.getByLabel("Or join with a code")).toHaveValue("ZZZZZZ");
});
