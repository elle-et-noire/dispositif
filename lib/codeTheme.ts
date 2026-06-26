import type { RawThemeSetting, ThemeRegistrationRaw } from "shiki";

/* コードハイライトをサイトの世界観に合わせた自作 Shiki テーマ。ライト／ダークで
   別パレットを持ち、rehype-pretty-code の複数テーマ機能で両方を CSS 変数
   （--shiki-light / --shiki-dark）として出力し、globals.css の .dark クラスで切り替える。

   ダークは深い藍（#111430）の地に、ブランドのアクセント青／臙脂／羊皮紙を載せた配色。
   ライトは羊皮紙（#f4edda）の地に、臙脂・オリーブ・セピア青など「古文書のインク」を
   思わせる落ち着いた配色で、本文や見出し・リンクと地続きに見せる。
   地色自体は globals.css の .post pre が担うので（keepBackground:false）、ここでは
   トークン色だけが効く。 */
interface Palette {
  fg: string;
  bg: string;
  comment: string;
  keyword: string;
  string: string;
  constant: string;
  func: string;
  type: string;
  property: string;
  punctuation: string;
  tag: string;
  attribute: string;
  inserted: string;
  deleted: string;
  changed: string;
}

const darkPalette: Palette = {
  fg: "#cbd9ea", // ダーク本文と同じ基調テキスト
  bg: "#181d42", // ほぼ黒の地から一段浮く藍（globals.css と一致）
  comment: "#6b86b0", // 控えめな青灰
  keyword: "#76b5e6", // ダークのアクセント青
  string: "#d8cdb5", // 羊皮紙の薄茶（藍に映える暖色）
  constant: "#dc4e47", // 臙脂アクセントのホバー色
  func: "#9ecbff", // 一段明るい青
  type: "#f0c68a", // 金がかった砂色
  property: "#bdf2ff", // リンクホバーの淡シアン
  punctuation: "#8aa6cc", // 青灰
  tag: "#76b5e6",
  attribute: "#9ecbff",
  inserted: "#7fd6a0",
  deleted: "#dc4e47",
  changed: "#f0c68a",
};

/* ダークと同じく「色がたくさん付いた」明るく楽しい配色。地は古臭い羊皮紙をやめ、
   ほんのり冷たい清潔な白（#edf0f6）にして、鮮やかなトークン色を映えさせる。
   紫・緑・橙・青・琥珀・ティール・赤と色相を散らし、白地でも読めるよう彩度と
   明度を調整している。 */
const lightPalette: Palette = {
  fg: "#383a42", // 落ち着いたスレート
  bg: "#edf0f6", // 清潔で明るい白（globals.css と一致）
  comment: "#8a8f9c", // 控えめなグレー
  keyword: "#9333ea", // 鮮やかな紫
  string: "#2b8a3e", // 緑
  constant: "#d9480f", // 橙（数値・定数）
  func: "#1971c2", // 青
  type: "#9a6700", // 琥珀
  property: "#0b7285", // ティール
  punctuation: "#6b7280", // グレー
  tag: "#d6322b", // 赤
  attribute: "#0b7285", // ティール
  inserted: "#2b8a3e",
  deleted: "#d6322b",
  changed: "#9a6700",
};

const buildTokenColors = (p: Palette): RawThemeSetting[] => [
  { settings: { foreground: p.fg, background: p.bg } },
  {
    scope: ["comment", "punctuation.definition.comment", "string.comment"],
    settings: { foreground: p.comment, fontStyle: "italic" },
  },
  {
    scope: [
      "keyword",
      "storage",
      "storage.type",
      "storage.modifier",
      "keyword.control",
      "keyword.operator.new",
      "keyword.operator.expression",
      "keyword.operator.logical",
    ],
    settings: { foreground: p.keyword },
  },
  {
    scope: [
      "string",
      "string.quoted",
      "string.template",
      "punctuation.definition.string",
    ],
    settings: { foreground: p.string },
  },
  {
    scope: ["string.regexp", "constant.character.escape"],
    settings: { foreground: p.string },
  },
  {
    scope: [
      "constant.numeric",
      "constant.language",
      "constant.language.boolean",
      "constant.character",
      "support.constant",
    ],
    settings: { foreground: p.constant },
  },
  {
    scope: [
      "entity.name.function",
      "support.function",
      "meta.function-call.generic",
      "variable.function",
    ],
    settings: { foreground: p.func },
  },
  {
    scope: [
      "entity.name.type",
      "entity.name.class",
      "support.type",
      "support.class",
      "entity.other.inherited-class",
    ],
    settings: { foreground: p.type },
  },
  {
    scope: [
      "variable.other.property",
      "support.variable.property",
      "meta.object-literal.key",
      "support.type.property-name",
    ],
    settings: { foreground: p.property },
  },
  {
    scope: [
      "keyword.operator",
      "punctuation",
      "punctuation.separator",
      "punctuation.terminator",
      "meta.brace",
    ],
    settings: { foreground: p.punctuation },
  },
  {
    scope: ["entity.name.tag", "punctuation.definition.tag"],
    settings: { foreground: p.tag },
  },
  {
    scope: ["entity.other.attribute-name"],
    settings: { foreground: p.attribute },
  },
  {
    scope: ["variable", "variable.other", "meta.definition.variable"],
    settings: { foreground: p.fg },
  },
  /* Markdown など軽量マークアップ */
  {
    scope: ["markup.heading", "entity.name.section"],
    settings: { foreground: p.keyword, fontStyle: "bold" },
  },
  { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
  { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
  {
    scope: ["markup.inline.raw", "markup.fenced_code"],
    settings: { foreground: p.string },
  },
  {
    scope: ["markup.underline.link", "markup.link"],
    settings: { foreground: p.func },
  },
  /* diff */
  {
    scope: ["markup.inserted", "meta.diff.header.to-file"],
    settings: { foreground: p.inserted },
  },
  {
    scope: ["markup.deleted", "meta.diff.header.from-file"],
    settings: { foreground: p.deleted },
  },
  { scope: ["markup.changed"], settings: { foreground: p.changed } },
];

const makeTheme = (
  name: string,
  type: "light" | "dark",
  p: Palette,
): ThemeRegistrationRaw => {
  const tokenColors = buildTokenColors(p);
  return {
    name,
    type,
    colors: { "editor.background": p.bg, "editor.foreground": p.fg },
    fg: p.fg,
    bg: p.bg,
    // Shiki は settings を読む（tokenColors は settings 不在時のフォールバック）。
    // 一方 rehype-pretty-code は tokenColors プロパティの有無だけで「単一の JSON テーマ」
    // か「複数テーマの組」かを判定する（isJSONTheme）。tokenColors が無いと複数テーマ扱い
    // になり name をバンドル名として探して落ちるため、両方に同じ配列を渡す。
    settings: tokenColors,
    tokenColors,
  };
};

export const darkCodeTheme = makeTheme("dispositif-dark", "dark", darkPalette);
export const lightCodeTheme = makeTheme("dispositif-light", "light", lightPalette);

/* rehype-pretty-code へ渡す複数テーマ。キー名がそのまま CSS 変数の接尾辞になる
   （--shiki-light / --shiki-dark）。 */
export const codeThemes = { light: lightCodeTheme, dark: darkCodeTheme };
