import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, firefox } from 'playwright-core';
import { toggleReadingMode } from './reading-controls.mjs';

const base = process.env.RM_BASE_URL ?? 'http://localhost:4321/dispositif/';
const selected = process.env.RM_ENGINES?.split(',');
const engines = Object.entries({ chromium, firefox }).filter(([name]) => !selected || selected.includes(name));
const article = (search = '') => new URL(`symmetric-polynomial/${search}`, base).href;

// Records whether the head script put the article text in the first column
// while the document was parsed (window.rmPremounted), with the stored mode.
const setup = (mode) => {
  if (location.protocol === 'about:') return;
  if (!sessionStorage.getItem('rm-test-stored')) {
    localStorage.setItem('dispositif:reading-mode', mode);
    sessionStorage.setItem('rm-test-stored', '1');
  }
  const observer = new MutationObserver(() => {
    if (!document.querySelector('.rm-source')) return;
    observer.disconnect();
    // Layout.astro's observer was created after this one; let it run first.
    queueMicrotask(() => {
      window.rmPremounted = Boolean(document.querySelector('.rm-slot > .rm-source'));
    });
  });
  // Chromium runs init scripts before <html> exists.
  observer.observe(document, { childList: true, subtree: true });
};

const ready = (page) => page.waitForSelector('html.rm-ready:not(.rm-pending)');
const state = (page) => page.evaluate(() => ({
  multi: document.documentElement.classList.contains('rm-active'),
  premounted: window.rmPremounted,
  stored: localStorage.getItem('dispositif:reading-mode'),
  search: location.search,
}));

for (const [name, engine] of engines) {
  test(`${name}: ?view= で記事を開く読書モードを指定できる`, { timeout: 120_000 }, async (t) => {
    const browser = await engine.launch({ executablePath: name === 'chromium' ? process.env.RM_BROWSER_PATH || undefined : undefined });
    const open = async (stored, url) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await context.addInitScript(setup, stored);
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (url !== base) await ready(page);
      return page;
    };
    try {
      await t.test('?view=multi は保存された1段より優先され、保存値を変えない', async () => {
        const page = await open('single', article('?view=multi'));
        assert.deepEqual(await state(page), { multi: true, premounted: true, stored: 'single', search: '?view=multi' });
        await page.context().close();
      });

      await t.test('?view=single は保存されたn段より優先される', async () => {
        const page = await open('multi', article('?view=single'));
        assert.deepEqual(await state(page), { multi: false, premounted: false, stored: 'multi', search: '?view=single' });
        await page.context().close();
      });

      await t.test('不正な値は無視して保存された設定に従う', async () => {
        const page = await open('multi', article('?view=columns'));
        assert.equal((await state(page)).multi, true);
        await page.context().close();
      });

      await t.test('切り替えた後の再読み込みでは切り替えた読書モードを保つ', async () => {
        const page = await open('single', article('?view=multi'));
        await toggleReadingMode(page);
        await page.waitForFunction(() => !document.documentElement.classList.contains('rm-active'));
        // The URL is left alone; the toggle saves the preference as usual.
        assert.deepEqual(await state(page), { multi: false, premounted: true, stored: 'single', search: '?view=multi' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await ready(page);
        assert.equal((await state(page)).multi, false);

        await toggleReadingMode(page);
        await page.waitForFunction(() => document.documentElement.classList.contains('rm-active'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await ready(page);
        assert.deepEqual(await state(page), { multi: true, premounted: true, stored: 'multi', search: '?view=multi' });
        await page.context().close();
      });

      await t.test('サイト内の遷移でも遷移先URLの ?view= に従い、最初の段へ先に移す', async () => {
        const page = await open('single', base);
        await page.evaluate((href) => {
          document.addEventListener('astro:after-swap', () => {
            window.rmSwapPremounted = Boolean(document.querySelector('.rm-slot > .rm-source'));
          }, { once: true });
          const link = document.createElement('a');
          link.href = href;
          link.id = 'rm-test-link';
          link.textContent = 'n段で開く';
          document.body.prepend(link);
        }, article('?view=multi'));
        await page.locator('#rm-test-link').click();
        await page.waitForURL(article('?view=multi'));
        await ready(page);
        assert.equal(await page.evaluate(() => window.rmSwapPremounted), true);
        assert.equal((await state(page)).multi, true);
        assert.equal((await state(page)).stored, 'single');
        await page.context().close();
      });
    } finally {
      await browser.close();
    }
  });
}
