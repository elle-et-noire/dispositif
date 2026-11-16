// Markdown table per article: op rows, condition x viewport columns, "median/max".
// Key operations come from the 80 ms key-hold run (keys-*.jsonl).
import { readFileSync } from "node:fs";
const load = (f) => readFileSync(new URL(f, import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const conds = [["chromium-1", "Cr"], ["chromium-4", "Cr×4"], ["firefox-1", "FF"]];
const rows = [];
for (const [c] of conds) {
  for (const r of load(`out-${c}.jsonl`)) if (!r.op.startsWith("key-")) rows.push({ ...r, cond: c });
  for (const r of load(`keys-${c}.jsonl`)) rows.push({ ...r, cond: c });
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (v) => v <= 8 ? "<16" : String(Math.round(v));
const opsOrder = ["toggle-to-multi", "toggle-to-single", "key-PageDown", "key-ArrowRight", "key-ArrowLeft", "key-Home", "key-End", "key-Home2",
  "toc-single", "toc-mobile-open", "toc-multi", "details-open-single", "details-close-single", "details-open-multi", "details-close-multi",
  "copy-single", "copy-multi", "close-single", "close-multi", "click-text-single", "click-text-multi"];
for (const article of ["symmetric-polynomial", "nextjs-mdx"]) {
  console.log(`\n### ${article}\n`);
  const cols = conds.flatMap(([c, label]) => ["desktop", "mobile"].map((v) => [c, v, `${label} ${v === "desktop" ? "1280" : "390"}`]));
  console.log(`| 操作 | ${cols.map((c) => c[2]).join(" | ")} |`);
  console.log(`|---|${cols.map(() => "---").join("|")}|`);
  for (const op of opsOrder) {
    const cells = cols.map(([c, v]) => {
      const xs = rows.filter((r) => r.article === article && r.cond === c && r.viewport === v && r.op === op).map((r) => r.inp ?? 8);
      return xs.length ? `${fmt(median(xs))}/${fmt(Math.max(...xs))}` : "-";
    });
    if (cells.every((c) => c === "-")) continue;
    console.log(`| ${op} | ${cells.join(" | ")} |`);
  }
}
