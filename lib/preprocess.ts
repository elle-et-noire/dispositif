// Markdown 本文の前処理。remark/rehype パイプラインに渡す前に、
//   1. コードフェンス・インラインコードを退避（数式処理の誤爆防止）
//   2. 数式（$ / \( \) / \[ \] / $$ / \begin…\end）を収集してプレースホルダ化
//   3. 独自記法（:::details / :::def / :::thm / :::proof、[語]{注釈}、^[脚注]）を HTML へ展開
// を行う。数式まわりは「$ の開閉判定」「日本語句読点に応じたスペーシング」を担う
// 状態機械で、この一連の replace チェーンは順序に意味がある（丸ごと 1 つの処理単位）。

import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

const markdownParser = unified().use(remarkParse).use(remarkGfm);

function fenceInfo(source: string): string {
  return source.replace(/^(`{3,}|~{3,})([^`\r\n]+)/, (_, fence: string, info: string) => {
    const [language, file] = info.split(":");
    return fence + language.replace(/diff\s/, "diff-") + (file === undefined ? "" : `[data-file='${file}']`);
  });
}

export type Preprocessed = {
  // プレースホルダ（<span data-im/dm>）と展開済み HTML を含む、パイプラインに渡す本文。
  processible: string;
  // 出現順に収集した、区切り記号付きの TeX 数式。data-im/data-dm の番号と対応する。
  mathexprs: string[];
};

export function preprocessMarkdown(text: string): Preprocessed {
  const spacer = "\\hspace{0.2em}";
  const rsmashers = ["。", "、", "）", "，", "．", " ", "　", "-", "：", "", "(", "（"];
  const lsmashers = ["（", "-", "", ")", "）"];
  // 記事内の数式（区切り記号付きの TeX）を出現順に集める。ビルド時に CHTML へ
  // 一括組版し、各プレースホルダ（data-im / data-dm の span）へ結果 HTML を流し込む。
  const mathexprs: string[] = [];
  let ord = 0;

  const evacuees: { [label: string]: string } = {};
  // 空行のない旧記法の details も、下で空行を足した後は Markdown として読む。
  // コードを探すときだけその開始行を空行に見せ、ソース位置と行頭の引用記号を保つ。
  const parserInput = text.replace(
    /^((?: {0,3}>[ \t]?)* {0,3})(<details[^>\r\n]*><summary>[^\r\n]*?<\/summary>)(?=[ \t]*\r?$)/gm,
    (_, prefix: string, opening: string) => prefix + " ".repeat(opening.length),
  );
  let protectedText = "";
  let cursor = 0;
  visit(markdownParser.parse(parserInput), ["code", "inlineCode"], (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const block = node.type === "code";
    const label = (block ? "blockcode" : "inlinecode") + ord++;
    const source = text.slice(start, end);
    evacuees[label] = node.type === "code" && node.lang ? fenceInfo(source) : source;
    protectedText += text.slice(cursor, start) + `<${label}/>`;
    cursor = end;
  });
  protectedText += text.slice(cursor);

  // offset は $ 基準
  const opener = (string: string, offset: number) => rsmashers.includes(string.substring(offset - 1, offset)) ? "\\(" : "\\(" + spacer;
  const closer = (string: string, offset: number) => lsmashers.includes(string.substring(offset + 1, offset + 2)) ? "\\)" : spacer + "\\)";

  // $ で挟まれた文中数式
  let opnum = 0, clnum = 0;
  let nextop = true; // 次にくる $ の開 or 閉
  // 脚注
  let footnotes = "\n";
  let footnum = 0;

  let rear = -1;  // dispmath の直下では rear = -1
  // /(?<=\\\\|[^\\\$]|^)\$(?!\$)/g と組み合わせる replacer。数式チャンク中で $ のスペーシングを行う
  const dollarspacer = (_: string, offset: number, string: string) => {
    if (rear == -1) {
      rear = offset;
      nextop = true;
      return opener(string, offset);
    }
    if (opnum == clnum && nextop) {
      rear = -1;
      return closer(string, offset);
    }
    const between = string.substring(rear, offset);
    const op = (between.match(/(?<!\\)\{/g) || []).length;
    const cl = (between.match(/(?<!\\)\}/g) || []).length;
    if (op == cl) nextop = !nextop;
    else nextop = op > cl;
    opnum += op;
    clnum += cl;
    rear = offset;
    return (nextop ? opener(string, offset) : closer(string, offset));
  }

  const processible = protectedText.replace(/<!--[\s\S]*?-->/g, () => "") // インラインのコメントは取り除く
    // Next.js/MDX 版の記事に残っている文字列式を、通常の Markdown/HTML として
    // 読める形へ戻す。コードは上で退避済みなので、掲載コードには作用しない。
    .replace(
      /\{`([^`]*)`\}|\{'([^']*)'\}|\{"([^"]*)"\}/g,
      (_, a: string | undefined, b: string | undefined, c: string | undefined) =>
        a ?? b ?? c ?? "",
    )
    // HTML の details 内にも Markdown（コードフェンス等）が書かれている。
    // 開閉タグとの間に空行を置き、remark が中身を Markdown として解析できるようにする。
    .replace(/<details([^>]*)><summary>([\s\S]*?)<\/summary>\s*/g, "<details$1><summary>$2</summary>\n\n")
    .replace(/\s*<\/details>/g, "\n\n</details>")
    .replace(/(!\[[\s\S]*?\]\([\s\S]*?\))\[([\s\S]*?)(?<!\\)\]/g, (_, p1: string, p2: string) => {
      return `${p1}\n\n<p class="img-caption text-center">${p2}</p>`;
    }).replace(/\\\(/g, (_, offset: number, string: string) => opener(string, offset))
    .replace(/\\\)/g, (_, offset: number, string: string) => closer(string, offset + 1))
    .replace(/\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\\begin\{([^\}]*)\}[\s\S]*?\\end\{\1\}/g, (math: string) => {
      rear = -1;  // dispmath の直下では rear = -1
      // ここでは nextop はマッチした $ の開 or 閉
      evacuees["dispmath" + ord] = math.replace(/(?<=\\\\|[^\\\$]|^)\$(?!\$)/g, dollarspacer);
      opnum = clnum = 0;
      nextop = true;
      return `<dispmath${ord++}/>`;
    }).replace(/\\\([\s\S]*?\\\)/g, (match: string) => { // \( \) のスペーシングは既に行われている
      rear = -1;
      evacuees["inmath" + ord] = match.replace(/(?<=\\\\|[^\\\$]|^)\$(?!\$)/g, dollarspacer);
      return `<inmath${ord++}/>`;
    }).concat(" $").replace(/(?<=\\\\|[^\\]|^)\$([\s\S]*?(?:\\\\|[^\\]))(?=\$)/g, (match: string, p1: string, offset: number, string: string) => {
      if (opnum == clnum) {
        if (!nextop) {
          evacuees[`inmath${ord++}`] += closer(string, offset);
          nextop = true;
          return p1;
        } else
          evacuees[`inmath${ord}`] = "";
      }
      const op = (match.match(/(?<!\\)\{/g) || []).length;
      const cl = (match.match(/(?<!\\)\}/g) || []).length;
      evacuees[`inmath${ord}`] += (nextop ? opener(string, offset) : closer(string, offset)) + p1;
      if (op == cl) nextop = !nextop;
      else nextop = op > cl;
      opnum += op;
      clnum += cl;
      return (opnum > clnum ? "" : `<inmath${ord}/>`);
    }).replace(/\s\$/, "").replace(/\\(eq)?ref\{[^}]*\}/g, (match: string) => {
      evacuees[`inmath${ord}`] = match;
      return `<inmath${ord++}/>`;
    }).replace(/:::details\s(.*)\r?\n([\s\S]*?):::/g, (_, title: string, content: string) => {
      return `<details><summary>${title}</summary>${content.replace(/\r?\n/g, "<br/>")}</details>`;
    }).replace(/:::(def|thm)\s(.*)\r?\n([\s\S]*?):::/g, (_, env: string, title: string, content: string) => {
      return `<div class="box ${env}">
<div class="title-container">
<span class="box-title">${title}</span>
</div>
<div class="box-content">
${content}
</div>
</div>`;
    }).replace(/:::proof\s(.*)\r?\n([\s\S]*?):::/g, (_, title: string, content: string) => {
      return `<details class="proof"><summary>**証明**${title}</summary><div>${content.replace(/\r?\n/g, "<br/>")}</div></details>`;
    }).replace(/<br>/g, "<br/>")
    .replace(/\[([^\]]+)\]\{([^}]+)\}/g, "<span class='has-tooltip relative items-center'><span class='inline-block tooltip balloon'>$2</span>$1</span>")
    .replace(/\^\[([^\]]+)\]/g, (_, p1: string): string => {
      footnotes += `\n[^${++footnum}]: ${p1}\n`;
      return `<span class='has-tooltip relative items-center no-underline'><span class='inline-block tooltip balloon'>${p1}</span>[^${footnum}]</span>`;
    }).concat(footnotes)
    // 数式と文章の間の隙間を詰め、コードブロックの開始行は保つ。
    .replace(/(<(?:inmath|dispmath)\d+\/>)(\r?\n|<br\/>)(?!(?:[ \t>]*\r?\n)*[^<\r\n]*<blockcode\d+\/>)/g, "$1")
    .replace(/<((?:inmath|dispmath)\d+)\/>/g, (_, mode: string): string => {
      const display = mode.substring(0, 8) == "dispmath";
      const index = mathexprs.length;
      mathexprs.push(evacuees[mode]); // 区切り記号付きの TeX をそのまま渡す
      // 組版済み CHTML をあとから流し込むための空プレースホルダ。
      return display ? `<span data-dm="${index}"></span>` : `<span data-im="${index}"></span>`;
    })
    .replace(/<((?:blockcode|inlinecode)\d+)\/>/g, (_, label: string) => evacuees[label]);

  // $ の数式の波括弧が閉じないまま本文が終わると、上の置換は残りの本文をすべて
  // その数式に取り込み、本文から消してしまう。報告には、記事内で検索できるよう、
  // 取り込みの始まりの $…$ を書かれた形で出す。
  if (opnum > clnum) {
    const [, head] = evacuees[`inmath${ord}`].split(/\\[()]/);
    throw new Error(`数式の波括弧が閉じていません。\n$${head.replace(spacer, "")}$`);
  }

  return { processible, mathexprs };
}
