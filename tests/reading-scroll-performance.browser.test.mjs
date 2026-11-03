import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";

const ARTICLE_URL = new URL("symmetric-polynomial/",
  process.env.RM_BASE_URL ?? "http://localhost:4321/dispositif/").href;
const settle = page => page.evaluate(async () => {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
});

test("拡大時も段内の横スクロールで本文のスタイルやDOMを更新しない", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.RM_BROWSER_PATH || undefined });
  try {
    for (const zoom of [1, 1.1, 1.125, 1.25, 1.5]) {
      // At every zoom leave room for two full columns, so this gesture stays
      // away from both input bounds and the native plane's rebase boundaries.
      const page = await browser.newPage({ viewport: { width: 2100, height: 927 } });
      try {
        await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
        await page.goto(ARTICLE_URL);
        await page.waitForSelector(".rm-content mjx-container");
        await page.evaluate(() => document.fonts.ready);
        await page.addStyleTag({ content: `html { zoom: ${zoom}; }` }); await settle(page);
        await page.locator('.rm-viewport').focus(); await page.keyboard.press('Home'); await settle(page);
        await page.locator('.rm-viewport').evaluate(v => { v.scrollLeft += 40; }); await settle(page);
        const before = await page.locator('.rm-slot').first().boundingBox();
        await page.evaluate(() => {
          window.scrollEdits = { styles: 0, children: 0 };
          window.scrollObserver = new MutationObserver(ms => {
            scrollEdits.styles += ms.filter(m => m.type === 'attributes' && m.attributeName === 'style').length;
            scrollEdits.children += ms.filter(m => m.type === 'childList').length;
          });
          scrollObserver.observe(document.querySelector('.rm-plane'), { subtree: true, attributes: true, childList: true });
        });
        for (let i = 0; i < 20; i++) {
          await page.locator('.rm-viewport').evaluate(v => { v.scrollLeft += 4.13; }); await settle(page);
        }
        const after = await page.locator('.rm-slot').first().boundingBox();
        const result = await page.evaluate(() => { scrollObserver.disconnect(); return scrollEdits; });
        assert.ok(before.x - after.x > 50 * zoom, '実際に横移動していない');
        assert.deepEqual(result, { styles: 0, children: 0 }, `拡大率${zoom}で不要な描画更新が起きた`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
