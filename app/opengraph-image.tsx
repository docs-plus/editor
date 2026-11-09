import { ImageResponse } from "next/og";

import { BRAND_ACCENT, BrandMark } from "@/components/brand";
import {
  SITE_NAME,
  SITE_URL,
  SOCIAL_DESCRIPTION,
  SOCIAL_TITLE,
} from "@/lib/site-config";

export const alt = SOCIAL_TITLE;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "#fafafa",
        color: "#18181b",
        borderTop: `16px solid ${BRAND_ACCENT}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <BrandMark size={96} />
        <div style={{ fontSize: 56, fontWeight: 700 }}>{SITE_NAME}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.1 }}>
          Real-time collaborative editing on Tiptap + Yjs
        </div>
        <div style={{ fontSize: 30, color: "#52525b", lineHeight: 1.4 }}>
          {SOCIAL_DESCRIPTION}
        </div>
      </div>
      <div style={{ fontSize: 26, color: BRAND_ACCENT }}>
        {`${new URL(SITE_URL).host} · open source, MIT`}
      </div>
    </div>,
    size,
  );
}
