import type { Metadata } from "next";
import { Noto_Sans_JP, Zen_Kaku_Gothic_New, Zen_Maru_Gothic, Kosugi_Maru, Nunito, Fira_Mono } from "next/font/google";

import "./globals.css";
import { BackgroundPattern } from "@/component/background";
import NavigationFix from "@/component/navfix";

const noto_sans_jp = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto-sans-jp"
});
const zen_kaku_gothic_new_medium = Zen_Kaku_Gothic_New({
  weight: "500",
  subsets: ["latin"],
  variable: "--font-zkgn-medium"
});
const zen_kaku_gothic_new_bold = Zen_Kaku_Gothic_New({
  weight: "700",
  subsets: ["latin"],
  variable: "--font-zkgn-bold"
});
const zen_maru_gothic_medium = Zen_Maru_Gothic({
  weight: "500",
  subsets: ["latin"],
  variable: "--font-zmg-medium"
});
const zen_maru_gothic_bold = Zen_Maru_Gothic({
  weight: "700",
  subsets: ["latin"],
  variable: "--font-zmg-bold"
});

const kosugi_maru = Kosugi_Maru({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-kosugi-maru"
});
const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito"
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
    <html lang="ja" className={`
      ${noto_sans_jp.variable}
      ${kosugi_maru.variable}
      ${nunito.variable}
      ${fira_mono.variable}
      ${zen_kaku_gothic_new_medium.variable}
      ${zen_kaku_gothic_new_bold.variable}
      ${zen_maru_gothic_medium.variable}
      ${zen_maru_gothic_bold.variable}
       antialiased`}
    >
      <head>
        {/* 数式はビルド時に CHTML へ組版済み。フォント (woff2) は @font-face 経由で
            この CDN から読み込むため、接続を事前確立しておく（plan.md #4）。 */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
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