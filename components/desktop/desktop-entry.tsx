"use client";

/**
 * The desktop page's client boundary: `DesktopRoot` runs in the browser
 * only (it opens storage and the editor), so it loads with `ssr: false`.
 */
import dynamic from "next/dynamic";

import {
  SkeletonDocument,
  SkeletonEditorBody,
} from "@/components/app-skeleton";

const DesktopRoot = dynamic(
  () => import("./desktop-root").then((module) => module.DesktopRoot),
  {
    ssr: false,
    loading: () => (
      <SkeletonEditorBody>
        <SkeletonDocument />
      </SkeletonEditorBody>
    ),
  },
);

export function DesktopEntry() {
  return <DesktopRoot />;
}
