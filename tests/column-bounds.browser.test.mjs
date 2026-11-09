import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { ARTICLE_URL, launch, storeColumns } from "./browser.mjs";


async function settle(page) {
  await page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); });
}
async function state(page) {
  return page.evaluate(() => {
    const v = document.querySelector(".cl-viewport"), plane = document.querySelector(".cl-plane");
    const number = (name) => name === "leading" ? Number(plane.dataset.clLeading) : parseFloat(plane.style.getPropertyValue(`--cl-${name}`));
    const p = number("p"), h = number("h"), step = number("step"), l = number("l"), leading = number("leading");
    const projectedX = v.scrollLeft + Number(plane.dataset.clOriginColumn) * p - leading;
    const projectedY = v.scrollTop + Number(plane.dataset.clOriginY);
    // Bounds belong to canonical integer coordinates. Reconstructing them
    // from CSS/native offsets puts exact edges a fraction of a tick away from
    // zero at non-integer zooms and can select an empty neighbouring column.
    const x = Number(plane.dataset.clXTicks) / 1024, y = Number(plane.dataset.clYTicks) / 1024;
    const edge = number("edge"), zoom = v.getBoundingClientRect().width / v.offsetWidth;
    return { x, y, projectedX, projectedY, xTicks: Number(plane.dataset.clXTicks), yTicks: Number(plane.dataset.clYTicks), p, h, step, l, leading, edge, zoom, w: number("w"), width: v.clientWidth, maxX: v.scrollWidth - v.clientWidth,
      nativeX: v.scrollLeft, nativeY: v.scrollTop, maxY: v.scrollHeight - v.clientHeight,
      slots: [...document.querySelectorAll(".cl-slot")].map(slot => {
        const r = slot.getBoundingClientRect(), paper = slot.querySelector(".cl-paper");
        const pr = paper.getBoundingClientRect();
        return { k: Number(slot.dataset.clK), left: r.left / zoom, right: r.right / zoom,
          paperTop: parseFloat(paper.style.top), paperHeight: parseFloat(paper.style.height),
          contentShift: parseFloat(slot.querySelector(".cl-content").style.translate.split(/\s+/)[1] ?? "0") + Number(slot.dataset.clK) * step + Number(plane.dataset.clOriginY),
          paperY: pr.y, paperX: pr.x, paperBottom: pr.bottom };
      }) };
  });
}
async function setPoint(page, point) {
  await page.locator(".cl-viewport").evaluate((v, point) => {
    const plane = document.querySelector(".cl-plane"), p = parseFloat(plane.style.getPropertyValue("--cl-p"));
    if (point.x !== undefined) v.scrollLeft = point.x - Number(plane.dataset.clOriginColumn) * p + Number(plane.dataset.clLeading);
    if (point.y !== undefined) v.scrollTop = point.y - Number(plane.dataset.clOriginY);
  }, point);
  await settle(page);
}
async function pixelAt(page, x, y) {
  const png = await page.screenshot();
  return page.evaluate(async ({ png, x, y }) => {
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(x, y, 1, 1).data];
  }, { png: png.toString("base64"), x: Math.floor(x), y: Math.floor(y) });
}
async function open(page) {
  await storeColumns(page, "multi");
  await page.goto(ARTICLE_URL);
  // Compare paper edges against a flat canvas, without list cards or the
  // keyboard focus outline painting over the first row of sampled pixels.
  await page.addStyleTag({ content: ".article-index-shell, .cl-backdrop { display: none !important; } .cl-viewport { outline: none !important; }" });
  await page.waitForSelector(".cl-slot");
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".cl-source").evaluate(s => { s.innerHTML = '<div style="height:13573px;background:#a33b00"></div>'; });
  await page.waitForFunction(() => document.querySelector(".cl-plane").style.getPropertyValue("--cl-l") === "13573px");
  await page.locator("astro-dev-toolbar").evaluateAll(nodes => nodes.forEach(node => node.remove()));
  await settle(page);
}

test("ズーム・縦位置によらず横操作だけで全文を読め、消える部分段を含めて横余白を制限する", { timeout: 120_000 }, async () => {
  const browser = await launch(chromium);
  try {
    for (const zoom of [1, 1.25, 1.5]) for (const width of [390, 1600]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await open(page);
        await page.addStyleTag({ content: `html { zoom: ${zoom}; }` });
        await settle(page);
        { const overlap = 0;
          await settle(page);
          await page.locator(".cl-viewport").focus(); await page.keyboard.press("Home"); await settle(page);
          const initial = await state(page);
          for (const y of [0, Math.floor(initial.step / 2)]) {
            await page.keyboard.press("Home"); await settle(page);
            await setPoint(page, { y });
            await setPoint(page, { x: -1e8 });
            const start = await state(page), intervals = [];
            const first = Math.floor((-start.y + 1e-7) / start.step);
            const last = Math.ceil((start.l - start.h - start.y - 1e-7) / start.step);
            const firstCore = Math.ceil((-start.y - 1e-7) / start.step);
            assert.ok(start.edge + firstCore * start.p - start.x <= start.p + start.edge + 2);
            for (let k = first; k <= last; k++) {
              await setPoint(page, { x: k * start.p });
              const s = await state(page);
              assert.ok(Math.abs(s.y - start.y) < 2, `横移動で縦位置が動いた: ${JSON.stringify({zoom,width,overlap,k,start,s})}`);
              const column = s.slots.find(slot => slot.k === k);
              assert.ok(column && column.left >= s.edge - 2 && column.right <= s.width - s.edge + 2,
                JSON.stringify({ zoom, width, overlap, k, start, s }));
              const from = k * s.step + s.y;
              intervals.push([from + column.paperTop - column.contentShift, from + column.paperTop + column.paperHeight - column.contentShift]);
              assert.ok(column.paperHeight <= Math.min(s.l, from + s.h) - Math.max(0, from) + 2);
              if (from > 0) assert.ok(Math.abs(column.paperTop) < 1, "末尾の部分段の上端がずれた");
            }
            let end = 0;
            for (const [from, to] of intervals) { assert.ok(from <= end + 2, JSON.stringify({zoom,width,overlap,y,from,end,intervals})); end = Math.max(end, to); }
            assert.ok(Math.abs(end - start.l) < 2, "横操作だけで末尾まで表示されない");
            const atEnd = await state(page);
            await page.locator(".cl-viewport").evaluate(v => { v.scrollLeft = v.scrollWidth; }); await settle(page);
            const blocked = await state(page);
            assert.ok(Math.abs(blocked.x - atEnd.x) < 2);
          }
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("画像の配置から上下に動かすと部分段が連続的に消え、本文端に余白も横移動も足さない", { timeout: 90_000 }, async () => {
  const browser = await launch(chromium, { ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    for (const width of [1280, 1562]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      try {
        await open(page);
        { const overlap = 0;
          await settle(page);
          for (const direction of [-1, 1]) {
            await page.locator(".cl-viewport").focus();
            await page.keyboard.press(direction < 0 ? "Home" : "End"); await settle(page);
            if (direction < 0) {
              await page.locator(".cl-viewport").evaluate(v => { v.scrollLeft = 0; }); await settle(page);
            }
            const edge = await state(page), x = edge.x;
            // Home/End align the real note. The additional column of blank
            // space is reached with vertical input, never horizontal input.
            const extra = Math.min(edge.p, Math.max(0, edge.width - edge.w - 2 * edge.edge));
            const targetY = direction < 0 ? -Math.floor((x + extra) / edge.p) * edge.step
              : edge.l - edge.h - Math.ceil((x + edge.width - edge.w - 2 * edge.edge - extra) / edge.p) * edge.step;
            const main = direction < 0 ? Math.round(-targetY / edge.step) : Math.round((edge.l - edge.h - targetY) / edge.step);
            const partial = main + direction;
            await setPoint(page, { y: targetY - direction * 120 });
            const before = await state(page);
            const heights = [];
            const rect = await page.locator(".cl-viewport").boundingBox();
            await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
            for (let i = 0; i < 12; i++) {
              await page.mouse.wheel(0, direction * 10); await settle(page);
              const current = await state(page);
              const sheet = current.slots.find(slot => slot.k === partial);
              heights.push(sheet?.paperHeight ?? 0);
              if (sheet && sheet.paperHeight > 1) {
                if (direction > 0) assert.ok(Math.abs(sheet.paperTop) < 1, "末尾側の上端がそろわない");
                else assert.ok(Math.abs(sheet.paperTop + sheet.paperHeight - current.h) < 1, "先頭側の下端がそろわない");
              }
              assert.ok(Math.abs(current.x - x) < 2, "部分段を消すとき横位置が動いた");
            }
            assert.ok(heights[0] > 50, JSON.stringify({direction, width, overlap, before, heights}));
            assert.ok(heights.at(-1) < 1.5, JSON.stringify({direction, width, overlap, heights}));
            assert.ok(heights.slice(1).every((height, i) => height <= heights[i] + 1));
            assert.ok(heights.slice(1).some((height, i) => height > 5 && height < heights[i] - 2));
            const ended = await state(page), mainSheet = ended.slots.find(slot => slot.k === main);
            assert.ok(mainSheet);
            assert.ok(Math.abs(ended.y - targetY) < 2);
            assert.ok(Math.abs(mainSheet.paperTop) < 2 && Math.abs(mainSheet.paperHeight - ended.h) < 2,
              "重なりが本文端の余白になった");
            const emptyX = ended.edge + partial * ended.p - ended.x + ended.w / 2;
            if (emptyX > 1 && emptyX < ended.width - 1) {
              assert.deepEqual(await pixelAt(page, emptyX, rect.y + (direction < 0 ? ended.h - 5 : 5)), [160, 186, 200, 255],
                "重なりだけの帯が残った");
            }
            await page.mouse.wheel(0, direction * 1000); await settle(page);
            await page.keyboard.press(direction < 0 ? "PageUp" : "PageDown"); await settle(page);
            const blocked = await state(page);
            assert.ok(Math.abs(blocked.x - x) < 2 && Math.abs(blocked.y - targetY) < 2);
            await page.mouse.wheel(0, -direction * 40); await settle(page);
            assert.ok((await state(page)).slots.some(slot => slot.k === partial && slot.paperHeight > 20), "逆スクロールで部分段が復元されない");
          }
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("同じ座標の本文と白い面は到達経路によらず一致し、Home/Endは基準配置に戻る", { timeout: 30_000 }, async () => {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  try {
    await open(page);
    const result = [];
    for (const path of [[{ y: 4000 }, { x: 600 }, { y: -400 }], [{ x: 600 }, { y: -400 }]]) {
      await page.locator(".cl-viewport").focus(); await page.keyboard.press("Home"); await settle(page);
      for (const point of path) await setPoint(page, point);
      const s = await state(page);
      result.push({ x: s.x, y: s.y, slots: s.slots.filter(slot => slot.right > 0 && slot.left < s.width)
        .sort((a,b) => a.k-b.k).map(({ k, left, paperTop, paperHeight }) => ({ k, left, paperTop, paperHeight })) });
    }
    assert.deepEqual(result[0], result[1]);
    const destinations = [];
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press("End"); await settle(page);
      const end = await state(page); destinations.push({ x: end.x, y: end.y });
      await setPoint(page, { x: 0 }); await setPoint(page, { y: 3000 });
      await page.keyboard.press("Home"); await settle(page);
      const start = await state(page); assert.ok(Math.abs(start.x) < 2 && Math.abs(start.y) < 2);
    }
    assert.deepEqual(destinations[0], destinations[1]);
  } finally { await page.close(); await browser.close(); }
});

test("拡大表示の下端の丸めでも白い線を残さず、本文の末尾を正確にそろえる", { timeout: 90_000 }, async () => {
  const browser = await launch(chromium, { ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    for (const zoom of [1, 1.1, 1.125, 1.25, 1.5]) for (const height of [900, 927]) {
      const page = await browser.newPage({ viewport: { width: 1410, height } });
      try {
        await open(page);
        await page.addStyleTag({ content: `html { zoom: ${zoom}; }` });
        await settle(page);
        for (const direction of [-1, 1]) {
          await page.locator(".cl-viewport").focus();
          await page.keyboard.press(direction < 0 ? "Home" : "End"); await settle(page);
          if (direction < 0) {
            await page.locator(".cl-viewport").evaluate(v => { v.scrollLeft = 0; }); await settle(page);
          }
          const rect = await page.locator(".cl-viewport").boundingBox();
          const beforeX = (await state(page)).x;
          await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
          await page.mouse.wheel(0, direction * 1e6); await settle(page);
          await page.locator(".cl-viewport").evaluate((v, direction) => { v.scrollTop = direction < 0 ? 0 : v.scrollHeight; }, direction);
          await settle(page);
          const s = await state(page);
          const k = direction < 0 ? Math.round(-s.y / s.step) : Math.round((s.l - s.h - s.y) / s.step);
          const partial = s.slots.find(slot => slot.k === k + direction);
          const main = s.slots.find(slot => slot.k === k);
          const message = JSON.stringify({ zoom, height, direction, s });
          assert.ok(main, message);
          assert.ok(Math.abs(s.x - beforeX) < 1.5, `丸め補正で横位置が動いた: ${message}`);
          assert.equal(partial?.paperHeight ?? 0, 0, `白い線が残った: ${message}`);
          assert.ok(Math.abs(main.paperHeight - s.h) < 1e-5, `本文端に余白ができた: ${message}`);
          const sourceTop = k * s.step + s.y - main.contentShift;
          // The text's translate is rounded to whole device pixels (sharp text
          // when columns are recycled), so it may sit up to half a pixel off the
          // exact end. The paper edge itself need not be on that grid.
          assert.ok(Math.abs(direction < 0 ? sourceTop : sourceTop + s.h - s.l) <= .501,
            `本文を切り捨てて線を隠している: ${message}`);
          if (direction > 0 && partial) {
            const x = (partial.left + s.w / 2) * s.zoom;
            if (x >= 1 && x < 1409) for (let row = 0; row < 4; row++) {
              assert.deepEqual(await pixelAt(page, x, Math.floor(rect.y) + row), [160, 186, 200, 255],
                `消えた段の上端に線が描かれている: ${message}`);
            }
          }
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("横操作は実在する端の段まで、縦で生じた余白は横位置を保ち内側へ連続して戻れる", { timeout: 90_000 }, async () => {
  const browser = await launch(chromium);
  try {
    for (const zoom of [1, 1.1, 1.125, 1.25, 1.5]) {
      // Leave room for a full blank column beside a full note at every zoom.
      const page = await browser.newPage({ viewport: { width: 2100, height: 927 }, reducedMotion: "reduce" });
      try {
        await open(page);
        await page.addStyleTag({ content: `html { zoom: ${zoom}; }` }); await settle(page);
        await page.locator('.cl-viewport').focus();
        const reference = new Map();
        for (let repeat = 0; repeat < 2; repeat++) for (const direction of [-1, 1]) {
          await page.keyboard.press(direction < 0 ? 'Home' : 'End'); await settle(page);
          const aligned = await state(page);
          assert.ok(Math.abs(aligned.x - aligned.projectedX) <= 1 / 1024);
          assert.ok(Math.abs(aligned.y - aligned.projectedY) <= 1 / 1024);
          const point = { x: aligned.xTicks, y: aligned.yTicks };
          if (repeat === 0) reference.set(direction, point);
          else assert.deepEqual(point, reference.get(direction), 'Home/Endの到着位置が経路で変わった');
          const k = direction < 0 ? 0 : Math.floor((aligned.l - aligned.h) / aligned.step);
          const paper = aligned.slots.find(slot => slot.k === k);
          assert.ok(paper && paper.paperHeight > 1);
          assert.ok(Math.abs(direction < 0 ? paper.left - aligned.edge : aligned.width - aligned.edge - paper.right) < 1,
            JSON.stringify({ zoom, direction, aligned }));
          await page.keyboard.press(direction < 0 ? 'ArrowLeft' : 'ArrowRight'); await settle(page);
          await setPoint(page, { x: direction * 1e8 });
          const blocked = await state(page);
          assert.deepEqual({ x: blocked.xTicks, y: blocked.yTicks }, point, '横操作だけで外側余白を作れた');
          await setPoint(page, { y: direction * 1e8 });
          const fringe = await state(page);
          assert.equal(fringe.xTicks, point.x, '縦操作で横位置が動いた');
          assert.equal(fringe.slots.find(slot => slot.k === k)?.paperHeight ?? 0, 0);
          assert.ok(Math.abs(fringe.y - aligned.y - direction * aligned.step) < .001);
          await page.keyboard.press(direction < 0 ? 'ArrowLeft' : 'ArrowRight'); await settle(page);
          assert.equal((await state(page)).xTicks, point.x, '余白を外側へさらに増やせた');
          await setPoint(page, { x: fringe.x - direction * 40 });
          const returning = await state(page);
          assert.equal(returning.yTicks, fringe.yTicks);
          assert.ok(Math.abs(returning.x - fringe.x) > 35 && Math.abs(returning.x - fringe.x) < 45,
            '余白からの復帰が段単位のジャンプになった');
          await page.keyboard.press(direction < 0 ? 'ArrowLeft' : 'ArrowRight'); await settle(page);
          assert.equal((await state(page)).xTicks, returning.xTicks, '復帰途中から余白を増やせた');
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
