// Placeholder brand assets for the S3 spike, written by script on any OS:
//   build/icons/<n>x<n>.png  Linux icon set
//   build/icon.ico           Windows (BMP entries up to 128, PNG for 256)
//   build/icon.icns          macOS fallback (PNG entries, no iconutil)
//   build/icon.icon/         Icon Composer bundle (icon.json + glyph layer)
// The ICNS and ICO packers below are plain TypeScript; the macOS job checks
// the ICNS with `iconutil` (round trip) so the script is the packer and
// iconutil is only the verifier.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const BUILD = path.join(import.meta.dir, "build");
type Rgba = [number, number, number, number];

// Coverage of the placeholder glyph: a "T" made of two bars, in unit space.
const inGlyph = (x: number, y: number) =>
  (y >= 0.24 && y <= 0.38 && x >= 0.24 && x <= 0.76) ||
  (y >= 0.24 && y <= 0.78 && x >= 0.43 && x <= 0.57);

// A rounded square (corner radius 22%) inset by 10%, like a macOS tile.
const inTile = (x: number, y: number) => {
  const inset = 0.1;
  const r = 0.22 * (1 - 2 * inset);
  const lo = inset + r;
  const hi = 1 - inset - r;
  const cx = Math.min(Math.max(x, lo), hi);
  const cy = Math.min(Math.max(y, lo), hi);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

const render = (size: number, layer: "full" | "glyph"): Uint8Array => {
  const out = new Uint8Array(size * size * 4);
  const ss = size >= 256 ? 2 : 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let tile = 0;
      let glyph = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          if (inTile(x, y)) tile++;
          if (inGlyph(x, y)) glyph++;
        }
      }
      const n = ss * ss;
      const t = py / size;
      const bg: Rgba = [
        Math.round(37 + (30 - 37) * t),
        Math.round(99 + (58 - 99) * t),
        Math.round(235 + (138 - 235) * t),
        255,
      ];
      const g = glyph / n;
      const i = (py * size + px) * 4;
      if (layer === "glyph") {
        out.set([255, 255, 255, Math.round(255 * g)], i);
        continue;
      }
      const a = tile / n;
      out.set(
        [
          Math.round(bg[0] * (1 - g) + 255 * g),
          Math.round(bg[1] * (1 - g) + 255 * g),
          Math.round(bg[2] * (1 - g) + 255 * g),
          Math.round(255 * a),
        ],
        i,
      );
    }
  }
  return out;
};

const crc32 = (buf: Uint8Array) => Bun.hash.crc32(buf);

const pngChunk = (type: string, data: Uint8Array) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

const encodePng = (size: number, rgba: Uint8Array) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    raw.set(
      rgba.subarray(y * size * 4, (y + 1) * size * 4),
      y * (size * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", new Uint8Array()),
  ]);
};

// 32-bit DIB entry for ICO: BITMAPINFOHEADER, bottom-up BGRA, AND mask.
const encodeDib = (size: number, rgba: Uint8Array) => {
  const maskRow = Math.ceil(size / 32) * 4;
  const out = Buffer.alloc(40 + size * size * 4 + maskRow * size);
  out.writeUInt32LE(40, 0);
  out.writeInt32LE(size, 4);
  out.writeInt32LE(size * 2, 8);
  out.writeUInt16LE(1, 12);
  out.writeUInt16LE(32, 14);
  out.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = 40 + ((size - 1 - y) * size + x) * 4;
      out[d] = rgba[s + 2] ?? 0;
      out[d + 1] = rgba[s + 1] ?? 0;
      out[d + 2] = rgba[s] ?? 0;
      out[d + 3] = rgba[s + 3] ?? 0;
    }
  }
  return out; // AND mask left zero: alpha channel decides
};

const encodeIco = (entries: { size: number; data: Buffer }[]) => {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach(({ size, data }, i) => {
    const o = 6 + 16 * i;
    head[o] = size >= 256 ? 0 : size;
    head[o + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(data.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.data)]);
};

const encodeIcns = (entries: { type: string; png: Buffer }[]) => {
  const parts = entries.map(({ type, png }) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, "ascii");
    h.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([h, png]);
  });
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8);
  h.write("icns", 0, "ascii");
  h.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([h, body]);
};

const png = new Map<number, Buffer>();
const pngOf = (size: number) => {
  let p = png.get(size);
  if (!p) {
    p = encodePng(size, render(size, "full"));
    png.set(size, p);
  }
  return p;
};

mkdirSync(path.join(BUILD, "icons"), { recursive: true });
for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  writeFileSync(path.join(BUILD, "icons", `${size}x${size}.png`), pngOf(size));
}

writeFileSync(
  path.join(BUILD, "icon.ico"),
  encodeIco([
    ...[16, 32, 48, 64, 128].map((size) => ({
      size,
      data: encodeDib(size, render(size, "full")),
    })),
    { size: 256, data: pngOf(256) },
  ]),
);

// ICNS PNG types: icp4 16, icp5 32, icp6 64, ic07 128, ic08 256, ic09 512,
// ic10 1024 (512@2x), ic11 32 (16@2x), ic12 64 (32@2x), ic13 256 (128@2x),
// ic14 512 (256@2x).
writeFileSync(
  path.join(BUILD, "icon.icns"),
  encodeIcns(
    (
      [
        ["icp4", 16],
        ["icp5", 32],
        ["icp6", 64],
        ["ic07", 128],
        ["ic08", 256],
        ["ic09", 512],
        ["ic10", 1024],
        ["ic11", 32],
        ["ic12", 64],
        ["ic13", 256],
        ["ic14", 512],
      ] as const
    ).map(([type, size]) => ({ type, png: pngOf(size) })),
  ),
);

// Icon Composer bundle: background fill in icon.json, one glyph layer.
const iconDir = path.join(BUILD, "icon.icon");
mkdirSync(path.join(iconDir, "Assets"), { recursive: true });
writeFileSync(
  path.join(iconDir, "Assets", "glyph.png"),
  encodePng(1024, render(1024, "glyph")),
);
writeFileSync(
  path.join(iconDir, "icon.json"),
  `${JSON.stringify(
    {
      fill: {
        "linear-gradient": [
          "srgb:0.14510,0.38824,0.92157,1.00000",
          "srgb:0.11765,0.22745,0.54118,1.00000",
        ],
      },
      groups: [
        {
          layers: [{ "image-name": "glyph.png", name: "glyph" }],
          shadow: { kind: "neutral", opacity: 0.5 },
          translucency: { enabled: true, value: 0.5 },
        },
      ],
      "supported-platforms": { squares: "shared" },
    },
    null,
    2,
  )}\n`,
);

console.log("icons written to", BUILD);
