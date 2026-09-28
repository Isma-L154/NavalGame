import { expect, test } from "@playwright/test";
import { newPlayer } from "./helpers.js";

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
