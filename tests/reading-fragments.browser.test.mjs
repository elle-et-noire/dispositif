import { toggleReadingMode } from "./reading-controls.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";

const ARTICLE_URL = new URL("symmetric-polynomial/",
  process.env.RM_BASE_URL ?? "http://localhost:4321/dispositif/").href;

async function settle(page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

async function open(page, slug = "symmetric-polynomial") {
  await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
  await page.goto(new URL(`../${slug}/`, ARTICLE_URL).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("[data-rm-fragmented]");
  await settle(page);
}

test("数式・コードを含む記事の断片が元本文と同じ位置・組版を保つ", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.RM_BROWSER_PATH || undefined });
  try {
    for (const [slug, width] of [["symmetric-polynomial", 1280], ["symmetric-polynomial", 390], ["tips-julia", 1280]]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await open(page, slug);
        await page.locator(".rm-source").evaluate((source) => {
          [...source.children, ...source.querySelector(".post").children].forEach((element, i) => {
            element.dataset.testFragment = String(i);
          });
          source.appendChild(document.createComment("reindex annotated blocks"));
        });
        await page.waitForSelector("[data-rm-fragmented] [data-test-fragment]");
        for (const y of [0, 400, 1700, 3700, 7200, 0]) {
          await page.locator(".rm-viewport").focus();
          await page.keyboard.press("Home");
          await settle(page);
          await page.locator(".rm-viewport").evaluate((viewport, y) => { viewport.scrollTop += y; }, y);
          await settle(page);
          const result = await page.evaluate(() => {
            const source = document.querySelector(".rm-source");
            const original = source.getBoundingClientRect();
            const errors = [];
            let inspected = 0;
            for (const root of document.querySelectorAll("[data-rm-fragmented]")) {
              const rootBox = root.getBoundingClientRect();
              for (const copy of root.querySelectorAll("[data-test-fragment]:not(.post)")) {
                const block = source.querySelector(`[data-test-fragment="${copy.dataset.testFragment}"]`);
                const a = block.getBoundingClientRect(), b = copy.getBoundingClientRect();
                const compare = (name, value, expected) => {
                  if (Math.abs(value - expected) > 0.75) errors.push({ block: copy.dataset.testFragment, name, value, expected });
                };
                compare("top", b.top - rootBox.top, a.top - original.top);
                compare("left", b.left - rootBox.left, a.left - original.left);
                compare("width", b.width, a.width);
                compare("height", b.height, a.height);
                const selector = "mjx-container, li, summary, pre, td, th, code";
                const originals = [...block.querySelectorAll(selector)];
                [...copy.querySelectorAll(selector)].forEach((node, i) => {
                  const x = originals[i].getBoundingClientRect(), z = node.getBoundingClientRect();
                  compare(`${node.tagName} top`, z.top - b.top, x.top - a.top);
                  compare(`${node.tagName} left`, z.left - b.left, x.left - a.left);
                  compare(`${node.tagName} width`, z.width, x.width);
                  compare(`${node.tagName} height`, z.height, x.height);
                });
                inspected++;
              }
            }
            return { errors: errors.slice(0, 12), inspected,
              copiedIds: document.querySelectorAll("[data-rm-fragmented] [id]").length };
          });
          assert.ok(result.inspected > 0, "断片を検証できない");
          assert.deepEqual(result.errors, [], `${slug}、幅${width}px、縦位置${y}pxで組版が変わった`);
          assert.equal(result.copiedIds, 0);
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("長い記事でも表示外のブロックを残さず、表示中の断片は再利用する", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.RM_BROWSER_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await open(page);
    await page.locator(".rm-source").evaluate((source) => {
      source.innerHTML = '<div class="post" style="padding:12px 9px;border:3px solid transparent">'
        + Array.from({ length: 400 }, (_, i) => `<p data-test-row="${i}" style="height:48px;margin:6px 0">`
          + Array.from({ length: 12 }, () => `<span>段落${i} </span>`).join("") + "</p>").join("") + "</div>";
    });
    await page.waitForSelector("[data-rm-fragmented] [data-test-row]");
    await settle(page);
    const fullCount = await page.locator(".rm-source *").count();
    const rows = page.locator("[data-rm-fragmented]").first().locator("[data-test-row]");
    const retained = await rows.nth(3).elementHandle();
    await page.locator(".rm-viewport").evaluate((viewport) => { viewport.scrollTop += 40; });
    await settle(page);
    assert.ok(await retained.evaluate((node) => node.isConnected), "小さな縦移動で表示中の断片を作り直した");
    for (const y of [500, 1700, 4000, 9000, 14000, 0]) {
      await page.locator(".rm-viewport").focus();
      await page.keyboard.press("Home");
      await settle(page);
      await page.locator(".rm-viewport").evaluate((viewport, y) => { viewport.scrollTop += y; }, y);
      await settle(page);
      assert.equal(await page.locator(".rm-source *").count(), fullCount);
      assert.ok(await page.locator("[data-rm-fragmented] *").count() < fullCount / 4,
        "移動するほど画面外の本文が蓄積した");
      const errors = await page.locator("[data-rm-fragmented] [data-test-row]").evaluateAll((copies) => {
        const source = document.querySelector(".rm-source"), sourceBox = source.getBoundingClientRect();
        return copies.flatMap((copy) => {
          const root = copy.closest("[data-rm-fragmented]").getBoundingClientRect();
          const original = source.querySelector(`[data-test-row="${copy.dataset.testRow}"]`).getBoundingClientRect();
          const rect = copy.getBoundingClientRect();
          return Math.abs(rect.top - root.top - original.top + sourceBox.top) > 0.75
            || Math.abs(rect.left - root.left - original.left + sourceBox.left) > 0.75 ? [copy.dataset.testRow] : [];
        });
      });
      assert.deepEqual(errors, [], "余白や罫線を持つ親の中で断片位置がずれた");
    }
  } finally { await page.close(); await browser.close(); }
});

test("表・番号付きリスト・画像・SVGの内部配置を保つ", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.RM_BROWSER_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await open(page);
    await page.locator(".rm-source").evaluate(async (source) => {
      const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="560" height="120"><rect width="560" height="120" fill="#0044aa"/></svg>');
      source.innerHTML = `<div class="post"><div style="height:650px"></div>
        <ol data-test-kind="list" start="7"><li><p>項目7</p></li><li>項目8<ol start="3"><li>入れ子3</li></ol></li></ol>
        <table data-test-kind="table"><thead><tr><th>名前</th><th>値</th></tr></thead><tbody>
          <tr><td>一行目</td><td><code>123</code></td></tr><tr><td>二行目</td><td>456</td></tr></tbody></table>
        <img data-test-kind="image" src="${picture}" width="560" height="120" alt="青い図">
        <svg data-test-kind="svg" xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60"><rect width="120" height="60" fill="#aa3300"/></svg>
        <div style="height:4000px"></div></div>`;
      await source.querySelector("img").decode();
    });
    await page.waitForSelector("[data-rm-fragmented] [data-test-kind]");
    for (const y of [0, 250, 600]) {
      await page.locator(".rm-viewport").focus();
      await page.keyboard.press("Home");
      await settle(page);
      await page.locator(".rm-viewport").evaluate((viewport, y) => { viewport.scrollTop += y; }, y);
      await settle(page);
      const errors = await page.locator("[data-rm-fragmented] [data-test-kind]").evaluateAll((copies) => copies.flatMap((copy) => {
        const original = document.querySelector(`.rm-source [data-test-kind="${copy.dataset.testKind}"]`);
        const a = original.getBoundingClientRect(), b = copy.getBoundingClientRect();
        const originals = [original, ...original.querySelectorAll("li, p, tr, td, th, code, rect")];
        return [copy, ...copy.querySelectorAll("li, p, tr, td, th, code, rect")].flatMap((node, i) => {
          const x = originals[i].getBoundingClientRect(), z = node.getBoundingClientRect();
          return Math.abs(z.top - b.top - x.top + a.top) > 0.75
            || Math.abs(z.left - b.left - x.left + a.left) > 0.75
            || Math.abs(z.width - x.width) > 0.75 || Math.abs(z.height - x.height) > 0.75
            ? [`${copy.dataset.testKind}:${node.tagName}`] : [];
        });
      }));
      assert.deepEqual(errors, []);
    }
    assert.equal(await page.locator('.rm-source ol[data-test-kind="list"]').getAttribute("start"), "7");
  } finally { await page.close(); await browser.close(); }
});

test("表示外の折りたたみがあっても開閉・コードコピー・ハッシュ移動を維持する", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.RM_BROWSER_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await open(page);
    await page.evaluate(() => { navigator.clipboard.writeText = async (text) => { window.__copiedText = text; }; });
    await page.locator(".rm-source").evaluate((source) => {
      source.innerHTML = `<div class="post">
        <details data-test-details="earlier"><summary>表示外</summary><p>最初の詳細</p></details>
        <div style="height:1000px"></div>
        <details data-test-details="later"><summary>操作する詳細</summary>
          <p>内容</p><details data-test-details="nested"><summary>入れ子</summary>
            <h2 id="fragment-hash-target">移動先</h2></details>
          <figure data-rehype-pretty-code-figure><pre><code><span data-line>const x = 1;</span><span data-line>x + 1</span></code></pre>
            <button class="code-copy-button">コピー</button></figure>
        </details><div style="height:4000px"></div></div>`;
    });
    const later = page.locator('[data-rm-fragmented] [data-test-details="later"]:visible').first();
    await later.locator(":scope > summary").click();
    await page.waitForFunction(() => document.querySelector('.rm-source [data-test-details="later"]').open);
    assert.equal(await page.locator('.rm-source [data-test-details="earlier"]').evaluate((node) => node.open), false);
    await settle(page);
    await later.locator('[data-test-details="nested"] > summary').click();
    await page.waitForFunction(() => document.querySelector('.rm-source [data-test-details="nested"]').open);
    await settle(page);
    await later.locator(".code-copy-button").click({ force: true });
    await page.waitForFunction(() => window.__copiedText === "const x = 1;\nx + 1");
    await later.locator(":scope > summary").click();
    await page.waitForFunction(() => !document.querySelector('.rm-source [data-test-details="later"]').open);
    await page.evaluate(() => { location.hash = "fragment-hash-target"; });
    await page.waitForFunction(() => document.querySelector('.rm-source [data-test-details="later"]').open);
    await settle(page);
    assert.equal(await page.locator('.rm-source [data-test-details="nested"]').evaluate((node) => node.open), true);
    await toggleReadingMode(page);
    assert.equal(await page.locator("[data-rm-fragmented]").count(), 0);
    assert.equal(await page.locator("#fragment-hash-target").count(), 1);
  } finally { await page.close(); await browser.close(); }
});

test("n段ではコードを段幅で折り返し、1段では折り返さない", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.RM_BROWSER_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  try {
    await open(page, "tips-rust");
    const overflowing = (selector) => page.evaluate((selector) =>
      [...document.querySelectorAll(selector)].filter((pre) => pre.scrollWidth > pre.clientWidth + 1).length, selector);
    assert.ok(await page.locator(".rm-source pre").count() > 0);
    assert.equal(await overflowing(".rm-source pre"), 0);
    assert.equal(await overflowing("[data-rm-fragmented] pre"), 0);
    const indent = await page.locator(".rm-source pre code > [data-line]").first().evaluate((line) => {
      const range = document.createRange();
      range.selectNodeContents(line);
      const rects = [...range.getClientRects()];
      const left = line.getBoundingClientRect().left;
      const first = rects.find((rect) => rect.width > 0 && rect.left - left > 1);
      const wrapped = rects.filter((rect) => rect.width > 0 && rect.top > first.bottom - 1);
      return { first: first.left - left, wrapped: wrapped.length ? wrapped[0].left - left : null };
    });
    assert.ok(indent.wrapped !== null, "先頭行が折り返されていない");
    assert.ok(Math.abs(indent.wrapped - indent.first) < 1, `折り返し行が本文の開始位置にそろわない: ${JSON.stringify(indent)}`);
    await toggleReadingMode(page);
    await page.waitForFunction(() => !document.documentElement.classList.contains("rm-active"));
    assert.ok(await overflowing(".rm-source pre") > 0);
  } finally { await page.close(); await browser.close(); }
});
