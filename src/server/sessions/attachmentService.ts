import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { formatDimensionNote, resizeImage } from "@earendil-works/pi-coding-agent";
import type { PromptAttachment, PromptImageAttachment, SavedPromptAttachment } from "../../shared/apiTypes.js";
import { DEFAULT_SAVED_ATTACHMENT_FOLDER, extensionForImageMimeType, MAX_SAVED_ATTACHMENT_COLLISION_ATTEMPTS, MAX_SAVED_ATTACHMENT_ORIGINAL_NAME_LENGTH, MAX_SAVED_ATTACHMENT_RELATIVE_PATH_LENGTH } from "../../shared/promptAttachments.js";
import { ensureInside, isNodeErrorWithCode, resolveParentInsideWorkspace } from "../workspaces/pathSafety.js";

/**
 * Default workspace-relative folder used when saving pasted/dropped
 * attachments for the agent to read with its own tools.
 */
export const DEFAULT_ATTACHMENT_FOLDER = DEFAULT_SAVED_ATTACHMENT_FOLDER;

export interface InlineImage {
  image: ImageContent;
  /** Optional human-readable dimension note produced by pi when resizing. */
  dimensionNote?: string;
}

/**
 * Convert validated attachments into pi-compatible inline image content.
 *
 * Mirrors pi's own CLI/TUI behaviour: each image is run through pi's
 * `resizeImage` so it fits within pi's max dimensions and inline byte budget
 * (2000x2000, ~4.5MB base64). Images that cannot be resized below the limit
 * are dropped, matching pi's `[Image omitted]` behaviour.
 */
export async function attachmentsToInlineImages(attachments: PromptImageAttachment[]): Promise<InlineImage[]> {
  const results: InlineImage[] = [];
  for (const attachment of attachments) {
    const bytes = Buffer.from(attachment.data, "base64");
    const resized = await resizeImage(bytes, attachment.mimeType);
    if (resized === null) continue;
    const note = formatDimensionNote(resized);
    results.push({
      image: { type: "image", data: resized.data, mimeType: resized.mimeType },
      ...(note === undefined ? {} : { dimensionNote: note }),
    });
  }
  return results;
}

type AttachmentFileWriter = (path: string, bytes: Uint8Array, options: { flag: "wx" }) => Promise<void>;
type AttachmentFileRemover = (path: string) => Promise<void>;

export interface SaveAttachmentsOptions {
  /** Workspace-relative folder to write into. Defaults to `.forgerie/attachments`. */
  folder?: string;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
  /** File-system seams used to verify transactional cleanup. */
  fileWriter?: AttachmentFileWriter;
  fileRemover?: AttachmentFileRemover;
}

/**
 * Write attachments into a workspace folder and return their relative paths.
 * Filenames are collision-safe and stay inside the workspace root.
 */
export async function saveAttachmentsToWorkspace(
  cwd: string,
  attachments: PromptAttachment[],
  options: SaveAttachmentsOptions = {},
): Promise<SavedPromptAttachment[]> {
  const folder = options.folder ?? DEFAULT_ATTACHMENT_FOLDER;
  const now = options.now ?? (() => new Date());
  const fileWriter = options.fileWriter ?? ((path, bytes, writeOptions) => writeFile(path, bytes, writeOptions));
  const fileRemover = options.fileRemover ?? ((path) => rm(path, { force: true }));
  const { root, target: requestedFolderTarget, relativePath: normalizedFolder } = await resolveParentInsideWorkspace(cwd, folder);
  await mkdir(requestedFolderTarget, { recursive: true });
  const folderTarget = await realpath(requestedFolderTarget);
  ensureInside(root, folderTarget);

  const stamp = timestamp(now());
  const saved: SavedPromptAttachment[] = [];
  const writtenPaths: string[] = [];
  try {
    for (const [index, attachment] of attachments.entries()) {
      const bytes = Buffer.from(attachment.data, "base64");
      const filename = await writeUniqueAttachmentFile(folderTarget, attachmentFilename(attachment, stamp, index), bytes, fileWriter);
      writtenPaths.push(join(folderTarget, filename));
      const relativePath = normalizedFolder === "" ? filename : `${normalizedFolder}/${filename}`;
      if (folder === DEFAULT_ATTACHMENT_FOLDER && relativePath.length > MAX_SAVED_ATTACHMENT_RELATIVE_PATH_LENGTH) {
        throw new Error("Saved attachment path exceeded its declared length bound");
      }
      saved.push({ path: relativePath, mimeType: attachment.mimeType, size: bytes.byteLength });
    }
    return saved;
  } catch (error) {
    await Promise.allSettled(writtenPaths.map(async (path) => { await fileRemover(path); }));
    throw error;
  }
}

async function writeUniqueAttachmentFile(folderTarget: string, filename: string, bytes: Buffer, fileWriter: AttachmentFileWriter): Promise<string> {
  for (let attempt = 0; attempt < MAX_SAVED_ATTACHMENT_COLLISION_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 0 ? filename : addCollisionSuffix(filename, attempt + 1);
    try {
      await fileWriter(join(folderTarget, candidate), bytes, { flag: "wx" });
      return candidate;
    } catch (error: unknown) {
      if (!isNodeErrorWithCode(error, "EEXIST")) throw error;
    }
  }
  throw new Error("Unable to choose a unique attachment filename");
}

function addCollisionSuffix(filename: string, suffix: number): string {
  const extension = extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);
  return `${stem}-${String(suffix)}${extension}`;
}

function attachmentFilename(attachment: PromptAttachment, stamp: string, index: number): string {
  const originalName = sanitizeOriginalFilename(attachment.name) ?? fallbackAttachmentFilename(attachment);
  return `attachment-${stamp}-${String(index + 1)}-${originalName}`;
}

function fallbackAttachmentFilename(attachment: PromptAttachment): string {
  if (attachment.kind === "image") return `image.${extensionForImageMimeType(attachment.mimeType)}`;
  return "file.bin";
}

function sanitizeOriginalFilename(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  if (trimmed === undefined || trimmed === "") return undefined;
  const leaf = basename(trimmed.replace(/\\/g, "/"));
  const sanitized = stripControlCharacters(leaf)
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/-+\./g, ".")
    .replace(/^\.+/, "")
    .replace(/[.-]+$/, "");
  if (sanitized === "") return undefined;
  return truncateFilename(sanitized, MAX_SAVED_ATTACHMENT_ORIGINAL_NAME_LENGTH);
}

function stripControlCharacters(value: string): string {
  return Array.from(value).filter((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint > 0x1f && codePoint !== 0x7f;
  }).join("");
}

function truncateFilename(filename: string, maxLength: number): string {
  if (filename.length <= maxLength) return filename;
  const extension = extname(filename);
  if (extension.length >= maxLength) return filename.slice(0, maxLength);
  const stem = filename.slice(0, filename.length - extension.length);
  return `${stem.slice(0, maxLength - extension.length)}${extension}`;
}

function timestamp(date: Date): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}
