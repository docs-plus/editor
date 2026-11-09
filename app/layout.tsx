import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { GoogleAnalytics } from "@/components/analytics";
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

import "./globals.css";
import "@/styles/_variables.scss";
import "@/styles/_keyframe-animations.scss";

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
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.variable}>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: prevents theme flash on load
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem("tinydocy-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
        <TooltipProvider>{children}</TooltipProvider>
        <GoogleAnalytics />
      </body>
    </html>
  );
}
