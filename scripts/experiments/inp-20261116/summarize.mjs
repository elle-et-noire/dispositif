// Summarize out.jsonl: median and max INP per op x condition, with the median
// processing/presentation split. Missing entries (<16 ms) count as 8.
import { readFileSync } from "node:fs";
const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (v) => v <= 8 ? "<16" : String(Math.round(v));
const groups = new Map();
for (const r of rows) {
  const key = [r.engine + (r.rate > 1 ? `x${r.rate}` : ""), r.article, r.viewport, r.op].join("|");
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
console.log("cond|article|viewport|op|n|median|max|med proc|med pres|med delay");
for (const [key, list] of groups) {
  const inp = list.map((r) => r.inp ?? 8);
  const withEv = list.filter((r) => r.inp != null);
  console.log([key, list.length, fmt(median(inp)), fmt(Math.max(...inp)),
    withEv.length ? Math.round(median(withEv.map((r) => r.processing))) : "-",
    withEv.length ? Math.round(median(withEv.map((r) => r.presentation))) : "-",
    withEv.length ? Math.round(median(withEv.map((r) => r.inputDelay))) : "-"].join("|"));
}
