import type { Metadata } from "next";
import Link from "next/link";

import { SiteJsonLd } from "@/components/site-intro";
import { SitePage } from "@/components/site-page";
import {
  PARENT_ORG,
  REPO_URL,
  SANDBOX_NOTICE,
  SITE_ANSWER,
  SITE_DESCRIPTION,
  SITE_FEATURES,
  splitFeature,
} from "@/lib/site-config";

export const metadata: Metadata = {
  title: "About",
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/about" },
};

const AUDIENCES = [
  "Developers building collaborative editors with Tiptap, ProseMirror or Yjs who want a complete working reference: collaboration, persistence, abuse guardrails and tests in one MIT-licensed codebase.",
  "People evaluating docs.plus who want to try its editor features without signing up.",
  "Anyone who needs a quick shared scratchpad and is fine with every visitor seeing it.",
];

const FAQ: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "Is TinyDocy free?",
    answer:
      "Yes. The live demo is free, and the source code is MIT-licensed on GitHub.",
  },
  {
    question: "Do I need an account?",
    answer:
      "No. Open the page and start typing. Your display name and cursor colour are saved only in your browser.",
  },
  {
    question: "Are my documents private?",
    answer: `No. ${SANDBOX_NOTICE}`,
  },
  {
    question: "Can I self-host TinyDocy?",
    answer:
      "Yes. Clone the GitHub repository, run `bun install` and then `make dev`. It starts a Next.js app and a Hocuspocus WebSocket server that stores documents in SQLite.",
  },
  {
    question: "What is TinyDocy built with?",
    answer:
      "Next.js (App Router), Tiptap 3 on ProseMirror, Yjs for conflict-free sync, Hocuspocus as the WebSocket server, and SQLite for storage, all running on Bun.",
  },
  {
    question: "How does TinyDocy relate to docs.plus?",
    answer:
      "TinyDocy is the open-source testbed for docs.plus. Editor features are built and tested here first, then move to docs.plus once they pass collaboration and scale checks.",
  },
  {
    question: "Can I reuse the editor extensions?",
    answer:
      "Yes. The heading extensions (fold, drag, filter, scale) in the repository's extensions/ folder are built to work in other Tiptap 3 apps. The link, inline code, indent, placeholder, Mermaid and media extensions are published on npm as @docs.plus/extension-*.",
  },
];

const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** Renders `code` spans in FAQ answers without allowing any HTML. */
function renderAnswer(answer: string) {
  return answer.split(/(`[^`]+`)/).map((part, index) =>
    part.startsWith("`") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static, never reordered
      <code key={index}>{part.slice(1, -1)}</code>
    ) : (
      part
    ),
  );
}

export default function AboutPage() {
  return (
    <SitePage>
      <SiteJsonLd />
      <article>
        <h1>
          TinyDocy: an open-source real-time collaborative document editor
        </h1>
        <p>{SITE_ANSWER}</p>
        <p className="site-page-actions">
          <Link href="/">Open the editor</Link>
          <a href={REPO_URL} rel="noopener">
            View source on GitHub
          </a>
        </p>

        <section>
          <h2>Who is TinyDocy for?</h2>
          <ul>
            {AUDIENCES.map((audience) => (
              <li key={audience}>{audience}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2>What can you do in TinyDocy?</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Feature</th>
                <th scope="col">What it does</th>
              </tr>
            </thead>
            <tbody>
              {SITE_FEATURES.map((feature) => {
                const [name, description] = splitFeature(feature);
                return (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    <td>{capitalize(description)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Frequently asked questions</h2>
          {FAQ.map(({ question, answer }) => (
            <div key={question}>
              <h3>{question}</h3>
              <p>{renderAnswer(answer)}</p>
            </div>
          ))}
        </section>

        <p className="site-page-meta">
          Maintained by the{" "}
          <a href={PARENT_ORG.github} rel="noopener">
            docs.plus team
          </a>
          .
        </p>
      </article>
    </SitePage>
  );
}
