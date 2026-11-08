import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, firefox } from 'playwright-core';

const base = process.env.RM_BASE_URL ?? 'http://localhost:4321/dispositif/';
// rm-pending hides the article without an inherited property (clip-path), so
// check what it hides: computed clip-path, hit testing at the viewport centre
// (clip-path clips hit testing as it clips painting), and aria-hidden, which
// keeps the clipped article out of the accessibility tree for the same span.
// Runs in the page.
const pendingState = () => {
  const article = document.querySelector('.rm-article-scrollport');
  const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  return {
    clipPath: getComputedStyle(article).clipPath,
    hit: article.contains(hit),
    ariaHidden: article.getAttribute('aria-hidden'),
    active: document.documentElement.classList.contains('rm-active'),
    pending: document.documentElement.classList.contains('rm-pending'),
  };
};
const hiddenWhilePending = (frame) => frame.pending && frame.clipPath === 'inset(50%)' && !frame.hit && frame.ariaHidden === 'true';
const shown = el => [getComputedStyle(el).clipPath, el.getAttribute('aria-hidden')];
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
        assert.deepEqual(await page.locator('.rm-article-scrollport').evaluate(shown), ['none', null]);
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
        await page.addInitScript(([mode, pendingState]) => {
          if (mode === null) localStorage.removeItem('dispositif:reading-mode');
          else localStorage.setItem('dispositif:reading-mode', mode);
          const state = new Function(`return (${pendingState})()`);
          // Every frame before the reader's first one, on a direct load
          // (from the first frame) and after a click (from the swap).
          window.initialPaints = [];
          const record = () => {
            if (document.documentElement.dataset.pageKind !== 'article') return;
            if (!document.documentElement.classList.contains('rm-pending')) return;
            if (document.querySelector('.rm-article-scrollport')) window.initialPaints.push(state());
            requestAnimationFrame(record);
          };
          requestAnimationFrame(record);
          document.addEventListener('astro:after-swap', record);
        }, [mode, pendingState.toString()]);
        await page.goto(base);
        await page.locator('a[href$="symmetric-polynomial/"]').click();
        await page.waitForFunction(() => document.documentElement.dataset.pageKind === 'article' && !document.documentElement.classList.contains('rm-pending'));
        const verify = async (where) => {
          const paints = await page.evaluate(() => window.initialPaints);
          assert.ok(paints.length > 0, where);
          for (const frame of paints) assert.ok(hiddenWhilePending(frame), `${mode} ${where}: ${JSON.stringify(frame)}`);
          assert.deepEqual(await page.locator('.rm-article-scrollport').evaluate(shown), ['none', null], where);
          assert.equal(await page.locator('.rm-article-scrollport').evaluate(el => el.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2))), true, where);
          assert.equal(await page.locator('html').evaluate(el => el.classList.contains('rm-active')), mode === 'multi', where);
        };
        await verify('click');
        await page.goto(new URL('symmetric-polynomial/', base).href);
        await page.waitForFunction(() => !document.documentElement.classList.contains('rm-pending'));
        await verify('direct');
        await page.close();
      }
      const noJS = await browser.newPage({ javaScriptEnabled: false });
      await noJS.goto(new URL('symmetric-polynomial/', base).href);
      assert.deepEqual(await noJS.locator('.rm-article-scrollport').evaluate(shown), ['none', null]);
      await noJS.close();
      const failedBundle = await browser.newPage();
      await failedBundle.addInitScript(() => {
        const original = window.setTimeout;
        window.setTimeout = (handler, delay, ...args) => original(handler, delay === 10000 ? 100 : delay, ...args);
        localStorage.setItem('dispositif:reading-mode', 'multi');
        // The scrollport's aria-hidden values before each change: set while
        // pending (from none), then removed by the fallback.
        window.ariaHidden = [];
        new MutationObserver((records) => {
          for (const r of records) if (r.target.matches?.('.rm-article-scrollport')) window.ariaHidden.push(r.oldValue);
        }).observe(document, { subtree: true, attributeFilter: ['aria-hidden'], attributeOldValue: true });
      });
      await failedBundle.route(/\.(?:m?js)(?:\?|$)/, route => route.abort());
      await failedBundle.goto(new URL('symmetric-polynomial/', base).href, { waitUntil: 'domcontentloaded' });
      await failedBundle.waitForFunction(() => document.documentElement.classList.contains('rm-fallback'));
      assert.deepEqual(await failedBundle.locator('.rm-article-scrollport').evaluate(shown), ['none', null]);
      assert.deepEqual(await failedBundle.evaluate(() => window.ariaHidden), [null, 'true']);
      await failedBundle.close();
      // While pending, Tab does not move focus into the hidden article (the
      // scrollport, the close button, the TOC and the text's links); after the
      // fallback shows it, Tab reaches it again.
      const stalled = await browser.newPage();
      await stalled.addInitScript(() => {
        const original = window.setTimeout;
        window.setTimeout = (handler, delay, ...args) => original(handler, delay === 10000 ? 2000 : delay, ...args);
      });
      await stalled.route(/\.(?:m?js)(?:\?|$)/, route => route.abort());
      await stalled.goto(new URL('symmetric-polynomial/', base).href, { waitUntil: 'domcontentloaded' });
      const focusInArticle = () => stalled.evaluate(() => document.querySelector('.rm-article-scrollport').contains(document.activeElement));
      for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Tab']) {
        await stalled.keyboard.press(key);
        assert.equal(await stalled.evaluate(() => document.documentElement.classList.contains('rm-pending')), true);
        assert.equal(await focusInArticle(), false, `${key} moved focus into the pending article`);
      }
      await stalled.waitForFunction(() => document.documentElement.classList.contains('rm-fallback'));
      for (let i = 0; i < 3 && !await focusInArticle(); i++) await stalled.keyboard.press('Tab');
      assert.equal(await focusInArticle(), true);
      await stalled.close();
    } finally { await browser.close(); }
  });
}
