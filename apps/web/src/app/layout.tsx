import type { Metadata } from "next";

import { MainNav, SiteFooter } from "@/components/layout";
import { QueryProvider } from "@/components/providers/QueryProvider";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SMPLAT – Social Media Promotion Platform",
    template: "%s | SMPLAT"
  },
  description:
    "Enterprise-ready social media promotion storefront delivering growth services with transparency and automation.",
  authors: [{ name: "SMPLAT" }],
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1
  }
};

type RootLayoutProps = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <QueryProvider>
          <div className="flex min-h-screen flex-col">
            <MainNav />
            <div className="flex-1">{children}</div>
            <SiteFooter />
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
