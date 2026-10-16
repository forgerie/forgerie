import { describe, expect, it } from "vitest";
import { imageDimensions, readImageProblem, MAX_IMAGE_BYTES } from "./readImageSafety.js";
import { png } from "./readImageSafety.testSupport.js";

describe("read image safety", () => {
  it("rejects a tiny compressed tall image before it enters history", () => {
    const bytes = png(1, 9000);
    expect(bytes.length).toBeLessThan(1000);
    expect(readImageProblem(bytes, "image/png")).toContain("1 × 9000 px");
  });
  it("uses the many-image bound even on a first read because history can retain images", () => {
    expect(readImageProblem(png(1, 3001), "image/png")).toContain("3000 px per-side limit");
    expect(readImageProblem(png(3000, 1), "image/png")).toBeUndefined();
    expect(readImageProblem(png(1, 1), "image/png")).toBeUndefined();
  });
  it("keeps the byte bound and fails closed on truncated headers", () => {
    expect(readImageProblem(Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/png")).toContain("3.75 MB");
    for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp"]) expect(readImageProblem(Buffer.alloc(4), mime)).toContain("Cannot read image dimensions");
  });
  it("reads GIF and JPEG frame dimensions without decoding pixels", () => {
    expect(imageDimensions(Buffer.from("47494638396102000300", "hex"), "image/gif")).toEqual({ width: 2, height: 3 });
    // APP0 followed by progressive SOF2.
    expect(imageDimensions(Buffer.from("ffd8ffe000040000ffc20008080003000201", "hex"), "image/jpeg")).toEqual({ width: 2, height: 3 });
  });
  it.each([
    ["VP8X", "00000000010000020000"],
    ["VP8 ", "0000009d012a02000300"],
    ["VP8L", "2f01800000"],
  ])("reads %s WebP dimensions", (kind, hex) => {
    const data = Buffer.from(hex, "hex");
    const header = Buffer.alloc(20); header.write("RIFF"); header.writeUInt32LE(data.length + 12, 4); header.write("WEBP", 8); header.write(kind, 12); header.writeUInt32LE(data.length, 16);
    expect(imageDimensions(Buffer.concat([header, data]), "image/webp")).toEqual({ width: 2, height: 3 });
  });
});
