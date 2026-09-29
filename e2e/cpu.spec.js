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
