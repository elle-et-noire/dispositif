// Exploratory resource sampling. /proc collection runs in a worker; sampling
// still adds system load and may miss peaks or exited-process CPU. The browser
// measurements are not exact paint timestamps or human input latency.
import { chromium, firefox } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
function usage(){
 const rows=execFileSync('ps',['-eo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(s=>s.trim().split(/\s+/).map(Number));
 const ids=new Set([process.pid]);let prev;do{prev=ids.size;for(const [pid,ppid] of rows)if(ids.has(ppid))ids.add(pid)}while(prev!==ids.size);
 return rows.filter(([pid])=>pid!==process.pid&&ids.has(pid)).reduce((acc,[pid])=>{try{acc.pss+=Number(/^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`,'utf8'))?.[1]??0);const s=readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ');acc.ticks+=+s[11]+ +s[12]}catch{}return acc},{pss:0,ticks:0});
}
if(!isMainThread){
 let timer, samples=[];
 const sample=()=>{try{samples.push({at:Date.now(),...usage()})}catch{}};
 parentPort.on('message',cmd=>{if(cmd==='start'){samples=[];sample();timer=setInterval(sample,150);parentPort.postMessage({ok:true})}else if(cmd==='snapshot'){sample();parentPort.postMessage(samples.at(-1))}else if(cmd==='stop'){clearInterval(timer);sample();parentPort.postMessage(samples)}});
}else{
const base=process.env.RM_BASE_URL??'http://127.0.0.1:4597/dispositif/';
const candidate=process.env.RM_CANDIDATE_URL??'http://127.0.0.1:4598/dispositif/';
const engines=(process.env.RM_ENGINES??'chromium,firefox').split(',');
const articles=(process.env.RM_ARTICLES??'tips-python,symmetric-polynomial').split(',');
const dwells=(process.env.RM_DWELLS??'0,300,1000,3000').split(',').map(Number);
const runs=Number(process.env.RM_RUNS??3),action=process.env.RM_ACTION??'click';
const cache=process.env.RM_CACHE??'warm';
const worker=new Worker(new URL(import.meta.url));
const ask=command=>new Promise((resolve,reject)=>{const fail=e=>{worker.off('message',ok);reject(e)};const ok=x=>{worker.off('error',fail);resolve(x)};worker.once('message',ok);worker.once('error',fail);worker.postMessage(command)});
for(const name of engines){
 const engine={chromium,firefox}[name];let browser=cache==='warm'?await engine.launch():null;
 try {for(const article of articles)for(let run=1;run<=runs;run++)for(const dwell of dwells)for(const mode of (run%2?['current','candidate']:['candidate','current'])) {
  if(cache==='cold')browser=await engine.launch();
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  try{
   await context.addInitScript(()=>{
    localStorage.setItem('dispositif:reading-mode','multi'); window.rmEvents=[];window.rmLong=[];
    window.rmLongSupported=PerformanceObserver.supportedEntryTypes?.includes('longtask')??false;
    if(window.rmLongSupported){const o=new PerformanceObserver(list=>window.rmLong.push(...list.getEntries().map(e=>e.duration)));o.observe({type:'longtask',buffered:true});}
    document.addEventListener('pointerover',e=>{if(e.target instanceof Element&&e.target.closest('[data-article-index] a'))window.rmEvents.push(['hover',performance.now()])},true);
    document.addEventListener('pointerout',e=>{if(e.target instanceof Element&&e.target.closest('[data-article-index] a'))window.rmEvents.push(['leave',performance.now()])},true);
    document.addEventListener('click',e=>{if(!(e.target instanceof Element)||!e.target.closest('[data-article-index] a'))return;window.rmEvents.push(['click',performance.now()]);const frame=document.querySelector('html > iframe[data-rm-preparing]');try{window.rmChildLong=frame?.contentWindow?.rmLong??[]}catch{};
     const poll=()=>{const frame=document.querySelector('html > iframe[data-rm-prepared-reader]'),r=document.documentElement;const normal=r.dataset.pageKind==='article'&&!r.classList.contains('rm-pending')&&(r.classList.contains('rm-active')||r.classList.contains('rm-fallback'));if(frame||normal){requestAnimationFrame(()=>requestAnimationFrame(()=>window.rmEvents.push(['visible',performance.now(),!!frame,r.classList.contains('rm-fallback')])));return}requestAnimationFrame(poll)};requestAnimationFrame(poll);
    },true);
    const watch=new MutationObserver(()=>{if(document.querySelector('html > iframe[data-rm-preload-ready]')&&!window.rmEvents.some(e=>e[0]==='ready'))window.rmEvents.push(['ready',performance.now()])});const watchRoot=()=>watch.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-rm-preload-ready']});if(document.documentElement)watchRoot();else document.addEventListener('DOMContentLoaded',watchRoot,{once:true});
   });
   const page=await context.newPage();
   await page.goto(mode==='candidate'?candidate:base);await page.evaluate(()=>document.fonts.ready); const before=usage();await ask('start');
   const link=page.locator(`a[href$="${article}/"]`);await link.hover();await page.waitForTimeout(dwell);
   let extra={};const dispatched=Date.now();
   if(action==='click'){
    await page.mouse.down();await page.mouse.up();const dispatchMs=Date.now()-dispatched;await page.waitForFunction(()=>window.rmEvents.some(e=>e[0]==='visible'),null,{timeout:45000});
    const info=await page.evaluate(()=>({events:window.rmEvents,longSupported:window.rmLongSupported,parentLong:window.rmLong,childLong:window.rmChildLong??[]}));
    const h=info.events.find(x=>x[0]==='hover'),c=info.events.find(x=>x[0]==='click'),v=info.events.find(x=>x[0]==='visible'),ready=info.events.find(x=>x[0]==='ready');
    if(!h||!c||!v)throw Error('Missing event');
    extra={actualDwellMs:c[1]-h[1],hoverToDisplayMs:v[1]-h[1],displayMs:v[1]-c[1],usedPrepared:v[2],fallback:v[3],readyMs:ready?ready[1]-h[1]:null,dispatchMs,longSupported:info.longSupported,maxLongTaskMs:info.longSupported?Math.max(0,...info.parentLong,...info.childLong):null};
   }else{
    await page.mouse.move(0,0);const dispatchMs=Date.now()-dispatched;
    await page.waitForFunction(()=>!document.querySelector('html > iframe[data-rm-preparing]'),null,{timeout:30000});const removedAt=Date.now();
    await page.waitForTimeout(2000);const after2=await ask('snapshot');await page.waitForTimeout(8000);const after10=await ask('snapshot');
    const info=await page.evaluate(()=>({events:window.rmEvents,indexIntact:document.documentElement.dataset.pageKind==='index'}));const h=info.events.find(x=>x[0]==='hover'),out=info.events.find(x=>x[0]==='leave');
    extra={actualDwellMs:h&&out?out[1]-h[1]:null,dispatchMs,removalMs:removedAt-dispatched,recovered2PssKiB:after2.pss-before.pss,recovered10PssKiB:after10.pss-before.pss,cpu2Ticks:after2.ticks-before.ticks,cpu10Ticks:after10.ticks-before.ticks,indexIntact:info.indexIntact};
   }
   const samples=await ask('stop');const beforeAction=samples.filter(s=>s.at<=dispatched);console.log(JSON.stringify({name,article,run,dwell,mode,action,cache,...extra,peakBeforeActionPssKiB:beforeAction.length?Math.max(...beforeAction.map(x=>x.pss))-before.pss:null,preActionCpuTicks:beforeAction.length?beforeAction.at(-1).ticks-before.ticks:null,peakPssKiB:Math.max(...samples.map(x=>x.pss))-before.pss,endCpuTicks:samples.at(-1).ticks-before.ticks,samples:samples.length}));
  }catch(error){try{await ask('stop')}catch{}console.log(JSON.stringify({name,article,run,dwell,mode,action,cache,error:String(error)}));}
  finally{await context.close();if(cache==='cold'){await browser.close();browser=null}}
 }}finally{if(browser)await browser.close()}
}
await worker.terminate();
}
