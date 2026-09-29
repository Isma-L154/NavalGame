// Renders the committed share images from design/: node scripts/render-og-image.mjs
import { readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES = { ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const TARGETS = [
  { source: "/design/og-image.html", output: "public/og-image.png", width: 1200, height: 630 },
  { source: "/design/apple-touch-icon.html", output: "public/apple-touch-icon.png", width: 180, height: 180 },
];

const browser = await chromium.launch();
for (const { source, output, width, height } of TARGETS) {
  const page = await browser.newPage({ viewport: { width, height } });
  const missing = [];
  // Serve design/ and the site's public/ files from disk: file:// pages cannot load web fonts.
  await page.route("http://render.local/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = join(ROOT, path.startsWith("/design/") ? "" : "public", path);
    try {
      await route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] });
    } catch {
      missing.push(path);
      await route.abort();
    }
  });
  await page.goto(`http://render.local${source}`);
  await page.evaluate(() => document.fonts.ready);
  if (missing.length) throw new Error(`${source} requested missing files: ${missing.join(", ")}`);
  await writeFile(join(ROOT, output), await page.screenshot({ type: "png" }));
  await page.close();
}
await browser.close();
