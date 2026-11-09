// Regression coverage for ordinary Astro navigation after the index stopped
// preparing reader iframes. Every operation that the removed prepared-reader
// tests exercised and that remains supported is checked here in both engines.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BASE_URL, engines, launch } from "./browser.mjs";

const KEY = 'dispositif:columns';
// The reader's own script: a hashed chunk in a build, an Astro module request
// on the dev server.
const READER_SCRIPT = /ColumnLayout\.astro(?:_astro_type_script[^/]*\.js|\?astro&type=script)/;

const frames = (page, count = 2) => page.evaluate(async (count) => {
  for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
}, count);
// History traversal changes the URL before Astro swaps in the destination, so
// the previous article (still ready) can briefly sit under the new path. Also
// require that the destination itself has finished loading.
const articleReady = (page, slug) => page.waitForFunction((slug) => {
  const root = document.documentElement;
  return location.pathname.endsWith(`/${slug}/`) && window.clLoadedPath?.endsWith(`/${slug}/`)
    && root.dataset.pageKind === 'article'
    && root.classList.contains('cl-ready') && !root.classList.contains('cl-pending');
}, slug);
const indexReady = page => page.waitForFunction(() => document.documentElement.dataset.pageKind === 'index');
const isMulti = page => page.evaluate(() => document.documentElement.classList.contains('cl-multi'));
const point = page => page.locator('.cl-plane').evaluate(plane => ({ x: plane.dataset.clXTicks, y: plane.dataset.clYTicks }));
// Wait until the logical point stops changing instead of sleeping for a fixed time.
const stablePoint = async (page) => {
  let previous;
  for (let i = 0; i < 60; i++) {
    const current = await point(page);
    if (previous && current.x === previous.x && current.y === previous.y) return current;
    previous = current;
    await frames(page, 3);
  }
  throw new Error('reading point did not settle');
};
const indexScroll = page => page.locator('.article-index-shell').evaluate(el => el.scrollTop);
const focusedHref = page => page.evaluate(() => document.activeElement?.getAttribute('href') ?? null);
// Init scripts also run in the initial about:blank document, where storage is denied.
const setMode = (context, mode) => context.addInitScript(([key, mode]) => {
  if (location.protocol === 'about:') return;
  if (mode === null) localStorage.removeItem(key); else localStorage.setItem(key, mode);
}, [KEY, mode]);
// Delay only the router's loader for one destination. This does not use
// request routing and leaves the HTTP cache and prefetch behaviour intact.
const delayArticle = (context, slug, ms) => context.addInitScript(([slug, ms]) => {
  document.addEventListener('astro:before-preparation', event => {
    if (!event.to.pathname.endsWith(`/${slug}/`)) return;
    const load = event.loader;
    event.loader = async function () { await new Promise(resolve => setTimeout(resolve, ms)); return load.call(this); };
  });
}, [slug, ms]);
// Record every iframe ever attached, not only the count at the end.
const watchFrames = context => context.addInitScript(() => {
  window.clFramesSeen = 0;
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof Element && (node.matches('iframe') || node.querySelector('iframe'))) window.clFramesSeen++;
    }
  });
  const start = () => observer.observe(document, { childList: true, subtree: true });
  start();
});
const newContext = async (browser, options = {}) => {
  const context = await browser.newContext({ viewport: { width: 900, height: 500 }, reducedMotion: 'reduce', ...options });
  context.errors = [];
  await context.addInitScript(() => {
    document.addEventListener('astro:page-load', () => { window.clLoadedPath = location.pathname; });
  });
  context.on('page', page => page.on('pageerror', error => context.errors.push(String(error))));
  return context;
};
const addLink = (page, slug, id) => page.evaluate(([href, id]) => {
  const link = document.createElement('a');
  link.href = href; link.id = id; link.textContent = 'other article';
  document.querySelector('.cl-source .post').append(link);
}, [new URL(`${slug}/`, BASE_URL).href, id]);

for (const [name, engine] of engines) {
  test(`${name}: ordinary navigation keeps reading points, index position and focus across history`, { timeout: 120_000 }, async () => {
    const browser = await launch(engine);
    try {
      const context = await newContext(browser);
      await setMode(context, 'multi');
      await delayArticle(context, 'tips-python', 1000);
      const page = await context.newPage();
      await page.goto(BASE_URL);
      const link = page.locator('a[href$="tips-wsl/"]');
      await link.scrollIntoViewIfNeeded();
      const listY = await indexScroll(page);
      assert.ok(listY > 0, 'the chosen card should require index scrolling');
      await link.click();
      await articleReady(page, 'tips-wsl');
      assert.equal(await isMulti(page), true);
      await page.keyboard.press('ArrowRight');
      const first = await stablePoint(page);
      assert.ok(Number(first.x) > 0);
      // Another article: keep reading while that destination is still loading.
      await addLink(page, 'tips-python', 'cl-test-other');
      await page.evaluate(() => document.querySelector('.cl-viewport').focus({ preventScroll: true }));
      await page.evaluate(() => document.getElementById('cl-test-other').click());
      await page.keyboard.press('ArrowRight');
      const moved = await stablePoint(page);
      assert.equal(await page.evaluate(() => location.pathname.endsWith('/tips-wsl/')), true, 'the delayed destination committed too early');
      assert.ok(Number(moved.x) > Number(first.x), 'input during navigation was ignored');
      await articleReady(page, 'tips-python');
      assert.equal(await isMulti(page), true);
      await page.goBack();
      await articleReady(page, 'tips-wsl');
      assert.deepEqual(await stablePoint(page), moved);
      await page.goBack();
      await indexReady(page);
      await frames(page);
      assert.equal(await indexScroll(page), listY);
      assert.match(await focusedHref(page), /tips-wsl\/$/);
      await page.goForward();
      await articleReady(page, 'tips-wsl');
      assert.deepEqual(await stablePoint(page), moved);
      assert.equal(await page.locator('iframe').count(), 0);
      assert.deepEqual(context.errors, []);
      await context.close();
    } finally { await browser.close(); }
  });

  for (const mode of ['multi', 'single']) {
    test(`${name}: ${mode} contents links update the address, and closing or going back restores the index`, { timeout: 120_000 }, async () => {
      const browser = await launch(engine);
      try {
        const context = await newContext(browser);
        await setMode(context, mode);
        const page = await context.newPage();
        await page.goto(BASE_URL);
        const link = page.locator('a[href$="tips-wsl/"]');
        await link.scrollIntoViewIfNeeded();
        const listY = await indexScroll(page);
        const cardTop = await link.evaluate(el => el.getBoundingClientRect().top);
        await link.click();
        await articleReady(page, 'tips-wsl');
        assert.equal(await isMulti(page), mode === 'multi');
        // The index stays where it was behind the article, out of reach of
        // focus and assistive technology.
        assert.deepEqual(await page.locator('[data-article-index] a[href$="tips-wsl/"]').evaluate(el => {
          const shell = el.closest('.article-index-shell');
          return { top: el.getBoundingClientRect().top, inert: shell.inert, hidden: shell.getAttribute('aria-hidden') };
        }), { top: cardTop, inert: true, hidden: 'true' });
        const length = await page.evaluate(() => history.length);
        const start = mode === 'multi' ? await stablePoint(page) : undefined;
        const toc = mode === 'multi' ? '[data-toc-variant="header"] .toc-link' : '[data-toc-variant="sidebar"] .toc-link';
        const entry = page.locator(toc).nth(1);
        const hash = new URL(await entry.getAttribute('href'), BASE_URL).hash;
        await entry.click();
        await page.waitForFunction(hash => location.hash === hash, hash);
        assert.ok(hash);
        if (mode === 'multi') {
          assert.notDeepEqual(await stablePoint(page), start);
          assert.equal(await page.evaluate(() => history.length), length, 'n-column contents links replace the entry');
          // Clicking the gap beside the columns closes the article.
          const box = await page.locator('.cl-viewport').boundingBox();
          await page.mouse.click(4, box.y + 100);
        } else {
          assert.ok(await page.locator('.cl-article-scrollport').evaluate(el => el.scrollTop) > 0);
          await page.locator('.cl-close').click();
        }
        await indexReady(page);
        await frames(page);
        assert.equal(await indexScroll(page), listY);
        assert.match(await focusedHref(page), /tips-wsl\/$/);
        // The browser's back button restores the index the same way.
        await link.click();
        await articleReady(page, 'tips-wsl');
        await page.goBack();
        await indexReady(page);
        await frames(page);
        assert.equal(await indexScroll(page), listY, 'back did not restore the index position');
        assert.match(await focusedHref(page), /tips-wsl\/$/);
        assert.deepEqual(context.errors, []);
        await context.close();
      } finally { await browser.close(); }
    });
  }

  test(`${name}: switching to one column persists the choice, position and fragment history`, { timeout: 120_000 }, async () => {
    const browser = await launch(engine);
    try {
      const context = await newContext(browser);
      await setMode(context, 'multi');
      await watchFrames(context);
      const page = await context.newPage();
      await page.goto(BASE_URL);
      await page.locator('a[href$="tips-wsl/"]').click();
      await articleReady(page, 'tips-wsl');
      await page.locator('.cl-toggle').click();
      await page.waitForFunction(() => !document.documentElement.classList.contains('cl-multi'));
      assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), 'single');
      const position = await page.locator('.cl-article-scrollport').evaluate(el => { el.scrollTop = 300; return el.scrollTop; });
      assert.ok(position > 0);
      await frames(page);
      const target = await page.evaluate(() => {
        const target = [...document.querySelectorAll('.cl-source [id]')].at(-1);
        const link = document.createElement('a');
        link.id = 'cl-test-fragment'; link.href = `#${target.id}`; link.textContent = 'fragment';
        document.querySelector('.cl-source .post').prepend(link);
        return target.id;
      });
      await frames(page);
      const prepended = await page.locator('.cl-article-scrollport').evaluate(el => el.scrollTop);
      await page.evaluate(() => document.getElementById('cl-test-fragment').click());
      await page.waitForFunction(id => decodeURIComponent(location.hash) === `#${id}`, target);
      await page.goBack();
      await page.waitForFunction(() => location.pathname.endsWith('/tips-wsl/') && !location.hash);
      await frames(page, 4);
      assert.ok(Math.abs(await page.locator('.cl-article-scrollport').evaluate(el => el.scrollTop) - prepended) <= 1);
      await page.goBack();
      await indexReady(page);
      const other = page.locator('a[href$="tips-python/"]');
      await other.hover();
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => window.clFramesSeen), 0);
      await page.goForward();
      await articleReady(page, 'tips-wsl');
      assert.equal(await isMulti(page), false);
      // The injected link is gone after a fresh swap, so compare to the stored offset.
      assert.ok(Math.abs(await page.locator('.cl-article-scrollport').evaluate(el => el.scrollTop) - prepended) <= 1);
      assert.deepEqual(context.errors, []);
      await context.close();
    } finally { await browser.close(); }
  });

  test(`${name}: operations during an unfinished navigation leave consistent history`, { timeout: 180_000 }, async () => {
    const browser = await launch(engine);
    try {
      const run = async (label, scenario) => {
        const context = await newContext(browser);
        await setMode(context, 'multi');
        await delayArticle(context, 'tips-wsl', 1500);
        await watchFrames(context);
        const page = await context.newPage();
        try { await scenario(page); }
        catch (error) { error.message = `${label}: ${error.message}`; throw error; }
        assert.deepEqual(context.errors, [], label);
        assert.equal(await page.evaluate(() => window.clFramesSeen), 0, label);
        await context.close();
      };
      const openIndex = async (page) => {
        await page.goto(BASE_URL);
        const link = page.locator('a[href$="tips-wsl/"]');
        await link.scrollIntoViewIfNeeded();
        return { link, listY: await indexScroll(page), length: await page.evaluate(() => history.length) };
      };
      await run('same card twice', async (page) => {
        const { link, listY, length } = await openIndex(page);
        await link.click({ noWaitAfter: true });
        await page.waitForTimeout(200);
        await link.click({ noWaitAfter: true });
        await articleReady(page, 'tips-wsl');
        assert.equal(await page.evaluate(() => history.length), length + 1);
        await page.goBack();
        await indexReady(page);
        await frames(page);
        assert.equal(await indexScroll(page), listY);
      });
      await run('another card', async (page) => {
        const { link, length } = await openIndex(page);
        await link.click({ noWaitAfter: true });
        await page.waitForTimeout(200);
        // The second card may need scrolling; the index restores the position it was left at.
        const other = page.locator('a[href$="tips-python/"]');
        await other.scrollIntoViewIfNeeded();
        const listY = await indexScroll(page);
        await other.click({ noWaitAfter: true });
        await articleReady(page, 'tips-python');
        await page.waitForTimeout(1800);
        assert.equal(await page.evaluate(() => location.pathname.endsWith('/tips-python/')), true, 'the abandoned destination committed');
        assert.equal(await page.evaluate(() => history.length), length + 1);
        await page.goBack();
        await indexReady(page);
        await frames(page);
        assert.equal(await indexScroll(page), listY);
      });
      await run('index link', async (page) => {
        const { link } = await openIndex(page);
        await link.click({ noWaitAfter: true });
        await page.waitForTimeout(200);
        await page.locator('.site-article-index').click({ noWaitAfter: true });
        await page.waitForTimeout(1800);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.pageKind), 'index');
        assert.equal(await page.evaluate(() => location.pathname.endsWith('/dispositif/')), true);
      });
      await run('back', async (page) => {
        await page.goto(BASE_URL);
        await page.locator('a[href$="tips-python/"]').click();
        await articleReady(page, 'tips-python');
        await page.keyboard.press('ArrowRight');
        const reading = await stablePoint(page);
        await page.locator('.cl-close').click();
        await indexReady(page);
        await page.locator('a[href$="tips-wsl/"]').click({ noWaitAfter: true });
        await page.waitForTimeout(200);
        await page.goBack();
        await articleReady(page, 'tips-python');
        assert.deepEqual(await stablePoint(page), reading);
        await page.waitForTimeout(1800);
        assert.equal(await page.evaluate(() => location.pathname.endsWith('/tips-python/')), true, 'the abandoned destination committed');
        assert.deepEqual(await stablePoint(page), reading);
        await page.goForward();
        await indexReady(page);
      });
    } finally { await browser.close(); }
  });

  test(`${name}: unset, invalid and unavailable settings start single at every width`, { timeout: 180_000 }, async () => {
    const browser = await launch(engine);
    try {
      const cases = [
        ['unset', null], ['invalid', 'bogus'], ['case', 'MULTI'], ['empty', ''],
        ['getter throws', 'throw-getter'], ['getItem throws', 'throw-getItem'],
      ];
      for (const [label, value] of cases) {
        const context = await newContext(browser, { viewport: { width: 1920, height: 900 } });
        await context.addInitScript(([key, value]) => {
          const failure = () => new DOMException('storage disabled for test', 'SecurityError');
          // Astro's dev toolbar reads storage without a guard. It only exists
          // on the dev server, so leave its storage working and test ours.
          const fromDevToolbar = () => /dev-toolbar/.test(new Error().stack ?? '');
          if (value === 'throw-getter') {
            for (const name of ['localStorage', 'sessionStorage']) {
              let real;
              try { real = window[name]; } catch { /* already unavailable */ }
              Object.defineProperty(window, name, { configurable: true, get() {
                if (real && fromDevToolbar()) return real;
                throw failure();
              } });
            }
          } else if (value === 'throw-getItem') {
            const { getItem, setItem } = Storage.prototype;
            Storage.prototype.getItem = function (...args) { if (fromDevToolbar()) return getItem.apply(this, args); throw failure(); };
            Storage.prototype.setItem = function (...args) { if (fromDevToolbar()) return setItem.apply(this, args); throw failure(); };
          } else if (location.protocol === 'about:') return;
          else if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }, [KEY, value]);
        const page = await context.newPage();
        const check = async (where) => {
          for (const width of [1920, 390, 2560]) {
            await page.setViewportSize({ width, height: 900 });
            await frames(page, 3);
            assert.equal(await isMulti(page), false, `${label} ${where} ${width}px`);
            assert.deepEqual(await page.locator('.cl-article-scrollport').evaluate(el => [getComputedStyle(el).clipPath, el.getAttribute('aria-hidden')]), ['none', null], `${label} ${where}`);
          }
        };
        await page.goto(BASE_URL);
        await page.locator('a[href$="tips-python/"]').click();
        await articleReady(page, 'tips-python');
        await check('after index navigation');
        await page.goto(new URL('tips-wsl/', BASE_URL).href);
        await articleReady(page, 'tips-wsl');
        await check('on direct access');
        // An explicit choice still works for the current document even when
        // it cannot be stored, and resizing does not discard it.
        await page.locator('.cl-toggle').click();
        await page.waitForFunction(() => document.documentElement.classList.contains('cl-multi'));
        await page.setViewportSize({ width: 1200, height: 900 });
        await frames(page, 3);
        assert.equal(await isMulti(page), true, `${label} explicit choice after resize`);
        assert.deepEqual(context.errors, [], label);
        await context.close();
      }
    } finally { await browser.close(); }
  });

  test(`${name}: saved choices are used by later ordinary navigations`, { timeout: 120_000 }, async () => {
    const browser = await launch(engine);
    try {
      const context = await newContext(browser);
      await setMode(context, null);
      const page = await context.newPage();
      // The init script runs only for full document loads; this test then uses
      // ordinary router navigations, so the choices below are not reset.
      await page.goto(BASE_URL);
      await page.locator('a[href$="tips-python/"]').click();
      await articleReady(page, 'tips-python');
      assert.equal(await isMulti(page), false);
      await page.locator('.cl-toggle').click();
      await page.waitForFunction(() => document.documentElement.classList.contains('cl-multi'));
      assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), 'multi');
      await page.locator('.cl-close').click();
      await indexReady(page);
      await page.locator('a[href$="tips-wsl/"]').click();
      await articleReady(page, 'tips-wsl');
      assert.equal(await isMulti(page), true);
      await page.locator('.cl-toggle').click();
      await page.waitForFunction(() => !document.documentElement.classList.contains('cl-multi'));
      assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), 'single');
      await page.goBack();
      await indexReady(page);
      await page.goBack();
      await articleReady(page, 'tips-python');
      assert.equal(await isMulti(page), false, 'the saved single choice takes precedence over the layout saved in the entry');
      assert.deepEqual(context.errors, []);
      await context.close();
    } finally { await browser.close(); }
  });

  for (const mode of ['multi', 'single']) {
    test(`${name}: ${mode} article never paints in the other layout first`, { timeout: 120_000 }, async () => {
      const browser = await launch(engine);
      try {
        const context = await newContext(browser, { viewport: { width: 1440, height: 900 } });
        await setMode(context, mode);
        await context.addInitScript(() => {
          window.clPaints = [];
          const record = () => {
            const article = document.querySelector('.cl-article-scrollport');
            if (article && document.documentElement.dataset.pageKind === 'article') window.clPaints.push({
              visible: getComputedStyle(article).clipPath === 'none',
              active: document.documentElement.classList.contains('cl-multi'),
              fallback: document.documentElement.classList.contains('cl-fallback'),
            });
            requestAnimationFrame(record);
          };
          requestAnimationFrame(record);
        });
        const page = await context.newPage();
        const verify = async (where) => {
          const paints = await page.evaluate(() => window.clPaints);
          assert.ok(paints.some(paint => paint.visible), `${where}: no visible frame recorded`);
          for (const paint of paints) {
            if (!paint.visible) continue;
            assert.equal(paint.fallback, false, `${where}: ${JSON.stringify(paint)}`);
            assert.equal(paint.active, mode === 'multi', `${where}: ${JSON.stringify(paint)}`);
          }
        };
        await page.goto(new URL('symmetric-polynomial/', BASE_URL).href);
        await articleReady(page, 'symmetric-polynomial');
        await frames(page, 4);
        await verify('direct access');
        await page.goto(BASE_URL);
        await page.locator('a[href$="symmetric-polynomial/"]').click();
        await articleReady(page, 'symmetric-polynomial');
        await frames(page, 4);
        await verify('index navigation');
        assert.deepEqual(context.errors, []);
        await context.close();
      } finally { await browser.close(); }
    });
  }

  test(`${name}: the index is unchanged while hovered and articles match direct access`, { timeout: 120_000 }, async () => {
    const browser = await launch(engine);
    try {
      for (const mode of ['multi', 'single']) {
        const context = await newContext(browser);
        await setMode(context, mode);
        const page = await context.newPage();
        await page.goto(BASE_URL);
        await page.evaluate(() => document.fonts.ready);
        const link = page.locator('a[href$="tips-wsl/"]');
        await link.hover();
        const listY = await indexScroll(page);
        await page.waitForTimeout(200);
        const before = await page.screenshot();
        await page.waitForTimeout(1500);
        assert.ok((await page.screenshot()).equals(before), `${mode}: hovering changed the visible index`);
        assert.equal(await indexScroll(page), listY);
        await link.click();
        await articleReady(page, 'tips-wsl');
        await page.mouse.move(0, 0);
        await frames(page, 4);
        const actual = await page.screenshot();
        const normal = await context.newPage();
        await normal.goto(new URL('tips-wsl/', BASE_URL).href);
        await articleReady(normal, 'tips-wsl');
        await normal.evaluate(() => document.fonts.ready);
        await normal.locator('[data-article-index]').evaluate((el, y) => el.style.setProperty('--article-index-offset', `${-y}px`), listY);
        await normal.mouse.move(0, 0);
        await frames(normal, 4);
        const expected = await normal.screenshot();
        const difference = await page.evaluate(async ({ first, second }) => {
          const images = await Promise.all([first, second].map(async data => { const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode(); return image; }));
          const canvas = document.createElement('canvas'); canvas.width = images[0].width; canvas.height = images[0].height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(images[0], 0, 0); const a = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(images[1], 0, 0); const b = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let changed = 0; for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 5) changed++;
          return { changed, pixels: a.length / 4 };
        }, { first: actual.toString('base64'), second: expected.toString('base64') });
        assert.ok(difference.changed / difference.pixels < 0.001, `${mode}: article differs at ${difference.changed} pixels`);
        assert.deepEqual(context.errors, []);
        await context.close();
      }
    } finally { await browser.close(); }
  });

  test(`${name}: failed or late reader initialization keeps the single fallback`, { timeout: 120_000 }, async () => {
    const browser = await launch(engine);
    try {
      const prepare = async (context) => {
        await setMode(context, 'multi');
        // Shorten only the layout's 10 s fallback timer.
        await context.addInitScript(() => {
          const original = window.setTimeout;
          window.setTimeout = (handler, delay, ...args) => original(handler, delay === 10000 ? 100 : delay, ...args);
        });
      };
      const visibleFallback = async (page, label) => {
        await page.waitForFunction(() => document.documentElement.classList.contains('cl-fallback'));
        assert.deepEqual(await page.locator('.cl-article-scrollport').evaluate(el => [getComputedStyle(el).clipPath, el.getAttribute('aria-hidden')]), ['none', null], label);
        assert.equal(await isMulti(page), false, label);
        // A column mounted before the swap is returned to the single article.
        assert.equal(await page.locator('.cl-plane .cl-source, .cl-plane > *').count(), 0, label);
        assert.equal(await page.locator('.cl-reader').evaluate(el => el.hidden), true, label);
        assert.ok(await page.locator('.cl-source').evaluate(el => !el.style.width && el.getBoundingClientRect().height > 0), label);
      };
      {
        const context = await newContext(browser);
        await prepare(context);
        await context.route(READER_SCRIPT, route => route.abort());
        const page = await context.newPage();
        await page.goto(BASE_URL);
        await page.locator('a[href$="tips-python/"]').click({ noWaitAfter: true });
        await page.waitForFunction(() => location.pathname.endsWith('/tips-python/'));
        await visibleFallback(page, 'failed bundle after index navigation');
        await context.close();
      }
      for (const route of ['index', 'direct']) {
        const context = await newContext(browser);
        await prepare(context);
        let released;
        const gate = new Promise(resolve => { released = resolve; });
        await context.route(READER_SCRIPT, async request => { await gate; await request.continue(); });
        const page = await context.newPage();
        if (route === 'index') {
          await page.goto(BASE_URL);
          await page.locator('a[href$="tips-python/"]').click({ noWaitAfter: true });
        } else await page.goto(new URL('tips-python/', BASE_URL).href, { waitUntil: 'commit' });
        await page.waitForFunction(() => location.pathname.endsWith('/tips-python/') && document.documentElement.dataset.pageKind === 'article');
        await visibleFallback(page, `late bundle (${route}) before initialization`);
        released();
        await page.waitForFunction(() => document.documentElement.classList.contains('cl-ready'));
        await frames(page, 4);
        await visibleFallback(page, `late bundle (${route}) after initialization`);
        await page.setViewportSize({ width: 1440, height: 900 });
        await frames(page, 4);
        assert.equal(await isMulti(page), false, `late bundle (${route}) after resize`);
        assert.equal(await page.locator('.cl-source').count(), 1);
        await page.locator('.cl-toggle').click();
        await page.waitForFunction(() => document.documentElement.classList.contains('cl-multi') && !document.documentElement.classList.contains('cl-fallback'));
        await context.close();
      }
    } finally { await browser.close(); }
  });

  test(`${name}: a started reader whose first frame is delayed keeps the saved choice`, { timeout: 120_000 }, async () => {
    // Background tabs do not run animation frames, so the reader's first
    // frame can come after the fallback timer. That is not a failed reader.
    const browser = await launch(engine);
    try {
      for (const route of ['index', 'direct']) {
        const context = await newContext(browser);
        await setMode(context, 'multi');
        await context.addInitScript(() => {
          const originalTimeout = window.setTimeout;
          window.setTimeout = (handler, delay, ...args) => originalTimeout(handler, delay === 10000 ? 1000 : delay, ...args);
          const originalFrame = window.requestAnimationFrame.bind(window);
          let held = null;
          window.__holdFrames = () => { held = []; };
          window.__releaseFrames = () => { const queued = held ?? []; held = null; for (const callback of queued) originalFrame(callback); };
          window.requestAnimationFrame = (callback) => {
            if (!held) return originalFrame(callback);
            held.push(callback);
            return -held.length;
          };
        });
        const page = await context.newPage();
        if (route === 'index') {
          await page.goto(BASE_URL);
          await page.evaluate(() => document.addEventListener('astro:after-swap', () => window.__holdFrames(), { once: true }));
          await page.locator('a[href$="tips-python/"]').click({ noWaitAfter: true });
        } else {
          await context.addInitScript(() => { if (location.pathname.endsWith('/tips-python/')) window.__holdFrames(); });
          await page.goto(new URL('tips-python/', BASE_URL).href, { waitUntil: 'commit' });
        }
        // Default polling uses animation frames, which are held here.
        await page.waitForFunction(() => document.documentElement.classList.contains('cl-ready'), null, { polling: 50 });
        // The shortened timer still leaves the reader time to start; then wait
        // well past it while the first frame is held.
        await page.waitForTimeout(1300);
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cl-fallback')), false, `${route}: no fallback while held`);
        await page.evaluate(() => window.__releaseFrames());
        await page.waitForFunction(() => !document.documentElement.classList.contains('cl-pending'));
        await frames(page, 3);
        assert.equal(await isMulti(page), true, `${route}: saved multi choice applied`);
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cl-fallback')), false, route);
        await context.close();
      }
    } finally { await browser.close(); }
  });

  test(`${name}: printing resumes the exact n-column point, including within a column`, { timeout: 120_000 }, async () => {
    const browser = await launch(engine);
    try {
      const context = await newContext(browser, { viewport: { width: 1440, height: 900 } });
      await setMode(context, 'multi');
      const page = await context.newPage();
      await page.goto(BASE_URL);
      await page.locator('a[href$="symmetric-polynomial/"]').click();
      await articleReady(page, 'symmetric-polynomial');
      await page.evaluate(() => document.querySelector('.cl-viewport').focus({ preventScroll: true }));
      await page.keyboard.press('PageDown');
      await stablePoint(page);
      // Native horizontal scrolling leaves the column grid.
      await page.evaluate(() => { document.querySelector('.cl-viewport').scrollLeft += 137; });
      const before = await stablePoint(page);
      const p = await page.locator('.cl-plane').evaluate(plane => Math.round(parseFloat(plane.style.getPropertyValue('--cl-p')) * 1024));
      assert.ok(Number(before.y) > 0 && Number(before.x) % p !== 0, JSON.stringify(before));
      const native = () => page.locator('.cl-viewport').evaluate(el => [el.scrollLeft, el.scrollTop]);
      const nativeBefore = await native();
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
      await frames(page);
      assert.equal(await isMulti(page), false, 'the reader is suspended for printing');
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await page.emulateMedia({ media: 'screen' });
      await page.waitForFunction(() => document.documentElement.classList.contains('cl-multi'));
      assert.deepEqual(await stablePoint(page), before);
      assert.deepEqual(await native(), nativeBefore);
      assert.deepEqual(context.errors, []);
      await context.close();
    } finally { await browser.close(); }
  });

  for (const mode of ['multi', 'single']) {
    test(`${name}: ${mode} hover and focus never create reader iframes and still prefetch HTML`, { timeout: 120_000 }, async () => {
      const browser = await launch(engine);
      try {
        const actions = {
          'long hover': async (page, link) => { await link.hover(); await page.waitForTimeout(1000); },
          'short hover': async (page, link) => { await link.hover(); await page.waitForTimeout(30); await page.mouse.move(0, 0); },
          'long focus': async (page, link) => { await link.focus(); await page.waitForTimeout(1000); },
          'short focus': async (page, link) => { await link.focus(); await page.waitForTimeout(30); await page.evaluate(() => document.activeElement.blur()); },
        };
        const results = {};
        for (const [label, act] of Object.entries(actions)) {
          const context = await newContext(browser);
          await setMode(context, mode);
          await watchFrames(context);
          const page = await context.newPage();
          await page.goto(BASE_URL);
          await page.evaluate(() => document.fonts.ready);
          const requests = [];
          page.on('request', request => {
            if (new URL(request.url()).pathname.endsWith('/tips-wsl/')) requests.push(request.resourceType());
          });
          const link = page.locator('a[href$="tips-wsl/"]');
          await link.scrollIntoViewIfNeeded();
          await act(page, link);
          await page.waitForTimeout(1500);
          assert.equal(await page.evaluate(() => window.clFramesSeen), 0, label);
          assert.equal(await page.locator('iframe').count(), 0, label);
          results[label] = [...requests];
          if (label.startsWith('long')) {
            assert.ok(requests.length > 0 && requests.every(type => type !== 'document'), `${label}: no HTML prefetch (${requests})`);
            await link.click();
            await articleReady(page, 'tips-wsl');
            assert.equal(await isMulti(page), mode === 'multi', label);
            assert.equal(await page.evaluate(() => window.clFramesSeen), 0, label);
          }
          assert.deepEqual(context.errors, [], label);
          await context.close();
        }
        // Astro starts hover/focus prefetch after 80 ms; record the short cases.
        test.diagnostic?.(JSON.stringify(results));
        console.log(`# ${name} ${mode} prefetch requests ${JSON.stringify(results)}`);
      } finally { await browser.close(); }
    });
  }
}
