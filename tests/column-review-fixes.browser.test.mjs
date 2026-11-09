import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { BASE_URL, ARTICLE_URL, engines, launch, storeColumns, waitForColumnLayout } from "./browser.mjs";

const settle = (page) => page.evaluate(async () => {
  for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
});

test("本文内リンクの履歴ごとに位置と折りたたみを保存し、戻る・進む・一覧からの復帰で復元する", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await storeColumns(page, "single");
    await page.goto(new URL("nextjs-mdx/", BASE_URL).href);
    await waitForColumnLayout(page);
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".cl-source details summary").first().click();
    const link = page.locator('.cl-source a[href^="#"]').filter({ hasText: "参考文献" }).first();
    await link.scrollIntoViewIfNeeded();
    await settle(page);
    const snapshot = () => page.evaluate(() => ({
      top: document.querySelector(".cl-article-scrollport").scrollTop,
      open: document.querySelector(".cl-source details").open,
      key: history.state?.dispositifReadingKey,
    }));
    const before = await snapshot();
    assert.equal(before.open, true);
    await link.click();
    await page.waitForURL(/#.+/);
    await settle(page);
    await page.locator(".cl-source details").first().evaluate((details) => { details.open = false; });
    await settle(page);
    const destination = await snapshot();
    assert.notEqual(destination.key, before.key);
    assert.notEqual(destination.top, before.top);
    assert.equal(destination.open, false);
    await page.goBack();
    await settle(page);
    assert.deepEqual(await snapshot(), before);
    await page.goForward();
    await settle(page);
    assert.deepEqual(await snapshot(), destination);
    await page.locator(".cl-close:visible").click();
    await page.waitForSelector('html[data-page-kind="index"]');
    await page.goBack();
    await waitForColumnLayout(page);
    await settle(page);
    assert.deepEqual(await snapshot(), destination);
  } finally { await browser.close(); }
});

test("直接のハッシュ変更でも履歴項目を区別し、一覧から記事へ戻れる", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await storeColumns(page, "single");
    await page.goto(ARTICLE_URL);
    await waitForColumnLayout(page);
    await settle(page);
    await page.locator(".cl-article-scrollport").evaluate((v) => { v.scrollTop = 2500; });
    await settle(page);
    const initialKey = await page.evaluate(() => history.state.dispositifReadingKey);
    await page.evaluate(() => { location.hash = document.querySelector(".cl-source h2").id; });
    await page.waitForFunction(() => location.hash && history.state?.dispositifReadingKey);
    await settle(page);
    const hashState = await page.evaluate(() => ({ key: history.state.dispositifReadingKey,
      top: document.querySelector(".cl-article-scrollport").scrollTop }));
    assert.notEqual(hashState.key, initialKey);
    await page.locator(".cl-close:visible").click();
    await page.waitForSelector('html[data-page-kind="index"]');
    await page.goBack();
    await waitForColumnLayout(page);
    await settle(page);
    assert.deepEqual(await page.evaluate(() => ({ key: history.state.dispositifReadingKey,
      top: document.querySelector(".cl-article-scrollport").scrollTop })), hashState);
    await page.goBack();
    await settle(page);
    assert.equal(await page.locator(".cl-article-scrollport").evaluate((v) => v.scrollTop), 2500);
    await page.goForward();
    await settle(page);
    assert.deepEqual(await page.evaluate(() => ({ key: history.state.dispositifReadingKey,
      top: document.querySelector(".cl-article-scrollport").scrollTop })), hashState);
  } finally { await browser.close(); }
});

test("直接のハッシュ変更後に段を切り替えて戻っても元の本文付近へ戻る", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await storeColumns(page, "single");
    await page.goto(ARTICLE_URL);
    await waitForColumnLayout(page);
    await page.evaluate(() => document.fonts.ready);
    const heading = page.locator(".cl-source h2").nth(5);
    const name = await heading.innerText();
    await heading.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await settle(page);
    await page.evaluate(() => { location.hash = document.querySelector(".cl-source h2").id; });
    await page.waitForFunction(() => location.hash && history.state?.dispositifReadingKey);
    await settle(page);
    await page.locator(".cl-toggle").click();
    await page.waitForSelector("html.cl-multi .cl-slot");
    await page.goBack();
    await settle(page);
    const visible = await page.locator(".cl-slot h2").evaluateAll((headings, name) => headings
      .filter((h) => h.textContent === name).map((h) => h.getBoundingClientRect().toJSON())
      .filter((r) => r.x >= 0 && r.x < innerWidth && r.y >= 60 && r.y < innerHeight), name);
    assert.ok(visible.some((r) => r.y < 130), JSON.stringify(visible));
  } finally { await browser.close(); }
});

test("キーボード由来でもdetail=1のクリックでは選択先へフォーカスする", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await storeColumns(page, "multi");
    await page.goto(ARTICLE_URL);
    await page.waitForSelector(".cl-slot");
    const link = page.locator('[data-toc-variant="header"] .toc-link').nth(1);
    await link.focus();
    await link.evaluate((el) => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      el.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true, cancelable: true }));
    });
    await settle(page);
    assert.equal(await page.evaluate(() => document.activeElement.tagName), "H2");
    await page.goto(new URL("nextjs-mdx/", BASE_URL).href);
    await page.waitForSelector(".cl-slot");
    const summary = page.locator(".cl-source details summary").first();
    await summary.focus();
    await page.keyboard.press("Enter");
    const close = page.locator(".cl-source details .details-close-button--bottom").first();
    await close.focus();
    await close.evaluate((el) => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      el.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true, cancelable: true }));
    });
    await settle(page);
    assert.equal(await summary.locator("..").evaluate((details) => details.open), false);
    assert.equal(await summary.evaluate((el) => document.activeElement === el), true);
  } finally { await browser.close(); }
});

test("履歴復元では折りたたみの開閉状態を先に戻し、中や後の読書位置を保つ", { timeout: 90_000 }, async () => {
  const browser = await launch(chromium);
  try {
    for (const mode of ["single", "multi"]) for (const location of ["inside", "after"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
      try {
        await storeColumns(page, mode);
        await page.goto(new URL("nextjs-mdx/", BASE_URL).href);
        await waitForColumnLayout(page);
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        const summary = page.locator(".cl-source details summary").first();
        if (mode === "multi") { await summary.focus(); await page.keyboard.press("Enter"); }
        else await summary.click();
        await settle(page);
        const target = await page.evaluate((location) => {
          const details = document.querySelector(".cl-source details");
          const element = location === "inside" ? [...details.querySelectorAll("pre, p")].at(-1)
            : [...document.querySelectorAll(".cl-source h2[id]")].find((heading) =>
              Boolean(details.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING));
          if (!element) throw new Error("対象の本文が見つからない");
          element.setAttribute("data-history-test-target", "");
          return element.textContent;
        }, location);
        const original = page.locator(".cl-source [data-history-test-target]");
        if (mode === "multi") await original.evaluate((el) => { el.tabIndex = -1; el.focus(); });
        else await original.evaluate((el) => el.scrollIntoView({ block: "start" }));
        await settle(page);
        const before = await page.evaluate((mode) => mode === "single"
          ? document.querySelector(".cl-article-scrollport").scrollTop
          : [document.querySelector(".cl-plane").dataset.clXTicks, document.querySelector(".cl-plane").dataset.clYTicks], mode);
        await page.locator(".cl-close:visible").click();
        await page.waitForSelector('html[data-page-kind="index"]');
        await page.goBack();
        await waitForColumnLayout(page);
        await settle(page);
        assert.equal(await page.locator(".cl-source details").first().evaluate((d) => d.open), true, `${mode}: 詳細が閉じた`);
        assert.equal(await page.locator(".cl-source details").nth(1).evaluate((d) => d.open), false, `${mode}: 別の詳細が開いた`);
        const after = await page.evaluate((mode) => mode === "single"
          ? document.querySelector(".cl-article-scrollport").scrollTop
          : [document.querySelector(".cl-plane").dataset.clXTicks, document.querySelector(".cl-plane").dataset.clYTicks], mode);
        assert.deepEqual(after, before, `${mode}, ${location}: 読書位置が変わった`);
        if (mode === "single") {
          const visible = location === "inside" ? page.locator(".cl-source details").first().locator("pre, p").last()
            : page.locator(".cl-source h2[id]").filter({ hasText: target }).first();
          const rect = await visible.boundingBox();
          assert.ok(rect && rect.y < 700 && rect.y + rect.height > 0, `${mode}, ${location}: 対象が画面外`);
        }
        await page.reload();
        await waitForColumnLayout(page);
        await settle(page);
        assert.equal(await page.locator(".cl-source details").first().evaluate((d) => d.open), true, `${mode}: 再読込で詳細が閉じた`);
        const reloaded = await page.evaluate((mode) => mode === "single"
          ? document.querySelector(".cl-article-scrollport").scrollTop
          : [document.querySelector(".cl-plane").dataset.clXTicks, document.querySelector(".cl-plane").dataset.clYTicks], mode);
        assert.deepEqual(reloaded, before, `${mode}, ${location}: 再読込で読書位置が変わった`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("履歴から戻ると1段のスクロール位置とn段の縦横位置を復元する", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  try {
    for (const mode of ["single", "multi"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      try {
        await storeColumns(page, mode);
        await page.goto(ARTICLE_URL);
        await waitForColumnLayout(page);
        await settle(page);
        if (mode === "multi") {
          await page.locator(".cl-viewport").evaluate((v) => { v.scrollLeft += 500; v.scrollTop += 150; });
        } else await page.locator(".cl-article-scrollport").evaluate((v) => { v.scrollTop = 2500; });
        await settle(page);
        const position = async () => page.evaluate((mode) => mode === "single"
          ? document.querySelector(".cl-article-scrollport").scrollTop
          : [document.querySelector(".cl-plane").dataset.clXTicks, document.querySelector(".cl-plane").dataset.clYTicks], mode);
        const before = await position();
        await page.locator(".cl-close:visible").click();
        await page.waitForURL(BASE_URL);
        await page.goBack();
        await waitForColumnLayout(page);
        await settle(page);
        assert.deepEqual(await position(), before);
        await page.reload();
        await waitForColumnLayout(page);
        await settle(page);
        assert.deepEqual(await position(), before, "再読み込み後に履歴項目の位置を失った");
        await page.goForward();
        await page.waitForURL(BASE_URL);
        await page.goBack();
        await waitForColumnLayout(page);
        await settle(page);
        assert.deepEqual(await position(), before, "再読み込み後の履歴移動で位置を失った");
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("本文の幅が変わっても段の切り替えで同じ見出しの位置を保つ", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await storeColumns(page, "single");
    await page.goto(ARTICLE_URL);
    await waitForColumnLayout(page);
    await page.evaluate(() => document.fonts.ready);
    const heading = page.locator(".cl-source h2").nth(6);
    const id = await heading.getAttribute("id");
    const name = await heading.innerText();
    await heading.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.locator(".cl-toggle").click();
    await page.waitForSelector(".cl-slot");
    await settle(page);
    const visible = await page.locator(".cl-slot h2").evaluateAll((headings, name) => headings
      .filter((h) => h.textContent === name).map((h) => h.getBoundingClientRect().toJSON())
      .filter((r) => r.x >= 0 && r.x < innerWidth && r.y >= 60 && r.y < innerHeight), name);
    assert.ok(visible.some((r) => r.y < 130), JSON.stringify(visible));
    await page.locator(".cl-toggle").click();
    await settle(page);
    const top = await page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top, id);
    assert.ok(Math.abs(top - 24) < 5, `切り替え後の見出し位置: ${top}`);
  } finally { await browser.close(); }
});

test("別の記事で表示モードを変えてから履歴で戻っても同じ本文付近を表示する", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await storeColumns(page, "single");
    await page.goto(ARTICLE_URL);
    await waitForColumnLayout(page);
    await page.evaluate(() => document.fonts.ready);
    const heading = page.locator(".cl-source h2").nth(6);
    const name = await heading.innerText();
    await heading.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.locator(".cl-close:visible").click();
    await page.waitForURL(BASE_URL);
    await page.locator('[data-article-index] a[href*="nextjs-mdx"]').click();
    await waitForColumnLayout(page);
    await page.locator(".cl-toggle").click();
    await page.waitForSelector("html.cl-multi .cl-slot");
    await page.goBack();
    await page.waitForURL(BASE_URL);
    await page.waitForSelector('html[data-page-kind="index"]');
    await page.goBack();
    await page.waitForURL(ARTICLE_URL);
    await page.waitForSelector('html[data-page-kind="article"].cl-ready.cl-multi .cl-slot');
    await settle(page);
    const visible = await page.locator(".cl-slot h2").evaluateAll((headings, name) => headings
      .filter((h) => h.textContent === name).map((h) => h.getBoundingClientRect().toJSON())
      .filter((r) => r.x >= 0 && r.x < innerWidth && r.y >= 60 && r.y < innerHeight), name);
    assert.ok(visible.some((r) => r.y < 130), JSON.stringify(visible));
  } finally { await browser.close(); }
});

test("目次で選んだ見出しと、閉じた詳細の見出しに表示位置を合わせてフォーカスする", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await storeColumns(page, "multi");
    await page.goto(ARTICLE_URL);
    await page.waitForSelector(".cl-slot");
    await page.locator('[data-toc-variant="header"] .toc-link').nth(1).focus();
    await page.keyboard.press("Enter");
    await settle(page);
    const focused = await page.evaluate(() => ({ tag: document.activeElement.tagName,
      rect: document.activeElement.getBoundingClientRect().toJSON() }));
    assert.equal(focused.tag, "H2");
    assert.ok(focused.rect.x >= 0 && focused.rect.x < 1280 && focused.rect.y >= 0 && focused.rect.y < 900,
      JSON.stringify(focused));
    await page.goto(new URL("nextjs-mdx/", BASE_URL).href);
    await page.waitForSelector(".cl-slot");
    const summary = page.locator(".cl-source details summary").first();
    await summary.focus();
    await page.keyboard.press("Enter");
    assert.equal(await summary.locator("..").evaluate((details) => details.open), true);
    await page.locator(".cl-source details .details-close-button--bottom").first().focus();
    await page.keyboard.press("Enter");
    await settle(page);
    assert.equal(await summary.locator("..").evaluate((details) => details.open), false);
    assert.equal(await summary.evaluate((el) => document.activeElement === el), true);
    const rect = await summary.boundingBox();
    assert.ok(rect.x >= 0 && rect.x < 1280 && rect.y >= 0 && rect.y < 900);
  } finally { await browser.close(); }
});

test("最初のフレームより前に記事を離れても、その履歴項目の折りたたみとアンカーを上書きしない", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.addInitScript(() => {
      if (location.protocol === "about:") return;
      localStorage.setItem("dispositif:columns", "single");
      // Hold animation frames on demand, as a background tab does.
      const request = window.requestAnimationFrame.bind(window);
      const cancel = window.cancelAnimationFrame.bind(window);
      let held = null;
      window.__holdFrames = () => { held = new Map(); };
      window.__releaseFrames = () => { const queued = held ?? new Map(); held = null; for (const callback of queued.values()) request(callback); };
      let next = 0;
      window.requestAnimationFrame = (callback) => {
        if (!held) return request(callback);
        held.set(--next, callback);
        return next;
      };
      window.cancelAnimationFrame = (id) => { if (held?.delete(id)) return; cancel(id); };
    });
    await page.goto(new URL("nextjs-mdx/", BASE_URL).href);
    await waitForColumnLayout(page);
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".cl-source details summary").first().click();
    await page.locator(".cl-article-scrollport").evaluate((v) => { v.scrollTop = 1500; });
    await settle(page);
    const key = await page.evaluate(() => history.state.dispositifReadingKey);
    await page.locator(".cl-close:visible").click();
    await page.waitForSelector('html[data-page-kind="index"]');

    // Return to the entry, and leave it again while its first frame is held.
    await page.evaluate(() => document.addEventListener("astro:after-swap", () => window.__holdFrames(), { once: true }));
    await page.goBack();
    await page.waitForFunction(() => document.documentElement.dataset.pageKind === "article"
      && document.documentElement.classList.contains("cl-ready"), null, { polling: 50 });
    await page.evaluate(() => document.addEventListener("astro:after-swap", () => window.__releaseFrames(), { once: true }));
    await page.goForward();
    await page.waitForFunction(() => document.documentElement.dataset.pageKind === "index", null, { polling: 50 });

    // A full load hides the page and writes the positions to session storage.
    await page.goto(BASE_URL);
    const saved = await page.evaluate((key) => new Map(JSON.parse(sessionStorage.getItem("dispositif:reading-history"))).get(key), key);
    assert.equal(saved?.details?.[0], true, JSON.stringify(saved));
    assert.ok(saved?.anchor, JSON.stringify(saved));
  } finally { await browser.close(); }
});

test("保存済みの履歴が壊れていても、新しい読書位置を保存する", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.addInitScript(() => {
      if (location.protocol === "about:") return;
      localStorage.setItem("dispositif:columns", "single");
      if (sessionStorage.getItem("cl-test-damaged")) return;
      sessionStorage.setItem("cl-test-damaged", "1");
      sessionStorage.setItem("dispositif:reading-history", "{damaged");
    });
    await page.goto(ARTICLE_URL);
    await waitForColumnLayout(page);
    await settle(page);
    await page.locator(".cl-article-scrollport").evaluate((v) => { v.scrollTop = 1200; });
    await settle(page);
    const key = await page.evaluate(() => history.state.dispositifReadingKey);
    await page.goto(BASE_URL);
    const saved = await page.evaluate((key) => new Map(JSON.parse(sessionStorage.getItem("dispositif:reading-history"))).get(key), key);
    assert.equal(saved?.position, 1200, JSON.stringify(saved));
  } finally { await browser.close(); }
});

test("n段表示で折りたたみをクリックしても表示位置を動かさず、キーボードのフォーカスには追従する", { timeout: 90_000 }, async () => {
  const browser = await launch(chromium);
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await storeColumns(page, "multi");
    await page.goto(new URL("nextjs-mdx/", BASE_URL).href);
    await waitForColumnLayout(page);
    await page.evaluate(() => document.fonts.ready);
    return page;
  };
  let page;
  try {
    const summaries = () => page.evaluate(() => {
      const originals = [...document.querySelectorAll(".cl-source details")];
      return [...document.querySelectorAll(".cl-slot summary")].map((summary) => {
        const rect = summary.getBoundingClientRect(), details = summary.parentElement;
        const hit = document.elementFromPoint(rect.left + 5, rect.top + 10);
        return { x: rect.left, y: rect.top, hit: Boolean(hit && summary.contains(hit)), source: Boolean(summary.closest(".cl-source")),
          index: summary.closest(".cl-source") ? originals.indexOf(details) : Number(details.dataset.clDetails) };
      }).filter((s) => s.hit && s.y > 100 && s.y < 850);
    });
    const kinds = new Set();
    // Offsets between column boundaries, so that rounding to a column shows.
    for (const left of [700, 2000, 2333]) {
      // A fresh tab: the same entry would restore the previous iteration's details.
      await page?.close();
      page = await open();
      await page.locator(".cl-viewport").evaluate((v, left) => v.scrollTo({ left, behavior: "instant" }), left);
      await settle(page);
      const [target] = await summaries();
      if (!target) {
        // Report the reader's state: this has failed only on CI.
        const state = await page.evaluate(() => {
          const v = document.querySelector(".cl-viewport");
          const describe = (e) => e ? `${e.tagName.toLowerCase()}.${[...e.classList].join(".")}` : null;
          return {
            html: document.documentElement.className,
            viewport: { left: v.scrollLeft, top: v.scrollTop, width: v.scrollWidth, height: v.scrollHeight, client: [v.clientWidth, v.clientHeight] },
            slots: [...document.querySelectorAll(".cl-slot")].map((slot) => {
              const r = slot.getBoundingClientRect();
              return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
                source: Boolean(slot.querySelector(".cl-source")), fragmented: Boolean(slot.querySelector("[data-cl-fragmented]")),
                summaries: slot.querySelectorAll("summary").length };
            }),
            summaries: [...document.querySelectorAll(".cl-slot summary")].map((summary) => {
              const r = summary.getBoundingClientRect();
              return [Math.round(r.left), Math.round(r.top), describe(document.elementFromPoint(r.left + 5, r.top + 10))];
            }).filter(([x, y]) => x > -100 && x < 1380),
          };
        });
        assert.fail(`${left}: 見えている折りたたみがない ${JSON.stringify(state)}`);
      }
      kinds.add(target.source);
      const isOpen = (i) => page.evaluate((i) => document.querySelectorAll(".cl-source details")[i].open, i);
      assert.equal(await isOpen(target.index), false);
      await page.mouse.click(target.x + 5, target.y + 10);
      await settle(page);
      assert.equal(await isOpen(target.index), true, `${left}: 開かなかった`);
      const after = (await summaries()).find((s) => s.index === target.index);
      assert.deepEqual(after && { x: after.x, y: after.y }, { x: target.x, y: target.y }, `${left}: 位置がずれた`);
    }
    assert.deepEqual([...kinds].sort(), [false, true], "原本と複製の両方を試していない");
    // Focus that does not come from a press still brings its element into view.
    const last = page.locator(".cl-source details summary").last();
    await last.focus();
    await settle(page);
    const box = await last.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 1280 && box.y >= 0 && box.y + box.height <= 900, JSON.stringify(box));
  } finally { await browser.close(); }
});

for (const [name, engine] of engines) {
  test(`${name}: 本文の再計測を待つ間のスクロールも読書位置に反映する`, { timeout: 90_000 }, async () => {
    const browser = await launch(engine);
    // Changes the article, which schedules a measurement (fonts and images
    // loading after the first frame do the same), then scrolls horizontally
    // before or after that measurement has run.
    const scrolled = async (change, measured) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await storeColumns(page, "multi");
      await page.goto(new URL("nextjs-mdx/", BASE_URL).href);
      await waitForColumnLayout(page);
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      const state = await page.evaluate(async ({ change, measured }) => {
        const frames = async (n) => { for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame); };
        const viewport = document.querySelector(".cl-viewport");
        const source = document.querySelector(".cl-source");
        if (change === "same") source.append(document.createComment("measure"));
        else {
          const block = document.createElement("div");
          block.style.height = "300px";
          source.append(block);
        }
        await Promise.resolve();
        if (measured) await frames(5);
        viewport.scrollTo({ left: 700, behavior: "instant" });
        await frames(5);
        return {
          left: viewport.scrollLeft, top: viewport.scrollTop,
          x: document.querySelector(".cl-plane").dataset.clXTicks,
          slots: [...document.querySelectorAll(".cl-slot")].map((slot) => Math.round(slot.getBoundingClientRect().left)),
        };
      }, { change, measured });
      await page.close();
      return state;
    };
    try {
      // "same" keeps the layout; "length" only lengthens the article.
      for (const change of ["same", "length"]) {
        const expected = await scrolled(change, true);
        assert.notEqual(expected.x, "0", `${change}: ${JSON.stringify(expected)}`);
        assert.deepEqual(await scrolled(change, false), expected, change);
      }
    } finally { await browser.close(); }
  });
}
