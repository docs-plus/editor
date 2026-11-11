/**
 * Writes app/favicon.ico from the same BrandMark as app/icon.tsx, so
 * clients that only ask for /favicon.ico (bookmarks, RSS readers, older
 * browsers) get the brand instead of a default icon.
 *
 * Run after changing BrandMark: `bun scripts/generate-favicon.tsx`
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { ImageResponse } from "next/og";

import { BrandMark } from "@/components/brand";

const SIZES = [16, 32, 48] as const;
const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;

async function renderPng(size: number): Promise<Buffer> {
  const response = new ImageResponse(<BrandMark size={size} />, {
    width: size,
    height: size,
  });
  return Buffer.from(await response.arrayBuffer());
}

/** ICO container with PNG-encoded entries (supported by every current browser). */
function packIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = HEADER_BYTES + ENTRY_BYTES * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(ENTRY_BYTES);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const images = await Promise.all(
  SIZES.map(async (size) => ({ size, png: await renderPng(size) })),
);
const target = path.join(import.meta.dirname, "../app/favicon.ico");
writeFileSync(target, packIco(images));
console.log(`Wrote ${target} (${SIZES.join(", ")} px)`);
