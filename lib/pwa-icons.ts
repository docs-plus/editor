/**
 * Install icons served by app/pwa-icons/[id]. Imports nothing from
 * components so the manifest and the icon route share one table.
 */
export type BrandMarkVariant = "rounded" | "square" | "maskable";

export const PWA_ICONS = {
  "any-192": { size: 192, variant: "rounded", purpose: "any" },
  "any-512": { size: 512, variant: "rounded", purpose: "any" },
  "maskable-512": { size: 512, variant: "maskable", purpose: "maskable" },
} as const satisfies Record<
  string,
  { size: number; variant: BrandMarkVariant; purpose: "any" | "maskable" }
>;

export type PwaIconId = keyof typeof PWA_ICONS;

export function isPwaIconId(id: string): id is PwaIconId {
  return Object.hasOwn(PWA_ICONS, id);
}

export function pwaManifestIcon(id: PwaIconId) {
  const { size, purpose } = PWA_ICONS[id];
  return {
    src: `/pwa-icons/${id}`,
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose,
  };
}
