import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';

const base = process.env.RM_BASE_URL ?? 'http://localhost:4321/dispositif/';

// Chromium moves a recycled column's rasterized text instead of painting it
// again. A move by a fraction of a device pixel left the text blurred, e.g. at
// 125 %, where a 706 px column step is 882.5 device pixels.
const offGrid = () => [...document.querySelectorAll('.rm-slot')].flatMap((slot) => {
  const [x, y = '0'] = slot.firstElementChild.style.translate.split(/\s+/);
  return [parseFloat(x), parseFloat(y)].map((value) => value * devicePixelRatio)
    // Serialized with 6 significant digits (1263.6364px reads as 1263.64px).
    .filter((device) => Math.abs(device - Math.round(device)) > 0.01)
    .map((device) => `k${slot.dataset.rmK}: ${slot.firstElementChild.style.translate} (${device} device px)`);
});

test('n段の本文は使い回しても1デバイスピクセル単位の位置に置く', { timeout: 120_000 }, async () => {
  const browser = await chromium.launch();
  try {
    for (const [scale, width, height] of [[1.25, 1090, 802], [1.1, 1300, 777], [1.5, 1000, 700]]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
      await context.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
      const page = await context.newPage();
      await page.goto(new URL('symmetric-polynomial/', base).href);
      await page.waitForFunction(() => document.documentElement.classList.contains('rm-active')
        && !document.documentElement.classList.contains('rm-pending'));
      const seen = new Set();
      await page.mouse.move(width / 2, height / 2);
      for (let i = 0; i < 24; i++) {
        await page.mouse.wheel(97, 0);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        for (const k of await page.evaluate(() => [...document.querySelectorAll('.rm-slot')].map((slot) => slot.dataset.rmK))) seen.add(k);
        assert.deepEqual(await page.evaluate(offGrid), [], `${scale} after ${i + 1} steps`);
      }
      // Columns were recycled, so their offsets were rewritten.
      assert.ok(seen.size > 4, `${scale}: columns ${[...seen]}`);
      await context.close();
    }
  } finally { await browser.close(); }
});

test('表示倍率が変わると動いていない段も丸め直す', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1090, height: 802 }, deviceScaleFactor: 1 });
    await context.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
    const page = await context.newPage();
    await page.goto(new URL('symmetric-polynomial/', base).href);
    await page.waitForFunction(() => document.documentElement.classList.contains('rm-active')
      && !document.documentElement.classList.contains('rm-pending'));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1090, height: 802, deviceScaleFactor: 1.25, mobile: false });
    await page.waitForFunction(() => devicePixelRatio === 1.25);
    await page.mouse.move(545, 400);
    await page.mouse.wheel(0, 1);
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(offGrid), []);
    await context.close();
  } finally { await browser.close(); }
});
