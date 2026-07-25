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

import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
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

// 古い版が残らないよう一度作り直す。
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let count = 0;
let bytes = 0;
for (const name of readdirSync(srcDir)) {
  if (!name.endsWith(".woff2")) continue;
  const dest = join(outDir, name);
  cpSync(join(srcDir, name), dest);
  bytes += statSync(dest).size;
  count++;
}

console.log(`[copy-math-fonts] copied ${count} woff2 (${bytes} bytes) -> public/fonts/mjx/`);
