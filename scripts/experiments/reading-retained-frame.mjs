// Exploratory retained-frame overlay; not application code.
// Run against a built page, e.g. RM_BASE_URL=http://127.0.0.1:4333/dispositif/ node ...
import { chromium, firefox } from 'playwright-core';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const base = process.env.RM_BASE_URL ?? 'http://127.0.0.1:4333/dispositif/';
const slug = process.env.RM_ARTICLE ?? 'symmetric-polynomial';
function usage() {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const ids = new Set([process.pid]); let size;
  do { size = ids.size; for (const [pid, parent] of rows) if (ids.has(parent)) ids.add(pid); } while (size !== ids.size);
  return rows.filter(([pid]) => pid !== process.pid && ids.has(pid)).reduce((value, [pid]) => {
    try {
      const file = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
      value.pss += Number(/^Pss:\s+(\d+)/m.exec(file)?.[1] ?? 0);
      const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
      value.cpuTicks += Number(fields[11]) + Number(fields[12]);
    } catch { /* A process can exit while sampling. */ }
    return value;
  }, { pss: 0, cpuTicks: 0 });
}
async function compare(first, second) {
  const [a, b] = await Promise.all([sharp(first).ensureAlpha().raw().toBuffer({resolveWithObject:true}), sharp(second).ensureAlpha().raw().toBuffer({resolveWithObject:true})]);
  if (a.data.length !== b.data.length) return { dimensionMismatch: true };
  let changed = 0; let max = 0; let minX=a.info.width, minY=a.info.height, maxX=0, maxY=0;
  for (let i = 0; i < a.data.length; i += 4) {
    let delta = 0; for (let c=0;c<3;c++) delta=Math.max(delta,Math.abs(a.data[i+c]-b.data[i+c]));
    if (delta > 3) { changed++; const pixel=i/4, x=pixel%a.info.width, y=Math.floor(pixel/a.info.width); minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y); } max=Math.max(max,delta);
  }
  return { changedPixels: changed, totalPixels: a.data.length / 4, maxDifference: max, bounds: changed ? [minX,minY,maxX,maxY] : null };
}
for (const [name, engine] of Object.entries({chromium, firefox}).filter(([name]) => !process.env.RM_BROWSER || process.env.RM_BROWSER === name)) {
 const browser = await engine.launch();
 try {
  const page = await browser.newPage({viewport:{width:Number(process.env.RM_WIDTH ?? 1440),height:Number(process.env.RM_HEIGHT ?? 900)}, reducedMotion:'reduce'});
  await page.addInitScript(() => localStorage.setItem('dispositif:reading-mode','multi'));
  await page.goto(process.env.RM_DELAY ? `${base}?rm_delay_test${process.env.RM_INTERACTIVE ? '&rm_interactive_test' : ''}${process.env.RM_FORWARD_CLOSE ? '&rm_forward_close' : ''}` : base);
  await page.locator('.article-index-shell').evaluate(el=>el.scrollTop=160);
  const link = page.locator(`a[href$="${slug}/"]`); await link.hover(); await page.waitForTimeout(700);
  const initialIndexScroll = await page.locator('.article-index-shell').evaluate(el=>el.scrollTop);
  const beforeImage = await page.screenshot(); const before = usage();
  const started = Date.now();
  await page.evaluate(async url => {
    const frame=document.createElement('iframe'); frame.id='rm-experiment-frame'; frame.setAttribute('aria-hidden','true');
    frame.style.cssText='position:fixed;left:0;top:0;width:100vw;height:100vh;border:0;z-index:2147483647;pointer-events:none;transform:translateX(-200vw)';
    frame.src=url; document.documentElement.append(frame);
    await new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=reject});
    await frame.contentDocument.fonts.ready;
    while (!frame.contentDocument.querySelector('.rm-slot') || frame.contentDocument.documentElement.classList.contains('rm-pending')) await new Promise(resolve=>setTimeout(resolve,20));
    await new Promise(resolve=>frame.contentWindow.requestAnimationFrame(()=>frame.contentWindow.requestAnimationFrame(resolve)));
    const list=frame.contentDocument.querySelector('[data-article-index]');
    list.style.setProperty('--article-index-offset',`${-document.querySelector('.article-index-shell').scrollTop}px`);
    window.overlayMarks=[];
    if(location.search.includes('rm_forward_close')) frame.contentDocument.addEventListener('click',event=>{
      const close=event.target.closest('.rm-close, .rm-dismiss');
      if(!close)return;
      event.preventDefault();event.stopImmediatePropagation();
      const current=document.querySelector('.article-index-shell');const saved=current?.scrollTop ?? 0;
      frame.style.display='none';
      document.addEventListener('astro:after-swap',()=>{document.querySelector('.article-index-shell')?.scrollTo({top:saved,behavior:'instant'});document.querySelector(`a[href$="/${new URL(url).pathname.split('/').filter(Boolean).at(-1)}/"]`)?.focus({preventScroll:true});frame.remove()}, {once:true});
      window.__rmExperimentalNavigate(new URL('/dispositif/',location.href),{history:'replace'});
    },{capture:true});
    document.addEventListener('click', event=>{
      if (!event.target.closest(`a[href$="/${new URL(url).pathname.split('/').filter(Boolean).at(-1)}/"]`)) return;
      window.overlayMarks.push(['click',performance.now()]); if(location.search.includes('rm_interactive_test'))frame.style.pointerEvents='auto'; frame.contentDocument.querySelector('[data-article-index]').style.setProperty('--article-index-offset',`${-document.querySelector('.article-index-shell').scrollTop}px`); frame.style.transform='none';
      requestAnimationFrame(()=>requestAnimationFrame(()=>window.overlayMarks.push(['overlay-frames',performance.now()])));
    },{once:true,capture:true});
    if(location.search.includes('rm_delay_test'))document.addEventListener('astro:before-preparation',event=>{const load=event.loader;event.loader=async function(){await new Promise(resolve=>setTimeout(resolve,1200));return load.call(this)}},{once:true});
    document.addEventListener('astro:after-swap',()=>{
      window.overlayMarks.push(['after-swap',performance.now()]);
      const root=document.documentElement;
      const observer=new MutationObserver(()=>{if(!root.classList.contains('rm-pending')){window.overlayMarks.push(['ready',performance.now()]);observer.disconnect()}});
      observer.observe(root,{attributes:true,attributeFilter:['class']});
    },{once:true});
  }, new URL(`${slug}/`, base).href);
  const prepareMs=Date.now()-started; const retained=usage();
  const afterImage=await page.screenshot();
  await link.click();
  await page.waitForFunction(()=>window.overlayMarks.some(([type])=>type==='overlay-frames'));
  let previewScroll = null;
  if(process.env.RM_CLOSE_PREVIEW){await page.frameLocator('#rm-experiment-frame').locator('.rm-close').click();await page.waitForTimeout(300)}
  if(process.env.RM_FORWARD_CLOSE){await page.waitForTimeout(2000);const result=await page.evaluate(()=>({path:location.pathname,kind:document.documentElement.dataset.pageKind,scroll:document.querySelector('.article-index-shell')?.scrollTop,active:document.activeElement?.getAttribute('href'),historyLength:history.length,index:history.state?.index,marks:window.overlayMarks}));console.log(name,JSON.stringify({initialIndexScroll,result}));continue;}
  if(process.env.RM_OPEN_DETAILS) await page.evaluate(async()=>{const doc=document.querySelector('#rm-experiment-frame').contentDocument;const details=doc.querySelector('.rm-source details');if(details){details.open=true;await new Promise(resolve=>setTimeout(resolve,150));}});
  if(process.env.RM_INTERACTIVE && !process.env.RM_CLOSE_PREVIEW){await page.mouse.move(300,300);await page.mouse.wheel(0,320);await page.waitForTimeout(150);previewScroll=await page.evaluate(()=>{const p=document.querySelector('#rm-experiment-frame').contentDocument.querySelector('.rm-viewport');return {x:p.scrollLeft,y:p.scrollTop}})}
  const visibleImage=await page.screenshot();
  await page.waitForFunction(()=>window.overlayMarks.some(([type])=>type==='ready'));
  const times=await page.evaluate(()=>window.overlayMarks); const dual=usage();
  const routes=await page.evaluate(()=>({parent:location.pathname,preview:document.querySelector('#rm-experiment-frame').contentWindow.location.pathname}));
  let handoff = null;
  if(process.env.RM_HANDOFF) handoff=await page.evaluate(async()=>{
    const oldPlane=document.querySelector('#rm-experiment-frame').contentDocument.querySelector('.rm-plane');
    const expected={x:Number(oldPlane.dataset.rmXTicks),y:Number(oldPlane.dataset.rmYTicks)};
    const details=[...oldPlane.querySelectorAll('.rm-source details')].map(element=>element.open);
    const layout=['w','p','h','step','l','edge'].map(key=>oldPlane.style.getPropertyValue(`--rm-${key}`));
    layout.push(String(oldPlane.closest('.rm-viewport').clientWidth));
    document.dispatchEvent(new CustomEvent('rm:experiment-restore',{detail:{...expected,details,layout}}));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const newPlane=document.querySelector('body .rm-plane');
    return {expected,actual:{x:Number(newPlane.dataset.rmXTicks),y:Number(newPlane.dataset.rmYTicks)},previewOpen:oldPlane.querySelector('.rm-source details')?.open ?? null,actualOpen:newPlane.querySelector('.rm-source details')?.open ?? null};
  });
  await page.evaluate(()=>document.querySelector('#rm-experiment-frame').remove());
  const liveScroll=await page.locator('.rm-viewport').evaluate(p=>({x:p.scrollLeft,y:p.scrollTop}));
  const liveImage=await page.screenshot();
  if(process.env.RM_SAVE_IMAGES){writeFileSync(`/tmp/${name}-frame.png`,visibleImage);writeFileSync(`/tmp/${name}-live.png`,liveImage)}
  await page.waitForTimeout(500);const afterRemoval=usage();
  await page.goBack();await page.waitForFunction(()=>document.documentElement.dataset.pageKind==='index');
  const restoredIndexScroll=await page.locator('.article-index-shell').evaluate(el=>el.scrollTop);
  console.log(name,JSON.stringify({prepareMs,pssDifferenceKiB:retained.pss-before.pss,cpuTicksDifference:retained.cpuTicks-before.cpuTicks,dualPssDifferenceKiB:dual.pss-before.pss,afterRemovalPssDifferenceKiB:afterRemoval.pss-before.pss,initialIndexScroll,restoredIndexScroll,previewScroll,liveScroll,handoff,routes,times,indexDifference:await compare(beforeImage,afterImage),overlayDifference:await compare(visibleImage,liveImage)}));
 } finally { await browser.close(); }
}
