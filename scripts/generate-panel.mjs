import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 320, height: 160 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>body{margin:0}</style>${await readFile(new URL("../public/share/sincelasttime-panel.svg", import.meta.url), "utf8")}`,
  );
  await page
    .locator("svg")
    .screenshot({
      path: new URL("../public/share/sincelasttime-panel.png", import.meta.url).pathname,
    });
} finally {
  await browser.close();
}
