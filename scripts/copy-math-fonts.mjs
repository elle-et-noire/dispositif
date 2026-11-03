// MathJax CHTML の数式フォント (woff2) を、第三者 CDN（jsdelivr）ではなく自前ホスト
// （同一オリジン）で配信するために node_modules から public/fonts/mjx/ へコピーする。
//
// サイト全体の方針（本文・コードフォントの自前ホスト：scripts/generate-fonts.mjs）に
// 合わせる。数式フォントは最重量資産（mjx-tex-n.woff2 ≈ 161KB）で、これを同一オリジンに
// 置くことで jsdelivr への DNS+TLS+コネクション確立が消え、HTML を返した HTTP/2 接続へ
// 多重化される（lib/mathjax.ts の FONT_URL / Layout.astro の preload と対応）。
//
// 出力（public/fonts/mjx/*.woff2）は @mathjax/mathjax-tex-font（依存パッケージ）から
// その場でコピーするだけなので、本文フォントのサブセットと違いコミットせず、predev /
// prebuild で毎回生成する（フォントのバージョン更新に自動追随する）。

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const require = createRequire(import.meta.url);

// @mathjax/mathjax-tex-font の chtml/woff2 ディレクトリを実体パスで特定する。
// package.json を resolve してそこからの相対で辿る（exports に依らない）。
const pkgJson = require.resolve("@mathjax/mathjax-tex-font/package.json");
const srcDir = join(dirname(pkgJson), "chtml", "woff2");
const outDir = join(root, "public", "fonts", "mjx");

// Keep this directory and unchanged files alive while Astro is watching public/.
// Removing/recreating it can leave Vite's public-file index without these fonts,
// making a running dev server return 404 even though the files exist on disk.
mkdirSync(outDir, { recursive: true });
const fontNames = readdirSync(srcDir).filter((name) => name.endsWith(".woff2"));
const expected = new Set(fontNames);
for (const name of readdirSync(outDir)) {
  if (name.endsWith(".woff2") && !expected.has(name)) rmSync(join(outDir, name));
}

let count = 0;
let bytes = 0;
let copied = 0;
for (const name of fontNames) {
  const source = join(srcDir, name);
  const dest = join(outDir, name);
  if (!existsSync(dest) || !readFileSync(source).equals(readFileSync(dest))) {
    cpSync(source, dest);
    copied++;
  }
  bytes += statSync(dest).size;
  count++;
}

console.log(`[copy-math-fonts] synced ${count} woff2 (${bytes} bytes, ${copied} copied) -> public/fonts/mjx/`);
