import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";
import { BRAND, BRAND_SOCIAL_IMAGE } from "@/lib/brand";
import { getSiteUrl } from "@/lib/site-url";
import { SiteFooter } from "@/components/site-footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: BRAND.siteTitle,
  description: BRAND.description,
  openGraph: {
    title: BRAND.openGraphTitle,
    description: BRAND.openGraphDescription,
    siteName: BRAND.name,
    locale: "ko_KR",
    type: "website",
    images: [BRAND_SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND.openGraphTitle,
    description: BRAND.openGraphDescription,
    images: [BRAND_SOCIAL_IMAGE],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-canvas text-ink dark:bg-canvas dark:text-ink transition-colors">
        <ThemeProvider><AuthProvider>{children}<SiteFooter /></AuthProvider></ThemeProvider>
      </body>
    </html>
  );
}
