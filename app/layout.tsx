import type { Metadata } from "next";
import { Noto_Sans_JP, Zen_Maru_Gothic, Kosugi_Maru, Nunito, Fira_Mono } from "next/font/google";

import "./globals.css";
import MathEnvironment from "@/component/mathenv";
import { BackgroundPattern } from "@/component/background";

const noto_sans_jp = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto-sans-jp"
});
const zen_maru_gothic = Zen_Maru_Gothic({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-zen-maru-gothic"
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
      ${zen_maru_gothic.variable}
       antialiased`}
    >
      <body>
        <BackgroundPattern />
        <MathEnvironment>
          {/* <ProgressBarProvider> */}
          <main className="min-h-svh m-0 pb-12">
            {/* <div className="
                z-0 fixed top-0 left-0 right-0
                pt-4 pb-2 w-full
                bg-[#f8f8f8] shadow-[0_1px_1px_1px_rgba(0,0,0,0.3)]
                text-center text-[#112b45] text-lg md:text-2xl font-system
                underline underline-offset-[12px] decoration-4 decoration-yellow-300"
            >
              記事一覧
            </div> */}
            {children}
          </main>
          {/* </ProgressBarProvider> */}
        </MathEnvironment>
      </body>
    </html>
  );
}