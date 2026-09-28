import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, newPlayer } from "./helpers.js";

test("the theme follows the system until the player picks one", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo, { colorScheme: "dark" });
  await page.goto("/");
  const html = page.locator("html");
  const toggle = page.getByRole("button", { name: "Dark mode" });
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.goto("/terms");
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: "Dark mode" }).click();
  await page.goto("/");
  await expect(html).toHaveAttribute("data-theme", "dark");
});

test("light is the default when the system prefers light", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo, { colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("button", { name: "Dark mode" })).toHaveAttribute("aria-pressed", "false");
});

test("a picked theme is not overridden by a later system change", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo, { colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("button", { name: "Dark mode" }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("without a picked theme, a system change is followed live", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo, { colorScheme: "light" });
  await page.goto("/");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("hovered buttons keep readable text in dark mode", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "hover does not apply to touch screens");
  const page = await newPlayer(browser, testInfo, { colorScheme: "dark" });
  await page.goto("/");
  await page.getByLabel("Your nickname").fill("Ana");
  await page.getByRole("button", { name: "Create a room" }).click();
  const leave = page.getByRole("button", { name: "Leave room" }).first();
  await leave.hover();
  // The dark theme's ink (#f2efe7), not the near-black used on signal fills.
  await expect(leave).toHaveCSS("color", "rgb(242, 239, 231)");
  // Ghost buttons never grow a frame on hover.
  await expect(leave).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
});

test("borders on yellow stay dark in dark mode", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo, { colorScheme: "dark" });
  const bo = await newPlayer(browser, testInfo, { colorScheme: "dark" });
  const code = await createRoom(ana, "Ana");
  await joinRoom(bo, "Bo", code);
  for (const player of [ana, bo]) {
    await player.getByRole("button", { name: "Random" }).click();
    await player.getByRole("button", { name: "Ready" }).click();
  }
  await expect(ana.locator("#turn-banner")).toBeVisible();
  const shooter = (await ana.locator("#turn-banner").textContent()).startsWith("Your turn") ? ana : bo;
  await expect(shooter.locator("#turn-banner")).toHaveCSS("border-top-color", "rgb(17, 17, 17)");
  const other = shooter === ana ? bo : ana;
  await other.getByRole("button", { name: "Leave room" }).last().click();
  await expect(shooter.locator("#result-panel")).toHaveCSS("border-top-color", "rgb(17, 17, 17)");
  const leave = shooter.getByRole("button", { name: "Leave room" }).first();
  await expect(leave).toHaveCSS("border-top-color", "rgb(17, 17, 17)");
  await leave.focus();
  await shooter.keyboard.press("Shift+Tab");
  await shooter.keyboard.press("Tab");
  await expect(leave).toHaveCSS("outline-color", "rgb(17, 17, 17)");
  await expect(other.locator("h1, h2").filter({ hasText: "Sink the enemy fleet" })).toBeVisible();
});

test("a theme picked in one tab applies to the other open tabs", async ({ browser }, testInfo) => {
  const first = await newPlayer(browser, testInfo, { colorScheme: "light" });
  const second = await first.context().newPage();
  await first.goto("/");
  await second.goto("/terms");
  await first.getByRole("button", { name: "Dark mode" }).click();
  await expect(second.locator("html")).toHaveAttribute("data-theme", "dark");
  await second.emulateMedia({ colorScheme: "light" });
  await expect(second.locator("html")).toHaveAttribute("data-theme", "dark");
});
