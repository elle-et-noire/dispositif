import GithubSlugger from "github-slugger";

export type Heading = {
  level: number;
  text: string;
  id: string;
};

export function getHeadings(source: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  // 現在開いているコードフェンスのマーカー文字（` または ~）。フェンス外は null。
  let fence: string | null = null;

  for (const line of source.split("\n")) {
    // コードフェンス（``` / ~~~ ）の開閉を追跡する
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    // コードブロック内の見出し風の行は本物の見出しではないので無視する
    if (fence !== null) continue;

    // ## または ### で始まる行のみ対象 (h2, h3)。行頭が `>` 等のものは対象外。
    const m = line.match(/^(#{2,3})\s+(.*\S)\s*$/);
    if (!m) continue;

    const level = m[1].length;
    const text = m[2];
    // rehype-slug と同じルール（github-slugger）でIDを生成
    const id = slugger.slug(text);

    headings.push({ level, text, id });
  }

  return headings;
}