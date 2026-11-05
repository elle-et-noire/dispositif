// Compare a normal article navigation with reading-retained-reader.mjs.
import { chromium, firefox } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const base=process.env.RM_BASE_URL??'http://127.0.0.1:4333/dispositif/';
const slug=process.env.RM_ARTICLE??'symmetric-polynomial';
function pss(){
 const rows=execFileSync('ps',['-eo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
 const ids=new Set([process.pid]);let n;do{n=ids.size;for(const [pid,parent] of rows)if(ids.has(parent))ids.add(pid)}while(n!==ids.size);
 return rows.filter(([pid])=>pid!==process.pid&&ids.has(pid)).reduce((total,[pid])=>{try{return total+Number(/^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`,'utf8'))?.[1]??0)}catch{return total}},0);
}
for(const [name,engine] of Object.entries({chromium,firefox})){
 const browser=await engine.launch();try{
 const context=await browser.newContext({viewport:{width:Number(process.env.RM_WIDTH??1440),height:Number(process.env.RM_HEIGHT??900)},reducedMotion:'reduce'});
 await context.addInitScript(()=>localStorage.setItem('dispositif:reading-mode','multi'));const page=await context.newPage();await page.goto(base);
 const link=page.locator(`a[href$="${slug}/"]`);await link.hover();await page.waitForTimeout(600);const before=pss();
 const start=Date.now();await link.click();await page.waitForFunction(()=>document.documentElement.classList.contains('rm-active')&&!document.documentElement.classList.contains('rm-pending'));await page.waitForTimeout(200);
 const after=pss();console.log(name,JSON.stringify({slug,activePssDifferenceKiB:after-before,elapsedMs:Date.now()-start}));await context.close();
 }finally{await browser.close()}
}
