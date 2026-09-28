import { expect, test } from "@playwright/test";
import { cell, createRoom, joinRoom, openHome, placeRowFleet, watchConsole, newPlayer } from "./helpers.js";

test("a player who reloads mid-game gets their seat and board back", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const bo = await newPlayer(browser, testInfo);
  const problems = [ana, bo].map(watchConsole);
  const code = await createRoom(ana, "Ana");
  await joinRoom(bo, "Bo", code);
  await placeRowFleet(ana);
  await placeRowFleet(bo);
  await expect(ana.locator("#turn-banner")).toBeVisible();

  const shooter = (await ana.locator("#turn-banner").textContent()).startsWith("Your turn") ? ana : bo;
  await cell(shooter, "Enemy waters", "A1").click();
  await expect(cell(shooter, "Enemy waters", "A1")).toHaveAttribute("aria-label", "A1, hit");

  await shooter.reload();
  await expect(shooter.locator("#turn-banner")).toBeVisible();
  await expect(cell(shooter, "Enemy waters", "A1")).toHaveAttribute("aria-label", "A1, hit");
  const other = shooter === ana ? bo : ana;
  await expect(other.locator("#turn-banner")).toHaveText(/^Your turn/);
  expect(problems.flat()).toEqual([]);
});

test("a third player is turned away from a full room", async ({ browser }, testInfo) => {
  const [ana, bo, cy] = await Promise.all(
    [0, 1, 2].map(async () => newPlayer(browser, testInfo)),
  );
  const code = await createRoom(ana, "Ana");
  await joinRoom(bo, "Bo", code);
  await expect(bo.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  await joinRoom(cy, "Cy", code);
  await expect(cy.getByRole("alert")).toHaveText("This room already has two players.");
  await expect(cy.getByRole("heading", { name: "Sink the enemy fleet" })).toBeVisible();
});

test("an unknown room code sends the player back home", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await joinRoom(page, "Ana", "ZZZZZZ");
  await expect(page.getByRole("alert")).toContainText("Could not join room ZZZZZZ");
});

test("invalid nickname and code are explained before connecting", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await openHome(page, " spaced");
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.getByRole("alert")).toContainText("Choose a nickname");
  await page.getByLabel("Your nickname").fill("Ana");
  await page.getByLabel("Or join with a code").fill("abc0");
  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page.getByRole("alert")).toContainText("Room codes have 6 characters");
});

test("leaving the lobby returns home", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await createRoom(page, "Ana");
  await page.getByRole("button", { name: "Leave room" }).first().click();
  await expect(page.getByRole("heading", { name: "Sink the enemy fleet" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("an expired seat token falls back to joining as a new player", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const code = await createRoom(ana, "Ana");
  const bo = await newPlayer(browser, testInfo);
  await bo.goto("/");
  await bo.evaluate((room) => {
    localStorage.setItem("naval.nickname", "Bo");
    sessionStorage.setItem(`naval.token.${room}`, "x".repeat(43));
  }, code);
  await bo.goto(`/?room=${code}`);
  await expect(bo.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
});
