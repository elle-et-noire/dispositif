// Summarise reading-no-iframe-pinned-comparison.mjs output by before/after pairs.
// Usage: node scripts/experiments/reading-no-iframe-pinned-summary.mjs RESULT.jsonl > SUMMARY.json
//
// Pair = same engine, article, run and hover time; difference = after - before.
// With three runs per condition, report medians and sign agreement, not p-values.
//
// Disturbance flags were fixed before the measurement was run:
//   A pair is flagged when either trial's external CPU on the pinned CPUs
//   (pinned busy ticks minus browser, Node and server ticks, S0..S3) exceeds
//   5% of the pinned capacity, when the two trials' system-wide utilisation
//   differs by more than 15 percentage points, or when either trial failed.
//   Flagged pairs are not removed; summaries are given with and without them.
import { readFileSync } from 'node:fs';

export const FLAG_RULES = { externalShareAbove: 0.05, systemUtilDifferenceAbove: 0.15 };
const METRICS = {
  'pre.cpuTicks': r => r.pre.cpuTicks,
  'pre.peakPssDeltaMiB': r => r.pre.peakPssDeltaKiB / 1024,
  'pre.pssAtClickDeltaMiB': r => r.pre.pssAtClickDeltaKiB / 1024,
  'post.cpuTicks': r => r.post.cpuTicks,
  'post.cpuTicksToVisible': r => r.post.cpuTicksToVisible,
  'post.peakPssDeltaMiB': r => r.post.peakPssDeltaKiB / 1024,
  'post.peakPssAboveStartMiB': r => r.post.peakPssAboveStartKiB / 1024,
  'total.cpuTicks': r => r.total.cpuTicks,
  'total.peakPssDeltaMiB': r => r.total.peakPssDeltaKiB / 1024,
  displayMs: r => r.displayMs,
  hoverToDisplayMs: r => r.hoverToDisplayMs,
  actualDwellMs: r => r.actualDwellMs,
  dispatchMs: r => r.dispatchMs,
};
const median = values => {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const round = value => value === null ? null : Math.round(value * 10) / 10;

const rows = readFileSync(process.argv[2], 'utf8').trim().split('\n').map(line => JSON.parse(line));
const pairs = new Map();
for (const row of rows) {
  const key = [row.name, row.article, row.run, row.dwell].join('/');
  const pair = pairs.get(key) ?? { key, name: row.name, article: row.article, run: row.run, dwell: row.dwell };
  pair[row.build] = row;
  pairs.set(key, pair);
}
for (const pair of pairs.values()) {
  const { before, after } = pair;
  const reasons = [];
  if (!before || !after || before.error || after.error) reasons.push('missing or failed trial');
  else {
    for (const [label, row] of [['before', before], ['after', after]]) {
      if (row.disturbance.externalShare > FLAG_RULES.externalShareAbove) reasons.push(`${label} external share ${row.disturbance.externalShare.toFixed(3)}`);
    }
    const gap = Math.abs(before.disturbance.systemUtil - after.disturbance.systemUtil);
    if (gap > FLAG_RULES.systemUtilDifferenceAbove) reasons.push(`system utilisation gap ${gap.toFixed(3)}`);
    pair.diff = Object.fromEntries(Object.entries(METRICS).map(([name, get]) => [name, get(after) - get(before)]));
  }
  pair.flagged = reasons.length > 0;
  pair.flagReasons = reasons;
}

const summarise = (list) => {
  const usable = list.filter(pair => pair.diff);
  const metrics = {};
  for (const name of Object.keys(METRICS)) {
    const diffs = usable.map(pair => pair.diff[name]);
    metrics[name] = {
      before: round(median(usable.map(pair => METRICS[name](pair.before)))),
      after: round(median(usable.map(pair => METRICS[name](pair.after)))),
      medianDiff: round(median(diffs)),
      lower: diffs.filter(d => d < 0).length, higher: diffs.filter(d => d > 0).length, equal: diffs.filter(d => d === 0).length,
    };
  }
  return { pairs: usable.length, metrics,
    usedPrepared: { before: usable.filter(p => p.before.usedPrepared).length, after: usable.filter(p => p.after.usedPrepared).length },
    fallback: { before: usable.filter(p => p.before.fallback).length, after: usable.filter(p => p.after.fallback).length } };
};

const groups = (list, keyOf) => {
  const map = new Map();
  for (const pair of list) { const key = keyOf(pair); map.set(key, [...(map.get(key) ?? []), pair]); }
  return Object.fromEntries([...map].map(([key, value]) => [key, summarise(value)]));
};
const all = [...pairs.values()];
const unflagged = all.filter(pair => !pair.flagged);
const disturbance = rows.filter(row => row.disturbance).map(row => row.disturbance);
console.log(JSON.stringify({
  source: process.argv[2], trials: rows.length, errors: rows.filter(row => row.error).length,
  flagRules: FLAG_RULES,
  flaggedPairs: all.filter(pair => pair.flagged).map(pair => ({ key: pair.key, reasons: pair.flagReasons })),
  disturbanceOverall: {
    externalShare: { median: median(disturbance.map(d => d.externalShare)), max: Math.max(...disturbance.map(d => d.externalShare)) },
    systemUtil: { median: median(disturbance.map(d => d.systemUtil)), min: Math.min(...disturbance.map(d => d.systemUtil)), max: Math.max(...disturbance.map(d => d.systemUtil)) },
    load1: { min: Math.min(...disturbance.flatMap(d => d.load1)), max: Math.max(...disturbance.flatMap(d => d.load1)) },
  },
  instrument: {
    sampleMsMedian: median(rows.filter(r => r.instrument).map(r => r.instrument.sampleMsMedian)),
    sampleMsMax: Math.max(...rows.filter(r => r.instrument).map(r => r.instrument.sampleMsMax)),
    workerTicksMedian: median(rows.filter(r => r.instrument).map(r => r.instrument.workerTicks)),
    nodeTicksMedian: median(rows.filter(r => r.instrument).map(r => r.instrument.nodeTicks)),
    exitedPre: rows.filter(r => r.pre).reduce((n, r) => n + r.pre.exited, 0),
    exitedPost: rows.filter(r => r.post).reduce((n, r) => n + r.post.exited, 0),
  },
  byEngine: { all: groups(all, p => p.name), unflagged: groups(unflagged, p => p.name) },
  byCondition: { all: groups(all, p => `${p.name}/${p.article}/${p.dwell}`), unflagged: groups(unflagged, p => `${p.name}/${p.article}/${p.dwell}`) },
}, null, 1));
