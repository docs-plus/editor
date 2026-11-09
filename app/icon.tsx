import { ImageResponse } from "next/og";

import { BrandMark } from "@/components/brand";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<BrandMark size={size.width} />, size);
}
