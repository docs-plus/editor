/** Accent used by the generated icons and share image. */
export const BRAND_ACCENT = "#bb4d00";

/**
 * Square "T" mark for next/og ImageResponse (Satori: inline styles only).
 */
export function BrandMark({ size }: { size: number }) {
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
        borderRadius: size * 0.2,
        fontSize: size * 0.62,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      T
    </div>
  );
}
