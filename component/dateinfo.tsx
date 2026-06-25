"use client";

import { cn } from "@/lib/cn";

export default function DateInfo({ data, className = "" }: {
  data: { [key: string]: string };
  className: string;
}) {
  return (
    <div className={cn("flex justify-start \
      font-kosugi-maru font-[400] \
      text-[#6f6152] dark:text-[#8aa0bb] italic", className)}
    >
      <span className="pr-1">投稿日</span>{(new Date(data.publish)).toISOString().split('T')[0]}
      {"lastUpdate" in data && <><span className="pl-2 pr-1">» 最終更新日</span>{(new Date(data.lastUpdate)).toISOString().split('T')[0]}</>}
    </div>
  );
}