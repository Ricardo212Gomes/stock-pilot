import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StockPilot — Stock research",
  description:
    "Research US stocks: financials, earnings call transcripts, SEC filings, valuation calculators and market calendars.",
};

// Applies a collapsed sidebar before the first paint, so the page doesn't jump when the
// sidebar toggle hydrates. Matches SIDEBAR_STORAGE_KEY in components/sidebar-toggle.tsx.
const SIDEBAR_SCRIPT = `try{if(localStorage.getItem("stockpilot-sidebar")==="collapsed")document.documentElement.classList.add("sidebar-collapsed")}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The script and the theme toggle change <html>'s classes before React hydrates.
    <html
      lang="en"
      className={`${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
