import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { toggleColumns } from "./column-controls.mjs";
import { ARTICLE_URL, launch, storeColumns, waitForColumnLayout } from "./browser.mjs";


async function settle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
}

async function singleLayout(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      card: rect("article"), source: rect(".cl-source"), title: rect(".cl-source > h1"),
      toolbar: rect(".cl-toolbar"), close: rect(".cl-toolbar > .cl-close"),
      toc: rect(".toc-sidebar"),
    };
  });
}

test("1段の目次を右へ寄せ、操作ボタンと一緒に追従させて重なりを防ぐ", { timeout: 60_000 }, async () => {
  const browser = await launch(chromium);
  try {
    for (const width of [390, 768, 1280, 1600]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await storeColumns(page, "single");
        await page.goto(ARTICLE_URL);
        await waitForColumnLayout(page);
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        const before = await singleLayout(page);
        // The sidebar is beside the article from 768px; narrower screens use the mobile contents.
        assert.equal(await page.locator("[data-site-header] [data-toc]").isVisible(), false);
        assert.equal(await page.locator(".toc-mobile-toggle").isVisible(), width < 768);
        assert.equal(await page.locator(".toc-sidebar").isVisible(), width >= 768);
        if (width >= 768) assert.ok(before.toc.y >= before.toolbar.y + before.toolbar.height, "目次が操作ボタンに重なった");
        else {
          await page.locator(".toc-mobile-toggle").click();
          const panel = await page.locator(".toc-mobile-panel").boundingBox();
          assert.ok(panel.y >= before.toolbar.y + before.toolbar.height, "モバイル目次が操作ボタンに重なった");
          await page.keyboard.press("Escape");
        }

        await page.evaluate(() => document.querySelector(".cl-article-scrollport").scrollTo(0, 500));
        await settle(page);
        const scrolled = await singleLayout(page);
        assert.ok(scrolled.toolbar.y >= 0 && scrolled.toolbar.y + scrolled.toolbar.height <= 900, "スクロールすると操作ボタンが画面外へ出た");
        if (width >= 768) {
          assert.ok(scrolled.toc.y >= scrolled.toolbar.y + scrolled.toolbar.height, "スクロール中に目次が操作ボタンに重なった");
          await page.evaluate(() => document.querySelector(".cl-article-scrollport").scrollTo(0, 1e9)); await settle(page);
          const end = await singleLayout(page);
          assert.ok(end.toc.y >= end.toolbar.y + end.toolbar.height, "末尾で目次が操作ボタンに重なった");
        }
        await page.evaluate(() => document.querySelector(".cl-article-scrollport").scrollTo(0, 0));
        await settle(page);
        await toggleColumns(page);
        await page.waitForSelector("html.cl-multi .cl-slot");
        assert.equal(await page.locator("[data-toc-variant=mobile]").isVisible(), false);
        await toggleColumns(page);
        await page.waitForSelector(".cl-toolbar > .cl-toggle");
        await settle(page);
        assert.deepEqual(await singleLayout(page), before, "n段から戻ると1段の配置が変わった");
        assert.equal(await page.locator(".cl-toggle").evaluate((toggle) => document.activeElement === toggle), true);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("1段の標準バー越しに背景ヘッダーが透け、キー・矢印・段組みの切り替えで記事自身がスクロールする", { timeout: 60_000 }, async () => {
  const browser = await launch(chromium, { ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await storeColumns(page, "single");
    await page.goto(ARTICLE_URL);
    await waitForColumnLayout(page);
    await page.evaluate(() => document.fonts.ready);
    const scroller = page.locator(".cl-article-scrollport");
    const sizes = await scroller.evaluate((el) => ({ root: document.documentElement.clientWidth,
      header: document.querySelector("[data-site-header]").getBoundingClientRect().width,
      width: el.clientWidth, height: el.clientHeight }));
    assert.equal(sizes.root, 1280);
    assert.equal(sizes.header, 1280);
    assert.equal(sizes.width, 1272);
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight / 2; });
    await settle(page);
    const screenshot = await page.screenshot();
    const pixels = await page.evaluate(async (png) => {
      const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
      const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
      return { header: at(1268, 32), headerTrack: at(1276, 32),
        body: at(1268, 100), bodyTrack: at(1276, 100) };
    }, screenshot.toString("base64"));
    assert.deepEqual(pixels.headerTrack, pixels.header, "バーの背景が背面ヘッダーにつながらない");
    assert.deepEqual(pixels.bodyTrack, pixels.body);
    assert.notDeepEqual(pixels.headerTrack, pixels.bodyTrack, "トラックが単色で塗られている");

    await scroller.evaluate((el) => { el.scrollTop = 500; });
    await settle(page);
    await toggleColumns(page);
    await page.waitForSelector(".cl-slot");
    await toggleColumns(page);
    await settle(page);
    assert.ok(Math.abs(await scroller.evaluate((el) => el.scrollTop) - 500) < 2, "切替後に読書位置がずれた");
    // The lower arrow belongs to this scroller; clicking it must not hit the
    // link that closes the article behind it.
    await page.mouse.click(1276, sizes.height - 8);
    await page.waitForFunction(() => document.querySelector(".cl-article-scrollport").scrollTop > 500);
    assert.equal(page.url(), ARTICLE_URL);
    await scroller.focus();
    await page.keyboard.press("Home");
    await page.waitForFunction(() => document.querySelector(".cl-article-scrollport").scrollTop === 0);
    await page.keyboard.press("PageDown");
    await page.waitForFunction(() => document.querySelector(".cl-article-scrollport").scrollTop > 300);
    await page.keyboard.press("End");
    await page.waitForFunction(() => {
      const el = document.querySelector(".cl-article-scrollport");
      return Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 2;
    });
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await page.emulateMedia({ media: "print" });
    assert.equal(await scroller.evaluate((el) => getComputedStyle(el).position), "static");
    assert.equal(await page.locator(".cl-dismiss").isVisible(), false);
  } finally { await browser.close(); }
});

test("ノート外の左右・上下の背景でも標準のホイール操作で記事がスクロールする", { timeout: 60_000 }, async () => {
  const browser = await launch(chromium, { ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    for (const [width, javaScriptEnabled] of [[390, true], [1280, true], [1280, false]]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, javaScriptEnabled });
      try {
        await storeColumns(page, "single");
        await page.goto(ARTICLE_URL);
        if (javaScriptEnabled) {
          await waitForColumnLayout(page);
          await page.evaluate(() => document.fonts.ready);
        }
        await page.locator("astro-dev-toolbar").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
        const scroller = page.locator(".cl-article-scrollport");
        // Reset each gesture so wheel latching cannot hide an inert region.
        for (const [x, y, start, delta] of [[2, 300, 500, 240], [width - 10, 300, 500, -240],
          [width / 2, 8, 0, 240], [width >= 768 ? 100 : 20, 888, 1e9, -240]]) {
          await scroller.evaluate((el, start) => { el.scrollTop = start; }, start);
          if (javaScriptEnabled) await settle(page);
          const before = await scroller.evaluate((el) => el.scrollTop);
          assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).className,
            { x, y }), "cl-dismiss block cursor-pointer", `背景にカーソルを置けていない: ${width}, ${x}, ${y}`);
          await page.mouse.move(x, y);
          await page.mouse.wheel(0, delta);
          // Poll from Node so this also works when browser JS callbacks are disabled.
          // With page JS disabled, headless Chromium occasionally drops a
          // synthetic wheel entirely (about 1 in 6 gestures, at positions that
          // scroll on other attempts). Resend it a few times; an inert region
          // still never scrolls, so the check keeps its meaning.
          let movement = 0;
          for (let attempt = 0; attempt < 50; attempt++) {
            movement = (await scroller.evaluate((el) => el.scrollTop) - before) * Math.sign(delta);
            if (movement > 100) break;
            if (attempt === 10 || attempt === 20) await page.mouse.wheel(0, delta);
            await page.waitForTimeout(50);
          }
          assert.ok(movement > 100, `背景でスクロールしない: ${width}, JS=${javaScriptEnabled}, ${x}, ${y}`);
          assert.equal(await page.evaluate(() => window.scrollY), 0);
        }
        await page.mouse.click(2, 300);
        await page.waitForURL(new URL("../", ARTICLE_URL).href);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
