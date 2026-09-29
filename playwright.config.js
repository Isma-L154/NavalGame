import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.NAVAL_BASE_URL ?? "http://localhost:8787",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    // An iPad-sized touch screen on Chromium (CI installs only Chromium), for the visual flows.
    {
      name: "tablet",
      use: { ...devices["iPad Mini"], browserName: "chromium" },
      testMatch: /(board|flags|game|responsive)\.spec\.js/,
    },
  ],
});
