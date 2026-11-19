import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope, Syne } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by Next.js (no requests to Google from the browser, so the CSP stays 'self').
const display = Syne({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const body = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "GoMutualFunds",
  description: "Ask anything about Indian mutual funds, answered from GoChanakya's data.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f0e8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions add attributes to <html>/<body> before React loads
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
