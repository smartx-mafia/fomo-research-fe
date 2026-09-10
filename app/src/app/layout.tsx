import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { PrivyProviders } from "@/components/PrivyProviders";
import { FavoritesProvider } from "@/components/FavoritesProvider";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:gap-x-6">
            <Link href="/" className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight">
              <span className="inline-block h-2 w-2 rounded-full bg-accent" />
              FOMO<span className="text-muted">.poc</span>
            </Link>
            <nav className="order-3 flex w-full items-center gap-3 overflow-x-auto text-sm text-muted sm:order-none sm:w-auto sm:gap-4">
              <Link href="/" className="hover:text-foreground">
                Discover
              </Link>
              <Link href="/square?mode=token&lane=newest" className="hover:text-foreground">
                Square
              </Link>
              <Link href="/leaderboard" className="hover:text-foreground">
                Leaderboard
              </Link>
              <Link href="/portfolio" className="hover:text-foreground">
                Portfolio
              </Link>
              <Link href="/deposit" className="hover:text-foreground">
                Deposit
              </Link>
              <Link href="/invite" className="hover:text-foreground">
                Invite
              </Link>
              <Link href="/settings" className="hover:text-foreground">
                Settings
              </Link>
              <Link href="/login" className="hover:text-foreground">
                Login
              </Link>
            </nav>
            <div className="ml-auto hidden text-xs text-muted lg:block">
              Powered by <span className="text-foreground/70">SmartX</span> · live WS feed
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4">
          <PrivyProviders>
            <FavoritesProvider>{children}</FavoritesProvider>
          </PrivyProviders>
        </main>
        <footer className="border-t border-border px-4 py-3 text-center text-xs text-muted">
          Proof of concept — not financial advice. Data via SmartX market API (test environment).
        </footer>
      </body>
    </html>
  );
}
