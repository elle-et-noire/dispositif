import type { Element, ElementContent, Root } from "hast";

export type Heading = {
  level: 2 | 3;
  id: string;
  // 目次の項目に入れる HTML。見出しの文字と、組版済みの数式だけを含む。
  html: string;
};

// 本文の h2・h3 から目次を作る rehype プラグイン。rehype-slug の後に置き、本文の
// 見出しと同じ木から id と文字を読む。
//
// 目次に載るのは、本文で id を持つ h2・h3 のすべてにする。n段の段組み
// （src/scripts/column-layout.ts）は本文の h2[id], h3[id] から現在の見出しを選んで
// 目次に伝えるので、id を持つのに目次にない見出しがあると、その節ではどの項目も
// 強調されない。
//
// 引用（blockquote）の中の見出しは、引用元の文章の見出しで、記事の節ではないので、
// 目次に入れず、id も外す。
export function rehypeToc({ headings, mathHtml }: { headings: Heading[]; mathHtml: string[] }) {
  return () => (tree: Root) => {
    const visit = (node: Root | Element, quoted: boolean) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        if (quoted && /^h[1-6]$/.test(child.tagName)) {
          delete child.properties.id;
        } else if ((child.tagName === "h2" || child.tagName === "h3") && typeof child.properties.id === "string") {
          headings.push({
            level: child.tagName === "h2" ? 2 : 3,
            id: child.properties.id,
            html: tocHtml(child.children, mathHtml),
          });
        }
        visit(child, quoted || child.tagName === "blockquote");
      }
    };
    visit(tree, false);
  };
}

// 目次の項目はそれ自体がリンクなので、見出しの中のリンクやコードの装飾は持ち込まず
// 文字だけにする。数式（preprocess.ts のプレースホルダー）は、見出しと同じ見た目に
// なるよう、組版済みの CHTML を入れる。ただし \eqref の数式は中にリンクを含むので、
// 見えている文字（「(1)」など）だけにする。
function tocHtml(nodes: ElementContent[], mathHtml: string[]): string {
  return nodes.map((node) => {
    if (node.type === "text") return escapeHtml(node.value);
    if (node.type !== "element") return "";
    const math = node.properties.dataIm ?? node.properties.dataDm;
    if (math !== undefined) {
      const html = mathHtml[Number(math)] ?? "";
      return html.includes("<a ") ? html.replace(/<[^>]*>/g, "") : html;
    }
    return tocHtml(node.children, mathHtml);
  }).join("");
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
