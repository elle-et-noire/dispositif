import PostList from "@/component/postlist";
import RedirectToPosts from "@/component/redirecttoposts";

/**
 * トップ（`/`）。サーバーコンポーネントとして一覧を描画しつつ、クライアント子の
 * RedirectToPosts が URL を `/posts` に置き換える（記事を閉じたときの遷移先と
 * URL を一本化するため）。詳細は RedirectToPosts のコメント参照。
 */
export default function Home() {
  return (
    <>
      <RedirectToPosts />
      <PostList />
    </>
  );
}
