import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { newPlayer } from "./helpers.js";

test("the footer leads to the terms and shows the contact address", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: "info@cloudils.com" })).toHaveAttribute(
    "href",
    "mailto:info@cloudils.com",
  );
  await expect(footer.getByRole("link", { name: /source code/i })).toHaveCount(0);
  await footer.getByRole("link", { name: "Terms and conditions" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Terms and conditions" })).toBeVisible();
  await expect(page).toHaveURL(/\/terms$/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole("link", { name: "Back to the game" }).click();
  await expect(page.getByRole("heading", { name: "Sink the enemy fleet" })).toBeVisible();
});
