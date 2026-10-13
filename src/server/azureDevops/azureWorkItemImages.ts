import type { SupportedImageMimeType } from "../../shared/promptAttachments.js";

export const AZURE_IMAGE_BYTES = 10 * 1024 * 1024;
export const AZURE_LAUNCH_IMAGE_BYTES = 20 * 1024 * 1024;
export const AZURE_LAUNCH_IMAGES = 10;

export interface AzureWorkItemImageRef { url: string; name: string; section: string; index: number }
export type AzureImageSource = { kind: "remote"; url: string } | { kind: "data"; data: string } | { kind: "skipped"; reason: string };

/** Validate before reading credentials. Never fetch link targets or follow redirects. */
export function azureImageSource(source: string, organization: string): AzureImageSource {
  if (source.startsWith("data:")) {
    const data = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/iu.exec(source)?.[1];
    if (data === undefined || data.length % 4 !== 0) return { kind: "skipped", reason: "invalid or unsupported data URI" };
    return { kind: "data", data };
  }
  try {
    const url = new URL(source);
    // Inspect the source path before URL normalizes dot segments or backslashes.
    const path = /^https:\/\/[^/?#]+(\/[^?#]*)/iu.exec(source)?.[1] ?? "";
    const segments = path.split("/");
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "dev.azure.com" || url.port !== ""
      || url.username !== "" || url.password !== "" || segments[1]?.toLowerCase() !== organization.toLowerCase()
      || /%(?:25|2f|5c|2e)/iu.test(path) || path.includes("\\") || segments.some((segment) => segment === ".." || segment === ".")
      || !/^\/[^/]+\/(?:[^/]+\/)?_apis\/wit\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(path)) {
      return { kind: "skipped", reason: "not an allowed Azure attachment URL for this organization" };
    }
    url.hash = "";
    return { kind: "remote", url: url.href };
  } catch { return { kind: "skipped", reason: "invalid image URL" }; }
}

/** Headers and data URI labels are untrusted; identify the encoded image itself. */
export function azureImageMime(bytes: Buffer): SupportedImageMimeType | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined;
}
