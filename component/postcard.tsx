"use client";

import Link from "next/link";
import DateInfo from "./dateinfo";

export default function PostCard({ slug, data }: {
  slug: string;
  data: { [key: string]: string };
}) {
  return (
    <Link
      href={`/${slug}`}
      className="
        group block w-full overflow-hidden no-underline
        rounded-lg border-l-4 border-y border-r
        pl-4 pr-4 md:pl-6 md:pr-6 pt-3 pb-2.5
        transition-colors duration-200
        /* レトロ：背景のクリーム×深紅に合わせた不透明なパーチメント面。
           左罫は本文見出しと同じ作法で深紅のアクセントを置く。 */
        bg-[#ece5d3] text-[#1f1b1c]
        border-l-[#90332f] border-y-[#cdbfa3] border-r-[#cdbfa3]
        shadow-[0_5px_16px_-5px_rgba(0,0,0,0.55)]
        hover:bg-[#e4dcc6]
        /* ダーク：背景の濃紺×シアンに合わせた不透明な濃紺面。
           地（ほぼ漆黒）から明確に浮くよう面を一段明るくする。 */
        dark:bg-[#11294d] dark:text-[#9db8d6]
        dark:border-l-[#007ba7] dark:border-y-[#1d4170] dark:border-r-[#1d4170]
        dark:shadow-[0_5px_16px_-5px_rgba(0,0,0,0.75)]
        dark:hover:bg-[#15315a]"
    >
      <h2 className="
        mb-1
        font-bold font-zen-maru-gothic-medium
        text-base md:text-xl
        transition-colors duration-200
        group-hover:text-[#90332f] dark:group-hover:text-[#76ddfc]"
      >
        {data.title}
      </h2>
      <DateInfo data={data} className="text-xs md:text-sm" />
    </Link>
  )
}
