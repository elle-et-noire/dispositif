import type { Metadata } from "next";
import { Noto_Sans_JP, Kosugi_Maru, Nunito, Fira_Mono } from "next/font/google";

import "./globals.css";
import MathEnvironment from "@/component/mathenv";

const noto_sans_jp = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto-sans-jp"
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
  title: "Weekly Run Demo",
  description: "Description of something with working codes",
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
       antialiased`}
    >
      <body>
        <MathEnvironment>
          {/* <ProgressBarProvider> */}
          <main className="min-h-svh m-0 pb-12 bg-[#a0bac8]">
            <div className="
                z-0 fixed top-0 left-0 right-0
                pt-4 pb-2 w-full
                bg-[#f8f8f8] shadow-[0_1px_1px_1px_rgba(0,0,0,0.3)]
                text-center text-[#112b45] text-lg md:text-2xl font-system
                underline underline-offset-[12px] decoration-4 decoration-yellow-300"
            >
              記事一覧
            </div>
            {children}
          </main>
          {/* </ProgressBarProvider> */}
        </MathEnvironment>
      </body>
    </html>
  );
}