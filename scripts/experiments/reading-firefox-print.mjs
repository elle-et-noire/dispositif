// Firefox's Marionette WebDriver print command exports actual PDFs in headless mode.
// Run against a local production preview: RM_BASE_URL=http://127.0.0.1:4597/dispositif/
import { spawn, execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const base = process.env.RM_BASE_URL ?? 'http://127.0.0.1:4597/dispositif/';
const bin = process.env.RM_FIREFOX ?? `${process.env.HOME}/.cache/ms-playwright/firefox-1555/firefox/firefox`;
const profile = mkdtempSync(join(tmpdir(), 'rm-marionette-'));
writeFileSync(join(profile,'user.js'), 'user_pref("marionette.port", 2828);\n');
const browser = spawn(bin, ['-headless', '-no-remote', '-profile', profile, '-marionette'], {stdio:'ignore'});
let socket;
try {
  for (let i=0; i<100; i++) {
    try { socket = await new Promise((resolve, reject) => { const s=connect(2828,'127.0.0.1',()=>resolve(s)); s.once('error',reject); }); break; }
    catch { await delay(100); }
  }
  if (!socket) throw new Error('Firefox Marionette did not start');
  let buffer=Buffer.alloc(0), waiting=[];
  socket.on('data', chunk => {
    buffer=Buffer.concat([buffer,chunk]);
    while (true) { const colon=buffer.indexOf(58); if (colon<0) break; const length=Number(buffer.subarray(0,colon).toString());
      if (buffer.length < colon+1+length) break;
      const message=JSON.parse(buffer.subarray(colon+1,colon+1+length).toString()); buffer=buffer.subarray(colon+1+length);
      const next=waiting.shift(); if (next) next.resolve(message);
    }
  });
  const receive=()=>new Promise((resolve,reject)=>waiting.push({resolve,reject}));
  await receive(); let id=0;
  const command=async (name, params={}) => { const message=JSON.stringify([0,++id,name,params]); const reply=receive(); socket.write(`${Buffer.byteLength(message)}:${message}`); const response=await reply; if (response[2]) throw new Error(`${name}: ${JSON.stringify(response[2])}`); return response[3]; };
  const execute=async script => (await command('WebDriver:ExecuteScript',{script,args:[],newSandbox:true})).value;
  const wait=async (script, timeout=30000) => { const until=Date.now()+timeout; while (Date.now()<until) { if (await execute(`return (${script})`)) return; await delay(100); } throw new Error(`Timed out: ${script}`); };
  await command('WebDriver:NewSession',{capabilities:{}});
  await command('WebDriver:SetWindowRect',{width:1440,height:900});
  await command('WebDriver:Navigate',{url:base});
  await execute("localStorage.setItem('dispositif:reading-mode','multi'); return true;");
  await command('WebDriver:Navigate',{url:base});
  await execute("document.querySelector('a[href$=\"symmetric-polynomial/\"]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'})); return true;");
  await wait("!!document.querySelector('html > iframe[data-rm-preload-ready]')",60000);
  await execute("document.querySelector('a[href$=\"symmetric-polynomial/\"]').click(); return true;");
  await wait("location.pathname.endsWith('/symmetric-polynomial/') && !!document.querySelector('html > iframe[data-rm-prepared-reader]')");
  await execute("return document.fonts.ready.then(()=>true)");
  const prepared=await command('WebDriver:Print',{}); writeFileSync('/tmp/rm-firefox-prepared.pdf',Buffer.from(prepared.value,'base64'));
  await command('WebDriver:Navigate',{url:`${base}symmetric-polynomial/`});
  await wait("document.documentElement.classList.contains('rm-active') && !document.documentElement.classList.contains('rm-pending')");
  await execute("return document.fonts.ready.then(()=>true)");
  const normal=await command('WebDriver:Print',{}); writeFileSync('/tmp/rm-firefox-normal.pdf',Buffer.from(normal.value,'base64'));
  const info = path => execFileSync('pdfinfo',[path],{encoding:'utf8'}).match(/^Pages:\s+(\d+)/m)?.[1];
  const text = path => execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});
  const preparedPath='/tmp/rm-firefox-prepared.pdf', normalPath='/tmp/rm-firefox-normal.pdf';
  console.log(JSON.stringify({preparedPages:info(preparedPath), normalPages:info(normalPath), sameText:text(preparedPath)===text(normalPath), preparedBytes:readFileSync(preparedPath).length, normalBytes:readFileSync(normalPath).length}));
  await command('WebDriver:DeleteSession');
} finally { socket?.destroy(); browser.kill(); await new Promise(resolve=>browser.once('exit',resolve)); rmSync(profile,{recursive:true,force:true}); }
