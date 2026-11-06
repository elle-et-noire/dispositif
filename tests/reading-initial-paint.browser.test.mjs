import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, firefox } from 'playwright-core';

const base = process.env.RM_BASE_URL ?? 'http://localhost:4321/dispositif/';
for (const [name, engine] of Object.entries({ chromium, firefox })) {
  test(`${name}: first visit stays single until the reader opts into multi`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      await page.goto(base);
      assert.equal(await page.evaluate(() => localStorage.getItem('dispositif:reading-mode')), null);
      const link = page.locator('a[href$="tips-python/"]');
      await link.hover();
      await page.waitForTimeout(400);
      assert.equal(await page.locator('html > iframe').count(), 0);
      await link.click();
      await page.waitForFunction(() => document.documentElement.dataset.pageKind === 'article' && !document.documentElement.classList.contains('rm-pending'));
      for (const width of [390, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator('html').evaluate(el => el.classList.contains('rm-active')), false);
        assert.equal(await page.locator('.rm-article-scrollport').evaluate(el => getComputedStyle(el).visibility), 'visible');
      }
      assert.equal(await page.evaluate(() => localStorage.getItem('dispositif:reading-mode')), null);
      await page.locator('.rm-toggle').click();
      await page.waitForFunction(() => document.documentElement.classList.contains('rm-active'));
      assert.equal(await page.evaluate(() => localStorage.getItem('dispositif:reading-mode')), 'multi');
      await page.reload();
      await page.waitForFunction(() => document.documentElement.classList.contains('rm-active') && !document.documentElement.classList.contains('rm-pending'));
      await page.locator('.rm-toggle').click();
      await page.waitForFunction(() => !document.documentElement.classList.contains('rm-active'));
      assert.equal(await page.evaluate(() => localStorage.getItem('dispositif:reading-mode')), 'single');
      await page.reload();
      await page.waitForFunction(() => document.documentElement.classList.contains('rm-ready') && !document.documentElement.classList.contains('rm-pending'));
      assert.equal(await page.locator('html').evaluate(el => el.classList.contains('rm-active')), false);
      await page.close();
    } finally { await browser.close(); }
  });

  test(`${name}: initial article paint waits for the selected mode`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      for (const mode of ['single', 'multi', null]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
        await page.addInitScript((mode) => {
          if (mode === null) localStorage.removeItem('dispositif:reading-mode');
          else localStorage.setItem('dispositif:reading-mode', mode);
          window.initialPaints = [];
          document.addEventListener('astro:after-swap', () => {
            if (document.documentElement.dataset.pageKind !== 'article') return;
            const record = () => {
              const article = document.querySelector('.rm-article-scrollport');
              if (article) window.initialPaints.push({
                visibility: getComputedStyle(article).visibility,
                active: document.documentElement.classList.contains('rm-active'),
                ready: !document.documentElement.classList.contains('rm-pending'),
              });
              if (document.documentElement.classList.contains('rm-pending')) requestAnimationFrame(record);
            };
            record();
          });
        }, mode);
        await page.goto(base);
        await page.locator('a[href$="symmetric-polynomial/"]').click();
        await page.waitForFunction(() => document.documentElement.dataset.pageKind === 'article' && !document.documentElement.classList.contains('rm-pending'));
        const paints = await page.evaluate(() => window.initialPaints);
        assert.ok(paints.length > 0);
        for (const frame of paints) assert.ok(frame.visibility === 'hidden' || frame.active || mode !== 'multi', JSON.stringify(frame));
        assert.equal(await page.locator('.rm-article-scrollport').evaluate(el => getComputedStyle(el).visibility), 'visible');
        assert.equal(await page.locator('html').evaluate(el => el.classList.contains('rm-active')), mode === 'multi');
        await page.goto(new URL('symmetric-polynomial/', base).href);
        await page.waitForFunction(() => !document.documentElement.classList.contains('rm-pending'));
        assert.equal(await page.locator('html').evaluate(el => el.classList.contains('rm-active')), mode === 'multi');
        await page.close();
      }
      const noJS = await browser.newPage({ javaScriptEnabled: false });
      await noJS.goto(new URL('symmetric-polynomial/', base).href);
      assert.equal(await noJS.locator('.rm-article-scrollport').evaluate(el => getComputedStyle(el).visibility), 'visible');
      await noJS.close();
      const failedBundle = await browser.newPage();
      await failedBundle.addInitScript(() => {
        const original = window.setTimeout;
        window.setTimeout = (handler, delay, ...args) => original(handler, delay === 10000 ? 100 : delay, ...args);
        localStorage.setItem('dispositif:reading-mode', 'multi');
      });
      await failedBundle.route(/\.(?:m?js)(?:\?|$)/, route => route.abort());
      await failedBundle.goto(new URL('symmetric-polynomial/', base).href, { waitUntil: 'domcontentloaded' });
      await failedBundle.waitForFunction(() => document.documentElement.classList.contains('rm-fallback'));
      assert.equal(await failedBundle.locator('.rm-article-scrollport').evaluate(el => getComputedStyle(el).visibility), 'visible');
      await failedBundle.close();
    } finally { await browser.close(); }
  });
}
