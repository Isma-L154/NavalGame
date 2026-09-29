import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, newPlayer, pickFlag, watchConsole } from "./helpers.js";

// Both screens have a picker in the page; each check looks at the one on screen.
const picker = (page, id) => page.locator(`#${id}`);

test("each player flies the flag picked at home", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const bo = await newPlayer(browser, testInfo);
  const problems = [ana, bo].map(watchConsole);
  const code = await createRoom(ana, "Ana", { flag: "Kilo" });
  await joinRoom(bo, "Bo", code);
  await expect(bo.locator("#placement-opponent")).toContainText("Ana (Kilo)");
  await expect(ana.locator("#placement-opponent")).toContainText("Bo (Bravo)");
  await expect(bo.locator("#placement-flag-note")).toHaveText("");
  expect(problems.flat()).toEqual([]);
});

test("asking for the opponent's flag gets another one, and says so", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const bo = await newPlayer(browser, testInfo);
  const code = await createRoom(ana, "Ana", { flag: "Kilo" });
  await joinRoom(bo, "Bo", code, { flag: "Kilo" });
  await expect(bo.locator("#placement-flag-note")).toHaveText(
    "Your opponent already flies Kilo, so you fly Alfa. You can change it.",
  );
  await expect(ana.locator("#placement-opponent")).toContainText("Bo (Alfa)");
  await picker(bo, "placement-flag").getByText("Your flag", { exact: true }).click();
  await expect(picker(bo, "placement-flag").getByRole("radio", { name: "Kilo" })).toBeDisabled();
});

test("a flag changed while placing ships reaches the opponent and the battle", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const bo = await newPlayer(browser, testInfo);
  const problems = [ana, bo].map(watchConsole);
  const code = await createRoom(ana, "Ana", { flag: "Kilo" });
  await joinRoom(bo, "Bo", code);
  await expect(bo.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  await pickFlag(bo, "placement-flag", "Zulu");
  await expect(ana.locator("#placement-opponent")).toContainText("Bo (Zulu)");
  for (const page of [ana, bo]) {
    await page.getByRole("button", { name: "Random" }).click();
    await page.getByRole("button", { name: "Ready" }).click();
  }
  await expect(ana.getByRole("img", { name: "Bo's flag, Zulu" })).toBeVisible();
  await expect(ana.getByRole("img", { name: "Ana's flag, Kilo" })).toBeVisible();
  expect(problems.flat()).toEqual([]);
});

test("the home flag follows the nickname until the player picks one", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.goto("/");
  await page.getByLabel("Your nickname").fill("Mia");
  await expect(picker(page, "home-flag").locator(".flag-picker-current")).toHaveText("Mike");
  await pickFlag(page, "home-flag", "Tango");
  await page.getByLabel("Your nickname").fill("Zed");
  await expect(picker(page, "home-flag").locator(".flag-picker-current")).toHaveText("Tango");
  await page.reload();
  await expect(picker(page, "home-flag").locator(".flag-picker-current")).toHaveText("Tango");
});
