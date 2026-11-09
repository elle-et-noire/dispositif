import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { BASE_URL, launch, storeColumns, waitForColumnLayout } from "./browser.mjs";


// Screen readers get each formula as an image named by its TeX source
// (lib/mathjax.ts, labelForScreenReaders), not as the glyph boxes' characters.
test("数式は TeX のソースを名前にした画像として読み上げの対象になり、字形の文字は外れる", { timeout: 60_000 }, async () => {
  const browser = await launch(chromium);
  try {
    for (const mode of ["single", "multi"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      try {
        await storeColumns(page, mode);
        await page.goto(new URL("symmetric-polynomial/", BASE_URL).href);
        await waitForColumnLayout(page);
        const markup = await page.evaluate(() => {
          const containers = [...document.querySelectorAll(".cl-source mjx-container")];
          return {
            count: containers.length,
            unlabeled: containers.filter((c) => !c.querySelector("a")
              && !(c.getAttribute("role") === "img" && c.getAttribute("aria-label")
                && c.querySelector(":scope > mjx-math")?.getAttribute("aria-hidden") === "true")).length,
            label: containers.find((c) => c.getAttribute("aria-label")?.startsWith("s_\\lambda(X)"))?.getAttribute("aria-label"),
          };
        });
        assert.ok(markup.count > 100, `${mode}: ${markup.count}`);
        assert.equal(markup.unlabeled, 0, mode);
        // The inline spacer from preprocess.ts is not part of the label.
        assert.match(markup.label ?? "", /^s_\\lambda\(X\) \\coloneqq .*\.$/);
        assert.doesNotMatch(markup.label ?? "", /hspace/);
        const cdp = await page.context().newCDPSession(page);
        const { nodes } = await cdp.send("Accessibility.getFullAXTree");
        // Count only images in the article: the dev server's toolbar adds an
        // unlabeled svg badge when its audit reports something.
        const images = [];
        for (const n of nodes.filter((n) => !n.ignored && n.role?.value === "image" && n.backendDOMNodeId)) {
          const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: n.backendDOMNodeId });
          const { result } = await cdp.send("Runtime.callFunctionOn", { objectId: object.objectId,
            functionDeclaration: "function () { return !!this.closest('.cl-source'); }", returnByValue: true });
          if (result.value) images.push(n);
        }
        // Mathematical alphanumeric symbols (𝑥, 𝜆, …) only appear in the glyph boxes.
        const glyphs = nodes.filter((n) => !n.ignored && n.role?.value === "StaticText"
          && /[\u{1D400}-\u{1D7FF}]/u.test(n.name?.value ?? ""));
        assert.equal(images.length, markup.count, mode);
        assert.equal(glyphs.length, 0, mode);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
