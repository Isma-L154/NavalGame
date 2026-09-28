import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom } from "./helpers.js";

async function expectNoViolations(page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
}

test("every screen passes an automated WCAG AA check", async ({ browser }) => {
  const ana = await (await browser.newContext()).newPage();
  const bo = await (await browser.newContext()).newPage();
  await ana.goto("/");
  await expectNoViolations(ana);
  const code = await createRoom(ana, "Ana");
  await expectNoViolations(ana);
  await joinRoom(bo, "Bo", code);
  await expect(bo.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  await expectNoViolations(bo);
  await bo.getByRole("button", { name: "Random" }).click();
  await bo.getByRole("button", { name: "Ready" }).click();
  await ana.getByRole("button", { name: "Random" }).click();
  await ana.getByRole("button", { name: "Ready" }).click();
  await expect(ana.locator("#turn-banner")).toBeVisible();
  await expectNoViolations(ana);
});

test("a whole turn can be played with the keyboard only", async ({ browser }) => {
  const ana = await (await browser.newContext()).newPage();
  const bo = await (await browser.newContext()).newPage();
  const code = await createRoom(ana, "Ana");
  await joinRoom(bo, "Bo", code);
  await expect(ana.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();

  // Place every ship with arrows + Enter: the next ship is selected automatically.
  const grid = ana.getByRole("grid", { name: "Your waters. Place your fleet" });
  await grid.getByRole("button", { name: /^A1,/ }).focus();
  for (let ship = 0; ship < 5; ship += 1) {
    await ana.keyboard.press("Enter");
    await ana.keyboard.press("ArrowDown");
  }
  await expect(ana.locator("#ready")).toBeEnabled();
  await ana.locator("#ready").focus();
  await ana.keyboard.press("Enter");
  await bo.getByRole("button", { name: "Random" }).click();
  await bo.getByRole("button", { name: "Ready" }).click();

  await expect(ana.locator("#turn-banner")).toBeVisible();
  const shooter = (await ana.locator("#turn-banner").textContent()).startsWith("Your turn") ? ana : bo;
  const target = shooter.getByRole("grid", { name: "Enemy waters" });
  await target.getByRole("button", { name: /^A1,/ }).focus();
  await shooter.keyboard.press("ArrowRight");
  await shooter.keyboard.press("ArrowDown");
  await shooter.keyboard.press("Enter");
  await expect(target.getByRole("button", { name: /^B2,/ })).not.toHaveAttribute("aria-label", "B2, not fired at");
});
