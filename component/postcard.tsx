"use client";

import Link from "next/link";
import DateInfo from "./dateinfo";
import Seal from "./seal";

export default function PostCard({ slug, data }: {
  slug: string;
  data: { [key: string]: string };
}) {
  return (
    <Link
      href={`/${slug}`}
      className="
        group relative flex h-full min-h-[10rem] flex-col overflow-hidden no-underline
        rounded-lg border
        transition-colors duration-200
        /* レトロ：羊皮紙（封筒）。地から明確に浮くよう静的な影を効かせる。 */
        border-[#cdbfa3] bg-[#ece5d3]
        shadow-[0_5px_16px_-5px_rgba(0,0,0,0.55)]
        /* ダーク：背景の濃紺×シアンに合わせた濃紺の封筒。 */
        dark:border-[#1d4170] dark:bg-[#11294d]
        dark:shadow-[0_5px_16px_-5px_rgba(0,0,0,0.75)]"
    >
      {/* 封筒のフラップ（折り返した蓋）。下端の破線が「折り目＝ここを開ける」を示し、
          その上に封蝋がまたがって「封がされている」ことを表す。 */}
      <div className="relative h-11 shrink-0 bg-[#e4dcc6] dark:bg-[#0d244a]">
        <div className="
          absolute inset-x-3 bottom-0
          border-b border-dashed
          border-[#b59b6b] dark:border-[#3a5c86]"
        />
        {/* 封蝋。フラップ下端の折り目をまたいで本体側へ半分かかる。 */}
        <Seal className="
          absolute left-1/2 bottom-0 z-10 size-9
          -translate-x-1/2 translate-y-1/2"
        />
      </div>

      {/* 封筒の本体（宛名面）。ホバーで便箋色 #f5f0e6 へ変わり、
          「開くとこの色の文書（postcontent）になる」ことを予告する。 */}
      <div className="
        flex flex-1 flex-col px-4 pt-6 pb-3
        transition-colors duration-200
        text-[#1f1b1c] group-hover:bg-[#f5f0e6]
        dark:text-[#9db8d6] dark:group-hover:bg-[#15315a]"
      >
        <h2 className="
          font-bold font-zen-maru-gothic-medium
          text-sm md:text-base leading-snug line-clamp-3
          transition-colors duration-200
          group-hover:text-[#90332f] dark:group-hover:text-[#76b5e6]"
        >
          {data.title}
        </h2>
        <div className="mt-auto pt-2">
          <DateInfo data={data} className="text-xs" />
        </div>
      </div>
    </Link>
  )
}
