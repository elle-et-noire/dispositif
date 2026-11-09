import { toggleColumns } from "./column-controls.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { BASE_URL, ARTICLE_URL, launch, storeColumns } from "./browser.mjs";


async function waitForActiveItem(page) {
  await page.waitForFunction(() => {
    const container = [...document.querySelectorAll("[data-toc-scroll]")].find((node) => node.clientHeight > 0);
    const active = container?.querySelector('[aria-current="location"]');
    if (!active) return false;
    const a = active.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    const fits = a.width > c.width ? a.left >= c.left - 1 && a.left < c.right
      : a.left >= c.left - 1 && a.right <= c.right + 1;
    return fits
      && a.top >= c.top - 1 && a.bottom <= c.bottom + 1;
  });
}

async function openToc(page) {
  if (await page.locator(".toc-mobile-toggle").isVisible()
    && !await page.locator("[data-toc-variant=mobile]").evaluate((toc) => toc.open)) {
    await page.locator(".toc-mobile-toggle").click();
  }
  await waitForActiveItem(page);
}

async function readingState(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".cl-viewport");
    const plane = document.querySelector(".cl-plane");
    const source = document.querySelector(".cl-source");
    const p = parseFloat(plane.style.getPropertyValue("--cl-p"));
    const h = parseFloat(plane.style.getPropertyValue("--cl-h"));
    const origin = Number(document.querySelector(".cl-plane").dataset.clOriginColumn);
    const originY = parseFloat(document.querySelector(".cl-plane").dataset.clOriginY);
    const t = (Math.floor((viewport.scrollLeft - Number(plane.dataset.clLeading) + 0.01) / p) + origin) * h + viewport.scrollTop + originY;
    const top = source.getBoundingClientRect().top;
    const headings = [...source.querySelectorAll("h2[id], h3[id]")];
    const current = [...headings].reverse().find((heading) =>
      heading.getBoundingClientRect().top - top <= t + 64) ?? headings[0];
    return { t, id: current.id };
  });
}

test("1段のサイドバー目次とn段の上部目次を切り替えて使える", { timeout: 90_000 }, async (t) => {
  const browser = await launch(chromium);
  try {
    for (const width of [1600, 390]) {
      await t.test(`${width}px の上部目次`, async () => {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        try {
          await storeColumns(page, "multi");
          await page.goto(ARTICLE_URL, { waitUntil: "domcontentloaded" });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForSelector('html.cl-multi [data-toc-variant=header][data-ready="true"]');
          assert.equal(await page.locator("[data-toc-variant=header]").evaluate((toc) => toc.open), true);
          assert.equal(await page.locator(".toc-toggle").isVisible(), false);
          assert.equal(await page.locator("[data-toc-variant=header] [data-toc-scroll]").isVisible(), true);
          const beforeOpening = await readingState(page);
          const viewportBefore = await page.locator(".cl-viewport").boundingBox();
          await openToc(page);
          assert.deepEqual(await readingState(page), beforeOpening);
          assert.deepEqual(await page.locator(".cl-viewport").boundingBox(), viewportBefore);
          assert.equal(await page.locator("[data-toc-variant=header]").count(), 1);
          assert.equal(await page.locator("[data-site-header] [data-toc-variant=header]").count(), 1);
          assert.equal(await page.locator("article [data-toc-variant=header], article .cl-toolbar").count(), 0);
          assert.equal(await page.locator("[data-site-header] .cl-toggle").count(), 1);
          assert.equal(await page.locator("[data-toc-variant=sidebar]").isVisible(), false);

          const dimensions = await page.locator("[data-toc-variant=header] [data-toc-scroll]").evaluate((container) => ({
            top: container.getBoundingClientRect().top,
            width: container.clientWidth,
            scrollWidth: container.scrollWidth,
            height: container.clientHeight,
            scrollHeight: container.scrollHeight,
            overflowX: getComputedStyle(container).overflowX,
            scrollbar: getComputedStyle(container).scrollbarWidth,
            headings: [...container.querySelectorAll("a")].map((link) => ({
              mode: getComputedStyle(link).writingMode,
              height: link.getBoundingClientRect().height,
            })),
            centers: [...container.querySelectorAll("li")].map((item) => {
              const rect = item.getBoundingClientRect();
              return rect.top + rect.height / 2;
            }),
          }));
          assert.equal(dimensions.top, 0);
          if (width < 700) assert.ok(dimensions.scrollWidth > dimensions.width);
          assert.equal(dimensions.overflowX, "auto");
          assert.ok(["auto", "thin"].includes(dimensions.scrollbar));
          assert.ok(dimensions.headings.every((heading) => heading.mode === "horizontal-tb" && heading.height <= 40));
          assert.ok(dimensions.scrollHeight <= dimensions.height + 1);
          assert.ok(Math.max(...dimensions.centers) - Math.min(...dimensions.centers) < 1);
          assert.ok(await page.locator(".cl-viewport").evaluate((viewport, width) =>
            viewport.clientWidth >= width - 56, width));

          // Browsing the header must not move the article's scroll plane.
          const headerPanel = await page.locator("[data-toc-variant=header] [data-toc-scroll]").boundingBox();
          await page.mouse.move(headerPanel.x + 100, headerPanel.y + headerPanel.height / 2);
          await page.mouse.wheel(0, 240);
          if (width < 700) {
            await page.waitForFunction(() => document.querySelector("[data-toc-scroll]").scrollLeft > 100);
          }
          assert.deepEqual(await readingState(page), beforeOpening);

          const lastLink = page.locator("[data-toc-variant=header] .toc-link").last();
          const lastId = await lastLink.evaluate((link) => decodeURIComponent(link.hash.slice(1)));
          await lastLink.click();
          assert.equal(await page.locator("[data-toc-variant=header]").evaluate((toc) => toc.open), true);
          await page.waitForFunction((id) => {
            const viewport = document.querySelector(".cl-viewport");
            const plane = document.querySelector(".cl-plane");
            const source = document.querySelector(".cl-source");
            const h = parseFloat(plane.style.getPropertyValue("--cl-h"));
            const originY = parseFloat(document.querySelector(".cl-plane").dataset.clOriginY);
            const target = document.getElementById(id).getBoundingClientRect().top - source.getBoundingClientRect().top;
            const vr = viewport.getBoundingClientRect();
            return [...document.querySelectorAll(".cl-slot")].some((slot) => {
              const rect = slot.getBoundingClientRect();
              const py = target - Number(slot.dataset.clK) * h - viewport.scrollTop - originY;
              return rect.left >= vr.left - 1 && rect.right <= vr.right + 1 && py >= -1 && py < viewport.clientHeight;
            });
          }, lastId);
          const atHeading = await readingState(page);
          await openToc(page);
          assert.deepEqual(await readingState(page), atHeading);
          assert.equal(await lastLink.getAttribute("aria-current"), "location");

          const beforeResize = await readingState(page);
          await page.setViewportSize({ width: width === 1600 ? 900 : 350, height: 780 });
          await page.waitForFunction(() =>
            parseFloat(document.querySelector(".cl-plane").style.getPropertyValue("--cl-h"))
              === document.querySelector(".cl-viewport").clientHeight);
          await waitForActiveItem(page);
          const afterResize = await readingState(page);
          assert.ok(Math.abs(beforeResize.t - afterResize.t) < 1);
          assert.equal(await page.locator('[data-toc-variant=header] [aria-current="location"]').evaluate((link) =>
            decodeURIComponent(link.hash.slice(1))), afterResize.id);
          await page.locator(".cl-viewport").focus();
          await page.keyboard.press("Home");
          await page.waitForFunction(() =>
            document.querySelector("[data-toc-variant=header] .toc-link").getAttribute("aria-current") === "location");
          await openToc(page);
          // The n段 layout never folds the horizontal header, including after
          // navigation, Escape, focus changes and clicks outside the list.
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("[data-toc-variant=header]").evaluate((toc) => toc.open), true);
          await waitForActiveItem(page);
          await page.locator(".cl-viewport").click({ position: { x: 20, y: 400 } });
          assert.equal(await page.locator("[data-toc-variant=header]").evaluate((toc) => toc.open), true);

          // Single-column reading uses a persistent sidebar on wide screens.
          await toggleColumns(page);
          await openToc(page);
          const singleToc = page.locator(width >= 768 ? "[data-toc-variant=sidebar]" : "[data-toc-variant=mobile]");
          const singleLayout = await singleToc.locator("[data-toc-scroll]").evaluate((container) => ({
            height: container.clientHeight,
            scrollWidth: container.scrollWidth,
            width: container.clientWidth,
            headings: [...container.querySelectorAll("a")].map((link) => ({
              mode: getComputedStyle(link).writingMode,
              top: link.getBoundingClientRect().top,
            })),
          }));
          assert.ok(singleLayout.scrollWidth <= singleLayout.width + 1, "縦並び目次が横にはみ出している");
          assert.ok(singleLayout.headings.every((heading) => heading.mode === "horizontal-tb"));
          const tops = singleLayout.headings.map((heading) => heading.top);
          assert.ok(tops.every((top, i) => i === 0 || top > tops[i - 1]), "目次が縦に並んでいない");
          if (width >= 768) {
            assert.equal(await page.locator(".toc-toggle").isVisible(), false);
            assert.equal(await page.locator(".site-article-index").isVisible(), true);
            const side = await singleToc.boundingBox();
            const source = await page.locator(".cl-source").boundingBox();
            assert.ok(side.x >= source.x + source.width + 16, "目次が本文の横にない");
          } else {
            assert.equal(await page.locator("[data-toc-variant=sidebar]").isVisible(), false);
          }
          const firstLink = singleToc.locator(".toc-link").first();
          const firstId = await firstLink.evaluate((link) => decodeURIComponent(link.hash.slice(1)));
          await firstLink.click();
          assert.equal(await page.locator("[data-toc-variant=header]").evaluate((toc) => toc.open), false);
          await page.waitForFunction((id) => {
            const heading = document.getElementById(id).getBoundingClientRect();
            const inset = parseFloat(getComputedStyle(document.getElementById(id)).scrollMarginTop);
            // Position enters this tolerance before the animation finishes.
            // Wait for its focus handoff before opening the drawer again.
            return document.activeElement === document.getElementById(id)
              && heading.top >= inset - 1 && heading.top <= inset + 1;
          }, firstId);
          assert.equal(await firstLink.getAttribute("aria-current"), "location");
          await openToc(page);
          const top = await firstLink.evaluate((link) => {
            const rect = link.getBoundingClientRect();
            return Boolean(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest("[data-toc]"));
          });
          assert.ok(top, "目次が他の要素に覆われている");

          await page.emulateMedia({ media: "print" });
          assert.equal(await page.locator("[data-site-header]").evaluate((header) =>
            getComputedStyle(header).display), "none");
          assert.equal(await page.locator(".cl-source").evaluate((source) =>
            getComputedStyle(source).position), "static");
          assert.equal(await page.locator(".cl-toc").isVisible(), false);
          await page.emulateMedia({ media: "screen" });
          await page.keyboard.press("Escape");

          await page.locator(".cl-toolbar > a").click();
          await page.waitForURL(BASE_URL);
          assert.equal(await page.locator("[data-toc-variant=header]").count(), 0);
          assert.equal(await page.locator("[data-site-header] a").innerText(), "記事一覧");
          await page.locator('a[href*="/tips-julia"]').first().click();
          await page.waitForSelector('[data-site-header] [data-toc-variant=header][data-ready="true"]', { state: "attached" });
          assert.equal(await page.locator("[data-toc-variant=header]").count(), 1);
          assert.equal(await page.locator("[data-toc-variant=header]").evaluate((toc) => toc.open), false);
          assert.equal(await page.locator("[data-toc-variant=sidebar]").isVisible(), width >= 768);
        } finally {
          await page.close();
        }
      });
    }

    await t.test("長い見出しも横書きの一行で表示し、低い画面でも本文を確保する", async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 500 } });
      try {
        await storeColumns(page, "multi");
        await page.goto(new URL("tips-typst/", BASE_URL).href);
        await page.waitForSelector("html.cl-multi");
        await page.evaluate(() => document.fonts.ready);
        await page.waitForSelector('[data-toc-variant=header][open]');
        const dimensions = await page.locator("[data-toc-variant=header] .toc-link").evaluateAll((links) => links.map((link) => {
          const range = document.createRange();
          range.selectNodeContents(link);
          const rect = link.getBoundingClientRect();
          return { text: link.textContent, height: rect.height, width: rect.width,
            // Text fragments must stay within the link, without clipping.
            fits: [...range.getClientRects()].every((r) => r.top >= rect.top - 1 && r.bottom <= rect.bottom + 1),
          };
        }));
        assert.ok(dimensions.every((d) => d.height <= 40 && d.fits));
        const short = dimensions.find((d) => d.text === "可換図式");
        const long = dimensions.find((d) => d.text === "和文と欧文を別フォントにする");
        assert.ok(long.width > short.width + 10, "長い見出しの本文が省略されている");
        const panel = await page.locator("[data-toc-variant=header] [data-toc-scroll]").boundingBox();
        assert.ok(panel.y + panel.height <= 56);
        const viewport = await page.locator(".cl-viewport").boundingBox();
        assert.ok(viewport.height > 350, "目次が本文の高さを圧迫している");
      } finally { await page.close(); }
    });

    // ROADMAP 2.1: after a keyboard jump, the next Tab continues in the
    // article after the heading instead of returning to the table of contents.
    for (const [mode, width, variant] of [
      ["single", 1600, "sidebar"], ["single", 390, "mobile"], ["multi", 1600, "header"], ["multi", 390, "header"],
    ]) {
      await t.test(`${mode} ${width}px: キーボードで目次から移動すると、次のTabは見出しの後の本文へ進む`, async () => {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        try {
          await storeColumns(page, mode);
          await page.goto(new URL("tips-typst/", BASE_URL).href);
          await page.waitForSelector(`[data-toc-variant=${variant}][data-ready="true"]`, { state: "attached" });
          await page.waitForFunction((multi) => document.documentElement.classList.contains("cl-multi") === multi,
            mode === "multi");
          await page.evaluate(() => document.fonts.ready);
          if (variant === "mobile") {
            await page.locator(".toc-mobile-toggle").focus();
            await page.keyboard.press("Enter");
            await page.waitForFunction(() => document.querySelector("[data-toc-variant=mobile]").open);
          }
          const link = page.locator(`[data-toc-variant=${variant}] .toc-link`, { hasText: "LaTeXとの対応" });
          const id = await link.evaluate((link) => decodeURIComponent(link.hash.slice(1)));
          await link.focus();
          await page.keyboard.press("Enter");
          await page.waitForFunction((id) => document.activeElement === document.getElementById(id), id);
          assert.equal(await page.evaluate(() => document.activeElement.matches(":focus-visible")), true,
            "見出しのフォーカス表示が出ていない");
          // The first tabbable element after the heading. n段 slots
          // are inert copies; the focusable original follows the heading.
          const expected = await page.evaluate((id) => {
            const heading = document.getElementById(id);
            const next = [...heading.closest("article").querySelectorAll("a[href], button, summary, pre, [tabindex]")]
              .find((node) => node.tabIndex >= 0 && !node.closest("[inert]") && node.getClientRects().length
                && heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
            next.dataset.tocFocusExpected = "";
            return next.textContent.trim().slice(0, 40);
          }, id);
          await page.keyboard.press("Tab");
          assert.equal(await page.evaluate(() => document.activeElement.hasAttribute("data-toc-focus-expected")), true,
            `次のTabが「${expected}」へ進まず ${await page.evaluate(() => document.activeElement.outerHTML.slice(0, 80))} へ移った`);
        } finally {
          await page.close();
        }
      });
    }

    await t.test("JavaScript 無効でも目次の開閉と見出しリンクを使える", async () => {
      const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
      try {
        await page.goto(ARTICLE_URL, { waitUntil: "domcontentloaded" });
        assert.equal(await page.locator("[data-toc-variant=header] [data-toc-scroll]").isVisible(), false);
        await page.locator(".toc-mobile-toggle").click();
        const link = page.locator("[data-toc-variant=mobile] .toc-link").nth(1);
        const id = await link.evaluate((link) => decodeURIComponent(link.hash.slice(1)));
        await link.click();
        // Native details remains open without JS; the summary still closes it.
        await page.locator(".toc-mobile-toggle").click();
        const position = await page.evaluate((id) => ({
          heading: document.getElementById(id).getBoundingClientRect().top,
          inset: parseFloat(getComputedStyle(document.getElementById(id)).scrollMarginTop),
        }), id);
        assert.ok(position.heading >= position.inset - 1);
        assert.equal(await page.locator(".cl-slot").count(), 0);
      } finally {
        await page.close();
      }
    });
  } finally {
    await browser.close();
  }
});
