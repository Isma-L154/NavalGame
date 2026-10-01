// Renders the committed images from design/: node scripts/render-og-image.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TARGETS = [
  { source: "/design/og-image.html", output: "public/og-image.png", width: 1200, height: 630 },
  { source: "/design/apple-touch-icon.html", output: "public/apple-touch-icon.png", width: 180, height: 180 },
  { source: "/design/readme-banner.html", output: "docs/brand/readme-banner.png", width: 1280, height: 640 },
];

async function render(browser, { source, width, height }) {
  const page = await browser.newPage({ viewport: { width, height } });
  const failures = [];
  // Serve design/ and the site's public/ files from disk: file:// pages cannot load web fonts.
  await page.route("http://render.local/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    try {
      await route.fulfill({ path: join(ROOT, path.startsWith("/design/") ? "" : "public", path) });
    } catch (error) {
      failures.push(`${path}: ${error.message}`);
      await route.abort();
    }
  });
  await page.goto(`http://render.local${source}`);
  await page.evaluate(() => document.fonts.ready);
  if (failures.length) throw new Error(`${source} could not load:\n${failures.join("\n")}`);
  return page.screenshot({ type: "png" });
}

// Render everything before writing anything, so a failure never leaves a half-updated set.
const browser = await chromium.launch();
let images;
try {
  images = await Promise.all(TARGETS.map((target) => render(browser, target)));
} finally {
  await browser.close();
}
await Promise.all(
  TARGETS.map(async ({ output }, i) => {
    await mkdir(dirname(join(ROOT, output)), { recursive: true });
    await writeFile(join(ROOT, output), images[i]);
  }),
);
