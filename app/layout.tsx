import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSiteUrl } from "@/lib/site-url";

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
  title: "DATA HUB - 사람들의 선택을 확인하는 투표 커뮤니티",
  description: "다양한 주제에 투표하고 다른 사람들의 선택과 결과를 확인해보세요.",
  openGraph: {
    title: "DATA HUB - 사람들의 선택을 확인하는 투표 커뮤니티",
    description: "다양한 주제에 투표하고 다른 사람들의 선택과 결과를 확인해보세요.",
    siteName: "DATA HUB",
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "DATA HUB - 사람들의 선택을 확인하는 투표 커뮤니티",
    description: "다양한 주제에 투표하고 다른 사람들의 선택과 결과를 확인해보세요.",
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
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900 dark:bg-[#020617] dark:text-slate-200 transition-colors">
        <ThemeProvider>
          <ThemeToggle />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
