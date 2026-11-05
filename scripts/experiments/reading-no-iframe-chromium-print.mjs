// Requires a built site and poppler's pdfinfo/pdftotext.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
const outputDir = mkdtempSync('/tmp/dispositif-no-iframe-chromium-print-');
const base=process.env.RM_BASE_URL??'http://127.0.0.1:4333/dispositif/';
const browser=await chromium.launch();
try{
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>localStorage.setItem('dispositif:reading-mode','multi'));
  const page=await context.newPage();await page.goto(base);const link=page.locator('a[href$="symmetric-polynomial/"]');await link.hover();
  await page.waitForTimeout(1500);await link.click();
  await page.waitForFunction(()=>location.pathname.endsWith('/symmetric-polynomial/')&&document.documentElement.classList.contains('rm-active')&&!document.documentElement.classList.contains('rm-pending'));
  await page.keyboard.press('ArrowRight');await page.waitForTimeout(150);
  const point=await page.evaluate(()=>{const p=document.querySelector('.rm-plane');return [p.dataset.rmXTicks,p.dataset.rmYTicks]});
  await page.pdf({path:`${outputDir}/list.pdf`});
  const after=await page.evaluate(()=>{const d=document,p=d.querySelector('.rm-plane');return {active:d.documentElement.classList.contains('rm-active'),point:[p.dataset.rmXTicks,p.dataset.rmYTicks]}});
  const baseline=await context.newPage();await baseline.goto(new URL('symmetric-polynomial/',base).href);
  await baseline.waitForFunction(()=>document.documentElement.classList.contains('rm-active')&&!document.documentElement.classList.contains('rm-pending'));await baseline.evaluate(()=>document.fonts.ready);
  await baseline.pdf({path:`${outputDir}/direct.pdf`});
  const text=path=>execFileSync('pdftotext',[path,'-'],{encoding:'utf8'});
  const pages=path=>Number(/^Pages:\s*(\d+)/m.exec(execFileSync('pdfinfo',[path],{encoding:'utf8'}))?.[1]);
  const a=`${outputDir}/list.pdf`,b=`${outputDir}/direct.pdf`;
  console.log(JSON.stringify({outputDir,pages:pages(a),normalPages:pages(b),sameText:text(a)===text(b),before:point,after}));
  await context.close();
}finally{await browser.close()}
