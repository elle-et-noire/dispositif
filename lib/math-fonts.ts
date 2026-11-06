// 記事の数式表示で実際に使われる MathJax フォント（woff2）の名前と URL を、ビルド時に求める。
//
// CHTML のスタイルシートには、使わないものも含めて全フォントの @font-face が入る。
// ブラウザーがダウンロードするのは、本文の要素に当たる規則が参照するフォントだけである。
// そこで、スタイルシートの規則のうち font-family で @font-face のフォントを参照するものを
// 集め、その規則の対象（class または要素名）が本文 HTML に現れるかで判定する。
// フォント名とファイル名の対応は @font-face から読み、命名規則を仮定しない。
//
// 一覧の記事リンクは、この一覧をホバー時に先読みする（src/scripts/math-font-prefetch.ts）。
// 先読みしないと、数式フォントがレイアウト中に順に見つかって読み込まれ、そのたびに
// レイアウトし直しになる。

type Rule = { selector: string; families: string[] };

const unquote = (value: string) => value.trim().replace(/^["']|["']$/g, "");

const fontFamilies = (body: string) => {
  const match = /font-family\s*:\s*([^;}]+)/.exec(body);
  if (!match) return [];
  return match[1].replace(/!important/g, "").split(",").map(unquote).filter(Boolean);
};

function parse(css: string) {
  const faces = new Map<string, string>();
  const rules: Rule[] = [];
  // Comments can sit between "@font-face" and "{" in MathJax's output.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    const body = match[2];
    if (selector === "@font-face") {
      const family = fontFamilies(body)[0];
      const url = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(body)?.[1];
      if (family && url) faces.set(family, url);
    } else {
      const families = fontFamilies(body);
      if (families.length) rules.push({ selector, families });
    }
  }
  return { faces, rules };
}

// The last compound selector decides which element a rule styles. A rule only
// counts when that element (by class or by tag name) occurs in the HTML.
function targets(selector: string, classes: Set<string>, tags: Set<string>) {
  return selector.split(",").some((part) => {
    const last = part.trim().split(/[\s>+~]+/).at(-1) ?? "";
    const tag = /^[a-z][\w-]*/i.exec(last)?.[0]?.toLowerCase();
    const required = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    if (tag && !tags.has(tag)) return false;
    if (required.some((name) => !classes.has(name))) return false;
    return Boolean(tag || required.length);
  });
}

export type MathFont = { family: string; url: string };

/** The math fonts that the article's HTML uses, in stylesheet order. */
export function mathFontFaces(html: string, css: string): MathFont[] {
  if (!css) return [];
  const { faces, rules } = parse(css);
  if (!faces.size) return [];
  const classes = new Set<string>();
  for (const match of html.matchAll(/\bclass\s*=\s*"([^"]*)"/g)) {
    for (const name of match[1].split(/\s+/)) if (name) classes.add(name);
  }
  const tags = new Set([...html.matchAll(/<([a-z][\w-]*)/gi)].map((m) => m[1].toLowerCase()));
  const used = new Set<string>();
  for (const rule of rules) {
    if (!rule.families.some((family) => faces.has(family))) continue;
    if (!targets(rule.selector, classes, tags)) continue;
    for (const family of rule.families) if (faces.has(family)) used.add(family);
  }
  return [...faces].filter(([family]) => used.has(family)).map(([family, url]) => ({ family, url }));
}
