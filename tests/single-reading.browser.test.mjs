import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { toggleReadingMode } from "./reading-controls.mjs";

const ARTICLE_URL = new URL("symmetric-polynomial/",
  process.env.RM_BASE_URL ?? "http://localhost:4321/dispositif/").href;

async function settle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
}

async function singleLayout(page) {
  return page.evaluate(() => {
    const source = document.querySelector(".rm-source");
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      card: rect("article"), source: rect(".rm-source"), title: rect(".rm-source > h1"),
      toolbar: rect(".rm-toolbar"), close: rect(".rm-toolbar > .rm-close"),
      titlePadding: getComputedStyle(source.querySelector("h1")).paddingRight,
      sidebarTop: getComputedStyle(document.querySelector(".toc-sidebar")).top,
      headerZ: getComputedStyle(document.querySelector("[data-site-header]")).zIndex,
    };
  });
}

test("1段はmainの配置・幅・余白を保ち、段切り替えを直接表示する", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.RM_BROWSER_PATH || undefined });
  try {
    for (const width of [390, 768, 1280, 1600]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "single"));
        await page.goto(ARTICLE_URL);
        await page.waitForSelector(".rm-toolbar > .rm-toggle");
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        const before = await singleLayout(page);
        // Values from main's mt-8 / max-w-[68rem], original 48px control row,
        // 48rem body and 13rem sidebar, without feature-specific title padding.
        const cardWidth = Math.min(width - 16, 1088);
        assert.equal(before.card.width, cardWidth);
        assert.equal(before.card.x, (width - cardWidth) / 2);
        assert.equal(before.card.y, 32);
        assert.equal(before.toolbar.y, 32);
        assert.equal(before.toolbar.height, 48);
        assert.equal(before.close.y, 48);
        assert.equal(before.close.x + before.close.width, before.toolbar.x + before.toolbar.width);
        assert.equal(before.source.y, 80);
        assert.equal(before.title.y, 80);
        assert.equal(before.title.width, before.source.width);
        assert.equal(before.titlePadding, "0px");
        assert.equal(before.source.x, before.card.x + (width >= 768 ? 64 : 16));
        assert.equal(before.source.width, width >= 768 ? Math.min(768, cardWidth - 80 - 208) : cardWidth - 32);
        assert.equal(before.headerZ, "0");
        assert.equal(before.sidebarTop, "16px");
        assert.equal(await page.locator(".rm-settings-toggle").isVisible(), false);
        assert.equal(await page.locator(".rm-toggle").count(), 1);
        assert.equal(await page.locator("[data-site-header] [data-toc]").isVisible(), false);
        assert.equal(await page.locator(".toc-mobile-toggle").isVisible(), width < 768);
        assert.equal(await page.locator(".toc-sidebar").isVisible(), width >= 768);

        if (width < 768) {
          await page.locator(".toc-mobile-toggle").click();
          const panel = await page.locator(".toc-mobile-panel").boundingBox();
          assert.equal(panel.width, 208);
          assert.equal(panel.x + panel.width, before.toolbar.x + before.toolbar.width);
          assert.equal(panel.y, before.toolbar.y + before.toolbar.height + 8);
          assert.equal(await page.locator(".toc-mobile-panel .toc-link").first().evaluate((link) => getComputedStyle(link).fontSize), "16px");
          await page.keyboard.press("Escape");
        }

        await page.evaluate(() => window.scrollTo(0, 500));
        await settle(page);
        assert.equal((await singleLayout(page)).toolbar.y, 0);
        if (width >= 768) assert.equal((await page.locator(".toc-sidebar").boundingBox()).y, 16);
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page);
        await toggleReadingMode(page);
        await page.waitForSelector("html.rm-active .rm-slot");
        assert.equal(await page.locator("[data-site-header] .rm-settings-toggle").isVisible(), true);
        assert.equal(await page.locator("[data-toc-variant=mobile]").isVisible(), false);
        await toggleReadingMode(page);
        await page.waitForSelector(".rm-toolbar > .rm-toggle");
        await settle(page);
        assert.deepEqual(await singleLayout(page), before, "n段から戻るとmainの配置が変わった");
        assert.equal(await page.locator(".rm-settings-toggle").isVisible(), false);
        assert.equal(await page.locator(".rm-toggle").evaluate((toggle) => document.activeElement === toggle), true);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
