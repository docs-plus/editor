import Link from "next/link";

import {
  PARENT_ORG,
  REPO_URL,
  SANDBOX_NOTICE,
  SITE_ANSWER,
  SITE_FEATURES,
  SITE_HEADLINE,
} from "@/lib/site-config";

/**
 * Server-rendered intro shown until the live editor connects. Every user
 * agent gets the same HTML (crawlers, no-JS visitors, users whose WebSocket
 * fails), so it is not cloaking. Avoids `.tiptap`, `.app-shell` and
 * `data-tab-id`, which the e2e helpers wait on.
 */
export function SiteIntro() {
  return (
    <main className="document-editor-wrapper" aria-busy="true">
      <article className="document-editor-content site-intro">
        <h1>{SITE_HEADLINE}</h1>
        <p>{SITE_ANSWER}</p>
        <h2>What you can do</h2>
        <ul>
          {SITE_FEATURES.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <p className="site-intro-notice">{SANDBOX_NOTICE}</p>
        <p>
          <Link href="/about">What is TinyDocy?</Link> ·{" "}
          <a href={REPO_URL}>Source code on GitHub</a> ·{" "}
          <a href={PARENT_ORG.url}>docs.plus, the production editor</a>
        </p>
        <p className="site-intro-status" role="status">
          Connecting to the live editor…
        </p>
        <noscript>
          <p>Enable JavaScript to open the live editor.</p>
        </noscript>
      </article>
    </main>
  );
}
