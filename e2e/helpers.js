import { expect } from "@playwright/test";

/** The accessible name of the grid on the placement screen. */
export const PLACEMENT = "Your waters. Place your fleet";

// Ships in list order, each placed horizontally at column A of rows A-E.
export const FLEET_ROWS = ["A", "B", "C", "D", "E"];
export const FLEET_CELLS = [
  ...["A1", "A2", "A3", "A4", "A5"],
  ...["B1", "B2", "B3", "B4"],
  ...["C1", "C2", "C3"],
  ...["D1", "D2", "D3"],
  ...["E1", "E2"],
];
export const MISS_CELLS = "FGHIJ".split("").flatMap((row) =>
  Array.from({ length: 10 }, (_, i) => `${row}${i + 1}`));

/** Fails the test on console errors and CSP violations (the browser logs each blocked load). */
export function watchConsole(page) {
  const problems = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" || text.includes("Content Security Policy")) problems.push(text);
  });
  page.on("pageerror", (error) => problems.push(error.message));
  return problems;
}

// Cell labels read "A1, water": matching on "A1," cannot hit "A10,".
export const cell = (page, gridName, label) =>
  page.getByRole("grid", { name: gridName }).getByRole("button", { name: `${label},` });

/**
 * A browser for one player, with the project's device emulation. Against the local dev
 * server each player also gets its own client IP, as real players would, so the per-IP
 * room creation limit does not trip across tests. Cloudflare's edge rejects the header.
 */
export async function newPlayer(browser, testInfo, options = {}) {
  const { defaultBrowserType, ...device } = testInfo.project.use;
  const local = /^http:\/\/localhost/.test(testInfo.project.use.baseURL ?? "");
  const octet = () => Math.floor(Math.random() * 250) + 1;
  const extraHTTPHeaders = local
    ? { "CF-Connecting-IP": `10.${octet()}.${octet()}.${octet()}` }
    : {};
  const context = await browser.newContext({ ...device, extraHTTPHeaders, ...options });
  return context.newPage();
}

export async function openHome(page, nickname) {
  await page.goto("/");
  await page.getByLabel("Your nickname").fill(nickname);
}

/** Picks a flag by name in the picker inside `#pickerId` ("home-flag" or "placement-flag"). */
export async function pickFlag(page, pickerId, name) {
  const picker = page.locator(`#${pickerId}`);
  await picker.getByText("Your flag", { exact: true }).click();
  await picker.getByRole("radio", { name }).check();
}

export async function createRoom(page, nickname, { flag } = {}) {
  await openHome(page, nickname);
  if (flag) await pickFlag(page, "home-flag", flag);
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for an opponent" })).toBeVisible();
  return (await page.locator("#lobby-code").textContent()).trim();
}

export async function joinRoom(page, nickname, code, { flag } = {}) {
  await page.goto(`/?room=${code}`);
  await page.getByLabel("Your nickname").fill(nickname);
  if (flag) await pickFlag(page, "home-flag", flag);
  await page.getByRole("button", { name: "Join room" }).click();
}

/** The middle of an element in viewport pixels, where the mouse presses it. */
export async function centerOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Waits for the battle; returns [first shooter, the other player]. */
export async function battleOrder(ana, bo) {
  await expect(ana.locator("#turn-banner")).toBeVisible();
  const anaFirst = (await ana.locator("#turn-banner").textContent()).startsWith("Your turn");
  return anaFirst ? [ana, bo] : [bo, ana];
}

export async function placeRowFleet(page) {
  await expect(page.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  for (const row of FLEET_ROWS) {
    await cell(page, PLACEMENT, `${row}1`).click();
  }
  await page.getByRole("button", { name: "Ready" }).click();
}
