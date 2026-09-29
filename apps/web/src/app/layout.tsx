import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusBar } from "@/components/StatusBar";
import { ServerBanner, ServerProvider } from "@/lib/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description = "Walk the site, talk it through, get a landscaping quote.";

export const metadata: Metadata = {
  title: { default: "Groundwork", template: "%s · Groundwork" },
  description,
  applicationName: "Groundwork",
  openGraph: { title: "Groundwork", description, type: "website", siteName: "Groundwork" },
};

export const viewport: Viewport = {
  themeColor: "#1a4d33",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-10 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to the page
        </a>
        <ServerProvider>
          <SiteHeader />
          <ServerBanner />
          <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-20 pt-10 sm:px-6">
            {children}
          </main>
          <footer className="border-t border-line bg-sunken">
            <div className="mx-auto w-full max-w-5xl space-y-2 px-4 py-6 sm:px-6">
              <h2 className="text-xs font-medium text-ink-3">Connections</h2>
              <StatusBar />
            </div>
          </footer>
        </ServerProvider>
      </body>
    </html>
  );
}
