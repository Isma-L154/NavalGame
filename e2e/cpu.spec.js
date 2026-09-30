import { expect, test } from "@playwright/test";
import { cell, createRoom, joinRoom, newPlayer, openHome, watchConsole } from "./helpers.js";

/** Fires once if it is the player's turn, then waits for the CPU to answer. */
async function playUntilTheCpuFires(page) {
  const banner = page.locator("#turn-banner");
  await expect(banner).toBeVisible();
  if ((await banner.textContent()).startsWith("Your turn")) {
    await cell(page, "Enemy waters", "A1").click();
    await expect(banner).toHaveText("CPU is aiming…");
  }
  await expect(page.locator("#shot-log")).toContainText("CPU fired at");
  await expect(banner).toHaveText(/^Your turn/);
}

test("a player can play the CPU from the home screen", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  const problems = watchConsole(page);
  await openHome(page, "Ana");
  await page.getByRole("button", { name: "Play vs CPU" }).click();
  await expect(page.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  await expect(page.locator("#placement-opponent")).toContainText("CPU (Charlie) · fleet ready");
  await page.getByRole("button", { name: "Random" }).click();
  await page.getByRole("button", { name: "Ready" }).click();
  await playUntilTheCpuFires(page);
  expect(problems).toEqual([]);
});

test("a player waiting in the lobby can switch to the CPU", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const problems = watchConsole(ana);
  const code = await createRoom(ana, "Ana");
  await ana.getByRole("button", { name: "Play vs CPU instead" }).click();
  await expect(ana.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  await expect(ana.locator("#placement-opponent")).toContainText("CPU (Charlie)");
  // The friend room was left properly, so its seat is free for the friend who shows up late.
  const bo = await newPlayer(browser, testInfo);
  await joinRoom(bo, "Bo", code);
  await expect(bo.getByRole("heading", { name: "Waiting for an opponent" })).toBeVisible();
  expect(problems).toEqual([]);
});

test("an invite link offers no CPU game", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.goto("/?room=ABCDEF");
  await expect(page.getByRole("button", { name: "Join room" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play vs CPU" })).toBeHidden();
});

test("Play vs CPU is marked busy while the room is created", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.route("**/api/rooms", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.continue();
  });
  await openHome(page, "Ana");
  await page.getByRole("button", { name: "Play vs CPU" }).click();
  const starting = page.getByRole("button", { name: "Starting…" });
  await expect(starting).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("button", { name: "Create a room" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
});

test("the battle opens at the top of the page, with its turn banner in view", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sets its own viewport");
  const page = await newPlayer(browser, testInfo, { viewport: { width: 1280, height: 720 } });
  await openHome(page, "Ana");
  await page.getByRole("button", { name: "Play vs CPU" }).click();
  await expect(page.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  await page.getByRole("button", { name: "Random" }).click();
  // On a laptop screen Ready sits below the fold: reaching it scrolls the page down. Checked
  // before the click, since the battle (and its scroll to the top) can start right after it.
  const ready = page.getByRole("button", { name: "Ready" });
  await ready.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await ready.click();
  await expect(page.locator("#turn-banner")).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  // Later updates of the same screen leave the scroll where the player put it.
  await expect(page.locator("#turn-banner")).toHaveText(/^Your turn/);
  await page.evaluate(() => window.scrollTo(0, 200));
  await cell(page, "Enemy waters", "J10").click();
  await expect(page.locator("#shot-log")).toContainText("You fired at J10");
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});
