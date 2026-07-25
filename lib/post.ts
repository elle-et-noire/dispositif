import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const postPath = path.join(process.cwd(), "post");

// 記事のフロントマター（post/*.md 冒頭の YAML）。title と publish は必須、
// lastUpdate は任意。それ以外のキーが将来増えても許容する。
export type PostFrontmatter = {
  title: string;
  publish: string;
  lastUpdate?: string;
  [key: string]: unknown;
};

export type Post = {
  slug: string;
  content: string;
  data: PostFrontmatter;
};

function normalizeDate(slug: string, field: string, value: unknown): string {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`post/${slug}.md: frontmatter の ${field} は有効な日付で指定してください`);
  }
  return date.toISOString().slice(0, 10);
}

function parseFrontmatter(slug: string, data: Record<string, unknown>): PostFrontmatter {
  if (typeof data.title !== "string" || data.title.trim() === "") {
    throw new Error(`post/${slug}.md: frontmatter の title は必須です`);
  }
  return {
    ...data,
    title: data.title,
    publish: normalizeDate(slug, "publish", data.publish),
    ...(data.lastUpdate === undefined
      ? {}
      : { lastUpdate: normalizeDate(slug, "lastUpdate", data.lastUpdate) }),
  };
}

export function getAllSlugs(): string[] {
  return readdirSync(postPath)
    .filter((file) => /\.md$/.test(file))
    .map((file) => file.replace(/\.md$/, ""));
}

export function getPostBySlug(slug: string): Omit<Post, "slug"> {
  const markdown = readFileSync(path.join(postPath, `${slug}.md`), "utf8");

  const { content, data } = matter(markdown);
  return {
    content,
    data: parseFrontmatter(slug, data),
  };
}

export function getAllPosts(): Post[] {
  const slugs = getAllSlugs();
  const posts = slugs.map((slug) => ({ slug, ...getPostBySlug(slug) }));

  // 公開日の降順（新しい記事が先頭）
  return posts.sort((a, b) => {
    const byDate = Date.parse(b.data.publish) - Date.parse(a.data.publish);
    return byDate || a.slug.localeCompare(b.slug);
  });
}
