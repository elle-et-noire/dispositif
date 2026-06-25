"use client";

import { useCloseToList } from "./closenav";

/**
 * 記事の背後に敷くグラスモーフィズム背景。モーダル枠（より手前の z-index）の外側
 * ＝背景模様が透けて見える領域をクリックすると、記事を閉じて一覧へ戻る。モーダル
 * 枠自身は手前にあるため、本文上のクリックはここに届かない。
 *
 * 視覚上の閉じる手段は CloseButton（×）が担い、こちらはマウス操作の補助なので
 * aria-hidden（スクリーンリーダーには重複読み上げさせない）。
 */
export default function CloseOverlay() {
  const close = useCloseToList();
  return (
    <div
      aria-hidden
      onClick={close}
      className="
        z-10 fixed top-0 left-0 right-0
        size-full bg-[#1f1b1c]/15 dark:bg-[#001533]/30
        backdrop-blur-[3px] cursor-pointer
      "
    />
  );
}
