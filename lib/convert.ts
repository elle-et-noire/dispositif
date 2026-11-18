import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypePrettyCode from "rehype-pretty-code";
import { transformerLineNumbers } from "@rehype-pretty/transformers";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { ShikiTransformer } from "shiki";
import type { Root, Element } from "hast";

import { preprocessMarkdown } from "./preprocess";
import { renderArticleMath } from "./mathjax";
import { mathFontFaces, type MathFont } from "./math-fonts";
import { withBase } from "./base";
import { rehypeToc, type Heading } from "./toc";

// 記事の相対リンクはどのページで解決しても公開サイトと同じオリジンになる。
// Astro のサイト設定はビルド全体で共通なので、変換結果を本文だけで共有できる。
function rehypeSafeLinks() {
  const site = new URL(import.meta.env.SITE);
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "a") return;
      const { href, target, rel } = node.properties;
      if (typeof href !== "string") return;
      if (href === "") {
        node.properties.href = withBase();
        return;
      }
      if (target !== undefined) return;

      const url = URL.parse(href, site);
      if (url && (url.protocol === "http:" || url.protocol === "https:") && url.origin === site.origin) return;

      // mailto: なども従来どおり新規タブの属性を付ける。
      node.properties.target = "_blank";
      node.properties.rel = [...new Set([...(rel ?? []), "noopener", "noreferrer"])];
    });
  };
}

// Markdown から生成されたルート相対 URL に Astro の base を付ける。
// .astro 内のリンクと異なり、Markdown 本文の /foo はビルド時に自動変換されないため、
// GitHub Pages のプロジェクトサイトでは /dispositif/foo に補正する必要がある。
// GFM のタスクリストのチェックボックスに、項目の文を名前として付ける。remark-gfm の
// 出力のままでは名前がなく、スクリーンリーダーで部品を一覧すると、名前のない
// チェックボックスが並ぶ。チェックボックスと、その後の文（入れ子のリストの手前まで）を
// <label> で包む。id を使わないので、n段の複製で id を外しても関係が壊れない。
function rehypeTaskListLabels() {
  const block = /^(?:ul|ol|p|div|pre|figure|blockquote|table|details|h[1-6])$/;
  const isTaskItem = (node: Element | Root | undefined) => node?.type === "element" && node.tagName === "li"
    && [node.properties.className ?? []].flat().includes("task-list-item");
  return (tree: Root) => {
    // 項目が段落を持つ（項目の間に空行がある）リストでは、チェックボックスは段落の中にある。
    visit(tree, "element", (node: Element, _, parent) => {
      if (!isTaskItem(node) && !(node.tagName === "p" && isTaskItem(parent))) return;
      const i = node.children.findIndex((child) => child.type === "element" && child.tagName === "input"
        && child.properties.type === "checkbox");
      if (i < 0) return;
      let end = i + 1;
      while (end < node.children.length) {
        const child = node.children[end];
        if (child.type === "element" && block.test(child.tagName)) break;
        end++;
      }
      const label: Element = { type: "element", tagName: "label", properties: {}, children: node.children.slice(i, end) };
      node.children.splice(i, end - i, label);
    });
  };
}

function rehypeBasePaths() {
  const base = withBase();
  const baseWithoutTrailingSlash = base.replace(/\/$/, "");

  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      const property = node.tagName === "a" ? "href" : node.tagName === "img" ? "src" : null;
      if (!property) return;

      const value = node.properties?.[property];
      if (
        typeof value !== "string"
        || !value.startsWith("/")
        || value.startsWith("//")
        || base === "/"
        || value === baseWithoutTrailingSlash
        || value.startsWith(`${baseWithoutTrailingSlash}/`)
      ) {
        return;
      }
      node.properties[property] = withBase(value);
    });
  };
}

// 本文画像の最適化。
//   - loading=lazy / decoding=async：画面外の（外部ホストの）画像が初期ロードと
//     メインスレッドを塞がないようにする。
//   - src 末尾の `#{width}_{height}`（post/how-to-write.md に記載の記法）を width/height 属性へ
//     変換し、読み込み前から表示領域を確保してレイアウトシフト（CLS）を防ぐ。
//     アスペクト比の維持は globals.css の `.post img { height: auto }` が担う。
function rehypeArticleImages() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "img") return;
      node.properties.loading ??= "lazy";
      node.properties.decoding ??= "async";
      const src = node.properties.src;
      if (typeof src !== "string") return;
      const size = src.match(/#(\d+)_(\d+)$/);
      if (size) {
        node.properties.src = src.slice(0, -size[0].length);
        node.properties.width = Number(size[1]);
        node.properties.height = Number(size[2]);
      }
    });
  };
}

export type Converted = {
  // 本文の HTML 文字列（数式は CHTML として埋め込み済み）。
  html: string;
  // この記事で実際に使われたグリフぶんの CHTML スタイルシート。
  css: string;
  // 目次の項目（本文の h2・h3）。
  headings: Heading[];
};

// 記事ページと、全ページに入る記事一覧（各記事の数式フォント）の両方が同じ記事を変換する。
// 同じサイト設定の下では、同じ本文の変換を 1 回にまとめる。
const converted = new Map<string, Promise<Converted>>();

export const markdownToHtml = (text: string): Promise<Converted> => {
  let result = converted.get(text);
  if (!result) {
    result = convert(text);
    converted.set(text, result);
    // 失敗した変換は再試行できるよう残さない。
    result.catch(() => converted.delete(text));
  }
  return result;
};

/** この記事の数式表示で読み込まれるフォント（数式がなければ空）。 */
export const articleMathFonts = async (text: string): Promise<MathFont[]> => {
  const { html, css } = await markdownToHtml(text);
  return mathFontFaces(html, css);
};

const convert = async (text: string): Promise<Converted> => {
  // 数式・独自記法の前処理（lib/preprocess.ts）。数式は出現順の mathexprs へ収集され、
  // 本文にはプレースホルダ（data-im / data-dm の span）が残る。
  const { processible, mathexprs } = preprocessMarkdown(text);

  // 収集した数式をビルド時に一括で CHTML へ組版する。
  const { html: mathHtml, css } = await renderArticleMath(mathexprs);
  const headings: Heading[] = [];

  // remark/rehype パイプライン。remark-gfm → rehype-pretty-code → rehype-slug を通し、
  // HTML 文字列にする。前処理で差し込んだ生 HTML（details/box/span/プレースホルダ）は
  // remark-rehype の allowDangerousHtml + rehype-raw で本物のノードへ変換する。
  // rehype-pretty-code は rehype-raw より前に走らせ、コードフェンスの meta（言語・
  // ファイル名）が失われないようにする。
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypePrettyCode, {
      // weekly-rundemo と同じ既定テーマ（github-dark-dimmed）と行番号表示。
      // 地色は globals.css の .post pre に任せ、トークン色だけテーマから使う。
      keepBackground: false,
      transformers: [
        transformerLineNumbers({ autoApply: true }) as ShikiTransformer,
      ],
    })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeToc({ headings, mathHtml }))
    .use(rehypeSafeLinks)
    .use(rehypeArticleImages)
    .use(rehypeTaskListLabels)
    .use(rehypeBasePaths)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(processible);

  // 組版済み CHTML をプレースホルダへ流し込む。Dmath は横スクロール可能な
  // span.scrollable で包む。Imath は包まない。包む要素は表示を変えず、数式記事では
  // スタイル計算とレイアウトをする要素と、n段で複製する要素を増やすだけだったため。
  const html = String(file)
    .replace(/<span data-im="(\d+)"><\/span>/g, (_, i: string) => mathHtml[Number(i)] ?? "")
    .replace(/<span data-dm="(\d+)"><\/span>/g, (_, i: string) => `<span class="scrollable">${mathHtml[Number(i)] ?? ""}</span>`);

  return { html, css, headings };
};
