import type { BrandMarkVariant } from "@/lib/pwa-icons";

/** Accent used by the generated icons and share image. */
export const BRAND_ACCENT = "#bb4d00";

/**
 * Square "T" mark for next/og ImageResponse (Satori: inline styles only).
 * `square` and `maskable` are opaque edge to edge; `maskable` shrinks the
 * glyph so it stays inside the r = 0.4 × size safe circle.
 */
export function BrandMark({
  size,
  variant = "rounded",
}: {
  size: number;
  variant?: BrandMarkVariant;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BRAND_ACCENT,
        color: "#ffffff",
        borderRadius: variant === "rounded" ? size * 0.2 : 0,
        fontSize: size * (variant === "maskable" ? 0.5 : 0.62),
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      T
    </div>
  );
}
