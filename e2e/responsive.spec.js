import { expect, test } from "@playwright/test";
import { newPlayer, placeRowFleet } from "./helpers.js";

// Phones upright and on their side, tablets both ways, a laptop.
const VIEWPORTS = [
  { name: "small phone", width: 320, height: 568 },
  { name: "phone", width: 390, height: 844 },
  { name: "phone on its side", width: 844, height: 390 },
  { name: "small phone on its side", width: 667, height: 375 },
  { name: "tablet upright", width: 768, height: 1024 },
  { name: "tablet on its side", width: 1024, height: 768 },
  { name: "laptop", width: 1366, height: 768 },
];

const overflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const viewport of VIEWPORTS) {
  test(`every screen fits a ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "sets its own viewports");
    const size = { width: viewport.width, height: viewport.height };
    const ana = await newPlayer(browser, testInfo, { viewport: size });
    const bo = await newPlayer(browser, testInfo, { viewport: size });

    await ana.goto("/");
    expect(await overflow(ana)).toBe(0);
    await ana.getByLabel("Your nickname").fill("Ana");
    await ana.getByRole("button", { name: "Create a room" }).click();
    await expect(ana.getByRole("heading", { name: "Waiting for an opponent" })).toBeVisible();
    expect(await overflow(ana)).toBe(0);

    const code = (await ana.locator("#lobby-code").textContent()).trim();
    await bo.goto(`/?room=${code}`);
    expect(await overflow(bo)).toBe(0);
    await bo.getByLabel("Your nickname").fill("Bo");
    await bo.getByRole("button", { name: "Join room" }).click();
    await expect(bo.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
    expect(await overflow(bo)).toBe(0);
    // On a phone on its side the ship dock sits beside the board, so ships can be dragged across.
    if (viewport.height <= 500) {
      const board = await bo.locator("#placement-grid .board").boundingBox();
      const dock = await bo.locator("#ship-list").boundingBox();
      expect(dock.x).toBeGreaterThanOrEqual(board.x + board.width);
    }

    await placeRowFleet(ana);
    await placeRowFleet(bo);
    await expect(ana.locator("#turn-banner")).toBeVisible();
    expect(await overflow(ana)).toBe(0);

    // Each board fits the screen whole, so it can be seen at once.
    for (const id of ["target-grid", "own-grid"]) {
      const box = await ana.locator(`#${id} .board`).boundingBox();
      expect(box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.height).toBeLessThanOrEqual(viewport.height);
    }
    // From tablets up, the two boards sit side by side.
    if (viewport.width >= 720) {
      const enemy = await ana.locator("#target-grid .board").boundingBox();
      const own = await ana.locator("#own-grid .board").boundingBox();
      expect(own.x).toBeGreaterThanOrEqual(enemy.x + enemy.width);
    }
  });
}

test("a tap on a touch screen leaves no hover highlight behind", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sets its own touch emulation");
  const page = await newPlayer(browser, testInfo, {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await page.goto("/");
  expect(await page.evaluate(() => matchMedia("(any-hover: hover)").matches)).toBe(false);
  const toggle = page.getByRole("button", { name: "Dark mode" });
  await toggle.tap();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  // The tapped button keeps its own colours, not the yellow of a hover.
  const background = await toggle.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(background).not.toBe("rgb(244, 194, 13)");
});

test("on a phone on its side the top bar scrolls away with the page", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sets its own viewport");
  const page = await newPlayer(browser, testInfo, { viewport: { width: 844, height: 390 } });
  await page.goto("/");
  expect(await page.locator(".topbar").evaluate((node) => getComputedStyle(node).position)).toBe("static");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator(".topbar").evaluate((node) => getComputedStyle(node).position)).toBe("sticky");
});
