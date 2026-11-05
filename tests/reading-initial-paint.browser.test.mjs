import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, firefox } from 'playwright-core';

const base = process.env.RM_BASE_URL ?? 'http://localhost:4321/dispositif/';
for (const [name, engine] of Object.entries({ chromium, firefox })) {
  test(`${name}: initial article paint waits for the selected mode`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      for (const mode of ['single', 'multi']) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
        await page.addInitScript((mode) => {
          localStorage.setItem('dispositif:reading-mode', mode);
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
        for (const frame of paints) assert.ok(frame.visibility === 'hidden' || frame.active || mode === 'single', JSON.stringify(frame));
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
