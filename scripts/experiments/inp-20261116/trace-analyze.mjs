// Summarize a Chromium trace over one interaction window: main-thread self
// time per category, forced layouts/style recalcs with their JS stack, and
// CPU-profile time per (source-mapped) JS function.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

const MAP_DIR = new URL("./dist-map/_astro/", import.meta.url);
const maps = new Map();
const mapFor = (url) => {
  const file = url.split("/").pop()?.split("?")[0];
  if (!file?.endsWith(".js")) return null;
  const prefix = file.replace(/\.[^.]+\.js$/, "");
  if (maps.has(prefix)) return maps.get(prefix);
  let map = null;
  if (existsSync(MAP_DIR)) {
    const name = readdirSync(MAP_DIR).find((f) => f.endsWith(".js.map") && f.replace(/\.[^.]+\.js\.map$/, "") === prefix);
    if (name) map = new TraceMap(readFileSync(new URL(name, MAP_DIR), "utf8"));
  }
  maps.set(prefix, map);
  return map;
};
// line/column are 0-based in CPU profiles and 1-based in stack traces.
export const locate = (url, line, column, zeroBased = true) => {
  const short = (url || "").split("/").pop() || "(native)";
  const map = url && mapFor(url);
  if (!map || line < 0) return `${short}:${line}:${column}`;
  const pos = originalPositionFor(map, { line: zeroBased ? line + 1 : line, column: zeroBased ? column : column - 1 });
  if (!pos.source) return `${short}:${line}:${column}`;
  return `${pos.source.split("/").slice(-2).join("/")}:${pos.line}${pos.name ? ` (${pos.name})` : ""}`;
};

// Enclosing function name for a source position: scan back in the original
// source for the nearest `const x = (`, `function x(` or `x(...) {` method.
const sources = new Map();
export const enclosing = (where) => {
  const m = /^(.*?):(\d+)/.exec(where);
  if (!m) return where;
  const candidates = [`src/${m[1]}`, `src/scripts/${m[1].split("/").pop()}`, `src/components/${m[1].split("/").pop()}`];
  const path = candidates.find((p) => existsSync(new URL(`../${p}`, import.meta.url)) && statSync(new URL(`../${p}`, import.meta.url)).isFile());
  if (!path) return where;
  if (!sources.has(path)) sources.set(path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8").split("\n"));
  const lines = sources.get(path);
  for (let i = Number(m[2]) - 1; i >= 0; i--) {
    const f = /(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(|function\s+(\w+)\s*\(|^\s{2,}(?:private\s+)?(\w+)\s*\([^)]*\)\s*\{|addEventListener\("([\w:-]+)"/.exec(lines[i]);
    if (f && /^(if|for|while|switch|catch|return)$/.test(f[3] ?? "")) continue;
    if (f) return `${path.split("/").pop()}:${m[2]} in ${f[1] ?? f[2] ?? f[3] ?? `on ${f[4]}`}`;
  }
  return where;
};

const CATEGORY = [
  [/^(ParseHTML)$/, "parse"],
  [/^(UpdateLayoutTree|RecalculateStyles|ParseAuthorStyleSheet|ScheduleStyleRecalculation)$/, "style"],
  [/^(Layout)$/, "layout"],
  [/^(Paint|PrePaint|Layerize|UpdateLayer|UpdateLayerTree|CompositeLayers|Commit|RasterTask|PaintImage|Decode.*|IntersectionObserverController::computeIntersections|HitTest)$/, "paint"],
  [/(GC|gc|Scavenge|MarkCompact)/, "gc"],
  [/^(FunctionCall|EvaluateScript|v8\.|V8\.|TimerFire|EventDispatch|FireAnimationFrame|RunMicrotasks|CompileScript|CompileCode)/, "script"],
];
const categorize = (name) => CATEGORY.find(([re]) => re.test(name))?.[1] ?? "other";

export function analyze(json, markName, windowFromMark) {
  const events = json.traceEvents ?? json;
  const mark = events.find((e) => e.name === markName);
  if (!mark) return { error: "no mark" };
  const pid = mark.pid;
  const main = events.find((e) => e.name === "thread_name" && e.pid === pid && e.args?.name === "CrRendererMain");
  const tid = main?.tid ?? mark.tid;
  const from = mark.ts + windowFromMark[0] * 1000, to = mark.ts + windowFromMark[1] * 1000;
  const xs = events.filter((e) => e.pid === pid && e.tid === tid && e.ph === "X" && e.dur).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const self = new Map(), stack = [];
  for (const e of xs) {
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
    const parent = stack.at(-1);
    if (parent) self.set(parent, (self.get(parent) ?? parent.dur) - Math.min(e.dur, parent.ts + parent.dur - e.ts));
    stack.push(e);
  }
  const cats = {}, forced = [], frames = [], mainNames = {};
  for (const e of xs) {
    const start = Math.max(e.ts, from), end = Math.min(e.ts + e.dur, to);
    if (end <= start) continue;
    const own = (self.get(e) ?? e.dur) * (end - start) / e.dur;
    const cat = categorize(e.name);
    if (cat === "other" && /RunTask/.test(e.name)) continue;
    cats[cat] = (cats[cat] ?? 0) + own / 1000;
    mainNames[e.name] = (mainNames[e.name] ?? 0) + own / 1000;
    if ((e.name === "Layout" || e.name === "UpdateLayoutTree") && e.dur >= 2000) {
      const st = e.args?.beginData?.stackTrace ?? e.args?.data?.stackTrace ?? e.args?.beginData?.stack;
      const top = st?.slice(0, 4).map((f) => enclosing(locate(f.url, f.lineNumber, f.columnNumber, false))) ?? [];
      forced.push({ name: e.name, ms: Math.round(e.dur / 1000), at: Math.round((e.ts - from) / 1000),
        objects: e.args?.beginData?.dirtyObjects, elements: e.args?.elementCount, stack: top });
    }
  }
  for (const k of Object.keys(cats)) cats[k] = Math.round(cats[k]);
  // CPU profile: inclusive time per mapped function within the window.
  const nodes = new Map();
  const inclusive = new Map(), selfFn = new Map();
  let profileTs = null;
  // Chunks carry the id of their Profile event, which is on the sampled thread.
  const profileIds = new Set(events.filter((e) => e.name === "Profile" && e.pid === pid && e.tid === tid).map((e) => e.id));
  for (const e of events) {
    if (e.pid !== pid) continue;
    if (e.name === "Profile" && profileIds.has(e.id)) profileTs = e.args?.data?.startTime ?? e.ts;
    if (e.name !== "ProfileChunk" || !profileIds.has(e.id)) continue;
    const p = e.args?.data?.cpuProfile;
    for (const n of p?.nodes ?? []) nodes.set(n.id, n);
    let ts = profileTs ?? e.ts;
    const deltas = e.args?.data?.timeDeltas ?? [];
    (p?.samples ?? []).forEach((id, i) => {
      ts += deltas[i] ?? 0;
      const next = (deltas[i + 1] ?? 0);
      profileTs = ts;
      if (ts < from || ts > to) return;
      const seen = new Set();
      let node = nodes.get(id), first = true;
      while (node) {
        const cf = node.callFrame;
        const key = cf.url ? enclosing(locate(cf.url, cf.lineNumber, cf.columnNumber)) : `(${cf.functionName || "anon"})`;
        if (first) selfFn.set(key, (selfFn.get(key) ?? 0) + next / 1000);
        first = false;
        if (!seen.has(key)) { inclusive.set(key, (inclusive.get(key) ?? 0) + next / 1000); seen.add(key); }
        node = nodes.get(node.parent);
      }
    });
  }
  // Parents are set via `parent` in newer profiles; older ones use children.
  const top = (m) => [...m].filter(([k]) => !/^\((root|program|idle|garbage collector)\)$/.test(k))
    .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => [k, Math.round(v)]);
  // Busy time of every thread (top-level slices only) within the window, by
  // process/thread name, to see work outside the renderer main thread
  // (compositor, raster, GPU/Viz).
  const names = new Map();
  for (const e of events) if (e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args?.name);
  const pnames = new Map();
  for (const e of events) if (e.name === "process_name") pnames.set(e.pid, e.args?.name);
  const threads = {};
  const byThread = new Map();
  for (const e of events) {
    if (e.ph !== "X" || !e.dur) continue;
    const k = `${e.pid}:${e.tid}`;
    if (!byThread.has(k)) byThread.set(k, []);
    byThread.get(k).push(e);
  }
  const topNames = {};
  for (const [k, list] of byThread) {
    list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    let busy = 0, edge = -Infinity;
    const label = `${pnames.get(Number(k.split(":")[0])) ?? "?"}/${names.get(k) ?? k}`;
    for (const e of list) {
      if (e.ts + e.dur <= edge) continue; // nested
      const start = Math.max(e.ts, edge, from), end = Math.min(e.ts + e.dur, to);
      if (end > start) {
        busy += end - start;
        const t = (topNames[label] ??= {});
        t[e.name] = (t[e.name] ?? 0) + (end - start) / 1000;
      }
      edge = Math.max(edge, e.ts + e.dur);
    }
    if (busy >= 2000) threads[label] = Math.round(busy / 1000);
  }
  // Within the busiest non-main threads, the longest nested slice names.
  const detail = {};
  for (const [label, t] of Object.entries(topNames)) if (threads[label] && !/CrRendererMain/.test(label))
    detail[label] = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => [n, Math.round(v)]);
  const nested = {};
  for (const [k, list] of byThread) {
    const label = `${pnames.get(Number(k.split(":")[0])) ?? "?"}/${names.get(k) ?? k}`;
    if (!threads[label] || /CrRendererMain/.test(label)) continue;
    const agg = {};
    for (const e of list) {
      const start = Math.max(e.ts, from), end = Math.min(e.ts + e.dur, to);
      if (end > start && e.dur >= 1000) agg[e.name] = (agg[e.name] ?? 0) + (end - start) / 1000;
    }
    nested[label] = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, v]) => [n, Math.round(v)]);
  }
  const mainTop = Object.entries(mainNames).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, v]) => [n, Math.round(v)]);
  return { cats, mainTop, forced: forced.slice(0, 12), inclusive: top(inclusive), self: top(selfFn), threads, detail, nested };
}
