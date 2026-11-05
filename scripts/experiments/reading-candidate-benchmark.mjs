// Run against the production build, with no other browsers or tests running.
// PSS/CPU include every browser subprocess and shared caches, not just the frame.
import { chromium, firefox } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
const base = process.env.RM_BASE_URL ?? 'http://127.0.0.1:4597/dispositif/';
const candidateBase = process.env.RM_CANDIDATE_URL ?? 'http://127.0.0.1:4598/dispositif/';
const action = process.env.RM_ACTION ?? 'click';
const runs = Number(process.env.RM_RUNS ?? 2);
const engines = (process.env.RM_ENGINES ?? 'chromium,firefox').split(',');
const articles = (process.env.RM_ARTICLES ?? 'tips-python,symmetric-polynomial').split(',');
const dwells = (process.env.RM_DWELLS ?? '0,300,1000,3000').split(',').map(Number);
function usage() {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid='], {encoding:'utf8'}).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const ids = new Set([process.pid]); let size;
  do { size = ids.size; for (const [pid, parent] of rows) if (ids.has(parent)) ids.add(pid); } while (size !== ids.size);
  return rows.filter(([pid]) => pid !== process.pid && ids.has(pid)).reduce((sum, [pid]) => {
    try { sum.pss += Number(/^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))?.[1] ?? 0);
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); sum.ticks += Number(stat[11]) + Number(stat[12]); } catch {}
    return sum;
  }, { pss: 0, ticks: 0 });
}
if (!isMainThread) {
  parentPort.on('message', () => parentPort.postMessage(usage()));
} else {
const sampler = new Worker(new URL(import.meta.url));
const sampleAsync = () => new Promise((resolve, reject) => {
  const onMessage = value => { sampler.off('error', onError); resolve(value); };
  const onError = error => { sampler.off('message', onMessage); reject(error); };
  sampler.once('message', onMessage);
  sampler.once('error', onError);
  sampler.postMessage(null);
});
for (const name of engines) {
  const browser = await ({chromium, firefox})[name].launch();
  try { for (const article of articles) for (let run = 1; run <= runs; run++) for (const dwell of dwells) for (const mode of (run % 2 ? ['none', 'current', 'candidate'] : ['candidate', 'current', 'none'])) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    try {
      await context.addInitScript(() => {
        localStorage.setItem('dispositif:reading-mode', 'multi'); window.rmBench = [];
        document.addEventListener('pointerover', event => { if (event.target instanceof Element && event.target.closest('[data-article-index] a')) window.rmBench.push(['hover', performance.now()]); }, true);
        document.addEventListener('click', event => {
          if (!(event.target instanceof Element) || !event.target.closest('[data-article-index] a')) return;
          window.rmBench.push(['click', performance.now()]);
          const poll = () => {
            const frame = document.querySelector('html > iframe[data-rm-prepared-reader]');
            const root = document.documentElement;
            const normal = root.dataset.pageKind === 'article' && !root.classList.contains('rm-pending') && (root.classList.contains('rm-active') || root.classList.contains('rm-fallback'));
            if (frame || normal) { requestAnimationFrame(() => requestAnimationFrame(() => window.rmBench.push(['visible', performance.now(), !!frame, root.classList.contains('rm-fallback')]))); return; }
            requestAnimationFrame(poll);
          }; requestAnimationFrame(poll);
        }, true);
      });
      const page = await context.newPage();
      if (mode === 'none') await page.route(`**/${article}/`, route => route.request().frame().parentFrame() ? route.abort().catch(() => {}) : route.continue());
      await page.goto(mode === 'candidate' ? candidateBase : base); await page.evaluate(() => document.fonts.ready);
      const before = usage(); const link = page.locator(`a[href$="${article}/"]`);
      await link.hover(); await page.waitForTimeout(dwell);
      // Do not block delivery of the click while reading /proc. Sampling runs
      // concurrently and may finish just after the click; it is approximate.
      // RM_SYNC_SAMPLE=1 reproduces the earlier measurements, including the
      // extra delay caused by blocking the input script during sampling.
      if (action === 'leave') {
        const requestedAt = Date.now();
        await page.mouse.move(0, 0);
        const deliveredAt = Date.now();
        const atLeave = await sampleAsync();
        await page.waitForFunction(() => !document.querySelector('html > iframe[data-rm-preparing]'), null, {timeout: 30000});
        const removedAt = Date.now();
        await page.waitForTimeout(2000);
        const recovered = await sampleAsync();
        console.log(JSON.stringify({name, article, run, dwell, mode, action, leaveDispatchMs: deliveredAt-requestedAt, removalMs: removedAt-requestedAt,
          pssKiB: atLeave.pss-before.pss, cpuTicks: atLeave.ticks-before.ticks,
          recoveredPssKiB: recovered.pss-before.pss, totalCpuTicks: recovered.ticks-before.ticks,
          indexIntact: await page.evaluate(() => document.documentElement.dataset.pageKind === 'index')}));
        continue;
      }
      const atClickSample = process.env.RM_SYNC_SAMPLE === '1' ? Promise.resolve(usage()) : sampleAsync();
      if (process.env.RM_DIRECT_INPUT === '1') {
        // The pointer is already over the link; bypass locator actionability
        // waits to separate them from dispatch of the actual mouse events.
        await page.mouse.down(); await page.mouse.up();
      } else await link.click();
      const atClick = await atClickSample;
      await page.waitForFunction(() => window.rmBench.some(item => item[0] === 'visible'), null, {timeout: 45000});
      const events = await page.evaluate(() => window.rmBench); const hover = events.find(e => e[0] === 'hover'); const click = events.find(e => e[0] === 'click'); const visible = events.find(e => e[0] === 'visible');
      console.log(JSON.stringify({name, article, run, dwell, mode, action, actualDwellMs: click[1]-hover[1], displayMs: visible[1]-click[1], usedPrepared: visible[2], fallback: visible[3], pssKiB: atClick.pss-before.pss, cpuTicks: atClick.ticks-before.ticks}));
    } finally { await context.close(); }
  } } finally { await browser.close(); }
}
await sampler.terminate();
}
