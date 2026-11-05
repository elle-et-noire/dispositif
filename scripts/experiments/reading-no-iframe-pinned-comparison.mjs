// Before/after comparison of the index iframe preparation, with resources split
// at the click and per-trial disturbance records. A new instrument: the earlier
// reading-no-iframe-comparison.mjs is kept unchanged for its committed data.
//
// Start this script and both servers in their own scopes on the same chosen
// CPUs, for example:
//   systemd-run --user --scope -p CPUWeight=1000 taskset -c "$CPUS" \
//     python3 scripts/experiments/reading-comparison-server.py 4597 BUILD_BEFORE
//   systemd-run --user --scope -p CPUWeight=1000 taskset -c "$CPUS" \
//     python3 scripts/experiments/reading-comparison-server.py 4598 BUILD_AFTER
//   RM_SERVER_PIDS=pid1,pid2 RM_PINNED_CPUS="$CPUS" RM_SAMPLES_OUT=samples.jsonl \
//   systemd-run --user --scope -p CPUWeight=1000 taskset -c "$CPUS" \
//     node scripts/experiments/reading-no-iframe-pinned-comparison.mjs > result.jsonl
//
// Definitions (also written into every record under `definitions`):
// - S0: index loaded, index fonts ready, before the hover starts.
// - S1: immediately before the click's mouse-down is sent (pre-click = S0..S1).
// - S2: the Node side observed the "visible" event (two rAFs after the article
//   is ready); S3: S2 + RM_TAIL_MS. Post-click = S1..S3; S1..S2 is also kept.
// - CPU: utime+stime of the browser process tree (descendants of this Node
//   process) plus the cutime+cstime of tree members, so children that exited
//   and were reaped inside the tree are still counted. CPU of processes that
//   exited without being reaped inside the tree is missing; `exited` counts
//   PIDs that disappeared between samples. `liveCpuTicks` is the sum over live
//   processes only, the earlier instrument's method.
// - PSS: sum of smaps_rollup Pss over the browser tree (shared pages are
//   divided among sharers; an approximation of memory cost). Peaks are sampled
//   every RM_INTERVAL_MS and can be missed between samples.
// - Times are browser performance.now() differences. They are not human input
//   latency nor exact pixel presentation times.
import { chromium, firefox } from 'playwright-core';
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

const CLK_TCK = 100;
const read = path => readFileSync(path, 'utf8');
const statFields = text => text.slice(text.lastIndexOf(') ') + 2).split(' ');
// Fields after the command: state=0, ppid=1, ..., utime=11, stime=12, cutime=13, cstime=14.
function procTimes(pid) {
  const s = statFields(read(`/proc/${pid}/stat`));
  return { own: Number(s[11]) + Number(s[12]), reaped: Number(s[13]) + Number(s[14]) };
}
function descendants(root) {
  const found = []; const stack = [root];
  while (stack.length) {
    const pid = stack.pop();
    let tasks = [];
    try { tasks = readdirSync(`/proc/${pid}/task`); } catch { continue; }
    for (const tid of tasks) {
      let children = '';
      try { children = read(`/proc/${pid}/task/${tid}/children`); } catch { continue; }
      for (const child of children.trim().split(/\s+/).filter(Boolean).map(Number)) { found.push(child); stack.push(child); }
    }
  }
  return found;
}
function parseCpuList(list) {
  return list.split(',').flatMap(part => {
    const [a, b] = part.split('-').map(Number);
    return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });
}
function cpuStat(cpus) {
  const lines = read('/proc/stat').split('\n');
  const parse = line => {
    const v = line.trim().split(/\s+/).slice(1).map(Number);
    const busy = v[0] + v[1] + v[2] + v[5] + v[6] + v[7];
    return { busy, total: busy + v[3] + v[4] };
  };
  const all = parse(lines[0]);
  let pinnedBusy = 0, pinnedTotal = 0;
  for (const line of lines) {
    const m = /^cpu(\d+) /.exec(line);
    if (m && cpus.includes(Number(m[1]))) { const p = parse(line); pinnedBusy += p.busy; pinnedTotal += p.total; }
  }
  return { allBusy: all.busy, allTotal: all.total, pinnedBusy, pinnedTotal };
}

if (!isMainThread) {
  const { root, servers, cpus, intervalMs } = workerData;
  const workerTid = Number(read('/proc/thread-self/stat').split(' ')[0]);
  let timer, samples = [], known = new Map();
  const sample = (detail = false) => {
    const started = performance.now();
    const pids = descendants(root);
    let pss = 0, own = 0, reaped = 0;
    const seen = new Map();
    for (const pid of pids) {
      try {
        const t = procTimes(pid);
        const rollup = read(`/proc/${pid}/smaps_rollup`);
        pss += Number(/^Pss:\s+(\d+)/m.exec(rollup)?.[1] ?? 0);
        own += t.own; reaped += t.reaped; seen.set(pid, t.own + t.reaped);
      } catch { /* exited while sampling */ }
    }
    let exited = 0, exitedLastTicks = 0;
    for (const [pid, ticks] of known) if (!seen.has(pid)) { exited++; exitedLastTicks += ticks; }
    known = seen;
    const record = { at: Date.now(), pss, cpu: own + reaped, live: own, pids: seen.size, exited, exitedLastTicks };
    if (detail) {
      let serverTicks = 0;
      for (const pid of servers) { try { const t = procTimes(pid); serverTicks += t.own + t.reaped; } catch { /* stopped */ } }
      const self = procTimes(process.pid);
      const worker = statFields(read(`/proc/${process.pid}/task/${workerTid}/stat`));
      const freqs = cpus.map(cpu => { try { return Number(read(`/sys/devices/system/cpu/cpu${cpu}/cpufreq/scaling_cur_freq`)); } catch { return NaN; } });
      Object.assign(record, {
        serverTicks, nodeTicks: self.own, workerTicks: Number(worker[11]) + Number(worker[12]),
        ...cpuStat(cpus), load: read('/proc/loadavg').trim().split(' ').slice(0, 3).map(Number),
        freq: { min: Math.min(...freqs), mean: Math.round(freqs.reduce((a, b) => a + b, 0) / freqs.length), max: Math.max(...freqs) },
      });
    }
    record.durMs = performance.now() - started;
    return record;
  };
  parentPort.on('message', ({ cmd, label }) => {
    if (cmd === 'start') {
      samples = []; known = new Map();
      const first = sample(true); first.mark = 'S0'; samples.push(first);
      timer = setInterval(() => samples.push(sample()), intervalMs);
      parentPort.postMessage(first);
    } else if (cmd === 'mark') {
      const marked = sample(true); marked.mark = label; samples.push(marked); parentPort.postMessage(marked);
    } else if (cmd === 'stop') {
      clearInterval(timer); parentPort.postMessage(samples);
    }
  });
} else {
  const base = process.env.RM_BASE_URL ?? 'http://127.0.0.1:4597/dispositif/';
  const candidate = process.env.RM_CANDIDATE_URL ?? 'http://127.0.0.1:4598/dispositif/';
  const engines = (process.env.RM_ENGINES ?? 'chromium,firefox').split(',');
  const articles = (process.env.RM_ARTICLES ?? 'tips-python,symmetric-polynomial').split(',');
  const dwells = (process.env.RM_DWELLS ?? '300,1000').split(',').map(Number);
  const runs = Number(process.env.RM_RUNS ?? 3);
  const intervalMs = Number(process.env.RM_INTERVAL_MS ?? 100);
  const tailMs = Number(process.env.RM_TAIL_MS ?? 1000);
  const servers = (process.env.RM_SERVER_PIDS ?? '').split(',').filter(Boolean).map(Number);
  const allowed = /Cpus_allowed_list:\s*(\S+)/.exec(read('/proc/self/status'))[1];
  const cpus = parseCpuList(process.env.RM_PINNED_CPUS ?? allowed);
  const samplesOut = process.env.RM_SAMPLES_OUT;
  const labels = { current: process.env.RM_BEFORE_LABEL ?? 'before', candidate: process.env.RM_AFTER_LABEL ?? 'after' };
  const definitions = {
    S0: 'index loaded and fonts ready, before hover', S1: 'immediately before mouse-down',
    S2: 'Node observed visible event', S3: `S2 + ${tailMs} ms`, preClick: 'S0..S1', postClick: 'S1..S3',
    cpu: 'browser tree utime+stime plus cutime+cstime (reaped children)', pss: 'browser tree smaps_rollup Pss sum',
    intervalMs, tailMs, clockTicksPerSecond: CLK_TCK,
  };
  try {
    const cgroup = read('/proc/self/cgroup').trim().split('::')[1];
    definitions.measurer = { pid: process.pid, affinity: allowed, cgroup, cpuWeight: read(`/sys/fs/cgroup${cgroup}/cpu.weight`).trim() };
  } catch (error) { definitions.measurer = { pid: process.pid, affinity: allowed, error: String(error) }; }
  const worker = new Worker(new URL(import.meta.url), { workerData: { root: process.pid, servers, cpus, intervalMs } });
  const ask = message => new Promise((resolve, reject) => {
    const fail = error => { worker.off('message', ok); reject(error); };
    const ok = value => { worker.off('error', fail); resolve(value); };
    worker.once('message', ok); worker.once('error', fail); worker.postMessage(message);
  });
  const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
  const between = (samples, from, to) => samples.filter(s => s.at >= from.at && s.at <= to.at);
  const peak = (samples, from, to) => Math.max(...between(samples, from, to).map(s => s.pss));
  const exitedBetween = (samples, from, to) => samples.filter(s => s.at > from.at && s.at <= to.at).reduce((n, s) => n + s.exited, 0);
  const disturbance = (a, b, browserTicks) => {
    const ours = browserTicks + (b.nodeTicks - a.nodeTicks) + (b.serverTicks - a.serverTicks);
    const pinnedBusy = b.pinnedBusy - a.pinnedBusy, pinnedTotal = b.pinnedTotal - a.pinnedTotal;
    return {
      pinnedBusyTicks: pinnedBusy, pinnedTotalTicks: pinnedTotal, ourTicks: ours,
      externalOnPinnedTicks: pinnedBusy - ours, externalShare: pinnedTotal ? (pinnedBusy - ours) / pinnedTotal : null,
      pinnedUtil: pinnedTotal ? pinnedBusy / pinnedTotal : null,
      systemUtil: (b.allBusy - a.allBusy) / (b.allTotal - a.allTotal),
      load1: [a.load[0], b.load[0]], freqKHz: { S0: a.freq, end: b.freq },
    };
  };

  let trial = 0;
  for (const name of engines) {
    const engine = { chromium, firefox }[name];
    const browser = await engine.launch();
    const browserVersion = browser.version();
    try {
      for (const article of articles) for (let run = 1; run <= runs; run++) for (const dwell of dwells) {
        const order = run % 2 ? ['current', 'candidate'] : ['candidate', 'current'];
        for (const [position, mode] of order.entries()) {
          trial++;
          const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
          const common = { trial, name, browserVersion, article, run, dwell, mode, build: labels[mode], orderInPair: position, startedAt: new Date().toISOString() };
          try {
            await context.addInitScript(() => {
              if (location.protocol === 'about:') return;
              localStorage.setItem('dispositif:reading-mode', 'multi'); window.rmEvents = []; window.rmLong = [];
              window.rmLongSupported = PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false;
              if (window.rmLongSupported) new PerformanceObserver(list => window.rmLong.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: true });
              document.addEventListener('pointerover', e => { if (e.target instanceof Element && e.target.closest('[data-article-index] a')) window.rmEvents.push(['hover', performance.now()]); }, true);
              document.addEventListener('click', e => {
                if (!(e.target instanceof Element) || !e.target.closest('[data-article-index] a')) return;
                window.rmEvents.push(['click', performance.now()]);
                window.rmFramesAtClick = document.querySelectorAll('iframe').length;
                const poll = () => {
                  const frame = document.querySelector('html > iframe[data-rm-prepared-reader]'), r = document.documentElement;
                  const normal = r.dataset.pageKind === 'article' && !r.classList.contains('rm-pending') && (r.classList.contains('rm-active') || r.classList.contains('rm-fallback'));
                  if (frame || normal) { requestAnimationFrame(() => requestAnimationFrame(() => window.rmEvents.push(['visible', performance.now(), !!frame, r.classList.contains('rm-fallback')]))); return; }
                  requestAnimationFrame(poll);
                };
                requestAnimationFrame(poll);
              }, true);
              const watch = new MutationObserver(() => {
                if (!window.rmFirstFrame && document.querySelector('html > iframe')) window.rmFirstFrame = performance.now();
                if (document.querySelector('html > iframe[data-rm-preload-ready]') && !window.rmEvents.some(e => e[0] === 'ready')) window.rmEvents.push(['ready', performance.now()]);
              });
              const start = () => watch.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-rm-preload-ready'] });
              if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
            });
            const page = await context.newPage();
            await page.goto(mode === 'candidate' ? candidate : base);
            await page.evaluate(() => document.fonts.ready);
            const s0 = await ask({ cmd: 'start' });
            const link = page.locator(`a[href$="${article}/"]`);
            await link.hover();
            await page.waitForTimeout(dwell);
            const s1 = await ask({ cmd: 'mark', label: 'S1' });
            const sent = performance.now();
            await page.mouse.down(); await page.mouse.up();
            const dispatchMs = performance.now() - sent;
            await page.waitForFunction(() => window.rmEvents.some(e => e[0] === 'visible'), null, { timeout: 60_000 });
            const s2 = await ask({ cmd: 'mark', label: 'S2' });
            await page.waitForTimeout(tailMs);
            const s3 = await ask({ cmd: 'mark', label: 'S3' });
            const samples = await ask({ cmd: 'stop' });
            const info = await page.evaluate(() => ({ events: window.rmEvents, longSupported: window.rmLongSupported, long: window.rmLong, framesAtClick: window.rmFramesAtClick, firstFrame: window.rmFirstFrame ?? null }));
            const find = kind => info.events.find(e => e[0] === kind);
            const h = find('hover'), c = find('click'), v = find('visible'), ready = find('ready');
            if (!h || !c || !v) throw new Error('missing event');
            const durations = samples.map(s => s.durMs);
            const browserPre = s1.cpu - s0.cpu, browserAll = s3.cpu - s0.cpu;
            const record = {
              ...common,
              actualDwellMs: c[1] - h[1], dispatchMs, displayMs: v[1] - c[1], hoverToDisplayMs: v[1] - h[1],
              usedPrepared: v[2], fallback: v[3], readyMs: ready ? ready[1] - h[1] : null,
              framesAtClick: info.framesAtClick, firstFrameAfterHoverMs: info.firstFrame === null ? null : info.firstFrame - h[1],
              longSupported: info.longSupported, maxLongTaskMs: info.longSupported ? Math.max(0, ...info.long) : null,
              pre: {
                ms: s1.at - s0.at, cpuTicks: browserPre, liveCpuTicks: s1.live - s0.live,
                pssStartKiB: s0.pss, pssAtClickDeltaKiB: s1.pss - s0.pss, peakPssDeltaKiB: peak(samples, s0, s1) - s0.pss,
                exited: exitedBetween(samples, s0, s1), samples: between(samples, s0, s1).length,
              },
              post: {
                ms: s3.at - s1.at, cpuTicks: s3.cpu - s1.cpu, cpuTicksToVisible: s2.cpu - s1.cpu, liveCpuTicks: s3.live - s1.live,
                pssAtClickKiB: s1.pss, pssEndDeltaKiB: s3.pss - s1.pss, peakPssDeltaKiB: peak(samples, s1, s3) - s1.pss,
                peakPssAboveStartKiB: peak(samples, s1, s3) - s0.pss,
                exited: exitedBetween(samples, s1, s3), samples: between(samples, s1, s3).length,
              },
              total: { cpuTicks: browserAll, peakPssDeltaKiB: peak(samples, s0, s3) - s0.pss },
              instrument: {
                samples: samples.length, sampleMsMedian: median(durations), sampleMsMax: Math.max(...durations),
                workerTicks: s3.workerTicks - s0.workerTicks, nodeTicks: s3.nodeTicks - s0.nodeTicks,
                serverTicks: s3.serverTicks - s0.serverTicks,
              },
              disturbance: disturbance(s0, s3, browserAll),
              disturbancePre: disturbance(s0, s1, browserPre),
              cpus: cpus.length,
            };
            if (trial === 1) record.definitions = definitions;
            if (samplesOut) appendFileSync(samplesOut, JSON.stringify({ trial, name, article, run, dwell, mode, samples }) + '\n');
            console.log(JSON.stringify(record));
          } catch (error) {
            try { await ask({ cmd: 'stop' }); } catch { /* not started */ }
            console.log(JSON.stringify({ ...common, error: String(error) }));
          } finally { await context.close(); }
        }
      }
    } finally { await browser.close(); }
  }
  await worker.terminate();
}
