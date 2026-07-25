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
import { withBase } from "./base";

// 本文リンクの安全化。Next 版の component/safelink.tsx と同じ方針：
// 外部リンク（/ や # で始まらない）は新規タブで開き rel を付ける。
// 空 href はサイトのベースURLへ向ける。
function rehypeSafeLinks() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "a") return;
      let href = node.properties?.href;
      if (typeof href !== "string") return;
      if (href === "") {
        href = withBase();
        node.properties.href = href;
      }
      if (!href.startsWith("/") && !href.startsWith("#")) {
        node.properties.target = "_blank";
        node.properties.rel = ["noopener", "noreferrer"];
      }
    });
  };
}

// Markdown から生成されたルート相対 URL に Astro の base を付ける。
// .astro 内のリンクと異なり、Markdown 本文の /foo はビルド時に自動変換されないため、
// GitHub Pages のプロジェクトサイトでは /dispositif/foo に補正する必要がある。
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
//   - src 末尾の `#{width}_{height}`（howtowrite.md に記載の記法）を width/height 属性へ
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
};

export const markdownToHtml = async (text: string): Promise<Converted> => {
  // 数式・独自記法の前処理（lib/preprocess.ts）。数式は出現順の mathexprs へ収集され、
  // 本文にはプレースホルダ（data-im / data-dm の span）が残る。
  const { processible, mathexprs } = preprocessMarkdown(text);

  // 収集した数式をビルド時に一括で CHTML へ組版する。
  const { html: mathHtml, css } = await renderArticleMath(mathexprs);

  // remark/rehype パイプライン。Next 版（next-mdx-remote の compileMDX）と同じく
  // remark-gfm → rehype-pretty-code → rehype-slug を通すが、出力は React ではなく
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
    .use(rehypeSafeLinks)
    .use(rehypeArticleImages)
    .use(rehypeBasePaths)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(processible);

  // 組版済み CHTML をプレースホルダへ流し込む。Imath は素の span、Dmath は
  // 横スクロール可能な span.scrollable で包む（Next 版の Imath/Dmath と同じ）。
  const html = String(file)
    .replace(/<span data-im="(\d+)"><\/span>/g, (_, i: string) => `<span>${mathHtml[Number(i)] ?? ""}</span>`)
    .replace(/<span data-dm="(\d+)"><\/span>/g, (_, i: string) => `<span class="scrollable">${mathHtml[Number(i)] ?? ""}</span>`);

  return { html, css };
};
