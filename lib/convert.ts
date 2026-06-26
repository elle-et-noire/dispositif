import { createElement } from "react";
import { compileMDX, CompileMDXResult } from "next-mdx-remote/rsc";
import { renderArticleMath } from "@/lib/mathjax";

import { Root } from "hast";
import { visit } from "unist-util-visit";
import { Element } from "hast";

interface ExtendedElement extends Element {
  raw?: string;
}
import remarkGfm from "remark-gfm";
import rehypePrettyCode from "rehype-pretty-code";
// import { transformerLineNumbers } from "@rehype-pretty/transformers";
import rehypeSlug from "rehype-slug";
import { ShikiTransformer } from "shiki";
import { codeTheme } from "@/lib/codeTheme";
import _Link from "@/component/safelink";
// import _Pre from "@/components/_pre";
// import _Image from "@/components/_image";
// import rehypeUnwrapImages from "rehype-unwrap-images";

export const markdownToHtml = async (text: string): Promise<[CompileMDXResult<Record<string, unknown>>, string]> => {
  const spacer = "\\hspace{0.2em}";
  const rsmashers = ["。", "、", "）", "，", "．", " ", "　", "-", "：", "", "(", "（"];
  const lsmashers = ["（", "-", "", ")", "）"];
  // 記事内の数式（区切り記号付きの TeX）を出現順に集める。ビルド時に CHTML へ
  // 一括組版し、各プレースホルダ <Imath>/<Dmath> へ結果 HTML を流し込む。
  const mathexprs: string[] = [];
  let ord = 0;

  const evacuees: { [label: string]: string } = {};
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

  const processible = text.replace(/````[\s\S]*?````|```[\s\S]*?```|``[\s\S]*?``|`[\s\S]*?`/g, (match: string) => { // pre > code
    evacuees["quote" + ord] = match;
    return `<quote${ord++}/>`;
  }).replace(/<!--[\s\S]*?-->/g, (match: string) => `<p className="hidden">{\`${match}\`}</p>`)
    .replace(/(!\[[\s\S]*?\]\([\s\S]*?\))\[([\s\S]*?)(?<!\\)\]/g, (_, p1: string, p2: string) => {
      return `${p1}\n\n<p className="img-caption text-center">${p2}</p>`;
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
      return `<div className="box ${env}">
<div className="title-container">
<span className="box-title">${title}</span>
</div>
<div className="box-content">
${content}
</div>
</div>`;
    }).replace(/:::proof\s(.*)\r?\n([\s\S]*?):::/g, (_, title: string, content: string) => {
      return `<details className="proof"><summary>**証明**${title}</summary><div>${content.replace(/\r?\n/g, "<br/>")}</div></details>`;
    }).replace(/<br>/g, "<br/>")
    .replace(/\[([^\]]+)\]\{([^}]+)\}/g, "<span className='has-tooltip relative items-center'><span className='inline-block tooltip balloon'>$2</span>$1</span>")
    .replace(/\^\[([^\]]+)\]/g, (_, p1: string): string => {
      footnotes += `\n[^${++footnum}]: ${p1}\n`;
      return `<span className='has-tooltip relative items-center no-underline'><span className='inline-block tooltip balloon'>${p1}</span>[^${footnum}]</span>`;
    }).concat(footnotes).replace(/(<(?:inmath|dispmath)\d+\/>)(\r?\n|<br\/>)/g, "$1") // 数式と文章の間の改行による隙間を消す
    .replace(/<((?:inmath|dispmath)\d+)\/>/g, (_, mode: string): string => {
      const display = mode.substring(0, 8) == "dispmath";
      const index = mathexprs.length;
      mathexprs.push(evacuees[mode]); // 区切り記号付きの TeX をそのまま渡す
      return display ? `<Dmath i={${index}}/>` : `<Imath i={${index}}/>`;
    })
    .replace(/<(quote\d+)\/>/g, (_, mode: string) => evacuees[mode].replace(/(^`{3,})([^`\r\n]+)/g, (__, p1: string, p2: string): string => {
      const titles = p2.split(':');
      return p1 + titles[0].replace(/diff\s/, "diff-") + (titles.length > 1 ? ("[data-file='" + titles[1] + "']") : '');
    }).replace(/^(`{3,})mermaid([^`]+)\1/g, "\n<div className='mermaid'>{`%%{init:{'theme':'base','themeVariables':{'primaryColor':'#007777','primaryTextColor':'#f0f6fc','primaryBorderColor':'#008888','secondaryColor':'#145055','tertiaryColor': '#fff0f0','edgeLabelBackground':'#002b3600','lineColor':'#007777CC','noteTextColor':'#e2e8f0','noteBkgColor':'#007777BB','textColor':'#f0f6fc','fontSize':'16px'},'themeCSS':'text.actor {font-size:20px !important;}'}}%%$2`}</div>\n")
    );

  const options = {
    mdxOptions: {
      remarkPlugins: [remarkGfm],
      rehypePlugins: [
        () => (tree: Root) => {
          visit(tree, (node) => {
            if (node?.type === "element" && node?.tagName === "pre") {
              const [codeEl] = node.children;
              if (codeEl.type === "element") {
                if (codeEl.tagName == "code") {
                  const child = codeEl.children?.[0];
                  if (child && child.type === "text") {
                    const s = child.value;
                    if (typeof s === "string")
                      (node as Element & { raw?: string }).raw = s.slice(0, -1); // trailing breakline
                  }
                }
              }
            }
          });
        },
        [rehypePrettyCode, {
          // Zenn を模した単一のダークテーマ。地色は globals.css の .post pre（#1a2638）に
          // 任せ、トークン色だけこのテーマで塗る。
          theme: codeTheme,
          keepBackground: false,
          transformers: [
            // transformerLineNumbers({ autoApply: true }),
          ],
        }] as [typeof rehypePrettyCode, { theme: typeof codeTheme; keepBackground: boolean; transformers: ShikiTransformer[] }],
        () => (tree: Root) => {
          visit(tree, (node) => {
            if (node?.type === "element" && node?.tagName === "figure") {
              if (!("data-rehype-pretty-code-figure" in node.properties)) return;

              for (const child of node.children) {
                if (child.type === "element" && child.tagName === "pre") {
                  (child as ExtendedElement).properties["raw"] = (node as ExtendedElement).raw;
                }
              }
            }
          });
        },
        rehypeSlug,
        // rehypeUnwrapImages
      ],
    },
  };

  // 収集した数式をビルド時に一括で CHTML へ組版する。Imath/Dmath は組版済み
  // HTML をそのまま埋め込む（クライアントで MathJax は動かない）。
  const { html: mathHtml, css } = await renderArticleMath(mathexprs);
  const Imath = ({ i }: { i: number }) =>
    createElement("span", { dangerouslySetInnerHTML: { __html: mathHtml[i] ?? "" } });
  const Dmath = ({ i }: { i: number }) =>
    createElement("span", { className: "scrollable", dangerouslySetInnerHTML: { __html: mathHtml[i] ?? "" } });

  const mdx = await compileMDX({
    source: processible,
    options: { ...options, blockJS: false },
    components: {
      a: _Link,
      // pre: _Pre,
      // img: _Image,
      Imath,
      Dmath,
    }
  });

  return [mdx, css];
};