"use client";

import Seal from "./seal";
import { useCloseToList } from "./closenav";

/**
 * モーダル枠の上端／下端にまたがって描く封蝋の半円。クリックすると記事を閉じて
 * 一覧へ戻る（封を切って閉じる、というメタファ）。
 *
 * 容器に余裕を持たせ overflow-hidden で半分だけ覗かせる構造は元の装飾と同じ。
 * 視覚上の閉じる手段は CloseButton（×）が担うため、こちらは aria-hidden の補助。
 */
export default function CloseSeal({ position }: { position: "top" | "bottom" }) {
  const close = useCloseToList();
  const isTop = position === "top";
  return (
    <div
      aria-hidden
      onClick={close}
      className={`
        group absolute left-1/2 ${isTop ? "top-0" : "bottom-0"} z-40
        h-8 w-12 -translate-x-1/2 overflow-hidden cursor-pointer
      `}
    >
      {/* 封蝋の中心を窓の縁に合わせる → 直径が縁に flush し半分が出る。
          半円の封蝋（group）にホバーで封蝋がハイライトされる。 */}
      <Seal
        highlight
        className={`absolute left-1/2 ${isTop ? "-top-[1.125rem]" : "-bottom-[1.125rem]"} size-9 -translate-x-1/2`}
      />
    </div>
  );
}
