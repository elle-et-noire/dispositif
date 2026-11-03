import { toggleReadingMode } from "./reading-controls.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";

const ARTICLE_URL = new URL("symmetric-polynomial/",
  process.env.RM_BASE_URL ?? "http://localhost:4323/dispositif/").href;
const settle = page => page.evaluate(async () => {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
});
async function assertZeroOverlap(page) {
  await page.waitForSelector(".rm-slot .rm-source");
  await settle(page);
  const state = await page.locator(".rm-plane").evaluate(p => ({
    overlap: p.style.getPropertyValue("--rm-overlap"),
    h: p.style.getPropertyValue("--rm-h"), step: p.style.getPropertyValue("--rm-step"),
  }));
  assert.equal(state.overlap, "0px");
  assert.equal(state.h, state.step);
  assert.equal(await page.locator(".rm-settings, [data-rm-overlap], [data-rm-edge]").count(), 0);
  assert.equal(await page.locator("[data-site-header] .rm-toolbar > .rm-toggle").isVisible(), true);
  assert.equal(await page.locator("[data-site-header] .rm-toolbar > button").count(), 1);
}

test("保存済みの重なりやCSS指定を無視し、モード変更・リサイズ・再読込後も0に固定する", { timeout: 45_000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.RM_BROWSER_PATH || undefined });
  try {
    for (const width of [390, 1600]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.addInitScript(() => {
          localStorage.setItem("dispositif:reading-mode", "multi");
          localStorage.setItem("dispositif:reading-overlap-px", "127");
        });
        await page.goto(ARTICLE_URL); await page.evaluate(() => document.fonts.ready);
        await page.addStyleTag({ content: ":root { --rm-context-overlap: 200px; }" });
        await assertZeroOverlap(page);
        await page.setViewportSize({ width, height: 600 }); await assertZeroOverlap(page);
        await toggleReadingMode(page);
        await page.waitForSelector("html:not(.rm-active) .rm-toolbar > .rm-toggle");
        await toggleReadingMode(page); await assertZeroOverlap(page);
        await page.reload(); await assertZeroOverlap(page);
        await page.locator(".rm-viewport").focus(); await page.keyboard.press("End"); await settle(page);
        const end = await page.locator(".rm-plane").evaluate(p => Number(p.dataset.rmXTicks));
        assert.ok(end > 0);
        await page.keyboard.press("Home"); await settle(page);
        assert.deepEqual(await page.locator(".rm-plane").evaluate(p => [p.dataset.rmXTicks, p.dataset.rmYTicks]), ["0", "0"]);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
