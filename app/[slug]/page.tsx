import { GetAllSlugs, GetPostBySlug } from "@/lib/post";
import Toc from "@/component/toc";
import { getHeadings } from "@/lib/toc";
import DateInfo from "@/component/dateinfo";
import { markdownToHtml } from "@/lib/convert";
import CloseButton from "@/component/closebutton";
import PostList from "@/component/postlist";
import Seal from "@/component/seal";

interface PostPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export const dynamicParams = false;

// 記事一覧用の予約スラッグ。一覧を `[slug]` の 1 パラメータとして持たせることで、
// 記事ページ（同じ `[slug]` 動的ルート）から「記事→記事」と同じ要領で一覧へ
// SPA 遷移できる。Next.js の output:export では index ルート(`/`)への push は
// フルリロードにフォールバックしてしまうが、動的ルートのパラメータ遷移は SPA で
// 行えるため、これが直接アクセスした記事を（リロードせず）閉じる鍵になる
// （CloseButton 参照）。実在の記事スラッグと衝突してはならない。
const LIST_SLUG = "posts";

export async function generateStaticParams() {
  const slugs = GetAllSlugs();
  return [...slugs, LIST_SLUG].map((slug) => {
    return {
      slug: slug
    }
  });
}

export default async function PostPage({ params }: PostPageProps) {
  const { slug } = await params;
  // 予約スラッグなら記事一覧を描画する（記事のモーダル枠などは出さない）。
  if (slug === LIST_SLUG) {
    return <PostList />;
  }
  const { content, data } = GetPostBySlug(slug);
  const [mdx, mathCss] = await markdownToHtml(content || "");
  const headings = getHeadings(content || "");

  return (
    <>
      {/* ビルド時に抽出した、この記事で使われたグリフぶんの CHTML スタイル。
          MathJax の JS をクライアントで動かさずに数式を表示するために必要。 */}
      <style dangerouslySetInnerHTML={{ __html: mathCss }} />
      <div // glass morphism background
        className="
          z-10 fixed top-0 left-0 right-0
          size-full bg-[#1f1b1c]/15 dark:bg-[#001533]/30
          backdrop-blur-[3px]
        "
      />
      <div // modal window like
        className="
          z-20 relative flex flex-col
          mx-auto mt-8 px-4 md:pl-16 md:pr-4 pb-16
          w-[22rem] sm:w-[40rem] md:w-[68rem] rounded-lg
          bg-[#f5f0e6] shadow-[0_0px_4px_0px_rgba(31,27,28,0.45)]
          prose max-w-none
          transition-colors duration-500
          dark:bg-[#0b1422] dark:shadow-[0_0px_3px_0px_rgba(0,0,0,0.6)] dark:prose-invert
        "
      >
        {/* カードの破線＝この窓の上端かつ下端、と見立てる。カードでは封蝋が破線を
            またいでいたので、その封蝋を上端には下半分、下端には上半分として割って
            描く。上下を綴じれば一つの封蝋になり、破線の下に来ていたタイトル・日付の
            並びがそのまま窓の冒頭に対応する。 */}
        <div // 上端：封蝋の下半分（容器に余裕を持たせ、円弧と左右端が切れないようにする）
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 z-40 h-8 w-12 -translate-x-1/2 overflow-hidden"
        >
          {/* 封蝋の中心を容器上端（＝窓の上端）に合わせる → 直径が窓の縁に flush し下半分が出る */}
          <Seal className="absolute left-1/2 -top-[1.125rem] size-9 -translate-x-1/2" />
        </div>
        <div // 下端：封蝋の上半分
          aria-hidden
          className="pointer-events-none absolute left-1/2 bottom-0 z-40 h-8 w-12 -translate-x-1/2 overflow-hidden"
        >
          {/* 封蝋の中心を容器下端（＝窓の下端）に合わせる → 直径が窓の縁に flush し上半分が出る */}
          <Seal className="absolute left-1/2 -bottom-[1.125rem] size-9 -translate-x-1/2" />
        </div>
        <div // to put close button right
          className="invisible flex justify-end z-30 sticky top-0 pt-4">
          <CloseButton />
        </div>
        <div className="grid grid-flow-col justify-stretch">
          <div // left column
            className="w-[20rem] sm:w-[38rem] md:w-[48rem] font-zen-maru-gothic-medium overflow-x-visible"
          >
            <h1 className="mb-1 md:mb-3 text-lg sm:text-3xl md:text-4xl">{data.title}</h1>
            <DateInfo data={data} className="text-xs sm:text-base" />
            <div className="post">{mdx.content}</div>
          </div>
          <div //right column
            className="hidden md:block w-full md:w-[12rem] pl-4">
            <Toc headings={headings} />
          </div>
        </div>
      </div>
    </>
  );
}