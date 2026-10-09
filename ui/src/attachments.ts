import { generateId, SimpleImageAttachmentAdapter, type AppendMessage, type Attachment, type AttachmentAdapter, type CompleteAttachment } from "@assistant-ui/react";
import { z } from "zod";
import { isCommand } from "./commands";
import { attachmentDelivery, type AttachmentDelivery } from "./attachmentDelivery";

// Forgerie's native image contract. Larger images and all other files use the
// existing workspace upload endpoint rather than an unsupported model input.
export const INLINE_IMAGE_BYTES = Math.round(4.5 * 1024 * 1024);
export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const MAX_ATTACHMENTS = 16;
const imageTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
export interface PromptAttachment { kind: "image" | "file"; mimeType: string; data: string; name?: string }
export const savedAttachmentsSchema = z.object({ attachments: z.array(z.object({
  path: z.string().min(1), mimeType: z.string().min(1), size: z.number().nonnegative(),
})).length(1) });
export type SavedAttachment = z.infer<typeof savedAttachmentsSchema>["attachments"][number];
export type SaveAttachment = (attachment: PromptAttachment, signal?: AbortSignal) => Promise<SavedAttachment>;

/** An image Pi can take as model input. Larger images and every other file are saved instead. */
function canInline(attachment: Pick<Attachment, "contentType" | "file">): boolean {
  return imageTypes.has(attachment.contentType ?? "") && attachment.file !== undefined && attachment.file.size <= INLINE_IMAGE_BYTES;
}

/** The draft holds an image that the delivery choice decides. Without one, the choice changes nothing. */
export function offersDeliveryChoice(attachments: readonly Attachment[]): boolean {
  return attachments.some((attachment) => attachment.status.type !== "complete" && canInline(attachment));
}

/** An image too large for the message: it goes to the folder whatever the choice says. */
export function oversizedImage(attachment: Pick<Attachment, "contentType" | "file" | "status">): boolean {
  return attachment.status.type !== "complete" && imageTypes.has(attachment.contentType ?? "") && attachment.file !== undefined && !canInline(attachment);
}

/**
 * The attachment reaches Pi as an image in the prompt, not as a saved file's path.
 * Pi's queue keeps such an image, but Stop returns only queued text, so it cannot queue.
 * A completed attachment (restored after a failed send) keeps the form it already has.
 */
export function sendsInline(attachment: Attachment, delivery: AttachmentDelivery): boolean {
  if (attachment.status.type === "complete") return attachment.content?.some((part) => part.type === "image") === true;
  return delivery === "inline" && canInline(attachment);
}

/**
 * Session-scoped adapter. Reading/uploading happens only when Send is pressed,
 * so the delivery choice in force at that moment decides each image.
 */
export function createAttachmentAdapter(save: SaveAttachment, delivery: () => AttachmentDelivery = attachmentDelivery.get): AttachmentAdapter & { dispose: () => void } {
  const reader = new SimpleImageAttachmentAdapter();
  const lifetime = new AbortController();
  return {
    accept: "*",
    async add({ file }) {
      const type = imageTypes.has(file.type) ? "image" : file.type === "application/pdf" ? "document" : "file";
      return {
        id: generateId(), name: file.name, contentType: file.type || "application/octet-stream", type, file,
        status: file.size > MAX_ATTACHMENT_BYTES
          ? { type: "incomplete", reason: "error", message: "Files must be 16 MiB or smaller. Remove this file and choose a smaller one." }
          : { type: "requires-action", reason: "composer-send" },
      };
    },
    async send(attachment, options) {
      if (attachment.file.size > MAX_ATTACHMENT_BYTES) throw new Error("Files must be 16 MiB or smaller.");
      const signal = options?.signal === undefined ? lifetime.signal : AbortSignal.any([options.signal, lifetime.signal]);
      const encoded = await reader.send(attachment, { signal });
      const content = encoded.content[0];
      if (content?.type !== "image") throw new Error("The file could not be read.");
      const mimeType = attachment.contentType || "application/octet-stream";
      if (sendsInline(attachment, delivery())) return encoded;
      const data = content.image.slice(content.image.indexOf(",") + 1);
      const saved = await save({ kind: "file", name: attachment.name, mimeType, data }, signal);
      signal.throwIfAborted();
      // Keeping the original File allows a preview after a failed prompt. A
      // complete attachment's reference is reused, so retry never uploads twice.
      return { ...attachment, status: { type: "complete" }, content: [{ type: "text", text: `@${saved.path}` }] };
    },
    dispose: () => lifetime.abort(),
    async remove() {
      // Removing a chip does not delete an already saved workspace file. The
      // server has no delete-upload route, and the agent may already use it.
    },
  };
}

/** Translate assistant-ui's completed attachments into the existing Pi API. */
export function promptOf(message: Pick<AppendMessage, "content" | "attachments">): { text: string; attachments?: PromptAttachment[] } {
  const files = message.attachments ?? [];
  if (files.length > MAX_ATTACHMENTS) throw new Error("Send at most 16 attachments at once.");
  const text = message.content.flatMap((part) => part.type === "text" ? [part.text] : []);
  if (files.length && isCommand(text.join("\n"))) throw new Error("Remove attachments before running a slash command.");
  const images: PromptAttachment[] = [];
  for (const attachment of files) {
    for (const part of attachment.content) {
      if (part.type === "text") text.push(part.text);
      else if (part.type === "image") {
        const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.image);
        if (!match || !match[2]) throw new Error("The image attachment is invalid.");
        images.push({ kind: "image", mimeType: match[1]!, data: match[2], name: attachment.name });
      } else throw new Error("This attachment could not be prepared for Forgerie.");
    }
  }
  // Leave headroom under the server's default 64 MiB JSON body limit. Folder
  // files upload individually; only inline images share the prompt request.
  if (images.reduce((sum, image) => sum + image.data.length, 0) > 48 * 1024 * 1024) {
    throw new Error("These images exceed the combined upload limit. Send fewer images at once.");
  }
  return { text: text.join("\n"), ...(images.length ? { attachments: images } : {}) };
}

/** Restore completed uploads without reading files or writing them again. */
export function reusableAttachment(attachment: CompleteAttachment) {
  return { id: attachment.id, type: attachment.type, name: attachment.name,
    ...(attachment.contentType ? { contentType: attachment.contentType } : {}), content: attachment.content };
}
