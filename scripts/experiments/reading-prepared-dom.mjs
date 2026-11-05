// Apply prepared-dom.patch temporarily and run against the dev server; revert it afterward.
// The patch omits invalidation, history, and interaction handling; do not deploy it.
import { chromium, firefox } from 'playwright-core';
import { createHash } from 'node:crypto';
const base=process.env.RM_BASE_URL ?? 'http://127.0.0.1:4322/dispositif/';
const fragmentModule=process.env.RM_FRAGMENT_MODULE ?? 'scripts/experiments/reading-fragment-snapshot.ts';
for(const [name,engine] of Object.entries({chromium,firefox})){
 const browser=await engine.launch();
 try {for(const mode of (process.env.RM_MODES ?? "none,font-link,prepared,none,font-link,prepared").split(",")){
  const preload=mode === "prepared";
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>{localStorage.setItem('dispositif:reading-mode','multi');window.probeEvents=[];for(const event of ['astro:before-preparation','astro:after-swap','astro:page-load'])document.addEventListener(event,()=>{window.probeEvents.push([event,performance.now()]);if(event==='astro:after-swap'){const root=document.documentElement;const observer=new MutationObserver(()=>{if(!root.classList.contains('rm-pending')){window.probeEvents.push(['ready',performance.now()]);observer.disconnect()}});observer.observe(root,{attributes:true,attributeFilter:['class']})}});});
  const page=await context.newPage(); page.on('console',m=>{if(m.text().startsWith('PROBE_MEASURE'))console.log(name,mode,m.text())});
  await page.goto(base); const link=page.locator('a[href$="symmetric-polynomial/"]'); await link.hover(); await page.waitForTimeout(800);
  if(mode === 'fonts') await page.evaluate(async base => {
   const html=await(await fetch(new URL('symmetric-polynomial/',base))).text(); const parsed=new DOMParser().parseFromString(html,'text/html');
   const styles=[...parsed.head.querySelectorAll('style')].map(old=>{const s=document.createElement('style');s.textContent=old.textContent;document.head.append(s);return s});
   const box=document.createElement('div');box.style.cssText='position:fixed;left:-10000px;visibility:hidden';
   for(const node of parsed.querySelectorAll('mjx-container'))box.append(node.cloneNode(true));document.body.append(box);box.getBoundingClientRect();await document.fonts.ready;box.remove();styles.forEach(s=>s.remove());
  },base);
  if(mode === 'font-link') await page.evaluate(async base => {
   const html=await(await fetch(new URL('symmetric-polynomial/',base))).text(); const parsed=new DOMParser().parseFromString(html,'text/html');
   const ref=parsed.querySelector('link[rel="preload"][as="font"]');
   if(ref){const link=document.createElement('link');link.rel='preload';link.as='font';link.type='font/woff2';link.crossOrigin='anonymous';link.href=ref.href;document.head.append(link);await new Promise(resolve=>{link.onload=resolve;link.onerror=resolve})}
  },base);
  if(preload) await page.evaluate(async ({base,fragmentModule})=>{
   const html=await(await fetch(new URL('symmetric-polynomial/',base))).text();const parsed=new DOMParser().parseFromString(html,'text/html');
   const styles=[...parsed.head.querySelectorAll('style')].map(old=>{const s=document.createElement('style');s.textContent=old.textContent;document.head.append(s);return s});
   const box=document.createElement('div');box.className='rm-active rm-ready';box.style.cssText='position:fixed;left:0;top:0;width:100vw;height:100vh;transform:translateX(-200vw);visibility:hidden;pointer-events:none;contain:layout paint';
   const header=parsed.querySelector('[data-site-header]'), port=parsed.querySelector('.rm-article-scrollport');box.append(header,port);document.body.append(box);header.append(box.querySelector('.rm-toolbar'));header.style.position='fixed';box.querySelector('.rm-reader').hidden=false;box.style.setProperty('--rm-header-height',`${header.getBoundingClientRect().height}px`);
   const viewport=box.querySelector('.rm-viewport'),source=box.querySelector('.rm-source'),ruler=document.createElement('div');ruler.className='rm-ruler';box.append(ruler);
   const edge=parseFloat(getComputedStyle(ruler).paddingRight),width=Math.min(parseFloat(getComputedStyle(ruler).width),Math.max(1,viewport.clientWidth-2*edge));source.style.width=`${width}px`;source.querySelectorAll('img').forEach(img=>img.loading='eager');source.getBoundingClientRect();await document.fonts.ready;
   const {ReadingFragments}=await import(new URL(fragmentModule,base).href);const fragments=new ReadingFragments(source);fragments.measure(true);const sourceRect=source.getBoundingClientRect(),length=Math.ceil(sourceRect.height),height=viewport.clientHeight;
   const headings=[...source.querySelectorAll('h2[id], h3[id]')].map(el=>({id:el.id,t:el.getBoundingClientRect().top-sourceRect.top}));
   const count=Math.ceil(viewport.clientWidth/(width+parseFloat(getComputedStyle(ruler).marginRight)))+1;
   const contents=Array.from({length:count-1},(_,i)=>{const node=fragments.createContent();fragments.render(node,(i+1)*height,height,length);return node});
   window.__rmProbe={source,fragments,contents,width,height,length,viewportWidth:viewport.clientWidth,headings};
   document.addEventListener('astro:before-swap',event=>{event.newDocument.querySelector('.rm-source').replaceWith(source);box.remove();styles.forEach(s=>s.remove())},{once:true});
  },{base,fragmentModule});
  await page.evaluate(()=>window.probeEvents=[]);await link.click();await page.waitForFunction(()=>document.documentElement.classList.contains('rm-active')&&!document.documentElement.classList.contains('rm-pending'));await page.waitForTimeout(500);
  const times=await page.evaluate(()=>window.probeEvents);const screenshot=await page.locator('.rm-viewport').screenshot();console.log(name,'mode',mode,'times',JSON.stringify(times),'viewportSHA',createHash('sha256').update(screenshot).digest('hex'));
  await context.close();
 }}finally{await browser.close()}
}
