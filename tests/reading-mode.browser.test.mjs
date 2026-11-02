import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";

const ARTICLE_URL = new URL(
  "symmetric-polynomial/",
  process.env.RM_BASE_URL ?? "http://localhost:4321/dispositif/",
).href;
const ROW_HEIGHT = 40;
const ROW_COUNT = 300;
const COLORS = [[170, 51, 0, 255], [0, 68, 170, 255]];

async function layout(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".rm-viewport");
    const plane = document.querySelector(".rm-plane");
    const rect = viewport.getBoundingClientRect();
    return {
      x: viewport.scrollLeft,
      y: viewport.scrollTop + parseFloat(document.querySelector(".rm-plane").dataset.rmOriginY),
      nativeY: viewport.scrollTop,
      origin: Number(document.querySelector(".rm-plane").dataset.rmOriginColumn),
      originY: parseFloat(document.querySelector(".rm-plane").dataset.rmOriginY),
      maxX: viewport.scrollWidth - viewport.clientWidth,
      maxY: viewport.scrollHeight - viewport.clientHeight,
      h: viewport.clientHeight,
      step: parseFloat(plane.style.getPropertyValue("--rm-step")),
      p: parseFloat(plane.style.getPropertyValue("--rm-p")),
      l: parseFloat(plane.style.getPropertyValue("--rm-l")),
      top: rect.top,
      left: rect.left,
      width: viewport.clientWidth,
      slots: [...document.querySelectorAll(".rm-slot")].map((slot) => {
        const frame = slot.getBoundingClientRect();
        const style = getComputedStyle(slot.querySelector(".rm-content"));
        const textLeft = frame.left + parseFloat(style.paddingLeft);
        const textRight = frame.right - parseFloat(style.paddingRight);
        return {
          k: Number(slot.dataset.rmK),
          left: frame.left,
          width: frame.width,
          top: frame.top,
          height: frame.height,
          visible: textRight > rect.left + 8 && textLeft < rect.left + viewport.clientWidth - 8,
          sampleX: Math.floor(Math.min(Math.max(textLeft + (textRight - textLeft) * 0.85, rect.left + 8),
            rect.left + viewport.clientWidth - 8)),
        };
      }),
    };
  });
}

async function readPixels(page, samples, captured) {
  await page.locator("astro-dev-toolbar").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  const screenshot = captured ?? await page.screenshot();
  return page.evaluate(async ({ base64, samples }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return samples.map(({ x, y }) => [...context.getImageData(x, y, 1, 1).data]);
  }, { base64: screenshot.toString("base64"), samples });
}

async function assertPainted(page) {
  const state = await layout(page);
  const samples = [];
  for (const slot of state.slots.filter((slot) => slot.visible)) {
    assert.ok(Math.abs(slot.height - state.h) < 1, "段の高さが表示領域と違う");
    assert.ok(Math.abs(slot.top - state.top) < 1, "縦スクロールで段の枠が動いた");
    for (const offset of [23, 111, Math.floor(state.h / 2) + 7, state.h - 23]) {
      const y = Math.floor(state.top + offset);
      // Sample the actual pixel center, avoiding text at the row's left edge.
      const t = slot.k * state.step + state.y + y + 0.5 - state.top;
      samples.push({
        x: slot.sampleX,
        y,
        expected: t < 0 || t >= state.l ? [248, 248, 248, 255] : COLORS[Math.floor(t / ROW_HEIGHT) % 2],
        column: slot.k,
      });
    }
  }
  assert.ok(samples.length >= 4, "表示中の段の描画を検証できない");

  // Bounding rectangles stay correct even when the old overflow clip discards
  // pixels. Read the screenshot itself, not DOM geometry or computed colors.
  const pixels = await readPixels(page, samples);

  for (let i = 0; i < samples.length; i++) {
    assert.deepEqual(pixels[i], samples[i].expected,
      `段 ${samples[i].column} の画素 (${samples[i].x}, ${samples[i].y}) が本文と一致しない。scrollTop=${state.y}`);
  }
}

async function assertContextOverlap(page) {
  const state = await layout(page);
  const overlap = state.h - state.step;
  assert.ok(overlap > 0 && overlap <= state.h / 4);
  const visible = state.slots.filter((slot) => slot.visible);
  const samples = [];
  const sample = (slot, offset) => {
    const y = Math.floor(state.top + offset);
    const t = slot.k * state.step + state.y + y + 0.5 - state.top;
    if (t < 0 || t >= state.l) return;
    samples.push({ x: slot.sampleX, y,
      expected: COLORS[Math.floor(t / ROW_HEIGHT) % 2] });
    return t;
  };
  for (const slot of visible) {
    const bottom = sample(slot, state.step + overlap / 2);
    if (slot.k !== 0) sample(slot, overlap / 2);
    const next = visible.find((other) => other.k === slot.k + 1);
    if (next && bottom !== undefined) {
      const top = next.k * state.step + state.y
        + Math.floor(state.top + overlap / 2) + 0.5 - state.top;
      assert.ok(Math.abs(bottom - top) < 1, "上下端が同じ文脈を表示していない");
    }
  }
  const pixels = await readPixels(page, samples);
  for (let i = 0; i < samples.length; i++) {
    const expected = samples[i].expected;
    // Edge text should be gently softened, not erased or replaced with a band.
    const alpha = (pixels[i][2] - expected[2]) / (248 - expected[2]);
    assert.ok(alpha > 0.05 && alpha < 0.5, `文脈が薄すぎるか消えている: ${pixels[i]}`);
    for (let channel = 0; channel < 3; channel++) {
      const blended = expected[channel] * (1 - alpha) + 248 * alpha;
      assert.ok(Math.abs(pixels[i][channel] - blended) < 5,
        "重なり部分に別の本文が描画されている");
    }
  }
}

async function settle(page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

async function scrollLogical(page, column, y, phase = 0) {
  // Native limits describe the CURRENT row/column. Open the requested range
  // before moving along the other axis, as a reader would do.
  await page.locator(".rm-viewport").focus();
  await page.keyboard.press("Home");
  await settle(page);
  for (const axis of y >= 0 ? ["y", "x"] : ["x", "y"]) {
    await page.locator(".rm-viewport").evaluate((viewport, { column, y, phase, axis }) => {
      const style = document.querySelector(".rm-plane").style;
      const p = parseFloat(style.getPropertyValue("--rm-p"));
      const origin = Number(document.querySelector(".rm-plane").dataset.rmOriginColumn);
      const originY = parseFloat(document.querySelector(".rm-plane").dataset.rmOriginY);
      if (axis === "x") viewport.scrollLeft = (column - origin) * p + phase;
      else viewport.scrollTop = y - originY;
    }, { column, y, phase, axis });
    await settle(page);
  }
}

test("スクロール後も固定高さの各段が続きの本文で描画される", { timeout: 120_000 }, async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.RM_BROWSER_PATH || undefined,
  });
  try {
    for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }]) {
      await t.test(`${viewport.width}px の表示領域`, async () => {
        const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
        try {
          await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
          await page.goto(ARTICLE_URL, { waitUntil: "domcontentloaded" });
          await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForSelector("html.rm-active .rm-slot");
          await page.locator(".rm-source").evaluate((source, { rowHeight, rowCount }) => {
            // Solid alternating rows make a missing lower section unambiguous;
            // ordinary article whitespace must not hide a rendering regression.
            source.innerHTML = Array.from({ length: rowCount }, (_, i) =>
              `<div style="height:${rowHeight}px;margin:0;background:${i % 2 ? "#0044aa" : "#aa3300"}"></div>`,
            ).join("");
          }, { rowHeight: ROW_HEIGHT, rowCount: ROW_COUNT });
          await page.waitForFunction((length) =>
            parseFloat(document.querySelector(".rm-plane").style.getPropertyValue("--rm-l")) === length,
          ROW_HEIGHT * ROW_COUNT);
          await settle(page);
          const initial = await layout(page);

          // No native left range exists until a full text advance is earned.
          for (const y of [0, Math.floor(initial.step / 2), initial.step - 1]) {
            await scrollLogical(page, 0, y);
            await page.locator(".rm-viewport").focus();
            await page.keyboard.press("ArrowLeft");
            await settle(page);
            const blocked = await layout(page);
            assert.equal(blocked.x, 0);
            assert.equal(Math.floor((blocked.x + 0.01) / blocked.p) + blocked.origin, 0);
            assert.equal(blocked.y, y);
            await page.mouse.move(blocked.left + 100, blocked.top + 100);
            await page.mouse.wheel(-180, 0);
            await settle(page);
            assert.equal((await layout(page)).x, 0, "ホイールで白紙の段に移動できた");
          }

          // The user's example: down one text advance, then left one column.
          await scrollLogical(page, 0, initial.step);
          await page.locator(".rm-viewport").focus();
          await page.keyboard.press("ArrowLeft");
          await settle(page);
          const negative = await layout(page);
          assert.equal(Math.floor((negative.x + 0.01) / negative.p) + negative.origin, -1);
          assert.equal(negative.y, initial.step);
          await assertPainted(page);
          await assertContextOverlap(page);
          await page.keyboard.press("ArrowLeft");
          await page.keyboard.press("PageUp");
          await settle(page);
          assert.equal((await layout(page)).x, 0);
          assert.equal((await layout(page)).y, initial.step);

          await scrollLogical(page, 0, 2 * initial.step);
          await page.keyboard.press("ArrowLeft");
          await page.keyboard.press("ArrowLeft");
          await page.keyboard.press("ArrowLeft");
          await settle(page);
          const two = await layout(page);
          assert.equal(two.x, 0);
          assert.equal(Math.floor((two.x + 0.01) / two.p) + two.origin, -2);
          assert.equal(two.y, 2 * initial.step);
          await assertPainted(page);

          for (const y of [0, 37, 220, initial.h - 1, initial.h + 47, 2 * initial.h + 173,
            initial.l - initial.h - 17]) {
            await scrollLogical(page, 0, y);
            await assertPainted(page);
            await assertContextOverlap(page);
          }
          // Recycling and diagonal movement must paint the right source rows too.
          await scrollLogical(page, 3, 220);
          await assertPainted(page);
          await assertContextOverlap(page);

          const beforeWheel = await layout(page);
          await page.mouse.move(beforeWheel.left + 100, beforeWheel.top + 100);
          await page.mouse.wheel(97, 129);
          await page.waitForFunction(({ x, y }) => {
            const viewport = document.querySelector(".rm-viewport");
            return viewport.scrollLeft >= x + 96 && viewport.scrollTop >= y + 128;
          }, { x: beforeWheel.x, y: beforeWheel.nativeY });
          await settle(page);
          const afterWheel = await layout(page);
          assert.ok(Math.abs(afterWheel.x - beforeWheel.x - 97) < 1);
          assert.ok(Math.abs(afterWheel.y - beforeWheel.y - 129) < 1);
          await assertPainted(page);

          // Follow the same text far beyond the original first/last columns.
          // Earn the range before spending it at the article's leading edge.
          await scrollLogical(page, 0, 220, 73);
          const slotCount = (await layout(page)).slots.length;
          const origins = new Set();
          for (const [direction, cycles] of [[-1, 16], [1, 32]]) {
            for (let cycle = 0; cycle < cycles; cycle++) {
              for (const axis of direction < 0 ? ["y", "x"] : ["x", "y"]) {
                if (axis === "x") {
                  for (let i = 0; i < 8; i++) await page.keyboard.press(direction < 0 ? "ArrowLeft" : "ArrowRight");
                } else {
                  await page.locator(".rm-viewport").evaluate((viewport, direction) => {
                    const step = parseFloat(document.querySelector(".rm-plane").style.getPropertyValue("--rm-step"));
                    viewport.scrollBy({ top: -direction * 8 * step, behavior: "instant" });
                  }, direction);
                }
                await settle(page);
              }
              const moved = await layout(page);
              const k = Math.floor((moved.x + 0.01) / moved.p) + moved.origin;
              assert.ok(Math.abs(k * moved.step + moved.y - 220) < 1,
                `座標の組み替えで本文位置がずれた: ${JSON.stringify({ direction, cycle, k, x: moved.x, y: moved.y, step: moved.step, origin: moved.origin, originY: moved.originY })}`);
              assert.ok(Math.abs(moved.x % moved.p - 73) < 1, "横移動が段境界に吸着した");
              assert.equal(moved.slots.length, slotCount, "移動するほど本文複製が増えた");
              origins.add(`${moved.origin}:${moved.originY}`);
              if (cycle % 8 === 0 || cycle === cycles - 1) await assertPainted(page);
            }
          }
          assert.ok(origins.size >= 4, "スクロール領域の端を越す移動を確認できない");

          // The final real page stays visible; no input can expose an empty one.
          for (const y of [0, Math.floor(initial.step / 2), initial.step, 2 * initial.step]) {
            await scrollLogical(page, 0, y);
            // The scrollbar now spans only the mounted window. Keep moving
            // across rebases until the logical article end is reached.
            let previous = -Infinity;
            for (let i = 0; i < 30; i++) {
              await page.locator(".rm-viewport").evaluate((v) => { v.scrollLeft = v.scrollWidth; });
              await settle(page);
              const s = await layout(page);
              const logicalX = s.x + s.origin * s.p;
              if (Math.abs(logicalX - previous) < 1) break;
              previous = logicalX;
            }
            const right = await layout(page);
            assert.equal(right.x, right.maxX);
            const visible = right.slots.filter((slot) => slot.visible);
            assert.ok(visible.every((slot) => slot.k * right.step + right.y < right.l));
            const last = visible.reduce((a, b) => a.k > b.k ? a : b);
            assert.ok(last.k * right.step + right.y + right.h >= right.l);
            assert.ok(Math.abs(last.left + last.width - right.left - right.width) < 1,
              "末尾の右に空の段を表示している");
            await page.locator(".rm-viewport").focus();
            await page.keyboard.press("ArrowRight");
            await page.keyboard.press("ArrowRight");
            await page.mouse.move(right.left + right.width - 100, right.top + 100);
            await page.mouse.wheel(250, 0);
            await settle(page);
            const stopped = await layout(page);
            assert.equal(stopped.x, stopped.maxX);
            assert.ok(Math.abs(stopped.y - right.y) < 1);
            assert.equal(Math.floor((stopped.x + 0.01) / stopped.p) + stopped.origin,
              Math.floor((right.x + 0.01) / right.p) + right.origin);
            await assertPainted(page);
          }

          // Native edges either rebase or stop at the article's beginning.
          for (const edge of ["left", "right", "top", "bottom"]) {
            await page.locator(".rm-viewport").evaluate((viewport, edge) => {
              viewport.scrollTo({
                left: edge === "left" ? 0 : edge === "right" ? viewport.scrollWidth : viewport.scrollLeft,
                top: edge === "top" ? 0 : edge === "bottom" ? viewport.scrollHeight : viewport.scrollTop,
                behavior: "instant",
              });
            }, edge);
            await settle(page);
            const actual = await layout(page);
            assert.ok((Math.floor((actual.x + 0.01) / actual.p) + actual.origin) * actual.step + actual.y >= 0);
            assert.ok(actual.slots.filter((slot) => slot.visible).every((slot) => slot.k * actual.step + actual.y < actual.l));
            await assertPainted(page);
          }
          // Home/End work regardless of how far away the virtual origin is.
          await page.locator(".rm-viewport").focus();
          for (const key of ["Home", "End"]) {
            await page.keyboard.press(key);
            await settle(page);
            const state = await layout(page);
            const t = (Math.floor((state.x + 0.01) / state.p) + state.origin) * state.step + state.y;
            if (key === "Home") assert.ok(Math.abs(t) < 1);
            else assert.ok(state.slots.filter((slot) => slot.visible).some((slot) => {
              const py = state.l - 1 - slot.k * state.step - state.y;
              return py >= 0 && py < state.h;
            }), "Endで本文末尾が表示されない");
            await assertPainted(page);
          }
          await page.setViewportSize({ width: viewport.width, height: viewport.height - 130 });
          await page.waitForFunction(() =>
            parseFloat(document.querySelector(".rm-plane").style.getPropertyValue("--rm-h"))
              === document.querySelector(".rm-viewport").clientHeight);
          await settle(page);
          await assertPainted(page);
          await assertContextOverlap(page);
        } catch (error) {
          const path = join(tmpdir(), `dispositif-reading-paint-${viewport.width}.png`);
          await page.screenshot({ path }).catch(() => {});
          t.diagnostic(`描画確認画像: ${path}`);
          throw error;
        } finally {
          await page.close();
        }
      });
    }

    await t.test("有限なスクロール面より長い記事でもハッシュとHome/Endが使える", async () => {
      const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
      try {
        await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
        await page.goto(ARTICLE_URL);
        await page.waitForSelector(".rm-slot");
        await page.locator(".rm-source").evaluate((source) => {
          source.innerHTML = '<h2 id="rm-far-start" style="margin:0;height:40px">先頭</h2><div style="height:1000000px"></div><h2 id="rm-far-end" style="margin:0;height:1000px;background:#0044aa">遠い見出し</h2>';
        });
        await page.waitForFunction(() =>
          parseFloat(document.querySelector(".rm-plane").style.getPropertyValue("--rm-l")) > 1000000);
        await settle(page);
        assert.ok(await page.locator(".rm-viewport").evaluate((v) => v.scrollHeight <= 128 * v.clientHeight + 1),
          "本文の長さに応じてスクロール面まで大きくなった");
        const count = await page.locator(".rm-content").count();
        await page.evaluate(() => { location.hash = "rm-far-end"; });
        await page.waitForFunction(() => {
          const v = document.querySelector(".rm-viewport"), s = document.querySelector(".rm-plane").style;
          const step = parseFloat(s.getPropertyValue("--rm-step"));
          const target = document.getElementById("rm-far-end").getBoundingClientRect().top
            - document.querySelector(".rm-source").getBoundingClientRect().top;
          const vr = v.getBoundingClientRect();
          return [...document.querySelectorAll(".rm-slot")].some((slot) => {
            const r = slot.getBoundingClientRect();
            const py = target - Number(slot.dataset.rmK) * step - v.scrollTop - parseFloat(document.querySelector(".rm-plane").dataset.rmOriginY);
            return r.left >= vr.left - 1 && r.right <= vr.right + 1 && py >= -1 && py < v.clientHeight;
          });
        });
        await settle(page);
        const atHash = await layout(page);
        const first = atHash.slots.filter((slot) => slot.visible).sort((a, b) => a.left - b.left)[0];
        const [pixel] = await readPixels(page, [{ x: first.sampleX, y: Math.floor(atHash.top + 111) }]);
        assert.deepEqual(pixel, [0, 68, 170, 255], "遠い見出しの実際の描画が空白になった");
        await page.locator(".rm-viewport").focus();
        for (const key of ["Home", "End"]) {
          await page.keyboard.press(key);
          await settle(page);
          const s = await layout(page);
          const t = (Math.floor((s.x + 0.01) / s.p) + s.origin) * s.step + s.y;
          if (key === "Home") assert.ok(Math.abs(t) < 1);
          else assert.ok(s.slots.filter((slot) => slot.visible).some((slot) => {
            const py = s.l - 1 - slot.k * s.step - s.y;
            return py >= 0 && py < s.h;
          }));
          assert.equal(await page.locator(".rm-content").count(), count);
        }
      } finally { await page.close(); }
    });

    await t.test("画面より短い記事は1段で止まり、白紙の段を作らない", async () => {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      try {
        await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
        await page.goto(ARTICLE_URL);
        await page.waitForSelector(".rm-slot");
        await page.locator(".rm-source").evaluate((source) => {
          source.innerHTML = '<div style="height:200px;background:#0044aa">短い記事</div>';
        });
        await page.waitForFunction(() => parseFloat(document.querySelector(".rm-plane").style.getPropertyValue("--rm-l")) === 200);
        await settle(page);
        await page.locator(".rm-viewport").focus();
        await page.keyboard.press("ArrowRight");
        await page.locator(".rm-viewport").evaluate((v) => { v.scrollLeft = 1000000; });
        await settle(page);
        assert.equal((await layout(page)).maxX, 0);
        assert.equal((await layout(page)).x, 0);
        assert.equal(await page.locator(".rm-slot").count(), 1);
      } finally { await page.close(); }
    });

    await t.test("数式記事の高速移動で本文全体のスタイルを再計算しない", async (t) => {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      try {
        await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
        await page.goto(ARTICLE_URL);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForSelector(".rm-content mjx-container");
        await page.locator("astro-dev-toolbar").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
        await settle(page);
        const initial = await layout(page);
        const client = await page.context().newCDPSession(page);
        await client.send("Performance.enable");
        await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        const metrics = async () => Object.fromEntries(
          (await client.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]),
        );
        const before = await metrics();
        for (const distance of [-8000, 8000]) {
          await client.send("Input.synthesizeScrollGesture", {
            x: initial.left + 100, y: initial.top + 150,
            xDistance: distance, yDistance: 0, speed: 12000,
            gestureSourceType: "mouse", preventFling: true,
          });
        }
        const after = await metrics();
        const count = after.RecalcStyleCount - before.RecalcStyleCount;
        const duration = after.RecalcStyleDuration - before.RecalcStyleDuration;
        t.diagnostic(`CPU 4倍減速: スタイル再計算 ${count}回 / ${(duration * 1000).toFixed(1)}ms`);
        // Allow ample headroom for CI, but catch the former whole-MathJax-tree
        // invalidation (hundreds of milliseconds per update on this article).
        assert.ok(duration / Math.max(1, count) < 0.05,
          "段の移動で数式本文全体のスタイル再計算が発生している");
        assert.equal(await page.locator(".rm-slot").count(), initial.slots.length);
        await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        await client.detach();
      } finally { await page.close(); }
    });

    await t.test("高速横移動を妨げず、先読みと既存枠の再利用を維持する", async () => {
      for (const width of [1600, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        try {
          await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
          await page.goto(ARTICLE_URL);
          await page.evaluate(() => document.fonts.ready);
          await page.waitForSelector(".rm-slot");
          await page.locator(".rm-source").evaluate((source) => {
            source.innerHTML = '<div style="height:300000px;background:#0044aa"></div>';
          });
          await page.waitForFunction(() => document.querySelector(".rm-plane").style.getPropertyValue("--rm-l") === "300000px");
          await settle(page);
          const initial = await layout(page);
          const trace = await page.evaluateHandle(() => {
            const viewport = document.querySelector(".rm-viewport");
            const state = { missing: [], frames: new Set(document.querySelectorAll(".rm-slot")) };
            // Capture runs before the reader's passive listener/rAF. Checking
            // after two animation frames would miss the blank-page window.
            viewport.addEventListener("scroll", () => {
              const style = document.querySelector(".rm-plane").style;
              const p = parseFloat(style.getPropertyValue("--rm-p"));
              const origin = Number(document.querySelector(".rm-plane").dataset.rmOriginColumn);
              const first = Math.floor((viewport.scrollLeft + 0.01) / p) + origin;
              const last = Math.floor((viewport.scrollLeft + viewport.clientWidth - 0.01) / p) + origin;
              const mounted = new Set([...document.querySelectorAll(".rm-slot")].map((slot) => Number(slot.dataset.rmK)));
              for (let k = first; k <= last; k++) if (!mounted.has(k)) state.missing.push(k);
            }, { capture: true, passive: true });
            return state;
          });
          const session = await page.context().newCDPSession(page);
          const object = await session.send("Runtime.evaluate", {
            expression: 'document.querySelector(".rm-viewport")',
          });
          const { listeners } = await session.send("DOMDebugger.getEventListeners", { objectId: object.result.objectId });
          assert.ok(!listeners.some((listener) => listener.type === "wheel" && !listener.passive),
            "非passiveなホイール処理がネイティブスクロールを待たせる");
          assert.ok(initial.maxX > 50 * initial.p, "ネイティブスクロール面が数段に制限されている");
          await page.mouse.move(initial.left + 100, initial.top + 150);
          for (let i = 0; i < 20; i++) {
            await page.mouse.wheel((i < 12 ? 1 : -1) * 1.7 * initial.p, 0);
            await settle(page);
          }
          assert.deepEqual(await trace.evaluate((state) => state.missing), [], "先読みの外に可視段が出た");
          assert.ok(await trace.evaluate((state) => [...document.querySelectorAll(".rm-slot")].every((slot) => state.frames.has(slot))),
            "横移動で表示枠を作り直した");
          // Large wheel deltas keep their full logical distance across a rebase.
          const beforeJump = await layout(page);
          await page.mouse.wheel(20 * beforeJump.p, 0);
          await settle(page);
          const afterJump = await layout(page);
          assert.ok(Math.abs((afterJump.x + afterJump.origin * afterJump.p)
            - (beforeJump.x + beforeJump.origin * beforeJump.p) - 20 * beforeJump.p) < 1,
          "高速入力の移動距離がスクロール面の端で切り捨てられた");
          await page.mouse.wheel(-20 * beforeJump.p, 0);
          await settle(page);
          if (width === 1600) {
            const count = initial.slots.length;
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.waitForFunction((count) => document.querySelectorAll(".rm-slot").length < count, count);
            assert.ok(await trace.evaluate((state) => [...document.querySelectorAll(".rm-slot")].every((slot) => state.frames.has(slot))),
              "枠を減らす際に残すべき枠まで削除した");
            await page.setViewportSize({ width, height: 900 });
            await page.waitForFunction((count) => document.querySelectorAll(".rm-slot").length === count, count);
            const retained = await trace.evaluate((state) => [...document.querySelectorAll(".rm-slot")].filter((slot) => state.frames.has(slot)).length);
            assert.equal(retained, count - 1, "枠を増やす際に既存の枠まで作り直した");
          }
          // A large wheel gesture over a formula/code-like scroller must still
          // belong to that element, rather than jumping the article.
          await page.locator(".rm-viewport").focus();
          await page.keyboard.press("Home");
          await page.locator(".rm-source > div").evaluate((body) => {
            body.innerHTML = '<div data-test-scroll style="height:80px;width:120px;overflow:auto"><div style="width:30000px;height:40px"></div></div>';
          });
          await settle(page);
          const nested = page.locator('.rm-slot[data-rm-k="0"] [data-test-scroll]');
          await nested.waitFor();
          const box = await nested.boundingBox();
          await page.mouse.move(box.x + 40, box.y + 40);
          await page.mouse.wheel(4000, 0);
          await page.waitForFunction(() => document.querySelector('.rm-slot[data-rm-k="0"] [data-test-scroll]').scrollLeft > 3000);
          assert.equal((await layout(page)).x, 0, "数式やコードの横スクロールを奪った");
          await page.mouse.move(initial.left + 100, initial.top + 150);
          // A delayed rAF can still scroll natively through the prepared
          // nearby columns. Arbitrary jumps with JS suspended are not covered.
          const originalRAF = await page.evaluateHandle(() => window.requestAnimationFrame);
          await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
          for (const delta of [initial.p * 1.7, -initial.p * 1.7]) {
            const before = await layout(page);
            await page.mouse.wheel(delta, 0);
            await page.waitForTimeout(80);
            const state = await layout(page);
            assert.ok(Math.abs(state.x - before.x - delta) < 1, "JSの更新待ちで高速スクロールが止まった");
            const samples = state.slots.filter((slot) => slot.visible).map((slot) => ({
              x: slot.sampleX, y: Math.floor(state.top + state.h / 2),
            }));
            assert.ok(samples.length > 0);
            const shot = await session.send("Page.captureScreenshot", { format: "png" });
            const pixels = await readPixels(page, samples, Buffer.from(shot.data, "base64"));
            assert.ok(pixels.every((pixel) => pixel.join() === "0,68,170,255"),
              "先読みしてある本文が描画されない");
          }
          await page.evaluate((raf) => { window.requestAnimationFrame = raf; }, originalRAF);
          await originalRAF.dispose();
          await session.detach();
          await trace.dispose();
        } finally { await page.close(); }
      }
    });
  } finally {
    await browser.close();
  }
});
