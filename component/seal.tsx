import { cn } from "@/lib/cn";

/**
 * 封蝋（ワックスシール）モチーフ。同心円の円盤で、背景の「目玉」模様と呼応する。
 * 記事カード（封をした手紙）と、開いた記事本文の冒頭の両方で使い、両者が
 * 「封 → 開封」の関係であることを視覚的につなぐ。サイズ・配置は className で渡す。
 */
export default function Seal({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex items-center justify-center rounded-full \
        bg-[#90332f] text-[#ece5d3] \
        shadow-[inset_0_0_0_2px_rgba(236,229,211,0.4),0_1px_2px_rgba(0,0,0,0.45)] \
        dark:bg-[#0c2c4d] dark:text-[#76ddfc] \
        dark:shadow-[inset_0_0_0_2px_rgba(118,221,252,0.4),0_0_8px_rgba(0,123,167,0.45)]",
        className
      )}
    >
      {/* 中央の同心リング（目玉の芯にあたる） */}
      <span className="aspect-square w-[36%] rounded-full ring-2 ring-current" />
    </span>
  );
}
