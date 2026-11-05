// Run against a built site. CPU ticks use /proc and PSS includes all browser
// subprocesses, shared caches and renderer allocations, not only the reader.
import { chromium, firefox } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const base=process.env.RM_BASE_URL??'http://127.0.0.1:4333/dispositif/';
const slug=process.env.RM_ARTICLE??'symmetric-polynomial';
const runs=Number(process.env.RM_RUNS??3);
function usage(){
  const rows=execFileSync('ps',['-eo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
  const ids=new Set([process.pid]);let previous;
  do{previous=ids.size;for(const [pid,parent] of rows)if(ids.has(parent))ids.add(pid)}while(previous!==ids.size);
  return rows.filter(([pid])=>pid!==process.pid&&ids.has(pid)).reduce((sum,[pid])=>{
    try{sum.pss+=Number(/^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`,'utf8'))?.[1]??0);
      const stat=readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ');sum.ticks+=Number(stat[11])+Number(stat[12]);}catch{}
    return sum;
  },{pss:0,ticks:0});
}
for(const [name,engine] of Object.entries({chromium,firefox})){
  const browser=await engine.launch();
  try{
    for(let i=0;i<runs;i++)for(const preload of [false,true]){
      const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
      await context.addInitScript(()=>{
        localStorage.setItem('dispositif:reading-mode','multi');window.rmBench=[];
        document.addEventListener('click',event=>{
          if(!(event.target instanceof Element)||!event.target.closest('[data-article-index] a'))return;
          window.rmBench.push(['click',performance.now()]);
          const poll=()=>{
            const frame=document.querySelector('html > iframe[data-rm-prepared-reader]');
            const normal=document.documentElement.dataset.pageKind==='article'&&document.documentElement.classList.contains('rm-active')&&!document.documentElement.classList.contains('rm-pending');
            if(frame||normal){requestAnimationFrame(()=>requestAnimationFrame(()=>window.rmBench.push(['visible',performance.now(),!!frame])));return;}
            requestAnimationFrame(poll);
          };requestAnimationFrame(poll);
        },true);
      });
      const page=await context.newPage();await page.goto(base);await page.evaluate(()=>document.fonts.ready);
      const before=usage();const link=page.locator(`a[href$="${slug}/"]`);let preparationMs=null,preparationPssKiB=null,preparationTicks=null;
      if(preload){const start=Date.now();await link.hover();await page.waitForSelector('html > iframe[data-rm-preload-ready]',{state:'attached',timeout:30000});
        preparationMs=Date.now()-start;const ready=usage();preparationPssKiB=ready.pss-before.pss;preparationTicks=ready.ticks-before.ticks;
      }else{
        // Keep Astro's existing hover HTML prefetch, but prevent the reader
        // iframe from completing so the click takes the normal path.
        await page.route(`**/${slug}/`,async route=>{
          if(route.request().frame().parentFrame()){await new Promise(resolve=>setTimeout(resolve,3000));await route.abort().catch(()=>{});}
          else await route.continue();
        });
        await link.hover();await page.waitForTimeout(700);
      }
      await link.click();
      await page.waitForFunction(()=>window.rmBench.some(entry=>entry[0]==='visible'),null,{timeout:30000});
      const metrics=await page.evaluate(()=>window.rmBench);const start=metrics.find(entry=>entry[0]==='click');const visible=metrics.find(entry=>entry[0]==='visible');
      await page.waitForFunction(()=>document.documentElement.dataset.pageKind==='article');const active=usage();
      console.log(name,JSON.stringify({run:i+1,preload,displayMs:visible[1]-start[1],usedPrepared:visible[2],preparationMs,preparationPssKiB,preparationTicks,activePssKiB:active.pss-before.pss}));
      await context.close();
    }
  }finally{await browser.close()}
}
