import { GetAllSlugs, GetPostBySlug } from "@/lib/post";
import Toc from "@/component/toc";
import { getHeadings } from "@/lib/toc";
import DateInfo from "@/component/dateinfo";
import { markdownToHtml } from "@/lib/convert";
import PostContentMath from "@/component/postcontent";
import CloseButton from "@/component/closebutton";
import PostList from "@/component/postlist";

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
  const [mdx, mathblocks] = await markdownToHtml(content || "");
  const headings = getHeadings(content || "");

  return (
    <>
      <div // glass morphism background
        className="
          z-10 fixed top-0 left-0 right-0
          size-full bg-[#76ddfc]/15 dark:bg-[#001533]/25
          backdrop-blur-[3px]
        "
      />
      <div // modal window like
        className="
          z-20 relative flex flex-col
          mx-auto mt-8 px-4 md:pl-16 md:pr-4 pb-16
          w-[22rem] sm:w-[40rem] md:w-[68rem] rounded-lg
          bg-[#f8f8f8] shadow-[0_0px_3px_0px_rgba(128,128,128,0.5)]
          prose max-w-none
          transition-colors duration-500
          dark:bg-[#0b1422] dark:shadow-[0_0px_3px_0px_rgba(0,0,0,0.6)] dark:prose-invert
        "
      >
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
            <PostContentMath mathblocks={mathblocks} mdx={mdx} />
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