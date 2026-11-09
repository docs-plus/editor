import Link from "next/link";
import type { ReactNode } from "react";

import { REPO_URL, SITE_NAME } from "@/lib/site-config";

import "./site-page.scss";

/** Plain server-rendered shell for /about and /privacy. */
export function SitePage({ children }: { children: ReactNode }) {
  return (
    <div className="site-page">
      <header className="site-page-header">
        <Link href="/" className="site-page-brand">
          {SITE_NAME}
        </Link>
        <nav aria-label="Site">
          <Link href="/">Open the editor</Link>
          <Link href="/about">About</Link>
          <a href={REPO_URL} rel="noopener">
            GitHub
          </a>
        </nav>
      </header>
      <main className="site-page-content">{children}</main>
      <footer className="site-page-footer">
        <Link href="/privacy">Privacy</Link>
        <span>MIT licensed</span>
      </footer>
    </div>
  );
}
