import type { AssetHex } from "@/lib/assets/asset-ref";

/**
 * SHA-256 of `bytes` as 64 lowercase hex (Web Crypto: browsers, workers,
 * Bun and Electron). A view is hashed alone, not the rest of its buffer.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<AssetHex> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
