// Summarize JSONL without hiding individual samples or fallback outcomes.
import { readFileSync } from 'node:fs';
const rows = process.argv.slice(2).flatMap(path => readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
const keys = ['name','article','action','dwell','mode'];
const groups = Map.groupBy(rows, row => keys.map(key => row[key]).join('/'));
for (const [key, values] of groups) {
 const output = {group:key, n:values.length};
 for (const metric of ['usedPrepared','fallback','actualDwellMs','displayMs','pssKiB','cpuTicks','leaveDispatchMs','removalMs','recoveredPssKiB','totalCpuTicks','indexIntact']) {
  const samples = values.map(row=>row[metric]).filter(value=>value!==undefined);
  if (samples.length) output[metric]=samples;
 }
 console.log(JSON.stringify(output));
}
