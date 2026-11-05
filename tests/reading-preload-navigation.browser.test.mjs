import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, firefox } from 'playwright-core';

const base = process.env.RM_BASE_URL ?? 'http://localhost:4321/dispositif/';
for (const [name, engine] of Object.entries({ chromium, firefox })) {
  test(`${name}: prepared reader opens, scrolls and restores history`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce' });
      await page.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
      await page.goto(base);
      const link = page.locator('a[href$="tips-wsl/"]');
      await link.hover();
      const indexScroll = await page.locator('.article-index-shell').evaluate(el => el.scrollTop);
      assert.ok(indexScroll > 0);
      await page.waitForSelector('html > iframe[data-rm-preload-ready]', { state: 'attached' });
      await link.click();
      await page.waitForFunction(() => location.pathname.endsWith('/tips-wsl/') && document.querySelector('html > iframe[data-rm-prepared-reader]'));
      const state = await page.evaluate(() => {
        const frame = document.querySelector('html > iframe[data-rm-prepared-reader]');
        return { outerSources: document.querySelectorAll('.rm-source').length, inert: frame.inert,
          aria: frame.getAttribute('aria-hidden'), parentKey: history.state.dispositifReadingKey,
          childKey: frame.contentWindow.history.state.dispositifReadingKey,
          mode: frame.contentDocument.documentElement.classList.contains('rm-active') };
      });
      assert.equal(state.outerSources, 0);
      assert.equal(state.inert, false);
      assert.equal(state.aria, null);
      assert.equal(state.mode, true);
      assert.ok(state.parentKey);
      assert.equal(state.parentKey, state.childKey);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
      const point = await page.evaluate(() => {
        const plane = document.querySelector('html > iframe').contentDocument.querySelector('.rm-plane');
        return { x: plane.dataset.rmXTicks, y: plane.dataset.rmYTicks };
      });
      assert.ok(Number(point.x) > 0);
      await page.goBack();
      await page.waitForFunction(() => document.documentElement.dataset.pageKind === 'index' && !document.querySelector('html > iframe[data-rm-prepared-reader]'));
      assert.equal(await page.locator('.article-index-shell').evaluate(el => el.scrollTop), indexScroll);
      await page.goForward();
      await page.waitForFunction(() => document.documentElement.dataset.pageKind === 'article' && document.documentElement.classList.contains('rm-active') && !document.documentElement.classList.contains('rm-pending'));
      await page.waitForTimeout(300);
      const restored = await page.locator('.rm-plane').evaluate(plane => ({ x: plane.dataset.rmXTicks, y: plane.dataset.rmYTicks }));
      assert.deepEqual(restored, point);
      await page.close();
    } finally { await browser.close(); }
  });

  test(`${name}: preparation preserves the index and the article appearance`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce' });
      await context.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
      const page = await context.newPage();
      await page.goto(base);
      const link = page.locator('a[href$="tips-wsl/"]');
      await link.hover();
      const indexScroll = await page.locator('.article-index-shell').evaluate(el => el.scrollTop);
      const before = await page.screenshot();
      await page.waitForSelector('html > iframe[data-rm-preload-ready]', { state: 'attached' });
      assert.deepEqual(await page.screenshot(), before, 'preparation changed the visible index');
      await link.click();
      await page.waitForFunction(() => location.pathname.endsWith('/tips-wsl/') && !!history.state?.dispositifReadingKey);
      await page.mouse.move(0, 0);
      const actual = await page.screenshot();
      const normal = await context.newPage();
      await normal.goto(new URL('tips-wsl/', base).href);
      await normal.waitForFunction(() => document.documentElement.classList.contains('rm-active') && !document.documentElement.classList.contains('rm-pending'));
      await normal.locator('[data-article-index]').evaluate((el, y) => el.style.setProperty('--article-index-offset', `${-y}px`), indexScroll);
      await normal.mouse.move(0, 0);
      const expected = await normal.screenshot();
      const difference = await page.evaluate(async ({ first, second }) => {
        const images = await Promise.all([first, second].map(async data => { const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode(); return image; }));
        const canvas = document.createElement('canvas'); canvas.width = images[0].width; canvas.height = images[0].height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(images[0], 0, 0); const a = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(images[1], 0, 0); const b = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let changed = 0; for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i]-b[i]), Math.abs(a[i+1]-b[i+1]), Math.abs(a[i+2]-b[i+2])) > 5) changed++;
        return { changed, pixels: a.length / 4 };
      }, { first: actual.toString('base64'), second: expected.toString('base64') });
      assert.ok(difference.changed / difference.pixels < 0.001, `article appearance differs at ${difference.changed} pixels`);
      await context.close();
    } finally { await browser.close(); }
  });

  test(`${name}: prepared reader forwards contents and close actions`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce' });
      await page.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
      await page.goto(base);
      const link = page.locator('a[href$="tips-wsl/"]');
      await link.hover();
      const indexScroll = await page.locator('.article-index-shell').evaluate(el => el.scrollTop);
      await page.waitForSelector('html > iframe[data-rm-preload-ready]', { state: 'attached' });
      await link.click();
      await page.waitForFunction(() => location.pathname.endsWith('/tips-wsl/') && !!history.state?.dispositifReadingKey);
      await page.frameLocator('html > iframe[data-rm-prepared-reader]').locator('.toc-header .toc-link').nth(1).click();
      const hashes = await page.evaluate(() => ({ parent: location.hash, child: document.querySelector('html > iframe').contentWindow.location.hash }));
      assert.ok(hashes.parent);
      assert.equal(hashes.parent, hashes.child);
      await page.frameLocator('html > iframe[data-rm-prepared-reader]').locator('.rm-close').click();
      await page.waitForFunction(() => document.documentElement.dataset.pageKind === 'index' && !document.querySelector('html > iframe[data-rm-prepared-reader]'));
      assert.equal(await page.locator('.article-index-shell').evaluate(el => el.scrollTop), indexScroll);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')?.endsWith('/tips-wsl/')), true);
      await page.close();
    } finally { await browser.close(); }
  });

  test(`${name}: other-article links retain the previous reading position`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce' });
      await page.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
      await page.goto(base);
      const link = page.locator('a[href$="tips-wsl/"]');
      await link.hover();
      await page.waitForSelector('html > iframe[data-rm-preload-ready]', { state: 'attached' });
      await link.click();
      await page.waitForFunction(() => location.pathname.endsWith('/tips-wsl/') && !!history.state?.dispositifReadingKey);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
      const point = await page.evaluate(() => {
        const plane = document.querySelector('html > iframe').contentDocument.querySelector('.rm-plane');
        return { x: plane.dataset.rmXTicks, y: plane.dataset.rmYTicks };
      });
      await page.evaluate(base => {
        const doc = document.querySelector('html > iframe').contentDocument;
        const a = doc.createElement('a'); a.href = new URL('tips-python/', base).href; doc.body.append(a); a.click();
      }, base);
      await page.waitForFunction(() => location.pathname.endsWith('/tips-python/') && document.documentElement.classList.contains('rm-active') && !document.documentElement.classList.contains('rm-pending'));
      assert.equal(await page.locator('html > iframe[data-rm-prepared-reader]').count(), 0);
      await page.goBack();
      await page.waitForFunction(() => location.pathname.endsWith('/tips-wsl/') && document.documentElement.classList.contains('rm-active') && !document.documentElement.classList.contains('rm-pending'));
      await page.waitForTimeout(300);
      assert.deepEqual(await page.locator('.rm-plane').evaluate(el => ({ x: el.dataset.rmXTicks, y: el.dataset.rmYTicks })), point);
      await page.close();
    } finally { await browser.close(); }
  });

  test(`${name}: closing a prepared reader cancels an unfinished navigation`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce' });
      await page.addInitScript(() => {
        localStorage.setItem('dispositif:reading-mode', 'multi');
        document.addEventListener('astro:before-preparation', event => {
          if (!event.to.pathname.endsWith('/tips-wsl/')) return;
          const load = event.loader;
          event.loader = async function () { await new Promise(resolve => setTimeout(resolve, 1200)); return load.call(this); };
        });
      });
      await page.goto(base);
      const link = page.locator('a[href$="tips-wsl/"]');
      await link.hover();
      const indexScroll = await page.locator('.article-index-shell').evaluate(el => el.scrollTop);
      await page.waitForSelector('html > iframe[data-rm-preload-ready]', { state: 'attached' });
      await link.click({ noWaitAfter: true });
      await page.frameLocator('html > iframe[data-rm-prepared-reader]').locator('.rm-close').click();
      await page.waitForFunction(() => document.documentElement.dataset.pageKind === 'index' && !document.querySelector('html > iframe[data-rm-prepared-reader]'));
      await page.waitForTimeout(1400);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.pageKind), 'index');
      assert.equal(await page.locator('.article-index-shell').evaluate(el => el.scrollTop), indexScroll);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')?.endsWith('/tips-wsl/')), true);
      await page.close();
    } finally { await browser.close(); }
  });

  test(`${name}: prepared reader prints the same layout and resumes its position`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      await context.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
      const page = await context.newPage();
      await page.goto(base);
      const link = page.locator('a[href$="symmetric-polynomial/"]');
      await link.hover();
      await page.waitForSelector('html > iframe[data-rm-preload-ready]', { state: 'attached' });
      await link.click();
      await page.waitForFunction(() => location.pathname.endsWith('/symmetric-polynomial/') && !!history.state?.dispositifReadingKey);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
      const point = await page.evaluate(() => {
        const plane = document.querySelector('html > iframe').contentDocument.querySelector('.rm-plane');
        return { x: plane.dataset.rmXTicks, y: plane.dataset.rmYTicks };
      });
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(async () => { window.dispatchEvent(new Event('beforeprint')); await document.fonts.ready; });
      const preparedPrint = await page.screenshot({ fullPage: true });
      const baseline = await context.newPage();
      await baseline.goto(new URL('symmetric-polynomial/', base).href);
      await baseline.waitForFunction(() => document.documentElement.classList.contains('rm-active') && !document.documentElement.classList.contains('rm-pending'));
      await baseline.emulateMedia({ media: 'print' });
      await baseline.evaluate(async () => { window.dispatchEvent(new Event('beforeprint')); await document.fonts.ready; });
      const normalPrint = await baseline.screenshot({ fullPage: true });
      assert.deepEqual(preparedPrint, normalPrint, 'print layout differs from a normal article');
      await baseline.close();
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await page.emulateMedia({ media: 'screen' });
      await page.waitForTimeout(300);
      const restored = await page.evaluate(() => {
        const doc = document.querySelector('html > iframe').contentDocument, plane = doc.querySelector('.rm-plane');
        return { active: doc.documentElement.classList.contains('rm-active'), x: plane.dataset.rmXTicks, y: plane.dataset.rmYTicks };
      });
      assert.deepEqual(restored, { active: true, ...point });
      await context.close();
    } finally { await browser.close(); }
  });

  test(`${name}: a changed prepared document falls back to the normal article`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce' });
      await page.addInitScript(() => {
        localStorage.setItem('dispositif:reading-mode', 'multi');
        document.addEventListener('astro:before-preparation', event => {
          if (!event.to.pathname.endsWith('/tips-wsl/')) return;
          const load = event.loader;
          event.loader = async function () { await new Promise(resolve => setTimeout(resolve, 1000)); return load.call(this); };
        });
      });
      await page.goto(base);
      const link = page.locator('a[href$="tips-wsl/"]'); await link.hover();
      await page.waitForSelector('html > iframe[data-rm-preload-ready]', { state: 'attached' });
      await link.click({ noWaitAfter: true });
      await page.evaluate(base => {
        const child = document.querySelector('html > iframe[data-rm-prepared-reader]').contentWindow;
        child.history.replaceState(child.history.state, '', new URL('tips-python/', base).href);
      }, base);
      await page.waitForFunction(() => location.pathname.endsWith('/tips-wsl/') && document.documentElement.classList.contains('rm-active') && !document.documentElement.classList.contains('rm-pending'));
      assert.equal(await page.locator('html > iframe[data-rm-prepared-reader]').count(), 0);
      assert.equal(await page.locator('.rm-source').count(), 1);
      await page.close();
    } finally { await browser.close(); }
  });

  test(`${name}: an early article link waits for the current history entry`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce' });
      await page.addInitScript(() => {
        localStorage.setItem('dispositif:reading-mode', 'multi');
        document.addEventListener('astro:before-preparation', event => {
          if (!event.to.pathname.endsWith('/tips-wsl/')) return;
          const load = event.loader;
          event.loader = async function () { await new Promise(resolve => setTimeout(resolve, 1000)); return load.call(this); };
        });
      });
      await page.goto(base);
      const link = page.locator('a[href$="tips-wsl/"]'); await link.hover();
      await page.waitForSelector('html > iframe[data-rm-preload-ready]', { state: 'attached' });
      await link.click({ noWaitAfter: true });
      await page.evaluate(base => {
        const doc = document.querySelector('html > iframe[data-rm-prepared-reader]').contentDocument;
        const a = doc.createElement('a'); a.href = new URL('tips-python/', base).href; doc.body.append(a); a.click();
      }, base);
      await page.waitForFunction(() => location.pathname.endsWith('/tips-python/') && document.documentElement.classList.contains('rm-active') && !document.documentElement.classList.contains('rm-pending'));
      await page.goBack();
      await page.waitForFunction(() => location.pathname.endsWith('/tips-wsl/') && document.documentElement.classList.contains('rm-active') && !document.documentElement.classList.contains('rm-pending'));
      await page.close();
    } finally { await browser.close(); }
  });

  test(`${name}: switching a prepared reader to one column persists mode and position`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce' });
      await page.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
      await page.goto(base);
      const link = page.locator('a[href$="tips-wsl/"]'); await link.hover();
      await page.waitForSelector('html > iframe[data-rm-preload-ready]', { state: 'attached' });
      await link.click();
      await page.waitForFunction(() => location.pathname.endsWith('/tips-wsl/') && !!history.state?.dispositifReadingKey);
      await page.frameLocator('html > iframe[data-rm-prepared-reader]').locator('.rm-toggle').click();
      await page.waitForFunction(() => !document.querySelector('html > iframe').contentDocument.documentElement.classList.contains('rm-active'));
      const position = await page.evaluate(() => {
        const port = document.querySelector('html > iframe').contentDocument.querySelector('.rm-article-scrollport');
        port.scrollTop = 300; return port.scrollTop;
      });
      assert.ok(position > 0);
      await page.goBack();
      await page.waitForFunction(() => document.documentElement.dataset.pageKind === 'index' && !document.querySelector('html > iframe[data-rm-prepared-reader]'));
      assert.equal(await page.evaluate(() => localStorage.getItem('dispositif:reading-mode')), 'single');
      await page.locator('a[href$="tips-python/"]').hover();
      await page.waitForTimeout(400);
      assert.equal(await page.locator('html > iframe').count(), 0);
      await page.goForward();
      await page.waitForFunction(() => location.pathname.endsWith('/tips-wsl/') && document.documentElement.classList.contains('rm-ready') && !document.documentElement.classList.contains('rm-pending') && !document.documentElement.classList.contains('rm-active'));
      assert.equal(await page.locator('.rm-article-scrollport').evaluate(el => el.scrollTop), position);
      await page.close();
    } finally { await browser.close(); }
  });

  test(`${name}: single-column article fragments stay in the outer history`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce' });
      await page.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
      await page.goto(base);
      const link = page.locator('a[href$="tips-wsl/"]'); await link.hover();
      await page.waitForSelector('html > iframe[data-rm-preload-ready]', { state: 'attached' });
      await link.click();
      await page.waitForFunction(() => location.pathname.endsWith('/tips-wsl/') && !!history.state?.dispositifReadingKey);
      await page.frameLocator('html > iframe[data-rm-prepared-reader]').locator('.rm-toggle').click();
      await page.waitForFunction(() => !document.querySelector('html > iframe').contentDocument.documentElement.classList.contains('rm-active'));
      await page.evaluate(() => {
        const doc = document.querySelector('html > iframe').contentDocument;
        const target = doc.querySelector('.rm-source [id]');
        const link = doc.createElement('a'); link.id = 'test-fragment-link'; link.href = `#${target.id}`; link.textContent = 'fragment';
        doc.querySelector('.rm-source').prepend(link); link.click();
      });
      await page.waitForFunction(() => !!document.querySelector('html > iframe').contentWindow.location.hash);
      await page.waitForFunction(() => location.hash === document.querySelector('html > iframe').contentWindow.location.hash);
      await page.evaluate(() => history.back());
      await page.waitForFunction(() => location.pathname.endsWith('/tips-wsl/') && !location.hash);
      await page.goBack();
      await page.waitForFunction(() => document.documentElement.dataset.pageKind === 'index');
      await page.close();
    } finally { await browser.close(); }
  });

  test(`${name}: data saving and low memory use the normal n-column reader`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      for (const hint of ['data', 'memory']) {
        const page = await browser.newPage({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce' });
        await page.addInitScript((hint) => {
          localStorage.setItem('dispositif:reading-mode', 'multi');
          if (hint === 'data') Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
          else Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 });
        }, hint);
        await page.goto(base);
        const link = page.locator('a[href$="tips-python/"]'); await link.hover(); await page.waitForTimeout(400);
        assert.equal(await page.locator('html > iframe').count(), 0);
        await link.click();
        await page.waitForFunction(() => location.pathname.endsWith('/tips-python/') && document.documentElement.classList.contains('rm-active') && !document.documentElement.classList.contains('rm-pending'));
        assert.equal(await page.locator('html > iframe[data-rm-prepared-reader]').count(), 0);
        assert.equal(await page.locator('.rm-source').count(), 1);
        await page.close();
      }
    } finally { await browser.close(); }
  });

  test(`${name}: unready and single-mode navigation use the normal reader`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce' });
      await page.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
      await page.route('**/tips-python/', async route => {
        if (route.request().frame().parentFrame()) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          await route.abort().catch(() => {});
        } else await route.continue();
      });
      await page.goto(base);
      const link = page.locator('a[href$="tips-python/"]');
      await link.hover();
      await page.waitForSelector('html > iframe', { state: 'attached' });
      await link.click();
      await page.waitForFunction(() => location.pathname.endsWith('/tips-python/') && document.documentElement.classList.contains('rm-active') && !document.documentElement.classList.contains('rm-pending'));
      assert.equal(await page.locator('html > iframe[data-rm-prepared-reader]').count(), 0);
      assert.equal(await page.locator('.rm-source').count(), 1);
      await page.close();
      const single = await browser.newPage({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce' });
      await single.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'single'));
      await single.goto(base);
      const singleLink = single.locator('a[href$="tips-python/"]');
      await singleLink.hover();
      await single.waitForTimeout(400);
      assert.equal(await single.locator('html > iframe').count(), 0);
      await singleLink.click();
      await single.waitForFunction(() => location.pathname.endsWith('/tips-python/') && !document.documentElement.classList.contains('rm-pending'));
      assert.equal(await single.locator('html').evaluate(el => el.classList.contains('rm-active')), false);
      await single.close();
    } finally { await browser.close(); }
  });
}
