import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { toggleColumns } from "./column-controls.mjs";
import { BASE_URL, ARTICLE_URL, launch, storeColumns, waitForColumnLayout } from "./browser.mjs";

const settle = (page) => page.evaluate(async () => {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
});

test("一覧へ戻るとき、ポインターでは復元直後の枠を抑え、キーボードでは表示する", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await storeColumns(page, "multi");
    await page.goto(BASE_URL);
    const card = page.locator("[data-article-index] a").first();
    const href = await card.getAttribute("href");
    const openArticle = async () => {
      await card.click();
      await page.waitForSelector("html.cl-multi .cl-slot");
    };
    const restored = async () => {
      await page.waitForSelector('html[data-page-kind="index"]');
      await settle(page);
      assert.equal(await card.evaluate((el) => document.activeElement === el), true);
      assert.equal(new URL(await card.getAttribute("href"), BASE_URL).pathname, new URL(href, BASE_URL).pathname);
    };
    await openArticle();
    await page.locator(".cl-viewport").click({ position: { x: 100, y: 200 } });
    await page.keyboard.press("ArrowRight");
    await page.locator("[data-site-header] .cl-close").click();
    await restored();
    assert.equal(await card.evaluate((el) => getComputedStyle(el).outlineStyle), "none");
    await page.keyboard.press("ArrowDown");
    assert.equal(await card.evaluate((el) => getComputedStyle(el).outlineStyle), "solid");
    await page.keyboard.press("Tab");
    assert.equal(await card.evaluate((el) => el.classList.contains("index-restored-keyboard-focus")), false);
    await openArticle();
    await page.locator("[data-site-header] .cl-close").focus();
    await page.keyboard.press("Enter");
    await restored();
    assert.equal(await card.evaluate((el) => getComputedStyle(el).outlineStyle), "solid");
    // Alt+← reaches the page as a keydown before the browser goes back
    // (headless Chromium does not go back on it, so goBack() does). History
    // traversal restores the card without a ring, like a pointer return.
    await openArticle();
    await page.keyboard.press("Alt+ArrowLeft");
    await page.goBack();
    await restored();
    assert.equal(await card.evaluate((el) => getComputedStyle(el).outlineStyle), "none");
    await page.keyboard.press("ArrowDown");
    assert.equal(await card.evaluate((el) => getComputedStyle(el).outlineStyle), "solid");
  } finally { await browser.close(); }
});

test("背景の閉じるリンクはポインター専用で、Tab移動と読み上げでは閉じるボタンだけを使う", { timeout: 60_000 }, async () => {
  const browser = await launch(chromium);
  try {
    for (const width of [390, 1280]) for (const mode of ["single", "multi"]) {
      const page = await browser.newPage({ viewport: { width, height: 600 } });
      try {
        await storeColumns(page, mode);
        await page.goto(ARTICLE_URL);
        await waitForColumnLayout(page);
        if (mode === "multi") await page.waitForSelector("html.cl-multi .cl-slot");
        await settle(page);
        const close = page.getByRole("link", { name: "記事を閉じて一覧へ戻る" });
        assert.equal(await close.count(), 1, `${width}px ${mode}`);
        assert.equal(await close.evaluate((el) => el.classList.contains("cl-close")), true);
        let reachedClose = false;
        for (let i = 0; i < 80; i++) {
          await page.keyboard.press("Tab");
          const focused = await page.evaluate(() => document.activeElement?.className ?? "");
          assert.doesNotMatch(String(focused), /\bcl-dismiss\b/, `${width}px ${mode}`);
          if (/\bcl-close\b/.test(String(focused))) { reachedClose = true; break; }
        }
        assert.equal(reachedClose, true, `${width}px ${mode}: 閉じるボタンへTabで届かない`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("一覧はヘッダーの下の標準バーとホイール・キーでスクロールする", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium, { ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 600 } });
      try {
        await page.goto(BASE_URL);
        await page.evaluate(() => document.fonts.ready);
        const scrollport = page.locator(".article-index-shell");
        const geometry = await scrollport.evaluate((el) => ({
          top: el.getBoundingClientRect().top,
          headerBottom: document.querySelector("[data-site-header]").getBoundingClientRect().bottom,
          scrollbarWidth: el.offsetWidth - el.clientWidth,
        }));
        assert.equal(geometry.top, geometry.headerBottom);
        assert.equal(geometry.scrollbarWidth, 8);
        await page.mouse.move(20, 300);
        await page.mouse.wheel(0, 60);
        await page.waitForFunction(() => document.querySelector(".article-index-shell").scrollTop > 20);
        const before = await scrollport.evaluate((el) => el.scrollTop);
        await page.mouse.click(width - 4, 592);
        await page.waitForFunction((before) => document.querySelector(".article-index-shell").scrollTop > before, before);
        await scrollport.focus();
        await page.keyboard.press("End");
        await page.waitForFunction(() => {
          const el = document.querySelector(".article-index-shell");
          return Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 2;
        });
        await page.keyboard.press("Home");
        await page.waitForFunction(() => document.querySelector(".article-index-shell").scrollTop === 0);
        assert.equal(await page.evaluate(() => window.scrollY), 0);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("一覧のDOMと位置を両モードの背景へ引き継ぎ、閉じる・履歴移動で復元する", { timeout: 90_000 }, async () => {
  const browser = await launch(chromium);
  try {
    for (const width of [390, 1280]) for (const mode of ["single", "multi"]) {
      const page = await browser.newPage({ viewport: { width, height: 600 } });
      try {
        await storeColumns(page, mode);
        await page.goto(BASE_URL);
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => {
          window.__indexNode = document.querySelector("[data-article-index]");
          document.querySelector(".article-index-shell").scrollTo(0, 240);
        });
        await settle(page);
        const before = await page.evaluate(() => {
          const links = [...document.querySelectorAll("[data-article-index] a")];
          const i = links.findIndex((a) => { const r = a.getBoundingClientRect(); return r.top >= 80 && r.bottom < innerHeight; });
          return { i, y: document.querySelector(".article-index-shell").scrollTop, href: links[i].href, top: links[i].getBoundingClientRect().top };
        });
        assert.ok(before.y > 0);
        await page.locator("[data-article-index] a").nth(before.i).click();
        await waitForColumnLayout(page);
        if (mode === "multi") await page.waitForSelector("html.cl-multi .cl-slot");
        await settle(page);
        assert.deepEqual(await page.evaluate((i) => {
          const list = document.querySelector("[data-article-index]");
          return { same: list === window.__indexNode, inert: list.parentElement.inert,
            hidden: list.parentElement.getAttribute("aria-hidden"),
            top: list.querySelectorAll("a")[i].getBoundingClientRect().top,
            blur: getComputedStyle(document.querySelector(".cl-backdrop")).backdropFilter };
        }, before.i), { same: true, inert: true, hidden: "true", top: before.top, blur: "blur(3px)" });
        const articlePath = new URL(before.href).pathname;
        if (mode === "multi") {
          const box = await page.locator(".cl-viewport").boundingBox();
          await page.mouse.click(4, box.y + 100);
        } else await page.mouse.click(2, 200);
        await page.waitForSelector('html[data-page-kind="index"]');
        await settle(page);
        const restored = () => page.evaluate(() => ({ same: document.querySelector("[data-article-index]") === window.__indexNode,
          y: document.querySelector(".article-index-shell").scrollTop, inert: document.querySelector(".article-index-shell").inert,
          focus: document.activeElement?.getAttribute("href") }));
        const result = await restored();
        assert.equal(result.same, true);
        assert.equal(result.y, before.y);
        assert.equal(result.inert, false);
        assert.equal(new URL(result.focus, BASE_URL).pathname, articlePath);
        await page.goBack();
        await waitForColumnLayout(page);
        await page.goBack();
        await page.waitForSelector('html[data-page-kind="index"]');
        await settle(page);
        assert.equal((await restored()).y, before.y);
        assert.equal((await restored()).same, true);
        await page.goForward();
        await waitForColumnLayout(page);
        assert.equal(await page.evaluate(() => document.querySelector("[data-article-index]") === window.__indexNode), true);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("先頭と末尾だけ丸角にし、紙面操作・文字選択・モード切り替えで誤って閉じない", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await storeColumns(page, "multi");
    await page.goto(ARTICLE_URL);
    await page.waitForSelector(".cl-slot");
    await page.evaluate(() => document.fonts.ready);
    const corners = () => page.evaluate(() => [...document.querySelectorAll(".cl-slot")].map((slot) => {
      const s = getComputedStyle(slot.querySelector(".cl-paper"));
      return { head: slot.hasAttribute("data-cl-head"), tail: slot.hasAttribute("data-cl-tail"),
        corners: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius] };
    }));
    const checkCorners = async () => {
      for (const slot of await corners()) assert.deepEqual(slot.corners,
        [slot.head ? "8px" : "0px", slot.head ? "8px" : "0px", slot.tail ? "8px" : "0px", slot.tail ? "8px" : "0px"]);
    };
    await checkCorners();
    assert.ok((await corners()).some((slot) => slot.head && !slot.tail));
    assert.ok((await corners()).some((slot) => !slot.head && !slot.tail));
    const box = await page.locator(".cl-viewport").boundingBox();
    await page.mouse.click(100, box.y + 100);
    assert.equal(new URL(page.url()).pathname, new URL(ARTICLE_URL).pathname);
    await page.evaluate(() => {
      const range = document.createRange(); range.selectNodeContents(document.querySelector(".cl-source > h1"));
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    });
    await page.mouse.click(4, box.y + 100);
    assert.equal(new URL(page.url()).pathname, new URL(ARTICLE_URL).pathname);
    // A drag that ends in the gap must not close the note.
    await page.mouse.move(100, box.y + 30); await page.mouse.down();
    await page.mouse.move(4, box.y + 100, { steps: 5 }); await page.mouse.up();
    assert.equal(new URL(page.url()).pathname, new URL(ARTICLE_URL).pathname);
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await page.locator(".cl-viewport").focus(); await page.keyboard.press("End"); await settle(page);
    await checkCorners();
    assert.ok((await corners()).some((slot) => slot.tail));
    await toggleColumns(page); await settle(page);
    assert.equal(await page.locator(".cl-article").evaluate((el) => getComputedStyle(el).borderRadius), "8px");
    await toggleColumns(page); await settle(page); await checkCorners();
    await page.locator(".cl-source").evaluate((s) => { s.innerHTML = '<p style="height:80px;margin:0">短いノート</p>'; });
    await page.waitForFunction(() => document.querySelector(".cl-slot[data-cl-head][data-cl-tail]"));
    await checkCorners();
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator(".article-index-shell").isVisible(), false);
    assert.equal(await page.locator(".cl-backdrop").isVisible(), false);
    await page.emulateMedia({ media: "screen" });
    await page.waitForSelector(".cl-slot[data-cl-head][data-cl-tail]");
    const paper = await page.locator(".cl-slot[data-cl-head][data-cl-tail] .cl-paper").boundingBox();
    await page.mouse.click(paper.x + 0.5, paper.y + 0.5);
    await page.waitForSelector('html[data-page-kind="index"]');
  } finally { await browser.close(); }
});

test("目次の矢印は移動できる方向だけ表示し、クリック・長押し・キーで目次だけを動かす", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  try {
    await storeColumns(page, "multi");
    await page.goto(ARTICLE_URL);
    await page.waitForSelector(".cl-slot");
    const toc = page.locator(".toc-header-scroll");
    const left = page.locator('[data-toc-direction="-1"]'), right = page.locator('[data-toc-direction="1"]');
    await page.waitForFunction(() => !document.querySelector('[data-toc-direction="1"]').disabled);
    const position = await page.locator(".cl-plane").evaluate((p) => [p.dataset.clXTicks, p.dataset.clYTicks]);
    assert.equal(await left.isDisabled(), true);
    assert.equal(await left.isVisible(), false);
    assert.equal(await right.isVisible(), true);
    const initialBox = await toc.boundingBox();
    // Ordinary click must work independently of the pointerdown/hold path.
    await right.dispatchEvent("click", { detail: 1, button: 0 });
    await page.waitForFunction(() => document.querySelector(".toc-header-scroll").scrollLeft === 100);
    await left.click();
    await page.waitForFunction(() => document.querySelector(".toc-header-scroll").scrollLeft === 0);
    // The visible SVG is also part of the button's real mouse hit area.
    await right.locator("svg").click();
    await page.waitForFunction(() => document.querySelector(".toc-header-scroll").scrollLeft === 100);
    await left.click();
    await page.waitForFunction(() => document.querySelector(".toc-header-scroll").scrollLeft === 0);
    await right.click();
    await page.waitForFunction(() => document.querySelector(".toc-header-scroll").scrollLeft >= 99);
    assert.equal(await left.isDisabled(), false);
    assert.equal(await left.isVisible(), true);
    assert.equal(await right.isVisible(), true);
    assert.deepEqual(await toc.boundingBox(), initialBox, "矢印の表示で目次の位置や幅が変わった");
    const start = await toc.evaluate((t) => t.scrollLeft);
    await right.hover(); await page.mouse.down();
    await page.waitForFunction((start) => document.querySelector(".toc-header-scroll").scrollLeft > start + 140, start);
    await page.mouse.up();
    const afterHold = await toc.evaluate((t) => t.scrollLeft);
    await page.waitForTimeout(180);
    assert.equal(await toc.evaluate((t) => t.scrollLeft), afterHold);
    await left.focus(); await page.keyboard.press("Enter");
    // Finish the native smooth movement before testing a separate end jump.
    await page.waitForFunction((start) => document.querySelector(".toc-header-scroll").scrollLeft === start - 100, afterHold);
    assert.deepEqual(await page.locator(".cl-plane").evaluate((p) => [p.dataset.clXTicks, p.dataset.clYTicks]), position);
    await toc.evaluate((t) => { t.scrollTo({ left: t.scrollWidth, behavior: "instant" }); });
    await page.waitForFunction(() => document.querySelector('[data-toc-direction="1"]').disabled);
    assert.equal(await right.isVisible(), false);
    assert.equal(await left.isVisible(), true);
    await toc.evaluate((t) => { t.scrollTo({ left: 0, behavior: "instant" }); });
    await page.waitForFunction(() => document.querySelector('[data-toc-direction="-1"]').disabled);
    assert.equal(await left.isVisible(), false);
    assert.equal(await right.isVisible(), true);
    await page.setViewportSize({ width: 3000, height: 900 });
    await page.waitForFunction(() => [...document.querySelectorAll("[data-toc-direction]")].every((b) => b.disabled));
    assert.equal(await left.isVisible(), false);
    assert.equal(await right.isVisible(), false);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForFunction(() => !document.querySelector('[data-toc-direction="1"]').disabled);
    assert.equal(await right.isVisible(), true);
    assert.equal(await left.isVisible(), false);
  } finally { await browser.close(); }
});
