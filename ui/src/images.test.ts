import { describe, expect, it } from "vitest";
import { attachmentImages, GALLERY_GAP, GALLERY_TILE_MIN, galleryPlan, imageSource, replyImages, swipeStep } from "./images";

const png = "data:image/png;base64,aGk=";
const columnsWidth = (columns: number) => columns * GALLERY_TILE_MIN + (columns - 1) * GALLERY_GAP;

describe("imageSource", () => {
  it("builds a data URL only for supported, non-empty images", () => {
    expect(imageSource({ data: "aGk=", mimeType: "image/png" })).toBe(png);
    expect(imageSource({ data: "aGk=", mimeType: "image/svg+xml" })).toBeUndefined();
    expect(imageSource({ data: "", mimeType: "image/png" })).toBeUndefined();
    expect(imageSource({ mimeType: "image/png" })).toBeUndefined();
  });
  it("uses a session image reference only on its same-origin route", () => {
    const url = "/api/sessions/s1/images?cwd=%2Frepo&message=m1&image=0";
    expect(imageSource({ url, mimeType: "image/png" })).toBe(url);
    expect(imageSource({ url, mimeType: "image/svg+xml" })).toBeUndefined();
    expect(imageSource({ url: "https://example.com/x.png", mimeType: "image/png" })).toBeUndefined();
    expect(imageSource({ url: "/api/config?x", mimeType: "image/png" })).toBeUndefined();
  });
});

describe("galleryPlan", () => {
  it("shows one image large at every width", () => {
    expect(galleryPlan(0, 1)).toEqual({ kind: "single" });
    expect(galleryPlan(300, 1)).toEqual({ kind: "single" });
  });
  it("shows every tile while the width is unknown", () => {
    expect(galleryPlan(0, 7)).toEqual({ kind: "grid", columns: 7, visible: 7, overflow: 0 });
  });
  it("fits a column only when a whole minimum tile fits", () => {
    expect(galleryPlan(columnsWidth(4), 9)).toMatchObject({ columns: 4 });
    expect(galleryPlan(columnsWidth(4) - 1, 9)).toMatchObject({ columns: 3 });
  });
  it("keeps every image reachable: the last tile opens the overflow", () => {
    expect(galleryPlan(columnsWidth(4), 4)).toEqual({ kind: "grid", columns: 4, visible: 4, overflow: 0 });
    expect(galleryPlan(columnsWidth(4), 5)).toEqual({ kind: "grid", columns: 4, visible: 3, overflow: 2 });
  });
  it("never drops below two columns in a narrow pane", () => {
    expect(galleryPlan(120, 5)).toEqual({ kind: "grid", columns: 2, visible: 1, overflow: 4 });
  });
});

describe("swipeStep", () => {
  it("moves forward on a left swipe and back on a right swipe", () => {
    expect(swipeStep({ x: 200, y: 100 }, { x: 100, y: 110 })).toBe(1);
    expect(swipeStep({ x: 100, y: 100 }, { x: 200, y: 90 })).toBe(-1);
  });
  it("ignores short and mostly vertical drags", () => {
    expect(swipeStep({ x: 100, y: 100 }, { x: 60, y: 100 })).toBe(0);
    expect(swipeStep({ x: 100, y: 100 }, { x: 40, y: 200 })).toBe(0);
  });
});

describe("replyImages", () => {
  it("collects tool and generated images in transcript order with readable names", () => {
    const images = replyImages([
      { type: "text" },
      { type: "tool-call", toolCallId: "read", toolName: "read", args: { path: "shots/home.png" }, artifact: { state: "done", images: [png] } },
      { type: "image", image: png },
      { type: "tool-call", toolCallId: "shot", toolName: "screenshot", args: {}, artifact: { state: "done", images: [png, png] } },
      { type: "tool-call", toolCallId: "bash", toolName: "bash", artifact: { state: "done" } },
    ]);
    expect(images.map(({ id, alt, toolCallId }) => ({ id, alt, toolCallId }))).toEqual([
      { id: "read:0", alt: "home.png", toolCallId: "read" },
      { id: "part-2", alt: "Generated image 1", toolCallId: undefined },
      { id: "shot:0", alt: "screenshot image (1 of 2)", toolCallId: "shot" },
      { id: "shot:1", alt: "screenshot image (2 of 2)", toolCallId: "shot" },
    ]);
  });
});

describe("attachmentImages", () => {
  it("keeps only inline images, so the set matches what the chips can show", () => {
    expect(attachmentImages([
      { id: "a", name: "a.png", content: [{ type: "image", image: png }] },
      { id: "b", name: "notes.txt", content: [{ type: "text" }] },
      { id: "c", name: "remote.png", content: [{ type: "image", image: "https://example.com/x.png" }] },
    ])).toEqual([{ id: "a", src: png, alt: "a.png" }]);
  });
});
