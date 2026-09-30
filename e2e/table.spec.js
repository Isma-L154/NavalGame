import { expect, test } from "@playwright/test";
import { cell, newPlayer, openHome, watchConsole } from "./helpers.js";

const PLACEMENT = "Your waters. Place your fleet";

/** A game against the CPU, on the placement screen: one browser is enough. */
async function placementVsCpu(browser, testInfo, options = {}) {
  const page = await newPlayer(browser, testInfo, options);
  const problems = watchConsole(page);
  await openHome(page, "Ana");
  await page.getByRole("button", { name: "Play vs CPU" }).click();
  await expect(page.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  // The pointer is left where the home button was; keep it off the board so no cell is hovered.
  await page.mouse.move(0, 0);
  return { page, problems };
}

test("the board is a table leaning back over a pale sea", async ({ browser }, testInfo) => {
  const { page, problems } = await placementVsCpu(browser, testInfo);
  const table = page.locator("#placement-grid .board-table");
  expect(await table.evaluate((node) => getComputedStyle(node).transform)).toMatch(/^matrix3d\(/);
  await expect(cell(page, PLACEMENT, "J10")).toHaveCSS("background-color", "rgb(220, 231, 242)");
  // Still one grid of buttons for keyboards and screen readers.
  await expect(page.getByRole("grid", { name: PLACEMENT }).getByRole("button")).toHaveCount(100);
  // The night sea of the dark theme.
  await page.locator("#theme-toggle").click();
  await expect(cell(page, PLACEMENT, "J10")).toHaveCSS("background-color", "rgb(16, 35, 59)");
  expect(problems).toEqual([]);
});
