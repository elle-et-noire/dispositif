// Per op x condition: median LoAF numbers over the interaction, and the
// scripts (source-mapped entry point) with median duration / forced style+layout.
import { readFileSync } from "node:fs";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { readdirSync } from "node:fs";
import { enclosing } from "./trace-analyze.mjs";
const dir = new URL("./dist-map/_astro/", import.meta.url);
const maps = {};
for (const f of readdirSync(dir)) if (f.endsWith(".js.map")) maps[f.slice(0, -4)] = new TraceMap(readFileSync(new URL(f, dir), "utf8"));
const sources = {};
for (const f of readdirSync(dir)) if (f.endsWith(".js")) sources[f] = readFileSync(new URL(f, dir), "utf8");
const where = (url, pos) => {
  const code = sources[url]; const map = maps[url];
  if (!code || !map || pos < 0) return `${url}@${pos}`;
  const before = code.slice(0, pos); const line = before.split("\n").length; const column = pos - before.lastIndexOf("\n") - 1;
  const p = originalPositionFor(map, { line, column });
  return p.source ? enclosing(`${p.source.split("/").slice(-2).join("/")}:${p.line}`) : `${url}@${pos}`;
};
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
const rows = process.argv.slice(2).flatMap((f) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
const groups = new Map();
for (const r of rows) {
  if (!r.inp) continue;
  const key = `${r.engine}x${r.rate}|${r.article}|${r.viewport}|${r.op}`;
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
for (const [key, list] of groups) {
  if (median(list.map((r) => r.inp)) < 100) continue;
  const scripts = new Map();
  for (const r of list) for (const l of r.loaf ?? []) for (const s of l.scripts) {
    const k = `${s.invoker} -> ${where(s.url, s.pos)}`;
    const v = scripts.get(k) ?? { dur: [], forced: [] };
    v.dur.push(s.dur); v.forced.push(s.forced); scripts.set(k, v);
  }
  const frames = list.map((r) => r.loaf ?? []);
  console.log(`${key} n=${list.length} inp=${median(list.map((r) => r.inp))} loafSum=${median(frames.map((f) => f.reduce((a, l) => a + l.duration, 0)))} styleLayout=${median(frames.map((f) => f.reduce((a, l) => a + l.styleLayout, 0)))} render=${median(frames.map((f) => f.reduce((a, l) => a + l.render, 0)))}`);
  for (const [k, v] of [...scripts].sort((a, b) => median(b[1].dur) - median(a[1].dur)).slice(0, 4))
    console.log(`   ${k}  n=${v.dur.length} dur=${median(v.dur)} forced=${median(v.forced)}`);
}
