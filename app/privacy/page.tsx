import type { Metadata } from "next";

import { AnalyticsChoice } from "@/components/analytics";
import { SitePage } from "@/components/site-page";
import {
  PRIVACY_CONTACT,
  REPO_URL,
  SANDBOX_NOTICE,
  SITE_NAME,
} from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What the TinyDocy demo stores, what Google Analytics sees with your consent, and how to opt out.",
  alternates: { canonical: "/privacy" },
};

function Contact() {
  const { controller, email } = PRIVACY_CONTACT;
  if (controller && email) {
    return (
      <p>
        The controller is {controller}. Contact:{" "}
        <a href={`mailto:${email}`}>{email}</a>.
      </p>
    );
  }
  return (
    <p>
      Questions or requests: open an issue on{" "}
      <a href={`${REPO_URL}/issues`} rel="noopener">
        GitHub
      </a>
      .
    </p>
  );
}

export default function PrivacyPage() {
  return (
    <SitePage>
      <article>
        <h1>Privacy</h1>

        <h2>Your documents are public</h2>
        <p className="site-page-notice">{SANDBOX_NOTICE}</p>
        <p>
          {SITE_NAME} is a public demo. What you type is sent to our server over
          a WebSocket and stored there so other visitors can see it.
        </p>

        <h2>Stored in your browser</h2>
        <p>
          Your display name and caret colour, your open tabs, your theme and
          your analytics choice are kept in this browser&apos;s local storage.
          Your name and caret colour are shown to other people editing the same
          document. None of this is sent to Google.
        </p>

        <h2>Server logs</h2>
        <p>
          To protect the service from abuse, the server logs your IP address and
          the document ID when a rate limit or safety check triggers.
        </p>

        <h2>Google Analytics (only if you allow it)</h2>
        <p>
          If this deployment has analytics enabled and you click Allow, Google
          Analytics 4 counts page visits (path only) and which features are
          used, such as creating a tab, inserting a diagram, or the provider of
          an embedded video. It never receives document text, titles, links or
          your name. Google sets the cookies <code>_ga</code> and{" "}
          <code>_ga_*</code> for up to 13 months, and advertising features are
          off. The legal basis is your consent. If your browser sends Global
          Privacy Control or Do Not Track, analytics never loads and you are not
          asked.
        </p>
        <AnalyticsChoice />

        <h2>Contact</h2>
        <Contact />
      </article>
    </SitePage>
  );
}
