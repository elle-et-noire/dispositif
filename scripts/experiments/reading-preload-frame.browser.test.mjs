import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, firefox } from 'playwright-core';

// Direct bridge test; navigation integration is still separate.
const base = process.env.RM_BASE_URL ?? 'http://localhost:4321/dispositif/';
const preloadUrl = new URL('src/scripts/reading-preload.ts', base).href;
const frameUrl = new URL('src/scripts/reading-preload-frame.ts', base).href;
const article = new URL('tips-wsl/', base).href;
const otherArticle = new URL('tips-python/', base).href;
for (const [name, engine] of Object.entries({ chromium, firefox })) {
  test(`${name}: prepared frame bridges input, history and disposal`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce' });
      await page.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
      await page.goto(base);
      const prepared = await page.evaluate(async ({ preloadUrl, frameUrl, article }) => {
        const { ReadingPreloader } = await import(preloadUrl);
        const { PreparedReadingFrame } = await import(frameUrl);
        const manager = new ReadingPreloader();
        const candidate = await manager.prepare(article);
        if (!candidate) return null;
        const entry = manager.take(article);
        if (!entry) return null;
        window.testNavigationCalls = [];
        const reader = new PreparedReadingFrame(entry, (url, replace) => window.testNavigationCalls.push({ url, replace }));
        window.testPreparedReader = reader;
        window.testPreparedFrame = entry.frame;
        reader.show(123);
        return { inert: entry.frame.inert, aria: entry.frame.getAttribute('aria-hidden'),
          title: entry.frame.title, offset: entry.frame.contentDocument.querySelector('[data-article-index]').style.getPropertyValue('--article-index-offset') };
      }, { preloadUrl, frameUrl, article });
      assert.ok(prepared);
      assert.equal(prepared.inert, false);
      assert.equal(prepared.aria, null);
      assert.ok(prepared.title);
      assert.equal(prepared.offset, '-123px');
      const beforeCommitClose = await page.evaluate(() => {
        window.testPreparedFrame.contentDocument.querySelector('.rm-close').click();
        return window.testNavigationCalls.pop();
      });
      assert.equal(beforeCommitClose.url, base);
      assert.equal(beforeCommitClose.replace, true);
      const history = await page.evaluate(article => {
        history.replaceState({ ...history.state, index: 1 }, '', article);
        window.testPreparedReader.commit();
        const child = window.testPreparedFrame.contentWindow;
        child.history.replaceState(child.history.state, '', '#example');
        return { parentKey: history.state.dispositifReadingKey, childKey: child.history.state.dispositifReadingKey,
          parentHash: location.hash, childHash: child.location.hash };
      }, article);
      assert.ok(history.parentKey);
      assert.equal(history.parentKey, history.childKey);
      assert.equal(history.parentHash, '#example');
      assert.equal(history.childHash, '#example');
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
      const forwarded = await page.evaluate(otherArticle => {
        const frame = window.testPreparedFrame, doc = frame.contentDocument;
        const link = doc.createElement('a'); link.href = otherArticle; doc.body.append(link); link.click();
        const next = window.testNavigationCalls.pop();
        doc.querySelector('.rm-close').click();
        const close = window.testNavigationCalls.pop();
        const plane = doc.querySelector('.rm-plane');
        return { next, close, x: Number(plane.dataset.rmXTicks), y: Number(plane.dataset.rmYTicks), key: frame.contentWindow.history.state.dispositifReadingKey };
      }, otherArticle);
      assert.equal(forwarded.next.url, otherArticle);
      assert.equal(forwarded.next.replace, false);
      assert.equal(forwarded.close.url, base);
      assert.equal(forwarded.close.replace, false);
      assert.ok(forwarded.x > 0, 'keyboard input did not reach the prepared reader');
      const saved = await page.evaluate(({ key }) => {
        window.testPreparedReader.dispose();
        const entries = JSON.parse(sessionStorage.getItem('dispositif:reading-history') ?? '[]');
        const position = entries.find(([entryKey]) => entryKey === key)?.[1];
        return { connected: window.testPreparedFrame.isConnected, point: position?.point, printStyle: document.documentElement.classList.contains('rm-prepared-reader-print') };
      }, { key: forwarded.key });
      assert.equal(saved.connected, false);
      assert.equal(saved.point.x, forwarded.x);
      assert.equal(saved.point.y, forwarded.y);
      assert.equal(saved.printStyle, false);
      await page.close();
    } finally { await browser.close(); }
  });
}
