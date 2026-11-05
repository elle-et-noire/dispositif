// Exploratory retained-layer overlay; not application code.
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
  let changed = 0; let max = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let delta = 0; for (let c=0;c<3;c++) delta=Math.max(delta,Math.abs(a.data[i+c]-b.data[i+c]));
    if (delta > 3) changed++; max=Math.max(max,delta);
  }
  return { changedPixels: changed, totalPixels: a.data.length / 4, maxDifference: max };
}
for (const [name, engine] of Object.entries({chromium, firefox}).filter(([name]) => !process.env.RM_BROWSER || process.env.RM_BROWSER === name)) {
 const browser = await engine.launch();
 try {
  const page = await browser.newPage({viewport:{width:Number(process.env.RM_WIDTH ?? 1440),height:Number(process.env.RM_HEIGHT ?? 900)}, reducedMotion:'reduce'});
  await page.addInitScript(() => localStorage.setItem('dispositif:reading-mode','multi'));
  await page.goto(process.env.RM_DELAY ? `${base}?rm_delay_test` : base);
  const link = page.locator(`a[href$="${slug}/"]`); await link.hover(); await page.waitForTimeout(700);
  const beforeImage = await page.screenshot(); const before = usage();
  const started = Date.now();
  await page.evaluate(async ({url, moduleURL}) => {
    const html=await(await fetch(url)).text();const parsed=new DOMParser().parseFromString(html,'text/html');
    const styles=[...parsed.head.querySelectorAll('style')].map(old=>{const style=document.createElement('style');style.textContent=old.textContent;document.head.append(style);return style});
    const layer=document.createElement('div');layer.id='rm-experiment-frame';layer.className='rm-active rm-ready';layer.setAttribute('aria-hidden','true');layer.inert=true;
    layer.style.cssText='position:fixed;left:0;top:0;width:100vw;height:100vh;transform:translateX(-200vw);z-index:2147483647;pointer-events:none;contain:layout paint';
    const header=parsed.querySelector('[data-site-header]'), backdrop=parsed.querySelector('.rm-backdrop'), port=parsed.querySelector('.rm-article-scrollport');
    layer.append(header,backdrop,port);document.documentElement.append(layer);header.append(layer.querySelector('.rm-toolbar'));header.style.position='fixed';
    layer.querySelector('.rm-reader').hidden=false;
    const toc=header.querySelector('.toc-header');if(toc){toc.open=true;const first=toc.querySelector('[data-toc-id]');first?.classList.add('is-active-li');first?.querySelector('a')?.setAttribute('aria-current','location');const nav=toc.querySelector('[data-toc-scroll]');const right=toc.querySelector('[data-toc-direction="1"]');if(nav&&right)right.disabled=nav.scrollWidth-nav.clientWidth<=1;}
    layer.querySelector('.rm-toggle')?.setAttribute('aria-pressed','true');layer.style.setProperty('--rm-header-height',`${header.getBoundingClientRect().height}px`);
    const viewport=layer.querySelector('.rm-viewport'),plane=layer.querySelector('.rm-plane'),source=layer.querySelector('.rm-source'),ruler=document.createElement('div');ruler.className='rm-ruler';ruler.innerHTML='<div></div>';layer.append(ruler);
    const edge=parseFloat(getComputedStyle(ruler).paddingRight),gap=parseFloat(getComputedStyle(ruler).marginRight),width=Math.min(parseFloat(getComputedStyle(ruler).width),Math.max(1,viewport.clientWidth-2*edge));
    source.style.width=`${width}px`;source.querySelectorAll('img').forEach(img=>img.loading='eager');source.getBoundingClientRect();await document.fonts.ready;
    const {ReadingFragments,ReadingViewport,createLayout,ReadingState,toCss,ticks,paperWindow,slotColumns}=await import(moduleURL);
    const fragments=new ReadingFragments(source);fragments.measure(true);const length=Math.ceil(source.getBoundingClientRect().height),height=viewport.clientHeight;
    const layout=createLayout(width,gap,height,0,length,viewport.clientWidth,edge),state=new ReadingState(layout);
    for (const [key,value] of Object.entries({w:width,p:toCss(layout.p),h:height,step:height,overlap:0,l:length,edge}))plane.style.setProperty(`--rm-${key}`,`${value}px`);
    ruler.scrollLeft=1/(devicePixelRatio||1);if(!ruler.scrollLeft)ruler.scrollLeft=1;const native=new ReadingViewport(viewport,plane,ruler.scrollLeft||1);ruler.scrollLeft=0;
    const geometry=native.place(state.point,layout,true),{start,count}=slotColumns(state.point,layout),nativeY=viewport.scrollTop;
    for(let i=0;i<count;i++){
      const k=start+i,content=i===0?source:fragments.createContent();content.classList.add('rm-content');
      const track=document.createElement('div');track.className='rm-track';const slot=document.createElement('div');slot.className='rm-slot';slot.dataset.rmK=String(k);if(content!==source)slot.setAttribute('aria-hidden','true');slot.append(content);
      const shade=document.createElement('div');shade.className='rm-shade';shade.setAttribute('aria-hidden','true');const paper=document.createElement('div');paper.className='rm-paper';paper.setAttribute('aria-hidden','true');slot.append(shade,paper);track.append(slot);plane.append(track);
      const t=ticks(k*layout.step+state.point.y),surface=paperWindow(t,layout),from=toCss(t),paperTop=toCss(surface.top),paperHeight=toCss(surface.height),shift=toCss(surface.shift);
      const left=geometry.leading+geometry.edge+(k-geometry.originColumn)*geometry.p,top=-(k*geometry.step+geometry.originY)+shift;
      const clipped=from<0||from+geometry.h>geometry.l;
      track.style.left=`${left}px`;content.style.translate=`${left}px ${top}px`;
      track.style.clipPath=paperHeight===0?'inset(50%)':clipped?`polygon(-4px ${nativeY+paperTop}px, calc(100% + 4px) ${nativeY+paperTop}px, calc(100% + 4px) ${nativeY+paperTop+paperHeight}px, -4px ${nativeY+paperTop+paperHeight}px)`:'inset(0px -4px)';
      paper.style.top=shade.style.top=`${paperTop}px`;paper.style.height=shade.style.height=`${paperHeight}px`;
      shade.style.setProperty('--rm-shade-top',`${shift-paperTop}px`);shade.style.setProperty('--rm-shade-bottom',`${paperTop+paperHeight-geometry.h-shift}px`);
      slot.toggleAttribute('data-rm-head',from<=0);slot.toggleAttribute('data-rm-tail',from+geometry.h>=geometry.l);
      if(content!==source&&paperHeight>0)fragments.render(content,toCss(t-surface.shift),geometry.h,geometry.l);
    }
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    window.overlayMarks=[];
    document.addEventListener('click',event=>{if(!event.target.closest(`a[href$="/${new URL(url).pathname.split('/').filter(Boolean).at(-1)}/"]`))return;
      window.overlayMarks.push(['click',performance.now()]);layer.style.transform='translateX(0)';requestAnimationFrame(()=>requestAnimationFrame(()=>window.overlayMarks.push(['overlay-frames',performance.now()])));
    },{once:true,capture:true});
    if (location.search.includes('rm_delay_test')) document.addEventListener('astro:before-preparation',event=>{const load=event.loader;event.loader=async function(){await new Promise(resolve=>setTimeout(resolve,1200));return load.call(this)}} ,{once:true});
    document.addEventListener('astro:after-swap',()=>{document.querySelectorAll('body .rm-backdrop, body .rm-article-scrollport, body [data-site-header]').forEach(el=>el.style.setProperty('visibility','hidden'));window.overlayMarks.push(['after-swap',performance.now()]);const root=document.documentElement;
      const observer=new MutationObserver(()=>{if(!root.classList.contains('rm-pending')){window.overlayMarks.push(['ready',performance.now()]);observer.disconnect()}});observer.observe(root,{attributes:true,attributeFilter:['class']});
    },{once:true});
  }, {url:new URL(`${slug}/`,base).href,moduleURL:new URL('__retained.mjs',base).href});
  const prepareMs=Date.now()-started; const retained=usage();
  const afterImage=await page.screenshot();
  await link.click();
  await page.waitForFunction(()=>window.overlayMarks.some(([type])=>type==='overlay-frames'));
  const visibleImage=await page.screenshot();
  const beforeSwapAtScreenshot=await page.evaluate(()=>!window.overlayMarks.some(([type])=>type==='after-swap'));
  const getStyles = () => page.evaluate(()=>{const e=document.querySelector('#rm-experiment-frame .toc-link');const p=e?.closest('.toc-header-scroll');if(!e||!p)return null;const s=getComputedStyle(e),n=getComputedStyle(p);return {color:s.color,fill:s.webkitTextFillColor,font:s.font,visibility:s.visibility,opacity:s.opacity,navOpacity:n.opacity,navVisibility:n.visibility,navWidth:p.clientWidth,navHeight:p.clientHeight,navScroll:p.scrollLeft,open:p.closest('details').open}});
  const earlyStyle=await getStyles();
  await page.waitForFunction(()=>window.overlayMarks.some(([type])=>type==='ready'));
  const postSwapImage=await page.screenshot(); const lateStyle=await getStyles();
  const times=await page.evaluate(()=>window.overlayMarks);
  await page.evaluate(()=>{document.querySelector('#rm-experiment-frame').remove();document.querySelectorAll('body .rm-backdrop, body .rm-article-scrollport, body [data-site-header]').forEach(el=>el.style.removeProperty('visibility'))});
  const liveImage=await page.screenshot();
  if (process.env.RM_SAVE_IMAGES) { writeFileSync(`/tmp/${name}-retained.png`, visibleImage); writeFileSync(`/tmp/${name}-live.png`, liveImage); writeFileSync(`/tmp/${name}-posts.png`, postSwapImage); }
  console.log(name,JSON.stringify({prepareMs,pssDifferenceKiB:retained.pss-before.pss,cpuTicksDifference:retained.cpuTicks-before.cpuTicks,times,beforeSwapAtScreenshot,earlyStyle,lateStyle,indexDifference:await compare(beforeImage,afterImage),overlayDifference:await compare(visibleImage,liveImage),postSwapDifference:await compare(postSwapImage,liveImage),overlayChange:await compare(visibleImage,postSwapImage)}));
 } finally { await browser.close(); }
}
