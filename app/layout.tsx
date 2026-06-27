import type { Metadata } from "next";
import { Zen_Maru_Gothic, Fira_Mono } from "next/font/google";

import "./globals.css";
import { BackgroundPattern } from "@/component/background";
import NavigationFix from "@/component/navfix";

// 実際に適用されているフォントのみ読み込む。和文フォントは next/font/google が
// Unicode-range で約120分割の @font-face 目録（1ファミリーあたり ~91KB の
// レンダーブロッキング CSS）を生成するため、未使用ファミリーの削除が FCP/LCP に
// 直結する。本文＝Zen Maru Gothic medium、日付＝Kosugi Maru、コード＝Fira Mono。
const zen_maru_gothic_medium = Zen_Maru_Gothic({
  weight: "500",
  subsets: ["latin"],
  variable: "--font-zmg-medium"
});

const fira_mono = Fira_Mono({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-fira-mono"
});

export const metadata: Metadata = {
  title: "Dispositif",
  description: "A personal blog featuring articles on mathematics and physics.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning className={`
      ${fira_mono.variable}
      ${zen_maru_gothic_medium.variable}
       antialiased`}
    >
      <head>
        {/* テーマの初期適用（FOUC 防止）。body 描画前に同期実行し、保存値→OS 設定の順で
            <html> に dark/light クラスを付ける。background.tsx はマウント時にこのクラスへ
            state を同期する。next/script(beforeInteractive) は実行が hydration をブロック
            しないため、ちらつき防止には素のインライン script を使う。 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;var c=document.documentElement.classList;c.toggle('dark',d);c.toggle('light',!d);}catch(e){}})();",
          }}
        />
      </head>
      <body>
        <NavigationFix />
        <BackgroundPattern />
        {/* <ProgressBarProvider> */}
        <main className="min-h-svh m-0 pb-12">
          {children}
        </main>
        {/* </ProgressBarProvider> */}
      </body>
    </html>
  );
}