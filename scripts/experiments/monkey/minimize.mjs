// node minimize.mjs <run.json> <invariant> [tries]
// Drops bursts while the invariant still fails, then writes <run>.min.json
// with the remaining plan. A removal is kept only if the failure reproduces
// in at least one of `tries` replays (failures can depend on timing).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const [file, inv, triesText = "2"] = process.argv.slice(2);
const tries = Number(triesText);
const rec = JSON.parse(readFileSync(file, "utf8"));
const first = Math.min(...rec.failures.filter((f) => f.inv === inv).map((f) => f.burst));
let kept = rec.plan.map((_, i) => i).filter((i) => i <= first);
const monkey = new URL("./monkey.mjs", import.meta.url).pathname;
const tmp = file.replace(/\.json$/, ".try.json");
let runs = 0;
const fails = (indexes) => {
  writeFileSync(tmp, JSON.stringify({ ...rec, plan: indexes.map((i) => rec.plan[i]) }));
  for (let t = 0; t < tries; t++) {
    runs++;
    const out = execFileSync("node", [monkey, "replay", tmp], { encoding: "utf8", timeout: 600_000 });
    const result = JSON.parse(out.slice(out.indexOf("{")));
    if (result.failures[inv]) return true;
  }
  return false;
};
if (!fails(kept)) { console.log(JSON.stringify({ file, inv, reproduced: false, runs })); process.exit(0); }
for (let size = Math.ceil(kept.length / 2); size >= 1; size = size === 1 ? 0 : Math.ceil(size / 2)) {
  for (let start = 0; start < kept.length; ) {
    const candidate = kept.filter((_, i) => i < start || i >= start + size);
    if (candidate.length && fails(candidate)) kept = candidate; else start += size;
  }
}
const plan = kept.map((i) => rec.plan[i]);
writeFileSync(file.replace(/\.json$/, `.min-${inv}.json`), JSON.stringify({ ...rec, plan, kept }, null, 1));
console.log(JSON.stringify({ file, inv, reproduced: true, runs, kept, plan }, null, 1));
