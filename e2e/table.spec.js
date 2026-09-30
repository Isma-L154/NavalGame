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

/** The table's view as written by the camera; empty strings mean the default view. */
const viewOf = (page, gridId) =>
  page.locator(`#${gridId} .board-table`).evaluate((node) => ({
    turn: node.style.getPropertyValue("--turn"),
    tilt: node.style.getPropertyValue("--tilt"),
  }));

async function centerOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A mouse drag that starts on `from` and moves by (dx, dy). */
async function dragBy(page, from, dx, dy) {
  const { x, y } = await centerOf(from);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

/** A mouse drag from the centre of one element to the centre of another. */
async function dragTo(page, from, to) {
  const start = await centerOf(from);
  const end = await centerOf(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y + 10, { steps: 3 });
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

/** A game against the CPU in battle, on the player's turn. */
async function battleVsCpu(browser, testInfo, options = {}) {
  const { page, problems } = await placementVsCpu(browser, testInfo, options);
  await page.getByRole("button", { name: "Random" }).click();
  await page.getByRole("button", { name: "Ready" }).click();
  await expect(page.locator("#turn-banner")).toHaveText(/^Your turn/);
  // Reaching Ready scrolled the page, and the battle keeps that scroll: the drags below use
  // raw mouse positions, so start from the top, where the whole battle is in view.
  await page.evaluate(() => window.scrollTo(0, 0));
  return { page, problems };
}

const overflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("dragging the enemy board turns it without firing, and a click still fires", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "turning needs a mouse");
  const { page, problems } = await battleVsCpu(browser, testInfo);
  await expect(page.locator(".legend .board-hint")).toBeVisible();
  const target = cell(page, "Enemy waters", "E5");
  await dragBy(page, target, 150, 0);
  expect((await viewOf(page, "target-grid")).turn).not.toBe("");
  await expect(target).toHaveAttribute("aria-label", "E5, not fired at");
  await expect(page.locator("#shot-log")).not.toContainText("You fired");
  await target.click();
  await expect(page.locator("#shot-log")).toContainText("You fired at E5");
  expect(problems).toEqual([]);
});

test("a turn stops at its limits and a double-click off the grid resets it", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "turning needs a mouse");
  const { page } = await battleVsCpu(browser, testInfo);
  await dragBy(page, cell(page, "Enemy waters", "E5"), 400, -300);
  expect(await viewOf(page, "target-grid")).toEqual({ turn: "40deg", tilt: "60deg" });
  await dragBy(page, cell(page, "Enemy waters", "E5"), -250, 250);
  expect(await viewOf(page, "target-grid")).toEqual({ turn: "-40deg", tilt: "10deg" });
  // A double-click on a cell would fire, so only one off the grid resets the view.
  await page.locator("#target-grid .row-label").first().dblclick();
  expect(await viewOf(page, "target-grid")).toEqual({ turn: "", tilt: "" });
});

test("on a turnable board a ship still drags, and dragging water turns the board", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "turning needs a mouse");
  const { page } = await placementVsCpu(browser, testInfo);
  await expect(page.locator("#screen-placement .board-hint")).toBeVisible();
  await cell(page, PLACEMENT, "A1").click();
  await dragTo(page, cell(page, PLACEMENT, "A3"), cell(page, PLACEMENT, "F3"));
  await expect(cell(page, PLACEMENT, "F1")).toHaveAttribute("aria-label", /^F1, Carrier/);
  expect((await viewOf(page, "placement-grid")).turn).toBe("");
  await dragBy(page, cell(page, PLACEMENT, "J10"), -150, 0);
  expect((await viewOf(page, "placement-grid")).turn).not.toBe("");
  // The drag placed nothing: the battleship, selected next, is still in the dock.
  await expect(page.locator("#placement-grid .ship")).toHaveCount(1);
  await expect(cell(page, PLACEMENT, "F1")).toHaveAttribute("aria-label", /^F1, Carrier/);
});

test("a touch drag never turns the board, and touch screens get a gentler lean", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "touch screens");
  const { page } = await placementVsCpu(browser, testInfo);
  await expect(page.locator("#screen-placement .board-hint")).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tilt").trim()))
    .toBe("25deg");
  const { x, y } = await centerOf(cell(page, PLACEMENT, "J5"));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + step * 12, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect((await viewOf(page, "placement-grid")).turn).toBe("");
});

test("a fully turned board stays inside its place", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "turning needs a mouse");
  // Tablet width: the narrowest layout with the two boards side by side.
  const { page } = await battleVsCpu(browser, testInfo, { viewport: { width: 768, height: 1024 } });
  // 100px turns a board the full 40 degrees and keeps the pointer inside the 768px viewport.
  await dragBy(page, cell(page, "Your fleet", "E5"), 100, -100);
  await dragBy(page, cell(page, "Enemy waters", "E5"), -100, -100);
  expect(await viewOf(page, "own-grid")).toEqual({ turn: "40deg", tilt: "60deg" });
  expect(await viewOf(page, "target-grid")).toEqual({ turn: "-40deg", tilt: "60deg" });
  expect(await overflow(page)).toBe(0);
  const enemy = await page.locator("#target-grid .board").boundingBox();
  const own = await page.locator("#own-grid .board").boundingBox();
  expect(own.x).toBeGreaterThanOrEqual(enemy.x + enemy.width);
});
