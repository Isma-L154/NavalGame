import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { newPlayer, watchConsole } from "./helpers.js";

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

for (const colorScheme of ["light", "dark"]) {
  test(`an unknown address shows the not-found page (${colorScheme})`, async ({ browser }, testInfo) => {
    const page = await newPlayer(browser, testInfo, { colorScheme });
    const problems = watchConsole(page);
    const response = await page.goto("/no-such-page");
    expect(response.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Off the chart" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
    // The browser logs the page's own 404 status as an error; anything else is a real problem.
    expect(problems.filter((text) => !text.includes("status of 404"))).toEqual([]);
    await page.getByRole("link", { name: "Back to the game" }).click();
    await expect(page.getByRole("heading", { name: "Sink the enemy fleet" })).toBeVisible();
  });
}
