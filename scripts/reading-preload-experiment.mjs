// Exploratory benchmark: run `npm run build` first, then `node scripts/reading-preload-experiment.mjs`.
// The iframe snapshots are a feasibility probe, not a production preload implementation.
import { chromium, firefox } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
const root = resolve('dist');
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/dispositif\/?/, '');
    if (!path || path.endsWith('/')) path += 'index.html';
    const file = resolve(root, path);
    if (!file.startsWith(root + sep)) throw new Error('Invalid path');
    const data = await readFile(file);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
for (const [name, engine] of Object.entries({chromium, firefox})) {
 const browser=await engine.launch({headless:true}); const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 await page.addInitScript(()=>{localStorage.setItem('dispositif:reading-mode','multi'); window.events=[]; for(const e of ['astro:before-preparation','astro:before-swap','astro:after-swap','astro:page-load']) document.addEventListener(e,()=>{window.events.push([e,performance.now()]); if(e==='astro:after-swap') { const observer=new MutationObserver(()=>{if(document.documentElement.classList.contains('rm-active')){window.events.push(['active',performance.now()]);observer.disconnect();}}); observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']}); requestAnimationFrame(()=>window.events.push(['first-frame',performance.now(),document.documentElement.classList.contains('rm-active')])); }});});
 for(let i=0;i<3;i++){await page.goto(`${origin}/dispositif/`); await page.locator('a[href$="symmetric-polynomial/"]').hover(); await page.waitForTimeout(700); await page.evaluate(()=>window.events=[]); await page.locator('a[href$="symmetric-polynomial/"]').click(); await page.waitForSelector('.rm-slot'); await page.waitForTimeout(100); console.log(name,'baseline',JSON.stringify(await page.evaluate(()=>window.events)));}
 await page.goto(`${origin}/dispositif/`);
 const result=await page.evaluate(async()=>{const url='/dispositif/symmetric-polynomial/'; const load=()=>new Promise((resolve)=>{const t=performance.now(); const frame=document.createElement('iframe'); frame.style.cssText='position:fixed;left:-10000px;top:0;width:1440px;height:900px;border:0;visibility:hidden'; frame.src=url; document.body.append(frame); frame.onload=async()=>{await frame.contentDocument.fonts.ready; const poll=()=>frame.contentDocument.querySelector('.rm-slot')?resolve({frame,elapsed:performance.now()-t}):setTimeout(poll,20);poll();};}); const first=await load(); const snapshot=(frame)=>{const source=frame.contentDocument.querySelector('.rm-source'); const root=source.getBoundingClientRect(); const elements=[...source.children,...source.querySelector('.post').children]; const t=performance.now(); const boxes=elements.map(e=>{const r=e.getBoundingClientRect();return [r.top-root.top,r.left-root.left,r.width,r.height]}); return {boxes,cost:performance.now()-t};}; const a=snapshot(first.frame); const cached=JSON.stringify(a.boxes); const second=await load(); const b=snapshot(second.frame); const differences=a.boxes.flatMap((box,i)=>box.map((v,j)=>Math.abs(v-(b.boxes[i]?.[j]??Infinity)))); const out={prefetchMs:first.elapsed,secondLoadMs:second.elapsed,measureMs:a.cost,remeasureMs:b.cost,cacheBytes:cached.length,blocks:a.boxes.length,maxDifference:Math.max(...differences)}; first.frame.remove(); second.frame.remove();return out;}); console.log(name,'geometry-probe',JSON.stringify(result)); await browser.close();
}

} finally { server.close(); }
