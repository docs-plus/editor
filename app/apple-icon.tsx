import { ImageResponse } from "next/og";

import { BrandMark } from "@/components/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Opaque square: iOS applies its own mask, transparent corners turn black. */
export default function AppleIcon() {
  return new ImageResponse(
    <BrandMark size={size.width} variant="square" />,
    size,
  );
}
