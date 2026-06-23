import { readFileSync, readdirSync } from "fs";
import path from "path";
import matter from "gray-matter";

// MDXファイルのディレクトリ
const POSTS_PATH = path.join(process.cwd(), "post");

// ファイル名（slug）の一覧を取得
export function GetAllPostSlugs() {
  const postFilePaths = readdirSync(POSTS_PATH).filter((path) =>
    /\.md?$/.test(path)
  );
  return postFilePaths.map((path) => {
    const slug = path.replace(/\.md?$/, "");
    return slug;
  });
}

// slugからファイルの中身を取得
export function GetPostBySlug(slug: string) {
  const markdown = readFileSync(path.join(POSTS_PATH, `${slug}.md`), "utf8");

  const { content, data } = matter(markdown);
  return {
    content,
    data,
  };
}

export function GetAllPosts() {
  const slugs = GetAllPostSlugs();
  const posts = slugs.map((slug) => {
    const markdown = readFileSync(path.join(POSTS_PATH, `${slug}.md`), 'utf8');

    const { content, data } = matter(markdown);
    return {
      slug,
      content,
      data,
    };
  });

  const sortedPosts = posts.sort((a, b) => {
    const dateA = new Date(a.data.publish);
    const dateB = new Date(b.data.publish);
    return dateB.getTime() - dateA.getTime();
  })

  return sortedPosts;
}