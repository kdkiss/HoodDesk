import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import hoodDeskLogo from "@/docs/images/logo.png";

export const metadata: Metadata = {
  title: "HoodDesk",
  description: "Trading desk for Robinhood Chain",
  icons: {
    icon: [{ url: hoodDeskLogo.src, type: "image/png", sizes: "512x512" }],
    shortcut: [hoodDeskLogo.src],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: "try { const theme = localStorage.getItem('hooddesk-theme'); if (theme === 'light') { document.documentElement.classList.replace('dark', 'light'); } } catch {}",
          }}
        />
      </head>
      <body className="bg-hood-bg text-hood-text min-h-[100dvh]">
        <Providers>
          <div className="flex h-[100dvh]">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
              <Header />
              <main className="flex-1 overflow-auto pb-16 md:pb-0">{children}</main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
