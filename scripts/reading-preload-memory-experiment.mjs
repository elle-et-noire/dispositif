// Coarse Linux process RSS comparison. Run with the dev server already running.
import { execFileSync } from 'node:child_process';
import { chromium, firefox } from 'playwright-core';
const base = process.env.RM_BASE_URL ?? 'http://127.0.0.1:4322/dispositif/';
function descendantsUsage() {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,cputimes='], { encoding: 'utf8' }).trim().split('\n')
    .map(line => line.trim().split(/\s+/).map(Number));
  const descendants = new Set([process.pid]);
  let size;
  do { size = descendants.size; for (const [pid, ppid] of rows) if (descendants.has(ppid)) descendants.add(pid); }
  while (size !== descendants.size);
  return rows.filter(([pid]) => pid !== process.pid && descendants.has(pid)).reduce((sum, row) => ({ rssKiB: sum.rssKiB + row[2], cpuSeconds: sum.cpuSeconds + row[3] }), { rssKiB: 0, cpuSeconds: 0 });
}
for (const [name, engine] of Object.entries({ chromium, firefox })) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const before = descendantsUsage();
    const elapsed = await page.evaluate(async () => {
      const start = performance.now();
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1440px;height:900px;border:0;visibility:hidden';
      frame.src = new URL('symmetric-polynomial/', location.href).href;
      document.body.append(frame);
      await new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
      await frame.contentDocument.fonts.ready;
      while (!frame.contentDocument.querySelector('.rm-slot')) await new Promise(resolve => setTimeout(resolve, 20));
      return performance.now() - start;
    });
    await page.waitForTimeout(500);
    const after = descendantsUsage();
    console.log(name, JSON.stringify({ elapsedMs: elapsed, rssBeforeKiB: before.rssKiB, rssAfterKiB: after.rssKiB, rssDifferenceKiB: after.rssKiB - before.rssKiB, cpuSecondsDifference: after.cpuSeconds - before.cpuSeconds }));
  } finally { await browser.close(); }
}
