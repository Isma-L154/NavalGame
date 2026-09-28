import { expect } from "@playwright/test";

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

/** Fails the test on console errors and CSP violations (report-only mode logs them). */
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
export async function newPlayer(browser, testInfo) {
  const { defaultBrowserType, ...device } = testInfo.project.use;
  const local = /^http:\/\/localhost/.test(testInfo.project.use.baseURL ?? "");
  const octet = () => Math.floor(Math.random() * 250) + 1;
  const extraHTTPHeaders = local
    ? { "CF-Connecting-IP": `10.${octet()}.${octet()}.${octet()}` }
    : {};
  const context = await browser.newContext({ ...device, extraHTTPHeaders });
  return context.newPage();
}

export async function openHome(page, nickname) {
  await page.goto("/");
  await page.getByLabel("Your nickname").fill(nickname);
}

export async function createRoom(page, nickname) {
  await openHome(page, nickname);
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for an opponent" })).toBeVisible();
  return (await page.locator("#lobby-code").textContent()).trim();
}

export async function joinRoom(page, nickname, code) {
  await page.goto(`/?room=${code}`);
  await page.getByLabel("Your nickname").fill(nickname);
  await page.getByRole("button", { name: "Join room" }).click();
}

export async function placeRowFleet(page) {
  await expect(page.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  for (const row of FLEET_ROWS) {
    await cell(page, "Your waters. Place your fleet", `${row}1`).click();
  }
  await page.getByRole("button", { name: "Ready" }).click();
}
