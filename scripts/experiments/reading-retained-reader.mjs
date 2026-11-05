// Exploratory iframe as the actual reader. Requires forward-preview-navigation.patch
// in the built page. This does not implement general link, focus or history handling.
import { chromium, firefox } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
const base=process.env.RM_BASE_URL ?? 'http://127.0.0.1:4333/dispositif/';
const slug=process.env.RM_ARTICLE ?? 'tips-wsl';
function pss(){
 const rows=execFileSync('ps',['-eo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
 const ids=new Set([process.pid]);let n;do{n=ids.size;for(const [pid,parent] of rows)if(ids.has(parent))ids.add(pid)}while(n!==ids.size);
 return rows.filter(([pid])=>pid!==process.pid&&ids.has(pid)).reduce((total,[pid])=>{try{return total+Number(/^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`,'utf8'))?.[1]??0)}catch{return total}},0);
}
for(const [name,engine] of Object.entries({chromium,firefox}).filter(([name])=>!process.env.RM_BROWSER||process.env.RM_BROWSER===name)){
 const browser=await engine.launch();
 try{
  for(const exit of (process.env.RM_EXITS??'back,close').split(',')){
   const context=await browser.newContext({viewport:{width:Number(process.env.RM_WIDTH??900),height:Number(process.env.RM_HEIGHT??500)},reducedMotion:'reduce'});
   await context.addInitScript(()=>localStorage.setItem('dispositif:reading-mode','multi'));
   const page=await context.newPage();await page.goto(base);
   const link=page.locator(`a[href$="${slug}/"]`);await link.hover();await page.waitForTimeout(600);
   const initial=await page.evaluate(()=>({scroll:document.querySelector('.article-index-shell').scrollTop,history:history.length,index:history.state?.index}));
   const before=pss();
   await page.evaluate(async({url,base,shareHistory,flushFrame,syncHash,forwardOther,autoFocus,printFix,parentFonts})=>{
    const frame=document.createElement('iframe');frame.id='rm-kept-reader';frame.setAttribute('aria-hidden','true');
    frame.style.cssText='position:fixed;left:0;top:0;width:100vw;height:100vh;border:0;z-index:2147483647;pointer-events:none;transform:translateX(-200vw)';frame.src=url;document.documentElement.append(frame);
    await new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=reject});await frame.contentDocument.fonts.ready;
    while(!frame.contentDocument.querySelector('.rm-slot')||frame.contentDocument.documentElement.classList.contains('rm-pending'))await new Promise(resolve=>setTimeout(resolve,20));
    if(printFix){
     const controller=new AbortController();let paper;let printStyles=[];
     const rule=document.createElement('style');rule.textContent='@media print { #rm-kept-reader, body > main:not([data-rm-print]) { display:none !important; } }';document.documentElement.append(rule);
     window.addEventListener('beforeprint',()=>{
      if(paper||!frame.isConnected||frame.style.pointerEvents!=='auto')return;
      const doc=frame.contentDocument,original=doc.querySelector('.rm-source'),article=doc.querySelector('.rm-article');if(!original||!article)return;
      paper=doc.querySelector('body > main').cloneNode(false);paper.dataset.rmPrint='';
      const port=doc.querySelector('.rm-article-scrollport').cloneNode(false);
      const articleCopy=article.cloneNode(false);const layout=doc.querySelector('.rm-layout').cloneNode(false);
      const aside=doc.querySelector('.rm-sidebar');if(aside)layout.append(aside.cloneNode(true));
      const content=original.cloneNode(true);content.classList.remove('rm-content');for(const prop of ['width','left','translate'])content.style.removeProperty(prop);layout.append(content);articleCopy.append(layout);port.append(articleCopy);paper.append(port);document.body.append(paper);
      printStyles=[...doc.head.querySelectorAll('style')].map(old=>{const style=document.createElement('style');style.textContent=old.textContent;document.head.append(style);return style});
      const read=element=>{const s=getComputedStyle(element),r=element.getBoundingClientRect();return {tag:element.tagName,className:element.className?.toString(),width:r.width,height:r.height,font:s.font,lineHeight:s.lineHeight,display:s.display,position:s.position,transform:s.transform,translate:s.translate,whiteSpace:s.whiteSpace}};
      window.__printProbe={source:read(content),article:read(articleCopy),math:[...content.querySelectorAll('mjx-container')].slice(0,4).map(read),deep:[...(content.querySelector('mjx-container')?.querySelectorAll('*')??[])].slice(0,12).map(e=>({tag:e.tagName,cls:e.className,style:e.getAttribute('style'),font:getComputedStyle(e).font,box:e.getBoundingClientRect().toJSON()}))};
     },{signal:controller.signal});
     window.addEventListener('afterprint',()=>{paper?.remove();printStyles.forEach(style=>style.remove());paper=undefined;printStyles=[]},{signal:controller.signal});
     document.addEventListener('astro:before-swap',event=>{if(event.to.pathname!==new URL(url).pathname){controller.abort();rule.remove();paper?.remove();printStyles.forEach(style=>style.remove())} });
    }
    if(syncHash){
     const child=frame.contentWindow;const replace=child.history.replaceState.bind(child.history);
     child.history.replaceState=function(state,title,target){replace(state,title,target);if(location.pathname===child.location.pathname&&location.search===child.location.search)history.replaceState(history.state,'',child.location.pathname+child.location.search+child.location.hash)};
    }
    if(forwardOther) frame.contentDocument.addEventListener('click',event=>{
     if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
     const a=event.target.closest('a[href]');if(!a||a.target||a.hasAttribute('download'))return;
     const destination=new URL(a.href),current=frame.contentWindow.location;
     if(destination.origin!==location.origin||(destination.pathname===current.pathname&&destination.search===current.search))return;
     if(a.matches('.rm-close, .rm-dismiss'))return;
     event.preventDefault();event.stopImmediatePropagation();window.__rmExperimentalNavigate(destination.href);
    },{capture:true});
    frame.contentDocument.addEventListener('click',event=>{
     const target=event.target.closest('.rm-close, .rm-dismiss');if(!target)return;event.preventDefault();event.stopImmediatePropagation();
     const article=document.documentElement.dataset.pageKind==='article';const scroll=document.querySelector('.article-index-shell')?.scrollTop??0;
     if(!article)document.addEventListener('astro:after-swap',()=>document.querySelector('.article-index-shell')?.scrollTo({top:scroll,behavior:'instant'}),{once:true});
     window.__rmExperimentalNavigate(base,article?{}:{history:'replace'});
    },{capture:true});
    document.addEventListener('click',event=>{if(!event.target.closest(`a[href$="/${new URL(url).pathname.split('/').filter(Boolean).at(-1)}/"]`))return;
     frame.contentDocument.querySelector('[data-article-index]').style.setProperty('--article-index-offset',`${-document.querySelector('.article-index-shell').scrollTop}px`);
     frame.removeAttribute('aria-hidden');frame.style.pointerEvents='auto';frame.style.transform='none';if(autoFocus)frame.contentDocument.querySelector('.rm-viewport')?.focus({preventScroll:true});
    },{once:true,capture:true});
    document.addEventListener('astro:before-swap',event=>{
     if(!frame.isConnected)return;
     if(event.newDocument.documentElement.dataset.pageKind==='article'&&event.to.pathname===new URL(url).pathname){
      event.newDocument.querySelector('[data-site-header]')?.remove();event.newDocument.querySelector('.rm-backdrop')?.remove();event.newDocument.querySelector('.rm-article-scrollport')?.remove();
     } else {
      document.addEventListener('astro:after-swap',()=>{if(flushFrame)frame.contentDocument.dispatchEvent(new frame.contentWindow.Event('astro:before-swap'));frame.remove()},{once:true});
     }
    });
    document.addEventListener('astro:after-swap',()=>{if(document.documentElement.dataset.pageKind==='article'&&frame.isConnected){
     if(shareHistory){const key=frame.contentWindow.history.state?.dispositifReadingKey;if(key)history.replaceState({...history.state,dispositifReadingKey:key},'')}
     if(parentFonts){
      const key=face=>[face.family,face.style,face.weight,face.stretch].join('|');
      const child=[...frame.contentDocument.fonts].filter(face=>face.status==='loaded');const names=new Set(child.map(key));
      const selected=[...document.fonts].filter(face=>face.family.startsWith('MJX-')&&names.has(key(face)));
      window.__fontProbe={child:child.map(key),selected:selected.map(key)};void Promise.all(selected.map(face=>face.load().catch(()=>undefined)));
     }
     document.documentElement.classList.remove('rm-pending')
    }});
   },{url:new URL(`${slug}/`,base).href,base,shareHistory:!!process.env.RM_SHARE_HISTORY,flushFrame:!!process.env.RM_FLUSH_FRAME,syncHash:!!process.env.RM_SYNC_HASH,forwardOther:!!process.env.RM_FORWARD_OTHER,autoFocus:!!process.env.RM_AUTOFOCUS,printFix:!!process.env.RM_PRINT_FIX,parentFonts:!!process.env.RM_PARENT_FONTS});
   let fontRequests=0;
   if(process.env.RM_SLOW_PARENT_FONTS)await page.route(/\.woff2(?:\?|$)/,async route=>{fontRequests++;await new Promise(resolve=>setTimeout(resolve,1500));await route.continue()});
   const prepared=pss();const beforeClick=Date.now();await link.click();
   await page.waitForFunction(()=>document.documentElement.dataset.pageKind==='article');
   if(process.env.RM_KEY_TEST){await page.keyboard.press('ArrowRight');}else if(process.env.RM_OTHER_ARTICLE_TEST){
    if(process.env.RM_FORWARD_OTHER){await page.mouse.move(200,250);await page.mouse.wheel(0,250);await page.waitForTimeout(150)}
    await page.evaluate(()=>{const doc=document.querySelector('#rm-kept-reader').contentDocument;const a=doc.createElement('a');a.href='/dispositif/tips-python/';doc.body.append(a);a.click()});
    if(process.env.RM_FORWARD_OTHER){
     await page.waitForFunction(()=>location.pathname.endsWith('/tips-python/')&&!document.documentElement.classList.contains('rm-pending')&&document.documentElement.classList.contains('rm-active'));
     const moved=await page.evaluate(()=>({path:location.pathname,frame:!!document.querySelector('#rm-kept-reader'),hasArticle:!!document.querySelector('.rm-source')}));
     await page.goBack();await page.waitForFunction(()=>location.pathname.endsWith('/tips-wsl/')&&!document.documentElement.classList.contains('rm-pending')&&document.documentElement.classList.contains('rm-active'));await page.waitForTimeout(300);
     const returned=await page.evaluate(()=>({path:location.pathname,frame:!!document.querySelector('#rm-kept-reader'),logical:{x:document.querySelector('.rm-plane')?.dataset.rmXTicks,y:document.querySelector('.rm-plane')?.dataset.rmYTicks}}));
     console.log(name,JSON.stringify({initial,moved,returned}));await context.close();continue;
    }
    await page.waitForFunction(()=>document.querySelector('#rm-kept-reader').contentWindow.location.pathname.endsWith('/tips-python/'));
   }else if(process.env.RM_TOC_TEST){await page.frameLocator('#rm-kept-reader').locator('.toc-header .toc-link').nth(1).click();}else if(!process.env.RM_PRINT_EARLY){await page.mouse.move(200,250);await page.mouse.wheel(0,250);}if(!process.env.RM_PRINT_EARLY)await page.waitForTimeout(200);
   if(process.env.RM_TOGGLE_SINGLE){await page.frameLocator('#rm-kept-reader').locator('.rm-toggle').click();await page.waitForFunction(()=>!document.querySelector('#rm-kept-reader').contentDocument.documentElement.classList.contains('rm-active'))}
   const active=await page.evaluate(()=>{const frame=document.querySelector('#rm-kept-reader'),doc=frame?.contentDocument,p=doc?.querySelector('.rm-viewport');return {outerPath:location.pathname,outerSources:document.querySelectorAll('.rm-source').length,framePath:doc?.location.pathname,outerHash:location.hash,frameHash:doc?.location.hash,ariaHidden:frame?.getAttribute('aria-hidden'),parentFocus:document.activeElement?.tagName,childFocus:doc?.activeElement?.className,point:p?{x:p.scrollLeft,y:p.scrollTop}:null,logical:p?{x:p.querySelector('.rm-plane')?.dataset.rmXTicks,y:p.querySelector('.rm-plane')?.dataset.rmYTicks}:null,layout:p?{viewportWidth:p.clientWidth,viewportHeight:p.clientHeight,plane:p.querySelector('.rm-plane')?.getAttribute('style')}:null,childKey:frame?.contentWindow.history.state?.dispositifReadingKey,outerKey:history.state?.dispositifReadingKey,outerIndex:history.state?.index}});
   const activePss=pss();
   let visualPrintResult=null;
   if(process.env.RM_PRINT_VISUAL){
    await page.emulateMedia({media:'print'});await page.evaluate(async()=>{window.dispatchEvent(new Event('beforeprint'));await document.fonts.ready});
    const actual=await page.screenshot({fullPage:true});
    const baseline=await context.newPage();await baseline.goto(new URL(`${slug}/`,base).href);await baseline.waitForFunction(()=>document.documentElement.classList.contains('rm-active')&&!document.documentElement.classList.contains('rm-pending'));
    await baseline.emulateMedia({media:'print'});await baseline.evaluate(async()=>{window.dispatchEvent(new Event('beforeprint'));await document.fonts.ready});
    const expected=await baseline.screenshot({fullPage:true});
    const [a,b]=await Promise.all([sharp(actual).ensureAlpha().raw().toBuffer({resolveWithObject:true}),sharp(expected).ensureAlpha().raw().toBuffer({resolveWithObject:true})]);
    let changed=null,max=null;if(a.data.length===b.data.length){changed=0;max=0;for(let i=0;i<a.data.length;i+=4){let d=0;for(let j=0;j<3;j++)d=Math.max(d,Math.abs(a.data[i+j]-b.data[i+j]));if(d>3)changed++;max=Math.max(max,d)}}
    visualPrintResult={actual:{width:a.info.width,height:a.info.height},baseline:{width:b.info.width,height:b.info.height},changed,max};
    await baseline.close();await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await page.emulateMedia({media:'screen'});
   }
   let printResult=null;
   if(process.env.RM_PRINT_TEST&&name==='chromium'){
    if(process.env.RM_PRINT_WAIT){await page.emulateMedia({media:'print'});await page.evaluate(async()=>{window.dispatchEvent(new Event('beforeprint'));await document.fonts.ready})}
    const printStarted=Date.now();await page.pdf({path:'/tmp/rm-retained-reader.pdf'});const printDurationMs=Date.now()-printStarted;
    const text=execFileSync('pdftotext',['/tmp/rm-retained-reader.pdf','-'],{encoding:'utf8'});
    const info=execFileSync('pdfinfo',['/tmp/rm-retained-reader.pdf'],{encoding:'utf8'});
    const baseline=await context.newPage();await baseline.goto(new URL(`${slug}/`,base).href);await baseline.waitForFunction(()=>document.documentElement.classList.contains('rm-active')&&!document.documentElement.classList.contains('rm-pending'));await baseline.evaluate(()=>document.fonts.ready);if(process.env.RM_TOGGLE_SINGLE){await baseline.locator('.rm-toggle').click();await baseline.waitForFunction(()=>!document.documentElement.classList.contains('rm-active'))}
    await baseline.evaluate(()=>window.addEventListener('beforeprint',()=>{const read=element=>{const s=getComputedStyle(element),r=element.getBoundingClientRect();return {tag:element.tagName,className:element.className?.toString(),width:r.width,height:r.height,font:s.font,lineHeight:s.lineHeight,display:s.display,position:s.position,transform:s.transform,translate:s.translate,whiteSpace:s.whiteSpace}};const source=document.querySelector('.rm-source'),article=document.querySelector('.rm-article');window.__printProbe={source:read(source),article:read(article),math:[...source.querySelectorAll('mjx-container')].slice(0,4).map(read),deep:[...(source.querySelector('mjx-container')?.querySelectorAll('*')??[])].slice(0,12).map(e=>({tag:e.tagName,cls:e.className,style:e.getAttribute('style'),font:getComputedStyle(e).font,box:e.getBoundingClientRect().toJSON()}))}}));
    if(process.env.RM_PRINT_WAIT){await baseline.emulateMedia({media:'print'});await baseline.evaluate(async()=>{window.dispatchEvent(new Event('beforeprint'));await document.fonts.ready})}
    await baseline.pdf({path:'/tmp/rm-baseline-reader.pdf'});
    const metrics={clone:await page.evaluate(()=>window.__printProbe),baseline:await baseline.evaluate(()=>window.__printProbe)};
    const baselineText=execFileSync('pdftotext',['/tmp/rm-baseline-reader.pdf','-'],{encoding:'utf8'});
    const baselineInfo=execFileSync('pdfinfo',['/tmp/rm-baseline-reader.pdf'],{encoding:'utf8'});await baseline.close();
    if(process.env.RM_PRINT_WAIT)await page.emulateMedia({media:'screen'});
    printResult={pages:/^Pages:\s*(\d+)/m.exec(info)?.[1],characters:text.length,baselinePages:/^Pages:\s*(\d+)/m.exec(baselineInfo)?.[1],baselineCharacters:baselineText.length,sameText:text===baselineText,fontRequests,printDurationMs,frameAfter:await page.evaluate(()=>{const doc=document.querySelector('#rm-kept-reader').contentDocument,p=doc.querySelector('.rm-plane');return {mode:doc.documentElement.classList.contains('rm-active')?'multi':'single',logical:{x:p?.dataset.rmXTicks,y:p?.dataset.rmYTicks}}}),fontProbe:await page.evaluate(()=>window.__fontProbe),metrics};
   }
   if(process.env.RM_ONLY_PRINT){console.log(name,JSON.stringify({printResult}));await context.close();continue;}
   if(exit==='back')await page.goBack();else await page.frameLocator('#rm-kept-reader').locator('.rm-close').click();
   await page.waitForFunction(()=>document.documentElement.dataset.pageKind==='index');await page.waitForTimeout(300);
   const result=await page.evaluate(()=>({saved:sessionStorage.getItem('dispositif:reading-history'),path:location.pathname,scroll:document.querySelector('.article-index-shell').scrollTop,frame:!!document.querySelector('#rm-kept-reader'),active:document.activeElement?.getAttribute('href'),history:history.length,index:history.state?.index}));
   let forward=null;
   if(exit==='back'){
    await page.goForward();await page.waitForFunction(()=>document.documentElement.dataset.pageKind==='article'&&!document.documentElement.classList.contains('rm-pending')&&document.documentElement.classList.contains('rm-active'));
    await page.waitForTimeout(500);
    forward=await page.evaluate(()=>{const p=document.querySelector('.rm-plane');return {path:location.pathname,hash:location.hash,frame:!!document.querySelector('#rm-kept-reader'),logical:{x:p?.dataset.rmXTicks,y:p?.dataset.rmYTicks},layout:p?{viewportWidth:p.parentElement.clientWidth,viewportHeight:p.parentElement.clientHeight,plane:p.getAttribute('style')}:null,key:history.state?.dispositifReadingKey}});
   }
   console.log(name,JSON.stringify({exit,initial,active,result,forward,printResult,visualPrintResult,elapsedMs:Date.now()-beforeClick,preparedPssDifferenceKiB:prepared-before,activePssDifferenceKiB:activePss-before}));
   await context.close();
  }
 }finally{await browser.close()}
}
