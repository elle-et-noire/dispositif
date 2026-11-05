// Real PDFs printed from a non-initial reading position after ordinary index
// navigation, checked against a PDF printed from the head of a directly opened
// article, and the mode and reading position after printing.
//
// Firefox uses Marionette's WebDriver:Print (actual Gecko PDF output in
// headless mode); Chromium uses page.pdf(). No prepared iframe is involved:
// the success condition is the ordinary article. Requires Poppler.
//
// Usage: RM_BASE_URL=http://127.0.0.1:4321/dispositif/ \
//   RM_OUT=~/dispositif-artifacts/no-iframe-20261105/pdf \
//   node scripts/experiments/reading-no-iframe-print-position.mjs [chromium,firefox]
import { spawn, execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const base = process.env.RM_BASE_URL ?? 'http://127.0.0.1:4321/dispositif/';
const out = process.env.RM_OUT ?? mkdtempSync(join(tmpdir(), 'dispositif-print-position-'));
const engines = (process.argv[2] ?? 'chromium,firefox').split(',');
const firefoxBin = process.env.RM_FIREFOX ?? `${process.env.HOME}/.cache/ms-playwright/firefox-1555/firefox/firefox`;
const marionettePort = Number(process.env.RM_MARIONETTE_PORT ?? 2828);
const article = 'symmetric-polynomial';
const compareScript = fileURLToPath(new URL('./reading-pdf-compare.mjs', import.meta.url));
mkdirSync(out, { recursive: true });

// Evaluated in the page. Returns the state that must survive printing.
const STATE = `(() => {
  const root = document.documentElement, plane = document.querySelector('.rm-plane');
  const port = document.querySelector('.rm-article-scrollport'), view = document.querySelector('.rm-viewport');
  // Reading position in application ticks (1/1024 CSS px): the same quantity
  // as readingPosition() in reading-coordinates.ts. (0, k*step) and (k*p, 0)
  // denote the same position; resuming after print uses the canonical form.
  const tick = name => Math.round(parseFloat(plane?.style.getPropertyValue(name)) * 1024);
  const x = Number(plane?.dataset.rmXTicks), y = Number(plane?.dataset.rmYTicks);
  const anchor = root.classList.contains('rm-active') ? Math.floor(x / tick('--rm-p')) * tick('--rm-step') + y : null;
  return { path: location.pathname, anchor, active: root.classList.contains('rm-active'), pending: root.classList.contains('rm-pending'),
    fallback: root.classList.contains('rm-fallback'), x: plane?.dataset.rmXTicks ?? null, y: plane?.dataset.rmYTicks ?? null,
    articleTop: port?.scrollTop ?? null, viewLeft: view?.scrollLeft ?? null, viewTop: view?.scrollTop ?? null,
    sources: document.querySelectorAll('.rm-source').length, iframes: document.querySelectorAll('iframe').length,
    events: window.rmPrintEvents ?? null };
})()`;
const RECORD_EVENTS = `(() => {
  window.rmPrintEvents = [];
  const push = name => window.rmPrintEvents.push(name);
  addEventListener('beforeprint', () => push('beforeprint'));
  addEventListener('afterprint', () => push('afterprint'));
  matchMedia('print').addEventListener('change', event => push(event.matches ? 'media:print' : 'media:screen'));
  return true;
})()`;
const READY = `location.pathname.endsWith('/${article}/') && document.documentElement.classList.contains('rm-ready') && !document.documentElement.classList.contains('rm-pending')`;
// The visible reading position: logical anchor, native scroll offsets and mode.
const same = (a, b) => ['active', 'anchor', 'x', 'y', 'articleTop', 'viewLeft', 'viewTop', 'path'].every(key => a[key] === b[key]);

function comparePdf(a, b) {
  try {
    return { ...JSON.parse(execFileSync('node', [compareScript, a, b], { encoding: 'utf8' }).trim().split('\n').at(-1)), passed: true };
  } catch (error) {
    const line = String(error.stdout ?? '').trim().split('\n').at(-1);
    return { ...(line ? JSON.parse(line) : {}), passed: false, error: String(error.message).split('\n')[0] };
  }
}

// Shared procedure; `api` hides the engine-specific driver.
async function runCase(engine, mode, api) {
  const prefix = join(out, `${engine}-${mode}`);
  await api.goto(base);
  await api.eval(`(localStorage.setItem('dispositif:reading-mode', '${mode}'), true)`);
  await api.goto(base);
  await api.eval(`document.fonts.ready.then(() => true)`);
  await api.clickCard();
  await api.wait(READY);
  await api.eval(`document.fonts.ready.then(() => true)`);
  // Move away from the head with real key input, then wait for a settled state.
  if (mode === 'multi') {
    await api.eval(`(document.querySelector('.rm-viewport').focus({ preventScroll: true }), true)`);
    for (const key of ['ArrowRight', 'ArrowRight', 'PageDown']) { await api.keys([key]); await api.settled(); }
    // Also leave the column grid, as native horizontal scrolling does.
    await api.eval(`(document.querySelector('.rm-viewport').scrollLeft += 137, true)`);
  } else {
    await api.eval(`(document.querySelector('.rm-article-scrollport').focus({ preventScroll: true }), true)`);
    await api.keys(['PageDown', 'PageDown', 'PageDown']);
  }
  // A keyboard-focused scrollport prints its focus outline at page edges in
  // Chromium; remove focus so the PDF depends only on the reading state.
  await api.eval(`(document.activeElement?.blur(), true)`);
  let before = await api.settled();
  const moved = mode === 'multi'
    ? Number(before.y) > 0 && Number(before.x) % Math.round(parseFloat(await api.eval(`document.querySelector('.rm-plane').style.getPropertyValue('--rm-p')`)) * 1024) !== 0
    : before.articleTop > 0;
  await api.eval(RECORD_EVENTS);
  before = await api.settled();
  const beforeShot = await api.screenshot(`${prefix}-before-print.png`);
  const listPdf = `${prefix}-index-moved.pdf`;
  await api.print(listPdf);
  const after = await api.settled();
  const afterShot = await api.screenshot(`${prefix}-after-print.png`);
  // Baseline: the same article opened directly in a fresh page (no history
  // entry to restore) and printed at its head.
  await api.fresh();
  await api.goto(base);
  await api.eval(`(localStorage.setItem('dispositif:reading-mode', '${mode}'), true)`);
  await api.goto(new URL(`${article}/`, base).href);
  await api.wait(READY);
  await api.eval(`document.fonts.ready.then(() => true)`);
  const head = await api.settled();
  const directPdf = `${prefix}-direct-head.pdf`;
  await api.print(directPdf);
  const pdf = comparePdf(listPdf, directPdf);
  const result = {
    engine, mode, article, base, before, after, head, moved,
    modeKept: after.active === (mode === 'multi') && !after.fallback,
    positionKept: same(before, after),
    pointCanonicalised: before.x !== after.x || before.y !== after.y,
    headIsHead: head.anchor === 0 || head.articleTop === 0,
    screenshotEqual: beforeShot.equals(afterShot),
    printEvents: after.events, pdf,
  };
  result.passed = moved && result.modeKept && result.positionKept && result.screenshotEqual
    && result.headIsHead && pdf.passed && after.iframes === 0 && after.events?.includes('afterprint');
  return result;
}

async function chromiumApi() {
  const browser = await chromium.launch();
  let context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await context.newPage();
  const settled = async () => {
    let previous;
    for (let i = 0; i < 100; i++) {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await page.evaluate(STATE);
      if (previous && JSON.stringify(previous) === JSON.stringify(state)) return state;
      previous = state;
      await delay(50);
    }
    throw new Error('state did not settle');
  };
  return {
    name: 'chromium', version: browser.version(),
    goto: url => page.goto(url),
    eval: script => page.evaluate(script),
    wait: script => page.waitForFunction(script, null, { timeout: 30_000 }),
    clickCard: () => page.locator(`a[href$="${article}/"]`).click(),
    keys: async keys => { for (const key of keys) await page.keyboard.press(key); },
    settled,
    screenshot: async path => { const image = await page.screenshot(); writeFileSync(path, image); return image; },
    print: path => page.pdf({ path }),
    fresh: async () => {
      // A new context has no session history positions; runCase stores the mode again.
      await context.close();
      context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      page = await context.newPage();
    },
    close: () => browser.close(),
  };
}

async function firefoxApi() {
  const profile = mkdtempSync(join(tmpdir(), 'rm-marionette-'));
  writeFileSync(join(profile, 'user.js'), `user_pref("marionette.port", ${marionettePort});\n`);
  const browser = spawn(firefoxBin, ['-headless', '-no-remote', '-profile', profile, '-marionette'], { stdio: 'ignore' });
  let socket;
  for (let i = 0; i < 150 && !socket; i++) {
    try { socket = await new Promise((resolve, reject) => { const s = connect(marionettePort, '127.0.0.1', () => resolve(s)); s.once('error', reject); }); }
    catch { await delay(100); }
  }
  if (!socket) { browser.kill(); throw new Error('Firefox Marionette did not start'); }
  let buffer = Buffer.alloc(0); const waiting = [];
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const colon = buffer.indexOf(58); if (colon < 0) break;
      const length = Number(buffer.subarray(0, colon).toString());
      if (buffer.length < colon + 1 + length) break;
      const message = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length).toString());
      buffer = buffer.subarray(colon + 1 + length);
      waiting.shift()?.(message);
    }
  });
  const receive = () => new Promise(resolve => waiting.push(resolve));
  const hello = await receive();
  let id = 0;
  const command = async (name, params = {}) => {
    const message = JSON.stringify([0, ++id, name, params]); const reply = receive();
    socket.write(`${Buffer.byteLength(message)}:${message}`);
    const response = await reply;
    if (response[2]) throw new Error(`${name}: ${JSON.stringify(response[2])}`);
    return response[3];
  };
  const evaluate = async script => (await command('WebDriver:ExecuteAsyncScript', {
    script: `const done = arguments[arguments.length - 1]; Promise.resolve(${script}).then(done, e => done({ rmError: String(e) }));`,
    args: [], newSandbox: false,
  })).value;
  const session = await command('WebDriver:NewSession', { capabilities: {} });
  await command('WebDriver:SetWindowRect', { width: 1440, height: 900 });
  const KEYS = { ArrowRight: '', PageDown: '' };
  const settled = async () => {
    let previous;
    for (let i = 0; i < 100; i++) {
      await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      const state = await evaluate(STATE);
      if (previous && JSON.stringify(previous) === JSON.stringify(state)) return state;
      previous = state;
      await delay(50);
    }
    throw new Error('state did not settle');
  };
  return {
    name: 'firefox', version: session.capabilities?.browserVersion, marionette: hello,
    goto: url => command('WebDriver:Navigate', { url }),
    eval: evaluate,
    wait: async (script, timeout = 30_000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) { if (await evaluate(`(${script})`)) return; await delay(50); }
      throw new Error(`Timed out: ${script}`);
    },
    clickCard: async () => {
      const found = await command('WebDriver:FindElement', { using: 'css selector', value: `a[href$="${article}/"]` });
      await command('WebDriver:ElementClick', { id: Object.values(found.value ?? found)[0] });
    },
    keys: async keys => {
      for (const key of keys) {
        await command('WebDriver:PerformActions', { actions: [{ type: 'key', id: 'keyboard', actions: [
          { type: 'keyDown', value: KEYS[key] }, { type: 'keyUp', value: KEYS[key] }] }] });
        await command('WebDriver:ReleaseActions');
      }
    },
    settled,
    screenshot: async path => {
      const image = Buffer.from((await command('WebDriver:TakeScreenshot', { full: false, hash: false })).value, 'base64');
      writeFileSync(path, image); return image;
    },
    print: async path => writeFileSync(path, Buffer.from((await command('WebDriver:Print', {})).value, 'base64')),
    fresh: async () => {
      // A new tab has its own session history and sessionStorage; localStorage is shared.
      const opened = await command('WebDriver:NewWindow', { type: 'tab' });
      const old = (await command('WebDriver:GetWindowHandle')).value;
      await command('WebDriver:SwitchToWindow', { handle: opened.handle, focus: true });
      await command('WebDriver:SwitchToWindow', { handle: old, focus: false });
      await command('WebDriver:CloseWindow');
      await command('WebDriver:SwitchToWindow', { handle: opened.handle, focus: true });
    },
    close: async () => {
      try { await command('WebDriver:DeleteSession'); } catch { /* the browser is closed below */ }
      socket.destroy(); browser.kill(); await new Promise(resolve => browser.once('exit', resolve));
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

let failed = false;
for (const engine of engines) {
  const api = engine === 'firefox' ? await firefoxApi() : await chromiumApi();
  try {
    for (const mode of ['multi', 'single']) {
      let result;
      try { result = await runCase(engine, mode, api); }
      catch (error) { result = { engine, mode, passed: false, error: String(error?.stack ?? error) }; }
      result.browserVersion = api.version;
      failed ||= !result.passed;
      console.log(JSON.stringify(result));
    }
  } finally { await api.close(); }
}
console.log(JSON.stringify({ out, failed }));
process.exitCode = failed ? 1 : 0;
