import assert from 'node:assert/strict';
import test from 'node:test';
import { BASE_URL, engines, launch, storeColumns } from "./browser.mjs";

for (const [name, engine] of engines) {
  for (const mode of ['single', 'multi']) {
    test(`${name}: ${mode} hover and focus prefetch HTML without a reader iframe`, { timeout: 120_000 }, async () => {
      const browser = await launch(engine);
      try {
        const context = await browser.newContext({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce' });
        await storeColumns(context, mode);
        const page = await context.newPage();
        const requests = [];
        page.on('request', request => requests.push({ url: request.url(), type: request.resourceType() }));
        await page.goto(BASE_URL);
        const link = page.locator('a[href$="tips-wsl/"]');
        await link.hover();
        await link.focus();
        await page.waitForTimeout(1500);
        assert.equal(await page.locator('iframe').count(), 0);
        assert.ok(requests.some(request => request.url.includes('/tips-wsl/') && request.type !== 'document'), 'HTML prefetch was not requested');
        await link.click();
        await page.waitForFunction(() => location.pathname.endsWith('/tips-wsl/') && !document.documentElement.classList.contains('cl-pending'));
        assert.equal(await page.locator('iframe').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cl-multi')), mode === 'multi');
        await page.goBack();
        await page.waitForFunction(() => document.documentElement.dataset.pageKind === 'index');
        await page.goForward();
        await page.waitForFunction(() => document.documentElement.dataset.pageKind === 'article' && !document.documentElement.classList.contains('cl-pending'));
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cl-multi')), mode === 'multi');
        await context.close();
      } finally { await browser.close(); }
    });
  }
}
