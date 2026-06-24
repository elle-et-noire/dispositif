import { GetAllPosts } from "@/lib/post";
import PostCard from "@/component/postcard";

/**
 * 記事一覧。トップ（`/`）と、記事を閉じたときの遷移先（`/posts`）の両方で
 * この同じ一覧を描画する（`/posts` は `app/[slug]/page.tsx` の予約スラッグ）。
 */
export default function PostList() {
  const posts = GetAllPosts();
  return (
    <main className="min-h-screen m-0 pb-12">
      {/* 一覧ページ専用の集中スクリム。中央列に向けて背景の目玉模様をゆるく暗転させ、
          カードへ視線を集める。ぼかしは使わずクリックも透過させる。 */}
      <div
        aria-hidden
        className="
          pointer-events-none fixed inset-0 -z-10
          bg-[radial-gradient(ellipse_46%_64%_at_50%_42%,rgba(31,27,28,0.55),rgba(31,27,28,0)_72%)]
          dark:bg-[radial-gradient(ellipse_46%_64%_at_50%_42%,rgba(2,5,10,0.62),rgba(2,5,10,0)_72%)]"
      />
      {/* 上・左から行方向に詰めていく（Zenn の一覧風）。1→2→3 列にレスポンシブ。
          auto-rows-fr と各カードの h-full で全カードの高さを揃える。 */}
      <div className="
        mx-auto w-full max-w-[64rem]
        px-5 sm:px-8 pt-20 pb-16
        grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
        auto-rows-fr gap-4 sm:gap-5"
      >
        {posts.map((post) => (
          <PostCard key={post.slug} slug={post.slug} data={post.data} />
        ))}
      </div>
    </main>
  );
}
