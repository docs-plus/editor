/**
 * Image privacy (A0): inserted images carry no camera or location metadata.
 * happy-dom cannot decode or encode images, so JPEG re-encoding, orientation
 * and pixels are checked here, in a real browser. Also runs under
 * `--project=webkit`, where WebP cannot be encoded and JPEG is the fallback.
 */
import { expect, type Page, test } from "@playwright/test";

import {
  ascii,
  buildExifApp1,
  buildPng,
  pngChunk,
} from "../helpers/image-bytes";
import { EditorPage, typeInNewParagraphAtEnd } from "./helpers/editor-page";

const EXIF_ROTATED_GPS = buildExifApp1({
  orientation: 6,
  gps: { lat: 52.37, lon: 4.89 },
});
const PNG_WITH_METADATA = buildPng([
  pngChunk(
    "eXIf",
    buildExifApp1({ gps: { lat: 52.37, lon: 4.89 } }).subarray(6),
  ),
  pngChunk("tEXt", ascii("Comment\0secret")),
]);

interface InsertedImage {
  type: string;
  bytes: Buffer;
  alt: string | null;
  title: string | null;
  width: number;
  height: number;
}

/** Names of metadata segments: JPEG APP1 before SOS, WebP `EXIF`/`XMP `. */
function metadataSegments(bytes: Uint8Array): string[] {
  const found: string[] = [];
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 4 <= bytes.length; ) {
      const marker = bytes[offset + 1];
      if (bytes[offset] !== 0xff || marker === 0xda) break;
      if (marker === 0xe1) found.push("APP1");
      offset += 2 + ((bytes[offset + 2] << 8) | bytes[offset + 3]);
    }
    return found;
  }
  if (ascii("RIFF").every((byte, i) => bytes[i] === byte)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 12; offset + 8 <= bytes.length; ) {
      const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
      if (id === "EXIF" || id === "XMP ") found.push(id);
      const size = view.getUint32(offset + 4, true);
      offset += 8 + size + (size & 1);
    }
  }
  return found;
}

/**
 * A 40×20 JPEG, red on the left half and blue on the right, with an Exif
 * APP1 (orientation 6, GPS) spliced in right after SOI.
 */
async function rotatedJpegWithGps(page: Page): Promise<number[]> {
  return page.evaluate(async (app1: number[]) => {
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 20;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.fillStyle = "#f00";
    context.fillRect(0, 0, 20, 20);
    context.fillStyle = "#00f";
    context.fillRect(20, 0, 20, 20);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.95),
    );
    if (!blob) throw new Error("no JPEG");
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    const length = app1.length + 2;
    return [
      0xff,
      0xd8,
      0xff,
      0xe1,
      length >> 8,
      length & 0xff,
      ...app1,
      ...jpeg.subarray(2),
    ];
  }, Array.from(EXIF_ROTATED_GPS));
}

async function readImage(page: Page, index: number): Promise<InsertedImage> {
  const image = page.locator(".tiptap img").nth(index);
  await expect(image).toHaveAttribute("src", /^data:/);
  const info = await image.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    return {
      src: img.src,
      alt: img.getAttribute("alt"),
      title: img.getAttribute("title"),
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  });
  const match = /^data:([^;]+);base64,(.*)$/.exec(info.src);
  if (!match) throw new Error(`unexpected src ${info.src.slice(0, 40)}`);
  return { ...info, type: match[1], bytes: Buffer.from(match[2], "base64") };
}

/** Inserts the file the way paste and drop do (the media kit's event). */
async function pasteFile(
  page: Page,
  bytes: Uint8Array | number[],
  name: string,
  type: string,
): Promise<InsertedImage> {
  const before = await page.locator(".tiptap img").count();
  await page.evaluate(
    ({ bytes, name, type }) => {
      const file = new File([new Uint8Array(bytes)], name, { type });
      const editor = (window as Window & { __tiptap_editor?: unknown })
        .__tiptap_editor;
      document.dispatchEvent(
        new CustomEvent("editorFileUpload", {
          detail: { files: [file], editor },
        }),
      );
    },
    { bytes: Array.from(bytes), name, type },
  );
  await expect(page.locator(".tiptap img")).toHaveCount(before + 1);
  return readImage(page, before);
}

async function samplePixel(
  page: Page,
  x: number,
  y: number,
): Promise<[number, number, number]> {
  return page
    .locator(".tiptap img")
    .first()
    .evaluate(
      (img: HTMLImageElement, [px, py]) => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        context.drawImage(img, 0, 0);
        const [r, g, b] = context.getImageData(px, py, 1, 1).data;
        return [r, g, b] as [number, number, number];
      },
      [x, y],
    );
}

function expectNoFileName(image: InsertedImage) {
  expect(image.alt).toBe("");
  expect(image.title).toBeNull();
}

test.describe("Image metadata", () => {
  test.beforeEach(async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForSync();
    await typeInNewParagraphAtEnd(page, "Photo");
  });

  test("JPEG with orientation 6 and GPS", async ({ page, browserName }) => {
    const jpeg = await rotatedJpegWithGps(page);
    // The fixture carries the GPS APP1 (WebKit's encoder adds one of its own).
    expect(metadataSegments(new Uint8Array(jpeg))).toContain("APP1");

    const image = await pasteFile(
      page,
      jpeg,
      "IMG_2026_home.jpg",
      "image/jpeg",
    );

    expect(
      browserName === "webkit" ? ["image/webp", "image/jpeg"] : ["image/webp"],
    ).toContain(image.type);
    expect(metadataSegments(image.bytes)).toEqual([]);
    expect([image.width, image.height]).toEqual([20, 40]);
    const [r1, g1, b1] = await samplePixel(page, 10, 5);
    expect(r1).toBeGreaterThan(255 - 40);
    expect(g1).toBeLessThan(40);
    expect(b1).toBeLessThan(40);
    const [r2, g2, b2] = await samplePixel(page, 10, 35);
    expect(r2).toBeLessThan(40);
    expect(g2).toBeLessThan(40);
    expect(b2).toBeGreaterThan(255 - 40);
    expectNoFileName(image);
  });

  test("PNG with eXIf and tEXt", async ({ page }) => {
    const image = await pasteFile(
      page,
      PNG_WITH_METADATA,
      "IMG_2026_home.png",
      "image/png",
    );
    expect(image.type).toBe("image/png");
    expect(new Uint8Array(image.bytes)).toEqual(buildPng([]));
    expect([image.width, image.height]).toEqual([2, 1]);
    expectNoFileName(image);
  });

  test("JPEG bytes labelled image/png", async ({ page }) => {
    const jpeg = await rotatedJpegWithGps(page);
    const image = await pasteFile(page, jpeg, "photo.png", "image/png");
    expect(image.type).not.toBe("image/png");
    expect(metadataSegments(image.bytes)).toEqual([]);
    expectNoFileName(image);
  });

  test("JPEG bytes labelled image/gif", async ({ page }) => {
    const jpeg = await rotatedJpegWithGps(page);
    const image = await pasteFile(page, jpeg, "photo.gif", "image/gif");
    expect(image.type).not.toBe("image/gif");
    expect(metadataSegments(image.bytes)).toEqual([]);
    expectNoFileName(image);
  });

  test("the upload node inserts without the file name", async ({ page }) => {
    await page.evaluate(() => {
      const editor = (
        window as Window & {
          __tiptap_editor?: {
            commands: { setImageUploadNode: () => boolean };
          };
        }
      ).__tiptap_editor;
      editor?.commands.setImageUploadNode();
    });
    await page.locator('.tiptap input[type="file"]').setInputFiles({
      name: "IMG_2026_home.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_WITH_METADATA),
    });
    const image = await readImage(page, 0);
    expect(new Uint8Array(image.bytes)).toEqual(buildPng([]));
    expectNoFileName(image);
  });
});
