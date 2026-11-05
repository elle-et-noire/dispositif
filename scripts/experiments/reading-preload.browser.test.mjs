import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, firefox } from 'playwright-core';

// Exercise the coordinator directly, separately from navigation integration.
const base = process.env.RM_BASE_URL ?? 'http://127.0.0.1:4321/dispositif/';
// A bundled module URL also lets this run against a production snapshot.
const moduleUrl = process.env.RM_PRELOAD_MODULE_URL ?? new URL('src/scripts/reading-preload.ts', base).href;
const articleUrl = new URL('tips-python/', base).href;
for (const [name, engine] of Object.entries({ chromium, firefox })) {
  test(`${name}: reader preload respects preference, cancellation and ownership`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      await page.goto(base);
      await page.evaluate(() => document.fonts.ready);
      const choices = await page.evaluate(async (url) => {
        const module = await import(url);
        localStorage.setItem('dispositif:reading-mode', 'single');
        const single = module.shouldPrepareMulti();
        localStorage.setItem('dispositif:reading-mode', 'multi');
        const multi = module.shouldPrepareMulti();
        localStorage.removeItem('dispositif:reading-mode');
        const defaultSingle = !module.shouldPrepareMulti();
        const manager = new module.ReadingPreloader();
        const unsetRejected = await manager.prepare(new URL('tips-python/', location.href).href) === null;
        manager.dispose();
        return { single, multi, defaultSingle, unsetRejected, frames: document.querySelectorAll('iframe').length };
      }, moduleUrl);
      assert.deepEqual(choices, { single: false, multi: true, defaultSingle: true, unsetRejected: true, frames: 0 });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(async url => (await import(url)).shouldPrepareMulti(), moduleUrl), false);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
      const before = await page.screenshot();
      const ready = await page.evaluate(async ({ moduleUrl, articleUrl }) => {
        const { ReadingPreloader } = await import(moduleUrl);
        const manager = new ReadingPreloader();
        window.testReadingPreloader = manager;
        const first = manager.prepare(`${articleUrl}#ignored`);
        const samePromise = first === manager.prepare(articleUrl);
        const entry = await first;
        if (!entry) return { samePromise, ready: false };
        const doc = entry.frame.contentDocument;
        return { samePromise, ready: true, connected: entry.frame.isConnected,
          hidden: entry.frame.getAttribute('aria-hidden'), inert: entry.frame.inert,
          multi: doc.documentElement.classList.contains('rm-active'),
          pending: doc.documentElement.classList.contains('rm-pending'),
          slots: doc.querySelectorAll('.rm-slot').length, fonts: doc.fonts.status,
          width: entry.width, height: entry.height };
      }, { moduleUrl, articleUrl });
      assert.equal(ready.samePromise, true);
      assert.equal(ready.ready, true);
      assert.equal(ready.connected, true);
      assert.equal(ready.hidden, 'true');
      assert.equal(ready.inert, true);
      assert.equal(ready.multi, true);
      assert.equal(ready.pending, false);
      assert.ok(ready.slots > 0);
      assert.equal(ready.fonts, 'loaded');
      assert.equal(ready.width, 1440);
      assert.equal(ready.height, 900);
      assert.deepEqual(await page.screenshot(), before, 'preparation changed the visible index');
      const taken = await page.evaluate(articleUrl => {
        const manager = window.testReadingPreloader;
        const entry = manager.take(articleUrl);
        const attached = entry?.frame.isConnected ?? false;
        manager.dispose();
        const stillAttached = entry?.frame.isConnected ?? false;
        entry?.frame.remove();
        return { attached, stillAttached, remaining: document.querySelectorAll('iframe').length };
      }, articleUrl);
      assert.deepEqual(taken, { attached: true, stillAttached: true, remaining: 0 });
      const cancelled = await page.evaluate(async ({ moduleUrl, articleUrl }) => {
        const { ReadingPreloader } = await import(moduleUrl);
        const manager = new ReadingPreloader();
        const pending = manager.prepare(articleUrl);
        manager.cancel();
        const value = await pending;
        const foreign = await manager.prepare('https://example.invalid/article/');
        manager.dispose();
        const afterDispose = await manager.prepare(articleUrl);
        return { cancelled: value === null, rejectedForeign: foreign === null, rejectedDisposed: afterDispose === null, frames: document.querySelectorAll('iframe').length };
      }, { moduleUrl, articleUrl });
      assert.deepEqual(cancelled, { cancelled: true, rejectedForeign: true, rejectedDisposed: true, frames: 0 });
      const replaced = await page.evaluate(async ({ moduleUrl, articleUrl, base }) => {
        const { ReadingPreloader } = await import(moduleUrl);
        const manager = new ReadingPreloader();
        const first = manager.prepare(articleUrl);
        const nextUrl = new URL('tips-wsl/', base).href;
        const next = manager.prepare(nextUrl);
        const oldResult = await first;
        const newResult = await next;
        const result = { firstCancelled: oldResult === null, secondReady: !!newResult,
          frames: document.querySelectorAll('iframe').length, matches: newResult?.url === nextUrl };
        manager.dispose();
        return result;
      }, { moduleUrl, articleUrl, base });
      assert.deepEqual(replaced, { firstCancelled: true, secondReady: true, frames: 1, matches: true });
      const missing = await page.evaluate(async ({ moduleUrl, base }) => {
        const { ReadingPreloader } = await import(moduleUrl);
        const manager = new ReadingPreloader();
        const result = await manager.prepare(new URL('missing-article-for-preload-test/', base).href);
        manager.dispose();
        return { rejected: result === null, frames: document.querySelectorAll('iframe').length };
      }, { moduleUrl, base });
      assert.deepEqual(missing, { rejected: true, frames: 0 });
      await page.route('**/tips-julia/', async route => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await route.abort().catch(() => {});
      });
      const timedOut = await page.evaluate(async ({ moduleUrl, base }) => {
        const { ReadingPreloader } = await import(moduleUrl);
        const manager = new ReadingPreloader(15_000, 150);
        const entry = await manager.prepare(new URL('tips-julia/', base).href);
        manager.dispose();
        return { rejected: entry === null, frames: document.querySelectorAll('iframe').length };
      }, { moduleUrl, base });
      await page.unroute('**/tips-julia/');
      assert.deepEqual(timedOut, { rejected: true, frames: 0 });
      const stale = await page.evaluate(async ({ moduleUrl, articleUrl }) => {
        const { ReadingPreloader } = await import(moduleUrl);
        const manager = new ReadingPreloader();
        const entry = await manager.prepare(articleUrl);
        localStorage.setItem('dispositif:reading-mode', 'single');
        const taken = manager.take(articleUrl);
        const removed = !entry?.frame.isConnected;
        manager.dispose();
        return { prepared: !!entry, rejected: taken === null, removed };
      }, { moduleUrl, articleUrl });
      assert.deepEqual(stale, { prepared: true, rejected: true, removed: true });
      const storageBeforeAbandoned = await page.evaluate(() => sessionStorage.getItem('dispositif:reading-history'));
      const expired = await page.evaluate(async ({ moduleUrl, articleUrl }) => {
        const { ReadingPreloader } = await import(moduleUrl);
        localStorage.setItem('dispositif:reading-mode', 'multi');
        const manager = new ReadingPreloader(150);
        const entry = await manager.prepare(articleUrl);
        await new Promise(resolve => setTimeout(resolve, 300));
        const result = { prepared: !!entry, removed: !entry?.frame.isConnected, taken: manager.take(articleUrl) !== null };
        manager.dispose();
        return result;
      }, { moduleUrl, articleUrl });
      assert.deepEqual(expired, { prepared: true, removed: true, taken: false });
      assert.equal(await page.evaluate(() => sessionStorage.getItem('dispositif:reading-history')), storageBeforeAbandoned,
        'an abandoned candidate must not create a reading-history entry');
      await page.evaluate(async ({ moduleUrl, articleUrl }) => {
        const { ReadingPreloader } = await import(moduleUrl);
        window.testReadingPreloader = new ReadingPreloader();
        window.testReadingPromise = window.testReadingPreloader.prepare(articleUrl);
      }, { moduleUrl, articleUrl });
      await page.setViewportSize({ width: 1000, height: 700 });
      const resized = await page.evaluate(async () => {
        const result = await window.testReadingPromise;
        window.testReadingPreloader.dispose();
        return { cancelled: result === null, frames: document.querySelectorAll('iframe').length };
      });
      assert.deepEqual(resized, { cancelled: true, frames: 0 });
      await page.close();
    } finally { await browser.close(); }
  });
}
