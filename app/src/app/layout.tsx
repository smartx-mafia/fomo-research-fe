import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FOMO Terminal (PoC)",
  description: "SmartX token discovery and social feed — Next.js proof of concept",
};

/**
 * 根 layout 只负责 html / body / 字体 / 全局样式。
 *
 * Provider 一律下移到 route group：`(product)/layout.tsx` 持产品那套，
 * `(harness)/layout.tsx` 持 harness 自己那套。理由是这样 provider 边界
 * 是**结构性**的——谁在 Provider 里由目录决定，而不是由某个
 * `usePathname()` 运行时判断决定，将来新增 `/dev/xxx` 路由不会踩空。
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
