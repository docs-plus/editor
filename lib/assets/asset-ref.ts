/**
 * Content-addressed image references (image store spec §2.1, I1).
 *
 * A library document stores `asset:sha256-<64 lowercase hex>` in an image
 * node's `src`, never the bytes. The ref does not depend on origin: desktop,
 * the web library and a share each resolve it locally.
 *
 * Pure and dependency-free, for the asset kit's parse rules (and through
 * them the headless schema), the storage worker, the Hocus server and the
 * exporters. The sandbox editor never loads it.
 */

export const ASSET_REF_PREFIX = "asset:";

/** 64 lowercase hex characters: a SHA-256 digest. */
export type AssetHex = string;

export type ParsedAssetRef =
  | { alg: "sha256"; hex: AssetHex }
  | { alg: "unknown" };

const HEX = /^[0-9a-f]{64}$/;
const SHA256_REF = /^asset:sha256-([0-9a-f]{64})$/;
/** A future algorithm (`asset:blake3-…`): shown as "needs a newer version". */
const OTHER_REF = /^asset:([a-z0-9]+)-[A-Za-z0-9_-]+$/;
/**
 * Every well-formed sha256 ref in a text. The lookahead refuses a ref that
 * runs on into more ref characters (`OTHER_REF`'s set), which
 * `parseAssetRef` would refuse too, such as a 65th digit or an uppercase one.
 */
const SHA256_REF_IN_TEXT = /asset:sha256-([0-9a-f]{64})(?![A-Za-z0-9_-])/g;

export function isAssetHex(value: string): boolean {
  return HEX.test(value);
}

export function formatAssetRef(hex: AssetHex): string {
  if (!HEX.test(hex)) throw new Error("Not a SHA-256 hex digest.");
  return `${ASSET_REF_PREFIX}sha256-${hex}`;
}

/**
 * The algorithm and digest of an `asset:` src, `{ alg: "unknown" }` for an
 * algorithm this build does not know, or `null` when `src` is not an asset
 * ref (another scheme, or a malformed sha256 ref).
 */
export function parseAssetRef(src: unknown): ParsedAssetRef | null {
  if (typeof src !== "string" || !src.startsWith(ASSET_REF_PREFIX)) {
    return null;
  }
  const sha = SHA256_REF.exec(src);
  if (sha) return { alg: "sha256", hex: sha[1] };
  const other = OTHER_REF.exec(src);
  return other && other[1] !== "sha256" ? { alg: "unknown" } : null;
}

/** A host-owned src: kept on paste and import, resolved before rendering. */
export function isAssetRef(src: unknown): boolean {
  return parseAssetRef(src) !== null;
}

/** Each sha256 digest referenced in `text`, once, in order of first use. */
export function findAssetRefs(text: string): AssetHex[] {
  const seen = new Set<AssetHex>();
  for (const match of text.matchAll(SHA256_REF_IN_TEXT)) seen.add(match[1]);
  return [...seen];
}

/**
 * Replaces each `asset:sha256-<hex>` whose digest is in `map` with the
 * mapped string (an export's relative image path, spec §5.4). Refs not in
 * the map, and unknown algorithms, are left as they are.
 */
export function rewriteAssetRefs(
  text: string,
  map: ReadonlyMap<AssetHex, string>,
): string {
  if (map.size === 0) return text;
  return text.replace(
    SHA256_REF_IN_TEXT,
    (ref, hex: string) => map.get(hex) ?? ref,
  );
}
