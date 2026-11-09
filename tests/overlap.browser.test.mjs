import { toggleColumns } from "./column-controls.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { ARTICLE_URL, launch } from "./browser.mjs";

const settle = page => page.evaluate(async () => {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
});
async function assertZeroOverlap(page) {
  await page.waitForSelector(".cl-slot .cl-source");
  await settle(page);
  const state = await page.locator(".cl-plane").evaluate(p => ({
    overlap: p.style.getPropertyValue("--cl-overlap"),
    h: p.style.getPropertyValue("--cl-h"), step: p.style.getPropertyValue("--cl-step"),
  }));
  assert.equal(state.overlap, "0px");
  assert.equal(state.h, state.step);
  assert.equal(await page.locator(".cl-settings, [data-cl-overlap], [data-cl-edge]").count(), 0);
  assert.equal(await page.locator("[data-site-header] .cl-toolbar > .cl-toggle").isVisible(), true);
  assert.equal(await page.locator("[data-site-header] .cl-toolbar > button").count(), 1);
}

test("保存済みの重なりやCSS指定を無視し、モード変更・リサイズ・再読込後も0に固定する", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  try {
    for (const width of [390, 1600]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.addInitScript(() => {
          localStorage.setItem("dispositif:columns", "multi");
        });
        await page.goto(ARTICLE_URL); await page.evaluate(() => document.fonts.ready);
        await page.addStyleTag({ content: ":root { --cl-context-overlap: 200px; }" });
        await assertZeroOverlap(page);
        await page.setViewportSize({ width, height: 600 }); await assertZeroOverlap(page);
        await toggleColumns(page);
        await page.waitForSelector("html:not(.cl-multi) .cl-toolbar > .cl-toggle");
        await toggleColumns(page); await assertZeroOverlap(page);
        await page.reload(); await assertZeroOverlap(page);
        await page.locator(".cl-viewport").focus(); await page.keyboard.press("End"); await settle(page);
        const end = await page.locator(".cl-plane").evaluate(p => Number(p.dataset.clXTicks));
        assert.ok(end > 0);
        await page.keyboard.press("Home"); await settle(page);
        assert.deepEqual(await page.locator(".cl-plane").evaluate(p => [p.dataset.clXTicks, p.dataset.clYTicks]), ["0", "0"]);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
