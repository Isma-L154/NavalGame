import { expect, test } from "@playwright/test";
import { newPlayer, watchConsole } from "./helpers.js";

// Both screens have a picker in the page; each helper talks to the one on screen.
const picker = (page, id) => page.locator(`#${id}`);

async function pickFlag(page, id, name) {
  await picker(page, id).getByText("Your flag", { exact: true }).click();
  await picker(page, id).getByRole("radio", { name }).check();
}

const pickHomeFlag = (page, name) => pickFlag(page, "home-flag", name);

async function openRoom(page, nickname, flag) {
  await page.goto("/");
  await page.getByLabel("Your nickname").fill(nickname);
  if (flag) await pickHomeFlag(page, flag);
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for an opponent" })).toBeVisible();
  return (await page.locator("#lobby-code").textContent()).trim();
}

async function joinWithFlag(page, nickname, code, flag) {
  await page.goto(`/?room=${code}`);
  await page.getByLabel("Your nickname").fill(nickname);
  if (flag) await pickHomeFlag(page, flag);
  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
}

test("each player flies the flag picked at home", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const bo = await newPlayer(browser, testInfo);
  const problems = [ana, bo].map(watchConsole);
  const code = await openRoom(ana, "Ana", "Kilo");
  await joinWithFlag(bo, "Bo", code);
  await expect(bo.locator("#placement-opponent")).toContainText("Ana (Kilo)");
  await expect(ana.locator("#placement-opponent")).toContainText("Bo (Bravo)");
  await expect(bo.locator("#placement-flag-note")).toBeHidden();
  expect(problems.flat()).toEqual([]);
});

test("asking for the opponent's flag gets another one, and says so", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const bo = await newPlayer(browser, testInfo);
  const code = await openRoom(ana, "Ana", "Kilo");
  await joinWithFlag(bo, "Bo", code, "Kilo");
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
  const code = await openRoom(ana, "Ana", "Kilo");
  await joinWithFlag(bo, "Bo", code);
  await pickFlag(bo, "placement-flag", "Zulu");
  await expect(ana.locator("#placement-opponent")).toContainText("Bo (Zulu)");
  for (const page of [ana, bo]) {
    await page.getByRole("button", { name: "Random" }).click();
    await page.getByRole("button", { name: "Ready" }).click();
  }
  await expect(ana.getByRole("img", { name: "Bo's flag, Zulu" })).toBeVisible();
  await expect(ana.getByRole("img", { name: "Ana's flag, Kilo" })).toBeVisible();
});

test("the home flag follows the nickname until the player picks one", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.goto("/");
  await page.getByLabel("Your nickname").fill("Mia");
  await expect(picker(page, "home-flag").locator(".flag-picker-current")).toHaveText("Mike");
  await pickHomeFlag(page, "Tango");
  await page.getByLabel("Your nickname").fill("Zed");
  await expect(picker(page, "home-flag").locator(".flag-picker-current")).toHaveText("Tango");
  await page.reload();
  await expect(picker(page, "home-flag").locator(".flag-picker-current")).toHaveText("Tango");
});
