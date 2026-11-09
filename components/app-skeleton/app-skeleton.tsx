import type { CSSProperties, ReactNode } from "react";

import "./app-skeleton.scss";

function Block({
  width,
  height = "1rem",
  style,
}: {
  width: string;
  height?: string;
  style?: CSSProperties;
}) {
  return (
    <span className="skeleton-block" style={{ width, height, ...style }} />
  );
}

/** Toolbar button groups: widths roughly match the live toolbar. */
const TOOLBAR_GROUPS = [2, 3, 2, 7, 2, 4, 2, 2] as const;
const TOC_LINES = ["70%", "58%", "64%", "46%", "52%", "38%"] as const;
const DOCUMENT_LINES = ["92%", "100%", "86%", "96%", "64%"] as const;

/** Placeholder for the tab bar until the shared tab list has synced. */
export function SkeletonTabBar() {
  return (
    <div className="skeleton-tab-bar" aria-hidden="true">
      <Block width="7.5rem" height="1.5rem" />
      <Block width="6rem" height="1.5rem" />
    </div>
  );
}

/** Title and paragraph lines for the page card while a document syncs. */
export function SkeletonDocument() {
  return (
    <div aria-hidden="true" style={{ display: "contents" }}>
      <Block width="60%" height="2.25rem" style={{ marginBottom: "0.75rem" }} />
      {DOCUMENT_LINES.map((width, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
        <Block key={index} width={width} />
      ))}
      <Block width="40%" height="1.5rem" style={{ marginTop: "1rem" }} />
      {DOCUMENT_LINES.slice(0, 3).map((width, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
        <Block key={index} width={width} />
      ))}
    </div>
  );
}

/**
 * Toolbar, table of contents and page card in the live editor's geometry.
 * `children` fills the page card: the SEO intro on first load, or
 * `SkeletonDocument` while a document loads.
 */
export function SkeletonEditorBody({
  children,
  as: Tag = "div",
}: {
  children: ReactNode;
  /** `main` when this is the page's primary content (first load). */
  as?: "div" | "main";
}) {
  return (
    <Tag className="skeleton-editor-body" aria-busy="true">
      <div className="skeleton-toolbar" aria-hidden="true">
        {TOOLBAR_GROUPS.map((count, group) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
          <span key={group} style={{ display: "flex", gap: "0.5rem" }}>
            {Array.from({ length: count }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
              <Block key={i} width="1.25rem" height="1.25rem" />
            ))}
          </span>
        ))}
      </div>
      <div className="skeleton-canvas">
        <div className="skeleton-toc" aria-hidden="true">
          <Block
            width="4rem"
            height="0.625rem"
            style={{ marginBottom: "0.25rem" }}
          />
          {TOC_LINES.map((width, index) => (
            <Block
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
              key={index}
              width={width}
              height="0.75rem"
              style={{ marginLeft: index % 3 === 0 ? 0 : "1rem" }}
            />
          ))}
        </div>
        <div className="skeleton-page">{children}</div>
      </div>
    </Tag>
  );
}

/** Whole-app loading shell for the first paint, before the tab list syncs. */
export function AppSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="app-skeleton">
      <SkeletonTabBar />
      <SkeletonEditorBody as="main">{children}</SkeletonEditorBody>
    </div>
  );
}
