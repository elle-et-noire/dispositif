// node batch.mjs <engines> <seeds from-to> <bursts> <outDir> [concurrency]
import { spawn } from "node:child_process";
const [enginesText, seedsText, bursts, outDir, conc = "4"] = process.argv.slice(2);
const [from, to] = seedsText.split("-").map(Number);
const jobs = [];
for (const engine of enginesText.split(","))
  for (let seed = from; seed <= to; seed++)
    for (const article of ["symmetric-polynomial", "nextjs-mdx", "how-to-write", "tips-haskell"])
      for (const mode of ["single", "multi"]) jobs.push([engine, article, mode, String(seed), bursts, outDir]);
let next = 0;
const worker = () => new Promise((resolve) => {
  const go = () => {
    if (next >= jobs.length) return resolve();
    const job = jobs[next++];
    const child = spawn("node", [new URL("./monkey.mjs", import.meta.url).pathname, "run", ...job], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60_000);
    child.on("close", (code) => { clearTimeout(timer); console.log(out.trim() || `${job.join(" ")} exit ${code}`); go(); });
  };
  go();
});
await Promise.all(Array.from({ length: Number(conc) }, worker));
