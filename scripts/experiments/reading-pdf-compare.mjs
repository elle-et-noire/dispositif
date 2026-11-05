// Actual PDF text and every page's raster; requires Poppler, no browser mocks.
// Usage: node scripts/experiments/reading-pdf-compare.mjs A.pdf B.pdf
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const [a,b] = process.argv.slice(2);
if (!a || !b) throw new Error('Expected two PDF paths');
const dir=mkdtempSync(join(tmpdir(),'rm-pdf-raster-'));
try {
  const pages = path => Number(/^Pages:\s+(\d+)/m.exec(execFileSync('pdfinfo',[path],{encoding:'utf8'}))?.[1]);
  const text = path => execFileSync('pdftotext',['-layout',path,'-']);
  execFileSync('pdftoppm',['-r','72',a,join(dir,'a')]);
  execFileSync('pdftoppm',['-r','72',b,join(dir,'b')]);
  const aFiles=readdirSync(dir).filter(name=>name.startsWith('a-')).sort();
  const bFiles=readdirSync(dir).filter(name=>name.startsWith('b-')).sort();
  const rasterEqual=aFiles.length===bFiles.length && aFiles.every((name,i)=>readFileSync(join(dir,name)).equals(readFileSync(join(dir,bFiles[i]))));
  const result={a,b,aPages:pages(a),bPages:pages(b),sameText:text(a).equals(text(b)),rasterPages:aFiles.length,allPageRastersEqual:rasterEqual,dpi:72};
  console.log(JSON.stringify(result));
  assert.ok(Number.isInteger(result.aPages) && result.aPages > 0);
  assert.equal(result.aPages,result.bPages);
  assert.equal(aFiles.length,result.aPages);
  assert.equal(bFiles.length,result.bPages);
  assert.equal(result.sameText,true);
  assert.equal(result.allPageRastersEqual,true);
} finally { rmSync(dir,{recursive:true,force:true}); }
