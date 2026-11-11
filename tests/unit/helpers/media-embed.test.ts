import { describe, expect, it } from "bun:test";

import { resolveMediaType } from "@/components/tiptap-ui/media-embed-popover/use-media-embed";

describe("resolveMediaType", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
    ["https://vimeo.com/76979871", "vimeo"],
    ["https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", "spotify"],
    ["https://soundcloud.com/forss/flickermood", "soundcloud"],
    ["https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184", "loom"],
    ["https://x.com/docsplus/status/1234567890123456789", "x"],
    ["https://example.com/clip.mp4", "video"],
    ["https://example.com/podcast.mp3", "audio"],
    ["https://example.com/photo.png", "image"],
    ["  https://example.com/photo.png  ", "image"],
  ] as const)("maps %s to %s", (url, expected) => {
    expect(resolveMediaType(url)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:image/png;base64,AAAA",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "blob:https://example.com/uuid",
    "file:///etc/passwd",
    "/relative/photo.png",
    "not a url",
    "https://example.com/page",
  ])("rejects %s", (url) => {
    expect(resolveMediaType(url)).toBeNull();
  });
});
