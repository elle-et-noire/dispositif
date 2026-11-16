import { chromium } from "playwright-core";
const browser = await chromium.launch();
for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport: vp });
  await page.goto("http://localhost:4336/dispositif/nextjs-mdx/?columns=multi");
  await page.waitForFunction(() => document.documentElement.classList.contains("cl-ready") && !document.querySelector(".cl-source [data-cl-defer]"));
  await page.waitForTimeout(500);
  for (const i of [0, 1, 2, 5]) {
    const info = await page.evaluate((i) => {
      const el = document.querySelectorAll(".cl-source .code-copy-button")[i];
      el.focus({ preventScroll: true }); el.blur();
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const vp = document.querySelector(".cl-viewport").getBoundingClientRect();
        const all = [el, ...document.querySelectorAll(".cl-copies .code-copy-button")];
        r({ vp: [vp.left, vp.top, vp.right, vp.bottom], btns: all.map((b) => {
          const rc = b.getBoundingClientRect(); const cs = getComputedStyle(b);
          const hit = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
          return [b === el ? "orig" : "copy", Math.round(rc.left), Math.round(rc.top), Math.round(rc.width), cs.opacity, cs.visibility, hit?.className?.baseVal ?? hit?.className, b.closest("figure")?.textContent.slice(0, 20)];
        }).filter((x) => x[1] > -200 && x[1] < 2000) });
      })));
    }, i);
    console.log(vp.width, i, JSON.stringify(info));
  }
  await page.close();
}
await browser.close();
