import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import { chromium } from "playwright-core";

const run = promisify(execFile);
const ROOT = new URL("../", import.meta.url);
const FONT_DIR = new URL("public/fonts/mjx/", ROOT);
const BASE_URL = process.env.RM_BASE_URL ?? "http://localhost:4321/dispositif/";

async function assertMathFonts(page) {
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => [...document.fonts]
    .filter((font) => font.family.startsWith("MJX-"))
    .map(({ family, status }) => ({ family, status })));
  assert.ok(fonts.some((font) => font.family === "MJX-TEX-N" && font.status === "loaded"), "数式の主フォントが読み込まれていない");
  assert.deepEqual(fonts.filter((font) => font.status === "error"), [], "数式フォントの読み込みに失敗した");
  assert.equal(await page.locator(".rm-source mjx-merror").count(), 0);
}

test("フォント準備を再実行しても配信を維持し、1段・n段・記事遷移後も数式フォントを使える", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.RM_BROWSER_PATH || undefined });
  try {
    const directory = await stat(FONT_DIR);
    const mainFont = new URL("mjx-tex-n.woff2", FONT_DIR);
    const before = await stat(mainFont);
    const page = await browser.newPage();
    try {
      await page.goto(new URL("symmetric-polynomial/", BASE_URL).href);
      await assertMathFonts(page);
      // This is the same step predev/prebuild executes with a server running.
      await run(process.execPath, ["scripts/copy-math-fonts.mjs"], { cwd: ROOT });
      assert.equal((await stat(FONT_DIR)).ino, directory.ino, "監視中のフォントディレクトリを作り直した");
      const after = await stat(mainFont);
      assert.equal(after.ino, before.ino, "変更のないフォントを置き換えた");
      assert.equal(after.mtimeMs, before.mtimeMs, "変更のないフォントを書き直した");
      await page.waitForTimeout(300); // Allow file-watch events to reach Vite.
      for (const name of (await readdir(FONT_DIR)).filter((name) => name.endsWith(".woff2"))) {
        const response = await page.request.get(new URL(`fonts/mjx/${name}`, BASE_URL).href);
        assert.equal(response.status(), 200, `${name} が配信されていない`);
        assert.equal((await response.body()).subarray(0, 4).toString(), "wOF2", `${name} が有効なWOFF2ではない`);
      }
    } finally { await page.close(); }

    for (const mode of ["single", "multi"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      try {
        await page.addInitScript((mode) => localStorage.setItem("dispositif:reading-mode", mode), mode);
        await page.goto(BASE_URL);
        await page.locator('a[href*="/symmetric-polynomial"]').first().click();
        await page.waitForURL("**/symmetric-polynomial/");
        await page.waitForSelector("html.rm-ready");
        await assertMathFonts(page);
        assert.equal(await page.locator("html").evaluate((html) => html.classList.contains("rm-active")), mode === "multi");
        await page.reload();
        await assertMathFonts(page);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
