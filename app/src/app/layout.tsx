import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  description: "Mobula-powered token discovery — Next.js SSR proof of concept",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight">
              <span className="inline-block h-2 w-2 rounded-full bg-accent" />
              FOMO<span className="text-muted">.poc</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted">
              <Link href="/" className="hover:text-foreground">
                Discover
              </Link>
            </nav>
            <div className="ml-auto text-xs text-muted">
              Powered by <span className="text-foreground/70">Mobula</span> · demo feed
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4">{children}</main>
        <footer className="border-t border-border px-4 py-3 text-center text-xs text-muted">
          Proof of concept — not financial advice. Data via Mobula demo API (rate-limited).
        </footer>
      </body>
    </html>
  );
}
