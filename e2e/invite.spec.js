import { expect, test } from "@playwright/test";
import { createRoom, newPlayer, watchConsole } from "./helpers.js";

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
      throw new DOMException("share", window.shareOutcome);
    };
  });
  const code = await createRoom(ana, "Ana");
  await ana.getByRole("button", { name: "Share invite" }).click();
  await expect(ana.locator("#copy-feedback")).toHaveText("");
  await ana.evaluate(() => {
    window.shareOutcome = "NotAllowedError";
  });
  await ana.getByRole("button", { name: "Share invite" }).click();
  await expect(ana.getByText("Invite link copied.")).toBeVisible();
  expect(await ana.evaluate(() => navigator.clipboard.readText())).toContain(`/?room=${code}`);
});

test("pressing Enter twice creates a single room", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  let creations = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/rooms")) creations += 1;
  });
  await page.goto("/");
  await page.getByLabel("Your nickname").fill("Ana");
  await page.getByLabel("Your nickname").press("Enter");
  await page.getByLabel("Your nickname").press("Enter");
  await expect(page.getByRole("heading", { name: "Waiting for an opponent" })).toBeVisible();
  expect(creations).toBe(1);
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
