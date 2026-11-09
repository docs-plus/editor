import { ImageResponse } from "next/og";

import { BrandMark } from "@/components/brand";
import { isPwaIconId, PWA_ICONS } from "@/lib/pwa-icons";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(PWA_ICONS).map((id) => ({ id }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isPwaIconId(id)) return new Response("Not found", { status: 404 });
  const { size, variant } = PWA_ICONS[id];
  return new ImageResponse(<BrandMark size={size} variant={variant} />, {
    width: size,
    height: size,
  });
}
