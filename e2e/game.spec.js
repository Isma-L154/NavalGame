import { expect, test } from "@playwright/test";
import {
  FLEET_CELLS,
  MISS_CELLS,
  cell,
  createRoom,
  joinRoom,
  placeRowFleet,
  watchConsole,
  newPlayer,
} from "./helpers.js";

test("two players play a full game and can ask for a rematch", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const bo = await newPlayer(browser, testInfo);
  const problems = [...[ana, bo].map(watchConsole)];

  const code = await createRoom(ana, "Ana");
  await joinRoom(bo, "Bo", code);
  await placeRowFleet(ana);
  await placeRowFleet(bo);

  await expect(ana.locator("#turn-banner")).toBeVisible();
  const anaStarts = (await ana.locator("#turn-banner").textContent()).startsWith("Your turn");
  const [winner, loser] = anaStarts ? [ana, bo] : [bo, ana];
  const misses = [...MISS_CELLS];
  for (const [index, target] of FLEET_CELLS.entries()) {
    await expect(winner.locator("#turn-banner")).toHaveText(/^Your turn/);
    await cell(winner, "Enemy waters", target).click();
    if (index === FLEET_CELLS.length - 1) break;
    await expect(loser.locator("#turn-banner")).toHaveText(/^Your turn/);
    await cell(loser, "Enemy waters", misses.shift()).click();
  }

  await expect(winner.getByRole("heading", { name: "Victory" })).toBeVisible();
  await expect(loser.getByRole("heading", { name: "Defeat" })).toBeVisible();
  await expect(loser.getByRole("grid", { name: "Enemy waters" }).getByRole("button", { name: /unhit/ }).first()).toBeVisible();
  await expect(winner.locator("#shot-log li").first()).toContainText("sank the destroyer");

  if (testInfo.project.name === "desktop") {
    await winner.getByRole("button", { name: "Rematch" }).hover();
    await expect(winner.getByRole("button", { name: "Rematch" })).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
  }
  await winner.getByRole("button", { name: "Rematch" }).click();
  // A requested rematch must look disabled, not just be disabled.
  await expect(winner.getByRole("button", { name: "Rematch" })).toBeDisabled();
  await expect(winner.getByRole("button", { name: "Rematch" })).toHaveCSS("border-top-style", "dashed");
  await expect(loser.locator("#rematch-status")).toContainText("wants a rematch");
  await loser.getByRole("button", { name: "Rematch" }).click();
  await expect(ana.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  await expect(bo.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();

  expect(problems.flat()).toEqual([]);
});
