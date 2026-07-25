// サイトのベースパス（astro.config.mjs の base: '/bestand'）込みの絶対パスを組み立てる。
// Astro の import.meta.env.BASE_URL は末尾スラッシュ付き（例: '/bestand/'）になるため、
// 素朴に `${BASE_URL}/foo` と連結すると '/bestand//foo' と二重スラッシュを生む。
// ここで両端のスラッシュを正規化し、全箇所で同じ規則のパスを得られるようにする。
export const withBase = (path = ""): string => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const rest = path.replace(/^\//, "");
  return rest ? `${base}/${rest}` : `${base}/`;
};
