import type { SessionRef } from "../../shared/apiTypes.js";

/**
 * Image bytes stay out of live socket frames. One turn with many screenshots
 * can pass the socket's byte limit, and a frame over the limit never arrives,
 * so the browser could never attach. Frames carry a URL; the browser loads
 * each image on its own request.
 *
 * An image is addressed by its message ID and its position among that
 * message's image parts. Both read paths apply the same projection, so the
 * position is stable between the frame and the image request.
 */

/** Only these types are served back; anything else could run as a page. */
export const SESSION_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export interface SessionImage { mimeType: string; data: string }

/** The public URL. The web server proxies `/api/sessions/*` to the session daemon. */
export function sessionImageUrl(ref: SessionRef, messageId: string, image: number): string {
  return `/api/sessions/${encodeURIComponent(ref.id)}/images?${new URLSearchParams({ cwd: ref.cwd, message: messageId, image: String(image) }).toString()}`;
}

/** Replace inline image data with references. Messages without an ID keep their data. */
export function withImageReferences<T extends { id?: string | undefined; content?: unknown }>(ref: SessionRef, messages: readonly T[]): T[] {
  return messages.map((message) => {
    const id = message.id;
    if (id === undefined || !Array.isArray(message.content) || !message.content.some(isInlineImage)) return message;
    let image = 0;
    const content: unknown[] = message.content.map((part: unknown) => {
      if (!isImagePart(part)) return part;
      const index = image++;
      if (!isInlineImage(part)) return part;
      const reference: Record<string, unknown> = { ...part, url: sessionImageUrl(ref, id, index) };
      delete reference["data"];
      return reference;
    });
    return { ...message, content };
  });
}

/** The image a reference names, or undefined when the message or image is gone. */
export function findSessionImage(messages: readonly { id?: string | undefined; content?: unknown }[], messageId: string, image: number): SessionImage | undefined {
  const message = messages.find((candidate) => candidate.id === messageId);
  if (message === undefined || !Array.isArray(message.content)) return undefined;
  const part: unknown = message.content.filter(isImagePart)[image];
  if (!isInlineImage(part) || typeof part["mimeType"] !== "string" || !SESSION_IMAGE_MIME_TYPES.has(part["mimeType"])) return undefined;
  return { mimeType: part["mimeType"], data: part.data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImagePart(part: unknown): part is Record<string, unknown> {
  return isRecord(part) && part["type"] === "image";
}

function isInlineImage(part: unknown): part is Record<string, unknown> & { data: string } {
  return isImagePart(part) && typeof part["data"] === "string" && part["data"] !== "";
}
