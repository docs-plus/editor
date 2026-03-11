import type { Metadata } from "next";
import { DM_Sans, Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";
import "@/styles/_variables.scss";
import "@/styles/_keyframe-animations.scss";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });

export const metadata: Metadata = {
  title: "TinyDocy",
  description: "A lightweight document editor",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${dmSans.variable}`}>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: prevents theme flash on load
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem("tinydocy-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
