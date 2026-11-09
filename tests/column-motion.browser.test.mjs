import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { columnScrollbar } from "./column-controls.mjs";
import { ARTICLE_URL, launch, storeColumns } from "./browser.mjs";


async function settle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
}

async function state(page) {
  return page.evaluate(() => {
    const v = document.querySelector(".cl-viewport"), plane = document.querySelector(".cl-plane");
    const p = parseFloat(plane.style.getPropertyValue("--cl-p"));
    const edge = parseFloat(plane.style.getPropertyValue("--cl-edge"));
    const w = parseFloat(plane.style.getPropertyValue("--cl-w"));
    const x = v.scrollLeft + Number(plane.dataset.clOriginColumn) * p - Number(plane.dataset.clLeading);
    const y = v.scrollTop + Number(plane.dataset.clOriginY);
    let first = Math.ceil((x - edge - 0.01) / p);
    let last = Math.floor((x + v.clientWidth - edge - w + 0.01) / p);
    if (first > last) first = last = Math.round((x + v.clientWidth / 2 - edge - w / 2) / p);
    return { x, y, p, w, edge, first, last, width: v.clientWidth, h: v.clientHeight,
      step: parseFloat(plane.style.getPropertyValue("--cl-step")),
      l: parseFloat(plane.style.getPropertyValue("--cl-l")),
      animating: v.hasAttribute("data-cl-animating") };
  });
}

async function open(page) {
  await storeColumns(page, "multi");
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(".cl-slot");
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".cl-source").evaluate((source) => {
    source.innerHTML = '<div style="height:50000px;background:repeating-linear-gradient(#fff 0 30px,#e2e8f0 30px 60px)">本文</div>';
  });
  await page.waitForFunction(() => document.querySelector(".cl-plane").style.getPropertyValue("--cl-l") === "50000px");
  await settle(page);
  await page.locator(".cl-viewport").focus();
}

test("先頭・末尾で外向きの矢印を押しても同じ位置へ再スクロールしない", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  try {
    await open(page);
    await page.locator(".cl-viewport").evaluate((v) => {
      const original = v.scrollTo.bind(v);
      window.edgeScrollWrites = 0;
      v.scrollTo = (...args) => { window.edgeScrollWrites++; return original(...args); };
    });
    for (const [edge, arrow] of [["Home", "ArrowLeft"], ["End", "ArrowRight"]]) {
      await page.keyboard.press(edge);
      await settle(page);
      const before = await state(page);
      await page.evaluate(() => { window.edgeScrollWrites = 0; });
      for (let i = 0; i < 4; i++) await page.keyboard.press(arrow);
      await settle(page);
      assert.equal(await page.evaluate(() => window.edgeScrollWrites), 0);
      const after = await state(page);
      assert.equal(after.x, before.x);
      assert.equal(after.y, before.y);
    }
  } finally { await browser.close(); }
});

async function middle(page, phase = 100) {
  await page.keyboard.press("Home");
  await settle(page);
  await setY(page, 4000);
  await page.locator(".cl-viewport").evaluate((v, phase) => {
    const plane = document.querySelector(".cl-plane");
    v.scrollLeft = phase - Number(plane.dataset.clOriginColumn) * parseFloat(plane.style.getPropertyValue("--cl-p")) + Number(plane.dataset.clLeading);
  }, phase);
  await settle(page);
}

async function setY(page, y) {
  await page.locator(".cl-viewport").evaluate((v, y) => {
    v.scrollTop = y - Number(document.querySelector(".cl-plane").dataset.clOriginY);
  }, y);
  await settle(page);
}

async function animationDone(page) {
  await page.waitForFunction(() => !document.querySelector(".cl-viewport").hasAttribute("data-cl-animating"));
  await settle(page);
}

test("左右キーは途中の位置を通り、連打を合成し、逆入力・ホイール・タッチで中断できる", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, hasTouch: true });
  try {
    await open(page);
    await middle(page, 0);
    const before = await state(page);
    await page.evaluate(() => {
      window.motionFrames = [];
      const record = () => {
        const v = document.querySelector(".cl-viewport"), plane = document.querySelector(".cl-plane");
        const p = parseFloat(plane.style.getPropertyValue("--cl-p"));
        window.motionFrames.push({ x: v.scrollLeft + Number(plane.dataset.clOriginColumn) * p - Number(plane.dataset.clLeading),
          y: v.scrollTop + Number(plane.dataset.clOriginY), t: performance.now() });
        if (window.motionFrames.length < 30) requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
      document.addEventListener("keydown", () => { window.motionStart = performance.now(); }, { once: true, capture: true });
    });
    await page.keyboard.press("ArrowRight");
    await animationDone(page);
    const { frames, start } = await page.evaluate(() => ({ frames: window.motionFrames, start: window.motionStart }));
    // The step eases over 180 ms. Under load frames can be 50-100 ms apart, so
    // count of intermediate frames varies; a jump instead lands on the first
    // frame after the key press. Require a passed-through position and an
    // arrival no earlier than the animation allows.
    const arrival = frames.find((s) => Math.abs(s.x - before.x - before.p) < 2);
    assert.ok(frames.some((s) => s.x > before.x + 2 && s.x < before.x + before.p - 2), "段送りが瞬間移動になった");
    assert.ok(arrival && arrival.t - start >= 150, `段送りが短すぎる: ${arrival ? Math.round(arrival.t - start) : "未到達"} ms`);
    assert.ok(frames.every((s) => Math.abs(s.y - before.y) < 1), "段送りで縦位置が変わった");
    const after = await state(page);
    assert.ok(Math.abs(after.x - before.x - before.p) < 2);
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await animationDone(page);
    assert.ok(Math.abs((await state(page)).x - after.x - 3 * before.p) < 2, "連打の移動先が失われた");

    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(40);
    await page.evaluate(() => document.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft") return;
      const v = document.querySelector(".cl-viewport"), plane = document.querySelector(".cl-plane");
      window.reverseX = v.scrollLeft + Number(plane.dataset.clOriginColumn) * parseFloat(plane.style.getPropertyValue("--cl-p")) - Number(plane.dataset.clLeading);
    }, { once: true, capture: true }));
    await page.keyboard.press("ArrowLeft");
    await animationDone(page);
    const reverseX = await page.evaluate(() => window.reverseX);
    assert.ok(Math.abs((await state(page)).x - reverseX + before.p) < 2, "逆入力後も元の移動先を追い続けた");

    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(40);
    const box = await page.locator(".cl-viewport").boundingBox();
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.wheel(0, 80);
    await settle(page);
    const cancelled = await state(page);
    assert.equal(cancelled.animating, false);
    await page.waitForTimeout(220);
    assert.ok(Math.abs((await state(page)).x - cancelled.x) < 2, "ホイール後にキー移動が再開した");

    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(40);
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 100, y: box.y + 100 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await settle(page);
    const touched = await state(page);
    assert.equal(touched.animating, false);
    await page.waitForTimeout(220);
    assert.ok(Math.abs((await state(page)).x - touched.x) < 2);
    await session.detach();

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await state(page);
    await page.keyboard.press("ArrowRight");
    const immediate = await state(page);
    assert.equal(immediate.animating, false);
    assert.ok(Math.abs(immediate.x - reduced.x - reduced.p) < 2);
  } finally { await page.close(); await browser.close(); }
});

test("ヘッダーの横バーは3pxで下端に接し、本文の間隔は16pxでそろう", { timeout: 30_000 }, async () => {
  const browser = await launch(chromium, { ignoreDefaultArgs: ["--hide-scrollbars"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  try {
    await open(page);
    await page.mouse.move(100, 200);
    const layout = await page.evaluate(() => {
      const header = document.querySelector("[data-site-header]").getBoundingClientRect();
      const toc = document.querySelector(".toc-header-scroll");
      const rect = toc.getBoundingClientRect();
      const reader = document.querySelector(".cl-reader").getBoundingClientRect();
      const first = document.querySelector('.cl-slot[data-cl-k="0"]').getBoundingClientRect();
      return { headerBottom: header.bottom, bottom: rect.bottom, left: rect.left,
        padding: getComputedStyle(toc).paddingBottom,
        height: getComputedStyle(toc, "::-webkit-scrollbar").height,
        readerGap: reader.top - header.bottom, leftMargin: first.left,
        gap: parseFloat(document.querySelector(".cl-plane").style.getPropertyValue("--cl-p")) - first.width };
    });
    assert.equal(layout.height, "3px");
    assert.equal(layout.padding, "0px");
    assert.equal(layout.bottom, layout.headerBottom);
    assert.equal(layout.readerGap, 16);
    assert.equal(layout.leftMargin, 16);
    assert.equal(layout.gap, 16);
    const screenshot = await page.screenshot();
    const pixel = await page.evaluate(async ({ png, x, y }) => {
      const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
      return [...context.getImageData(x, y, 1, 1).data];
    }, { png: screenshot.toString("base64"), x: Math.floor(layout.left + 5), y: Math.floor(layout.bottom - 1) });
    assert.ok(["130,144,162,255", "100,116,139,255"].includes(pixel.join()), `ヘッダー下端にバーがない: ${pixel}`);
  } finally { await page.close(); await browser.close(); }
});

test("標準の横バーの矢印はクリック・長押しで本文だけを動かし、端で止まる", { timeout: 30_000 }, async () => {
  const browser = await launch(chromium, { ignoreDefaultArgs: ["--hide-scrollbars"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  try {
    await open(page);
    const bar = await columnScrollbar(page);
    assert.equal(bar.height, 8);
    const left = bar.x - 8, right = bar.x + bar.width + 8, y = bar.y + bar.height / 2;
    const initial = await state(page);
    await page.mouse.click(left, y); await settle(page);
    assert.ok(Math.abs((await state(page)).x - initial.x) < 1, "先頭から左へ移動した");
    await page.mouse.click(right, y);
    await page.waitForFunction(() => document.querySelector(".cl-viewport").scrollLeft >= 39);
    await settle(page);
    const clicked = await state(page);
    assert.ok(Math.abs(clicked.x - initial.x - 40) < 2, "標準の右矢印で少しずつ動かせない");
    await page.mouse.move(right, y); await page.mouse.down();
    await page.waitForTimeout(650); await page.mouse.up();
    await page.waitForTimeout(200); await settle(page);
    const held = await state(page);
    assert.ok(held.x > clicked.x + 80, "標準ボタンの長押しで連続移動できない");
    assert.ok(Math.abs(held.y - initial.y) < 1, "横操作で縦位置が変わった");
    await page.waitForTimeout(150); await settle(page);
    assert.ok(Math.abs((await state(page)).x - held.x) < 1, "ボタンを離しても移動し続ける");
    await page.keyboard.press("End"); await settle(page);
    const end = await state(page);
    await page.mouse.click(right, y); await settle(page);
    assert.ok(Math.abs((await state(page)).x - end.x) < 1, "末尾から右へ移動した");
  } finally { await page.close(); await browser.close(); }
});
