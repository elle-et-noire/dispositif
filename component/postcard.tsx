"use client";

import Link from "next/link";
import DateInfo from "./dateinfo";

export default function PostCard({ slug, data }: {
  slug: string;
  data: { [key: string]: string };
}) {
  return (
    <Link
      href={slug}
      className="
        px-3 md:px-6 pt-2 sm:pt-4 pb-1 sm:pb-2
        no-underline w-full bg-[#f8f8f8] text-[#324e73] rounded-md border-[#dadfe4] border-[0.5pt]
        shadow-[0_1px_1px_1px_rgba(0,0,0,0.2)] overflow-hidden"
    >
      <h2 className="
        mb-1
        font-semibold font-noto-sans
        text-base md:text-xl"
      >
        {data.title}
      </h2>
      <DateInfo data={data} className="text-xs md:text-sm" />
    </Link>
  )
}