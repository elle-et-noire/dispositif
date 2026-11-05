import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright-core';
const base = process.env.RM_BASE_URL ?? 'http://127.0.0.1:4597/dispositif/';
for (const [name, engine] of Object.entries({chromium, firefox})) {
  test(`${name}: abandoning a hover cancels speculative reader`, {timeout: 120_000}, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({viewport:{width:1440,height:900}, reducedMotion:'reduce'});
      await page.addInitScript(() => localStorage.setItem('dispositif:reading-mode','multi'));
      await page.goto(base);
      const link = page.locator('a[href$="symmetric-polynomial/"]');
      await link.hover();
      await page.waitForSelector('html > iframe[data-rm-preparing]', {state:'attached'});
      await page.mouse.move(0,0);
      await page.waitForFunction(() => !document.querySelector('html > iframe[data-rm-preparing]'), null, {timeout:30000});
      assert.equal(await page.locator('html > iframe[data-rm-preparing]').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.pageKind), 'index');
    } finally { await browser.close(); }
  });
}
