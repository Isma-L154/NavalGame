import { expect, test } from "@playwright/test";
import { battleOrder, cell, createRoom, joinRoom, newPlayer, placeRowFleet, watchConsole } from "./helpers.js";

const PLACEMENT = "Your waters. Place your fleet";

async function placementScreen(browser, testInfo, options = {}) {
  const ana = await newPlayer(browser, testInfo, options);
  const bo = await newPlayer(browser, testInfo, options);
  const code = await createRoom(ana, "Ana");
  await joinRoom(bo, "Bo", code);
  await expect(ana.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  return { ana, bo };
}

const ship = (page, kind) => page.locator(`#placement-grid .ship[data-kind="${kind}"]`);

async function centerOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test("placed ships are drawn as ships on the grid", async ({ browser }, testInfo) => {
  const { ana } = await placementScreen(browser, testInfo);
  const problems = watchConsole(ana);
  await cell(ana, PLACEMENT, "A1").click();
  await expect(ship(ana, "carrier")).toBeVisible();
  await expect(ship(ana, "carrier")).not.toHaveClass(/is-vertical/);
  await ana.getByRole("button", { name: "Random" }).click();
  await expect(ana.locator("#placement-grid .ship")).toHaveCount(5);
  expect(problems).toEqual([]);
});

test("a placed ship is selected with a click and turned with a second one", async ({ browser }, testInfo) => {
  const { ana } = await placementScreen(browser, testInfo);
  await cell(ana, PLACEMENT, "A1").click();
  await expect(cell(ana, PLACEMENT, "A5")).toHaveAttribute("aria-label", "A5, Carrier");
  await cell(ana, PLACEMENT, "A3").click();
  await expect(cell(ana, PLACEMENT, "A3")).toHaveAttribute("aria-label", "A3, Carrier, selected");
  await expect(ship(ana, "carrier")).toHaveClass(/is-selected/);
  await cell(ana, PLACEMENT, "A3").click();
  await expect(ship(ana, "carrier")).toHaveClass(/is-vertical/);
  await expect(cell(ana, PLACEMENT, "E1")).toHaveAttribute("aria-label", "E1, Carrier, selected");
  await expect(cell(ana, PLACEMENT, "A5")).toHaveAttribute("aria-label", "A5, water");
  // A selected ship moves to the water cell chosen next, keeping its orientation.
  await cell(ana, PLACEMENT, "B4").click();
  await expect(cell(ana, PLACEMENT, "F4")).toHaveAttribute("aria-label", "F4, Carrier, selected");
  await expect(cell(ana, PLACEMENT, "A1")).toHaveAttribute("aria-label", "A1, water");
});

test("ships can be dragged from the dock and around the grid", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "mouse dragging; touch uses the same pointer events");
  const { ana } = await placementScreen(browser, testInfo);
  // Held by the middle of its drawing, the carrier lands centred on the drop cell.
  const dockCarrier = ana.getByRole("button", { name: /Carrier/ }).locator(".ship-dock-art");
  await drag(ana, await centerOf(dockCarrier), await centerOf(cell(ana, PLACEMENT, "D5")));
  await expect(cell(ana, PLACEMENT, "D3")).toHaveAttribute("aria-label", /^D3, Carrier/);
  await expect(cell(ana, PLACEMENT, "D7")).toHaveAttribute("aria-label", /^D7, Carrier/);
  // Dragged by its first cell, the carrier moves so that cell lands where it is dropped.
  await drag(ana, await centerOf(cell(ana, PLACEMENT, "D3")), await centerOf(cell(ana, PLACEMENT, "H2")));
  await expect(cell(ana, PLACEMENT, "H2")).toHaveAttribute("aria-label", /^H2, Carrier/);
  await expect(cell(ana, PLACEMENT, "H6")).toHaveAttribute("aria-label", /^H6, Carrier/);
  await expect(cell(ana, PLACEMENT, "D3")).toHaveAttribute("aria-label", "D3, water");
  // A drop where the ship does not fit leaves it where it was.
  await drag(ana, await centerOf(cell(ana, PLACEMENT, "H2")), await centerOf(cell(ana, PLACEMENT, "J9")));
  await expect(cell(ana, PLACEMENT, "H2")).toHaveAttribute("aria-label", /^H2, Carrier/);
});

test("the newest shot is marked for its animation on both boards", async ({ browser }, testInfo) => {
  const { ana, bo } = await placementScreen(browser, testInfo);
  await placeRowFleet(ana);
  await placeRowFleet(bo);
  const [shooter, target] = await battleOrder(ana, bo);
  await cell(shooter, "Enemy waters", "A1").click();
  await expect(cell(shooter, "Enemy waters", "A1")).toHaveClass(/is-new/);
  await expect(cell(shooter, "Enemy waters", "A1")).toHaveClass(/state-hit/);
  await expect(cell(target, "Your fleet", "A1")).toHaveClass(/is-new/);
  // The own board draws the fleet as ships.
  await expect(target.locator("#own-grid .ship")).toHaveCount(5);
});

test("with reduced motion, shots show their final mark at once", async ({ browser }, testInfo) => {
  const { ana, bo } = await placementScreen(browser, testInfo, { reducedMotion: "reduce" });
  await placeRowFleet(ana);
  await placeRowFleet(bo);
  const [shooter] = await battleOrder(ana, bo);
  await cell(shooter, "Enemy waters", "J10").click();
  const target = cell(shooter, "Enemy waters", "J10");
  await expect(target).toHaveClass(/state-miss/);
  const duration = await target.evaluate((node) => getComputedStyle(node, "::before").animationDuration);
  expect(Number.parseFloat(duration)).toBeLessThan(0.01);
});
