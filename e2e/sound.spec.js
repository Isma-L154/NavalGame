import { expect, test } from "@playwright/test";
import { FLEET_ROWS, battleOrder, cell, createRoom, joinRoom, newPlayer, watchConsole } from "./helpers.js";

const PLACEMENT = "Your waters. Place your fleet";

/** Counts every audio source the page starts, in `window.soundStarts`. */
async function countSounds(page) {
  await page.addInitScript(() => {
    window.soundStarts = 0;
    for (const node of [AudioScheduledSourceNode, AudioBufferSourceNode]) {
      const { start } = node.prototype;
      node.prototype.start = function count(...args) {
        window.soundStarts += 1;
        return start.apply(this, args);
      };
    }
  });
}

const sounds = (page) => page.evaluate(() => window.soundStarts);

test("sound is on by default, and switching it off is remembered", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Sound" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});

test("placing ships and shots are heard, unless sound is off", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const bo = await newPlayer(browser, testInfo);
  const problems = [ana, bo].map(watchConsole);
  await countSounds(ana);
  await countSounds(bo);
  const code = await createRoom(ana, "Ana");
  await joinRoom(bo, "Bo", code);
  await expect(ana.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  expect(await sounds(ana)).toBe(0);

  await cell(ana, PLACEMENT, "A1").click();
  await expect.poll(() => sounds(ana)).toBeGreaterThan(0);
  const placed = await sounds(ana);

  const toggle = ana.getByRole("button", { name: "Sound" });
  await toggle.click();
  await cell(ana, PLACEMENT, "B1").click();
  await expect(cell(ana, PLACEMENT, "B1")).toHaveAttribute("aria-label", /Battleship/);
  // A cue waits at most half a second for the audio context.
  await ana.waitForTimeout(700);
  expect(await sounds(ana)).toBe(placed);

  await toggle.click();
  await expect.poll(() => sounds(ana)).toBeGreaterThan(placed);

  for (const row of FLEET_ROWS.slice(2)) await cell(ana, PLACEMENT, `${row}1`).click();
  for (const row of FLEET_ROWS) await cell(bo, PLACEMENT, `${row}1`).click();
  for (const page of [ana, bo]) await page.getByRole("button", { name: "Ready" }).click();
  const [shooter, target] = await battleOrder(ana, bo);
  const before = [await sounds(shooter), await sounds(target)];
  await cell(shooter, "Enemy waters", "A1").click();
  await expect(cell(shooter, "Enemy waters", "A1")).toHaveClass(/state-hit/);
  await expect.poll(() => sounds(shooter)).toBeGreaterThan(before[0]);
  await expect.poll(() => sounds(target)).toBeGreaterThan(before[1]);
  expect(problems.flat()).toEqual([]);
});

test("every cue is audible and does not clip", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "rendering does not depend on the device");
  const page = await newPlayer(browser, testInfo);
  await page.goto("/");
  const peaks = await page.evaluate(async () => {
    const { CUES, schedule } = await import("/js/sound.js");
    const rendered = {};
    for (const [name, voices] of CUES) {
      const context = new OfflineAudioContext(1, 88200, 44100);
      schedule(context, voices);
      const samples = (await context.startRendering()).getChannelData(0);
      rendered[name] = samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
    }
    return rendered;
  });
  expect(Object.keys(peaks)).toEqual(["place", "miss", "hit", "sunk", "victory", "defeat"]);
  for (const [name, peak] of Object.entries(peaks)) {
    expect(peak, name).toBeGreaterThan(0.1);
    expect(peak, name).toBeLessThan(0.95);
  }
});
