import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { GoogleAnalytics } from "@/components/analytics";
import { ServiceWorkerRegistration } from "@/components/pwa";
import { ThemeRuntime } from "@/components/theme/theme-runtime";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  SITE_DESCRIPTION,
  SITE_INDEXABLE,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
  SOCIAL_DESCRIPTION,
  SOCIAL_TITLE,
  THEME_COLOR,
} from "@/lib/site-config";
import { INSTALL_PROMPT_CAPTURE_SCRIPT } from "@/lib/pwa/install-prompt";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";

import "./globals.css";
import "@/styles/_variables.scss";
import "@/styles/_keyframe-animations.scss";
import "@/styles/_print.scss";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  robots: SITE_INDEXABLE
    ? { index: true, follow: true }
    : { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: "/",
    title: SOCIAL_TITLE,
    description: SOCIAL_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SOCIAL_TITLE,
    description: SOCIAL_DESCRIPTION,
  },
  formatDetection: { email: false, address: false, telephone: false },
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
  // Edge to edge on notched phones and installed apps; the shell, the tab
  // strip, the phone bar and its sheet pad themselves by the safe areas.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          In <head>, not <body>: Chromium may render as soon as <body> is
          inserted, and a busy parser can yield before the body's first
          script, painting one frame in the wrong theme.
        */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: applies the theme before the first frame
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className={inter.variable}>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: catches the install prompt before hydration
          dangerouslySetInnerHTML={{ __html: INSTALL_PROMPT_CAPTURE_SCRIPT }}
        />
        <TooltipProvider>{children}</TooltipProvider>
        <GoogleAnalytics />
        <ServiceWorkerRegistration />
        <ThemeRuntime />
      </body>
    </html>
  );
}
