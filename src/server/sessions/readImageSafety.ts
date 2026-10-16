/** Base64 adds a third; keep the existing inline-image byte bound. */
export const MAX_IMAGE_BYTES = 3_750_000;
/** A read cannot know the final request's image count, including retained history. Use the many-image bound. */
export const MAX_IMAGE_SIDE = 3000;

export function imageType(bytes: Uint8Array): string | undefined {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return undefined;
}

/** Read only format headers, never decompress image pixels. Truncated or unknown headers fail closed. */
export function imageDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | undefined {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mimeType === "image/png" && b.length >= 24 && b.toString("ascii", 12, 16) === "IHDR") return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (mimeType === "image/gif" && b.length >= 10) return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (mimeType === "image/jpeg") {
    let offset = 2;
    while (offset + 3 < b.length) {
      if (b[offset] !== 0xff) return undefined;
      while (b[offset] === 0xff) offset++;
      const marker = b[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) return undefined;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > b.length) return undefined;
      const length = b.readUInt16BE(offset);
      if (length < 2 || offset + length > b.length) return undefined;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8) return undefined;
        return { width: b.readUInt16BE(offset + 5), height: b.readUInt16BE(offset + 3) };
      }
      offset += length;
    }
  }
  if (mimeType === "image/webp") {
    // Extended WebP stores the canvas in VP8X. Simple files use VP8 or VP8L.
    for (let offset = 12; offset + 8 <= b.length;) {
      const kind = b.toString("ascii", offset, offset + 4);
      const length = b.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (start + length > b.length) return undefined;
      if (kind === "VP8X" && length >= 10) return { width: b.readUIntLE(start + 4, 3) + 1, height: b.readUIntLE(start + 7, 3) + 1 };
      if (kind === "VP8 " && length >= 10 && b[start + 3] === 0x9d && b[start + 4] === 0x01 && b[start + 5] === 0x2a) return { width: b.readUInt16LE(start + 6) & 0x3fff, height: b.readUInt16LE(start + 8) & 0x3fff };
      if (kind === "VP8L" && length >= 5 && b[start] === 0x2f) {
        const bits = b.readUInt32LE(start + 1);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      offset = start + length + (length % 2);
    }
  }
  return undefined;
}

export function readImageProblem(bytes: Uint8Array, mimeType: string): string | undefined {
  if (bytes.length > MAX_IMAGE_BYTES) return `Image is ${String(Math.round(bytes.length / 1000))} KB, above the ${String(MAX_IMAGE_BYTES / 1_000_000)} MB a model accepts. Make a smaller copy and read that.`;
  const size = imageDimensions(bytes, mimeType);
  if (size === undefined || size.width === 0 || size.height === 0) return "Cannot read image dimensions. Convert to a valid PNG, JPEG, GIF or WebP and read that.";
  if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) return `Image dimensions ${String(size.width)} × ${String(size.height)} px exceed the ${String(MAX_IMAGE_SIDE)} px per-side limit. Reads use the many-image limit because later requests can include earlier images. Crop to regions under ${String(MAX_IMAGE_SIDE)} px and read them one at a time.`;
  return undefined;
}
