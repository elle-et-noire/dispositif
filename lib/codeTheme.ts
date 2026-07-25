import type { RawThemeSetting, ThemeRegistrationRaw } from "shiki";

/* Zenn（zenn.dev）のコードハイライトを完全に模倣した Shiki テーマ。
   Zenn の配色は zenn-content-css の Prism テーマに基づき、ライト／ダークを問わず
   常に同じダーク（地色 #1a2638／基調テキスト #fff）。本サイトもそれに倣い、
   テーマ切り替えに関係なくこの 1 テーマだけを使う。地色は globals.css の .post pre が
   担うので（keepBackground:false）、ここではトークン色だけが効く。

   Zenn の Prism トークン色（出典: zenn-content-css）→ TextMate スコープへの対応：
     #94a1b3 コメント
     #ffc56d 文字列・数値・真偽・演算子・属性名・正規表現
     #ff8fa3 キーワード・セレクタ・属性値・deleted
     #38c7ff タグ・プロパティ・関数
     #939bc1 約物（punctuation）
     #b4ff9b inserted
     #fff    変数・クラス名・既定テキスト */
const FG = "#fff";
const BG = "#1a2638";
const COMMENT = "#94a1b3";
const AMBER = "#ffc56d"; // 文字列・数値・演算子・属性名 など
const PINK = "#ff8fa3"; // キーワード・属性値・deleted
const CYAN = "#38c7ff"; // タグ・プロパティ・関数
const PUNCT = "#939bc1";
const GREEN = "#b4ff9b"; // inserted

const tokenColors: RawThemeSetting[] = [
  { settings: { foreground: FG, background: BG } },
  {
    scope: [
      "comment",
      "punctuation.definition.comment",
      "string.comment",
      "punctuation.definition.documentation",
    ],
    settings: { foreground: COMMENT },
  },
  {
    // キーワード・記憶域・セレクタ・属性値・atrule
    scope: [
      "keyword",
      "keyword.control",
      "keyword.operator.new",
      "keyword.operator.expression",
      "keyword.operator.logical",
      "storage",
      "storage.type",
      "storage.modifier",
      "entity.other.attribute-name.class.css",
      "entity.other.attribute-name.id.css",
      "entity.name.tag.css",
      "keyword.control.at-rule",
      "string.quoted.double.html",
      "string.quoted.single.html",
      "meta.attribute-selector",
    ],
    settings: { foreground: PINK },
  },
  {
    // 文字列・数値・真偽・演算子・属性名・正規表現・エスケープ
    scope: [
      "string",
      "string.quoted",
      "string.template",
      "punctuation.definition.string",
      "string.regexp",
      "constant.character.escape",
      "constant.numeric",
      "constant.language.boolean",
      "constant.language",
      "support.constant",
      "keyword.operator",
      "entity.other.attribute-name",
      "constant.other.color",
    ],
    settings: { foreground: AMBER },
  },
  {
    // タグ・関数・プロパティ
    scope: [
      "entity.name.tag",
      "punctuation.definition.tag",
      "entity.name.function",
      "support.function",
      "meta.function-call.generic",
      "variable.function",
      "variable.other.property",
      "support.variable.property",
      "meta.object-literal.key",
      "support.type.property-name",
    ],
    settings: { foreground: CYAN },
  },
  {
    scope: [
      "punctuation",
      "punctuation.separator",
      "punctuation.terminator",
      "punctuation.definition.parameters",
      "meta.brace",
    ],
    settings: { foreground: PUNCT },
  },
  {
    // 変数・クラス名・型は Zenn では既定の白のまま
    scope: [
      "variable",
      "variable.other",
      "meta.definition.variable",
      "entity.name.type",
      "entity.name.class",
      "support.type",
      "support.class",
      "entity.other.inherited-class",
    ],
    settings: { foreground: FG },
  },
  /* diff */
  {
    scope: ["markup.inserted", "meta.diff.header.to-file"],
    settings: { foreground: GREEN },
  },
  {
    scope: ["markup.deleted", "meta.diff.header.from-file"],
    settings: { foreground: PINK },
  },
  /* Markdown など軽量マークアップ */
  { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
  { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
  {
    scope: ["markup.heading", "entity.name.section"],
    settings: { foreground: CYAN, fontStyle: "bold" },
  },
  {
    scope: ["markup.inline.raw", "markup.fenced_code"],
    settings: { foreground: AMBER },
  },
  {
    scope: ["markup.underline.link", "markup.link"],
    settings: { foreground: PINK },
  },
];

/* Shiki は settings を読む（tokenColors は settings 不在時のフォールバック）。
   一方 rehype-pretty-code は tokenColors プロパティの有無だけで「単一の JSON テーマ」
   か「複数テーマの組」かを判定する（isJSONTheme）。tokenColors が無いと複数テーマ扱い
   になり name をバンドル名として探して落ちるため、両方に同じ配列を渡す。 */
export const codeTheme: ThemeRegistrationRaw = {
  name: "zenn",
  type: "dark",
  colors: { "editor.background": BG, "editor.foreground": FG },
  fg: FG,
  bg: BG,
  settings: tokenColors,
  tokenColors,
};
