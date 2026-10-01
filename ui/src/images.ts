/**
 * Image data and layout decisions shared by the reply gallery, tool output,
 * attachments, and the viewer. Everything here is pure.
 */

/** One image the viewer can show. `src` is a data or object URL. */
export interface ViewerImage {
  readonly id: string;
  readonly src: string;
  readonly alt: string;
  /** The tool call that returned the image, when a tool did. */
  readonly toolCallId?: string;
}

const RENDERED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** A data URL for a supported Pi image part, or undefined when it cannot render. */
const INLINE_IMAGE = /^data:image\/(jpeg|png|gif|webp);base64,/;

/** The inline image an attachment carries, if any. */
export function attachmentImage(attachment: { readonly content?: readonly { readonly type: string; readonly image?: string }[] | undefined }): string | undefined {
  const image = attachment.content?.find((part) => part.type === "image")?.image;
  return image && INLINE_IMAGE.test(image) ? image : undefined;
}

/** A message's image attachments, as one browsable set. */
export function attachmentImages(attachments: readonly {
  readonly id: string; readonly name: string; readonly content?: readonly { readonly type: string; readonly image?: string }[] | undefined;
}[]): ViewerImage[] {
  return attachments.flatMap((attachment) => {
    const src = attachmentImage(attachment);
    return src ? [{ id: attachment.id, src, alt: attachment.name }] : [];
  });
}

export function imageSource(part: { data?: string | undefined; mimeType?: string | undefined }): string | undefined {
  if (!part.data || !part.mimeType || !RENDERED_MIME_TYPES.has(part.mimeType)) return undefined;
  return `data:${part.mimeType};base64,${part.data}`;
}

/** The structural slice of an assistant-ui message part that can carry an image. */
export interface ImageBearingPart {
  readonly type: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly args?: unknown;
  readonly artifact?: unknown;
  readonly image?: string;
}

/** Images a tool returned, carried on the tool part's artifact. */
export function toolImagesOf(artifact: unknown): readonly string[] {
  if (typeof artifact !== "object" || artifact === null || !("images" in artifact)) return [];
  const images = artifact.images;
  return Array.isArray(images) ? images.filter((image): image is string => typeof image === "string") : [];
}

/**
 * Every image a reply produced, in transcript order: tool results and the
 * assistant's own image parts. User attachments are a separate set.
 */
export function replyImages(parts: readonly ImageBearingPart[]): ViewerImage[] {
  let generated = 0;
  return parts.flatMap((part, partIndex): ViewerImage[] => {
    if (part.type === "image" && part.image) {
      generated += 1;
      return [{ id: `part-${partIndex}`, src: part.image, alt: `Generated image ${generated}` }];
    }
    if (part.type !== "tool-call") return [];
    const images = toolImagesOf(part.artifact);
    const name = toolImageName(part.toolName ?? "tool", part.args);
    const toolCallId = part.toolCallId ?? `part-${partIndex}`;
    return images.map((src, index) => ({
      id: `${toolCallId}:${index}`, src, toolCallId,
      alt: images.length === 1 ? name : `${name} (${index + 1} of ${images.length})`,
    }));
  });
}

/** A file name when the tool read a path, otherwise the tool's name. */
function toolImageName(toolName: string, args: unknown): string {
  const path = typeof args === "object" && args !== null && "path" in args && typeof args.path === "string" ? args.path : "";
  const base = path.split(/[\\/]/).filter(Boolean).at(-1);
  return base ?? `${toolName} image`;
}

/** Smallest drawn gallery tile, in CSS pixels. Columns never get narrower. */
export const GALLERY_TILE_MIN = 96;
export const GALLERY_GAP = 8;

export type GalleryPlan =
  | { readonly kind: "single" }
  | { readonly kind: "grid"; readonly columns: number; readonly visible: number; readonly overflow: number };

/**
 * The gallery layout as a function of the width it has. One image shows
 * large. More images fill one row of tiles no narrower than the minimum; when
 * they do not fit, the last tile opens the rest, so every image stays one tap
 * away. Unknown width (0, not laid out) shows every tile.
 */
export function galleryPlan(width: number, count: number): GalleryPlan {
  if (count === 1) return { kind: "single" };
  if (!(width > 0)) return { kind: "grid", columns: Math.max(2, count), visible: count, overflow: 0 };
  const columns = Math.max(2, Math.floor((width + GALLERY_GAP) / (GALLERY_TILE_MIN + GALLERY_GAP)));
  if (count <= columns) return { kind: "grid", columns, visible: count, overflow: 0 };
  return { kind: "grid", columns, visible: columns - 1, overflow: count - (columns - 1) };
}

/** Distance and direction that turn a one-finger drag into next/previous. */
export const SWIPE_MIN_DISTANCE = 48;

/**
 * A horizontal swipe moves through the set. Swiping left shows the next
 * image. Mostly vertical or short drags are not swipes.
 */
export function swipeStep(start: { x: number; y: number }, end: { x: number; y: number }): -1 | 0 | 1 {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
