import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, firefox } from 'playwright-core';
import { toggleColumns } from './column-controls.mjs';

const base = process.env.TEST_BASE_URL ?? 'http://localhost:4321/dispositif/';
const selected = process.env.TEST_ENGINES?.split(',');
const engines = Object.entries({ chromium, firefox }).filter(([name]) => !selected || selected.includes(name));
const article = (search = '') => new URL(`symmetric-polynomial/${search}`, base).href;

// Records whether the head script put the article text in the first column
// while the document was parsed (window.clPremounted), with the stored mode.
const setup = (mode) => {
  if (location.protocol === 'about:') return;
  if (!sessionStorage.getItem('cl-test-stored')) {
    localStorage.setItem('dispositif:columns', mode);
    sessionStorage.setItem('cl-test-stored', '1');
  }
  const observer = new MutationObserver(() => {
    if (!document.querySelector('.cl-source')) return;
    observer.disconnect();
    // Layout.astro's observer was created after this one; let it run first.
    queueMicrotask(() => {
      window.clPremounted = Boolean(document.querySelector('.cl-slot > .cl-source'));
    });
  });
  // Chromium runs init scripts before <html> exists.
  observer.observe(document, { childList: true, subtree: true });
};

const ready = (page) => page.waitForSelector('html.cl-ready:not(.cl-pending)');
const state = (page) => page.evaluate(() => ({
  multi: document.documentElement.classList.contains('cl-multi'),
  premounted: window.clPremounted,
  stored: localStorage.getItem('dispositif:columns'),
  search: location.search,
}));

for (const [name, engine] of engines) {
  test(`${name}: ?columns= で記事を開く段組みを指定できる`, { timeout: 120_000 }, async (t) => {
    const browser = await engine.launch({ executablePath: name === 'chromium' ? process.env.TEST_BROWSER_PATH || undefined : undefined });
    const open = async (stored, url) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await context.addInitScript(setup, stored);
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (url !== base) await ready(page);
      return page;
    };
    try {
      await t.test('?columns=multi は保存された1段より優先され、保存値を変えない', async () => {
        const page = await open('single', article('?columns=multi'));
        assert.deepEqual(await state(page), { multi: true, premounted: true, stored: 'single', search: '?columns=multi' });
        await page.context().close();
      });

      await t.test('?columns=single は保存されたn段より優先される', async () => {
        const page = await open('multi', article('?columns=single'));
        assert.deepEqual(await state(page), { multi: false, premounted: false, stored: 'multi', search: '?columns=single' });
        await page.context().close();
      });

      await t.test('不正な値は無視して保存された設定に従う', async () => {
        const page = await open('multi', article('?columns=other'));
        assert.equal((await state(page)).multi, true);
        await page.context().close();
      });

      await t.test('切り替えた後の再読み込みでは切り替えた段組みを保つ', async () => {
        const page = await open('single', article('?columns=multi'));
        await toggleColumns(page);
        await page.waitForFunction(() => !document.documentElement.classList.contains('cl-multi'));
        // The URL is left alone; the toggle saves the preference as usual.
        assert.deepEqual(await state(page), { multi: false, premounted: true, stored: 'single', search: '?columns=multi' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await ready(page);
        assert.equal((await state(page)).multi, false);

        await toggleColumns(page);
        await page.waitForFunction(() => document.documentElement.classList.contains('cl-multi'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await ready(page);
        assert.deepEqual(await state(page), { multi: true, premounted: true, stored: 'multi', search: '?columns=multi' });
        await page.context().close();
      });

      await t.test('サイト内の遷移でも遷移先URLの ?columns= に従い、最初の段へ先に移す', async () => {
        const page = await open('single', base);
        await page.evaluate((href) => {
          document.addEventListener('astro:after-swap', () => {
            window.clSwapPremounted = Boolean(document.querySelector('.cl-slot > .cl-source'));
          }, { once: true });
          const link = document.createElement('a');
          link.href = href;
          link.id = 'cl-test-link';
          link.textContent = 'n段で開く';
          document.body.prepend(link);
        }, article('?columns=multi'));
        await page.locator('#cl-test-link').click();
        await page.waitForURL(article('?columns=multi'));
        await ready(page);
        assert.equal(await page.evaluate(() => window.clSwapPremounted), true);
        assert.equal((await state(page)).multi, true);
        assert.equal((await state(page)).stored, 'single');
        await page.context().close();
      });
    } finally {
      await browser.close();
    }
  });
}
