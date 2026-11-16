// Experiment: which slots' styles change on one PageDown in n段 (math article).
import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:4336/dispositif/symmetric-polynomial/?columns=multi");
await page.waitForFunction(() => document.documentElement.classList.contains("cl-ready") && !document.documentElement.classList.contains("cl-pending") && !document.querySelector(".cl-source [data-cl-defer]"));
await page.waitForTimeout(800);
await page.locator(".cl-viewport").focus();
for (const key of ["PageDown", "PageDown", "End", "Home"]) {
  await page.evaluate(() => {
    window.muts = [];
    window.mo?.disconnect();
    window.mo = new MutationObserver((list) => { for (const m of list) window.muts.push(m); });
    window.mo.observe(document.querySelector(".cl-plane"), { subtree: true, attributes: true, attributeOldValue: true, childList: true, attributeFilter: ["style", "data-cl-k"] });
    window.summ = () => {
      const s = { sourceStyle: 0, copyStyle: 0, trackStyle: 0, added: 0, removed: 0, k: 0 };
      for (const m of window.muts) {
        if (m.type === "childList") { s.added += m.addedNodes.length; s.removed += m.removedNodes.length; continue; }
        if (m.attributeName === "data-cl-k") { s.k++; continue; }
        if (m.target.classList.contains("cl-source")) s.sourceStyle++;
        else if (m.target.classList.contains("cl-track")) s.trackStyle++;
        else if (m.target.classList.contains("cl-content")) s.copyStyle++;
      }
      s.sourceChange = window.muts.filter((m) => m.target.classList?.contains("cl-source") && m.type === "attributes").map((m) => [m.oldValue?.match(/translate[^;]*/)?.[0], m.target.getAttribute("style").match(/translate[^;]*/)?.[0]]);
      s.sourceElements = document.querySelectorAll(".cl-source *").length;
      s.copyElements = document.querySelectorAll(".cl-copies *").length;
      return s;
    };
  });
  await page.keyboard.press(key, { delay: 80 });
  await page.waitForTimeout(600);
  console.log(key, JSON.stringify(await page.evaluate(() => window.summ())));
}
await browser.close();
