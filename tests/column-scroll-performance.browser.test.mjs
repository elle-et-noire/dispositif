import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { ARTICLE_URL, launch, storeColumns } from "./browser.mjs";

const settle = page => page.evaluate(async () => {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
});

test("本文の末尾を越えて見えない段の断片を作り直さない", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  try {
    await storeColumns(page, "multi");
    await page.goto(ARTICLE_URL);
    await page.waitForSelector(".cl-slot");
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".cl-viewport").focus();
    await page.evaluate(() => {
      window.hiddenFragmentChanges = [];
      window.hiddenFragmentObserver = new MutationObserver((changes) => {
        for (const change of changes) {
          const slot = change.target instanceof Element ? change.target.closest(".cl-slot") : null;
          if (slot && !slot.querySelector(".cl-source") && parseFloat(slot.querySelector(".cl-paper").style.height) === 0)
            hiddenFragmentChanges.push(change.type);
        }
      });
      hiddenFragmentObserver.observe(document.querySelector(".cl-plane"), { childList: true, subtree: true });
    });
    await page.keyboard.press("End");
    await settle(page);
    const result = await page.evaluate(() => {
      hiddenFragmentObserver.disconnect();
      return { changes: hiddenFragmentChanges.length,
        hidden: [...document.querySelectorAll(".cl-slot")].filter((slot) =>
          !slot.querySelector(".cl-source") && parseFloat(slot.querySelector(".cl-paper").style.height) === 0).length };
    });
    assert.ok(result.hidden > 0, "末尾を越える段がテスト対象に含まれていない");
    assert.equal(result.changes, 0, "表示されない段の断片を更新した");
  } finally { await browser.close(); }
});

test("縦横のネイティブスクロールの途中でJSが位置を書き戻さない", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  try {
    await storeColumns(page, "multi");
    await page.goto(ARTICLE_URL);
    await page.waitForSelector(".cl-content mjx-container");
    await page.evaluate(() => document.fonts.ready);
    const client = await page.context().newCDPSession(page);
    for (const axis of ["x", "y"]) {
      const property = axis === "x" ? "scrollLeft" : "scrollTop";
      await page.locator(".cl-viewport").focus(); await page.keyboard.press("Home"); await settle(page);
      const initial = await page.locator(".cl-viewport").evaluate((v, key) => v[key], property);
      await page.evaluate(key => {
        const viewport = document.querySelector(".cl-viewport");
        const native = Object.getOwnPropertyDescriptor(Element.prototype, key);
        window.scrollWrites = [];
        Object.defineProperty(viewport, key, {
          configurable: true,
          get() { return native.get.call(this); },
          set(value) { scrollWrites.push({ axis: key, from: native.get.call(this), to: value }); native.set.call(this, value); },
        });
      }, property);
      await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await client.send("Input.synthesizeScrollGesture", {
        x: 150, y: 220, xDistance: axis === "x" ? -6000 : 0, yDistance: axis === "y" ? -6000 : 0, speed: 3000,
        gestureSourceType: "mouse", preventFling: true,
      });
      await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await settle(page);
      const result = await page.evaluate(property => ({
        position: document.querySelector(".cl-viewport")[property],
        writes: scrollWrites.filter(write => write.axis === property),
      }), property);
      assert.deepEqual(result.writes, [], `${axis}: ネイティブスクロールの途中でJSが本文位置を書き戻した`);
      assert.ok(Math.abs(result.position - initial - 6000) < 2, `${axis}: 入力の移動量が失われた: ${JSON.stringify(result)}`);
      await page.locator(".cl-viewport").evaluate((v, key) => { delete v[key]; }, property);
    }
  } finally { await page.close(); await browser.close(); }
});

test("拡大時も段内の横スクロールで本文のスタイルやDOMを更新しない", { timeout: 60_000 }, async () => {
  const browser = await launch(chromium);
  try {
    for (const zoom of [1, 1.1, 1.125, 1.25, 1.5]) {
      // At every zoom leave room for two full columns, so this gesture stays
      // away from both input bounds and the native plane's rebase boundaries.
      const page = await browser.newPage({ viewport: { width: 2100, height: 927 } });
      try {
        await storeColumns(page, "multi");
        await page.goto(ARTICLE_URL);
        await page.waitForSelector(".cl-content mjx-container");
        await page.evaluate(() => document.fonts.ready);
        await page.addStyleTag({ content: `html { zoom: ${zoom}; }` }); await settle(page);
        await page.locator('.cl-viewport').focus(); await page.keyboard.press('Home'); await settle(page);
        await page.locator('.cl-viewport').evaluate(v => { v.scrollLeft += 40; }); await settle(page);
        const before = await page.locator('.cl-slot').first().boundingBox();
        await page.evaluate(() => {
          window.scrollEdits = { styles: 0, children: 0, unchangedGeometry: 0 };
          window.scrollObserver = new MutationObserver(ms => {
            scrollEdits.styles += ms.filter(m => m.type === 'attributes' && m.attributeName === 'style').length;
            scrollEdits.children += ms.filter(m => m.type === 'childList').length;
            scrollEdits.unchangedGeometry += ms.filter(m => m.type === 'attributes' && m.attributeName !== 'style').length;
          });
          scrollObserver.observe(document.querySelector('.cl-plane'), { subtree: true, attributes: true, childList: true,
            attributeFilter: ['style', 'data-cl-origin-column', 'data-cl-origin-y', 'data-cl-leading', 'data-cl-y-ticks'] });
        });
        for (let i = 0; i < 20; i++) {
          await page.locator('.cl-viewport').evaluate(v => { v.scrollLeft += 4.13; }); await settle(page);
        }
        const after = await page.locator('.cl-slot').first().boundingBox();
        const result = await page.evaluate(() => { scrollObserver.disconnect(); return scrollEdits; });
        assert.ok(before.x - after.x > 50 * zoom, '実際に横移動していない');
        assert.deepEqual(result, { styles: 0, children: 0, unchangedGeometry: 0 }, `拡大率${zoom}で不要な描画更新が起きた`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
