import { GetAllPosts } from "@/lib/post";
import PostCard from "@/component/postcard";

/**
 * 記事一覧。トップ（`/`）と、記事を閉じたときの遷移先（`/posts`）の両方で
 * この同じ一覧を描画する（`/posts` は `app/[slug]/page.tsx` の予約スラッグ）。
 */
export default function PostList() {
  const posts = GetAllPosts();
  return (
    <main className="min-h-screen min-w-max m-0 pb-12">
      <div className="
        pb-16 pt-20 px-16 mx-auto
        w-full md:w-[48rem]
        flex flex-col gap-3 items-center"
      >
        {posts.map((post) => (
          <PostCard key={post.slug} slug={post.slug} data={post.data} />
        ))}
      </div>
    </main>
  );
}
