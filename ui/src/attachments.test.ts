import { describe, expect, it, vi } from "vitest";
import { createAttachmentAdapter, INLINE_IMAGE_BYTES, MAX_ATTACHMENT_BYTES, offersDeliveryChoice, oversizedImage, promptOf, sendsInline } from "./attachments";
import type { CompleteAttachment, PendingAttachment } from "@assistant-ui/react";

async function pending(file: File): Promise<PendingAttachment> {
  const adapter = createAttachmentAdapter(async () => { throw new Error("Unexpected upload"); });
  const result = adapter.add({ file });
  if (!(result instanceof Promise)) throw new Error("Expected promise");
  return result;
}
const image = (data = "aGk="): CompleteAttachment => ({ id: "image", type: "image", name: "picture.png", status: { type: "complete" },
  content: [{ type: "image", image: `data:image/png;base64,${data}` }] });

describe("Forgerie attachments", () => {
  it("names an image too large for the message, and nothing else", async () => {
    expect(oversizedImage(await pending(new File([new Uint8Array(INLINE_IMAGE_BYTES + 1)], "big.png", { type: "image/png" })))).toBe(true);
    expect(oversizedImage(await pending(new File([new Uint8Array(INLINE_IMAGE_BYTES)], "fits.png", { type: "image/png" })))).toBe(false);
    expect(oversizedImage(await pending(new File([new Uint8Array(INLINE_IMAGE_BYTES + 1)], "big.txt", { type: "text/plain" })))).toBe(false);
    expect(oversizedImage(image())).toBe(false);
  });
  it("passes native images to the prompt without writing a workspace file", async () => {
    const save = vi.fn();
    const adapter = createAttachmentAdapter(save);
    const file = new File(["hi"], "picture.png", { type: "image/png" });
    const draft = await pending(file);
    const complete = await adapter.send(draft);
    expect(complete.status).toEqual({ type: "complete" });
    expect(promptOf({ content: [{ type: "text", text: "look" }], attachments: [complete] })).toEqual({
      text: "look", attachments: [{ kind: "image", name: "picture.png", mimeType: "image/png", data: "aGk=" }],
    });
    expect(save).not.toHaveBeenCalled();
  });
  it("saves a native image as a file when the choice is the folder, read at send time", async () => {
    const save = vi.fn().mockResolvedValue({ path: ".forgerie/attachments/picture.png", mimeType: "image/png", size: 2 });
    let delivery: "inline" | "folder" = "inline";
    const adapter = createAttachmentAdapter(save, () => delivery);
    const draft = await pending(new File(["hi"], "picture.png", { type: "image/png" }));
    expect(offersDeliveryChoice([draft])).toBe(true);
    expect(sendsInline(draft, "inline")).toBe(true);
    delivery = "folder";
    const complete = await adapter.send(draft);
    expect(save).toHaveBeenCalledWith({ kind: "file", name: "picture.png", mimeType: "image/png", data: "aGk=" }, expect.any(AbortSignal));
    expect(promptOf({ content: [], attachments: [complete] })).toEqual({ text: "@.forgerie/attachments/picture.png" });
    // A completed attachment keeps its form, whatever the choice is now.
    expect(sendsInline(complete, "inline")).toBe(false);
    expect(sendsInline(image(), "folder")).toBe(true);
    expect(offersDeliveryChoice([complete])).toBe(false);
  });
  it("offers no delivery choice for files the folder always takes", async () => {
    const files = [await pending(new File(["hi"], "notes.txt", { type: "text/plain" })),
      await pending(new File([new Uint8Array(INLINE_IMAGE_BYTES + 1)], "large.png", { type: "image/png" }))];
    expect(offersDeliveryChoice(files)).toBe(false);
    expect(files.some((file) => sendsInline(file, "inline"))).toBe(false);
  });
  it.each(["application/pdf", "text/plain", "image/svg+xml", ""])("saves %s as a file and passes the reference to prompt", async (mimeType) => {
    const save = vi.fn().mockResolvedValue({ path: ".forgerie/attachments/report.txt", mimeType: mimeType || "application/octet-stream", size: 2 });
    const adapter = createAttachmentAdapter(save);
    const draft = await pending(new File(["hi"], "report.txt", { type: mimeType }));
    const complete = await adapter.send(draft);
    expect(save).toHaveBeenCalledWith({ kind: "file", name: "report.txt", mimeType: mimeType || "application/octet-stream", data: "aGk=" }, expect.any(AbortSignal));
    expect(promptOf({ content: [], attachments: [complete] })).toEqual({ text: "@.forgerie/attachments/report.txt" });
    await adapter.remove(complete);
    expect(save).toHaveBeenCalledOnce();
  });
  it("saves larger supported images rather than exceeding the native image limit", async () => {
    const save = vi.fn().mockResolvedValue({ path: ".forgerie/attachments/large.png", mimeType: "image/png", size: INLINE_IMAGE_BYTES + 1 });
    const adapter = createAttachmentAdapter(save);
    const draft = await pending(new File([new Uint8Array(INLINE_IMAGE_BYTES + 1)], "large.png", { type: "image/png" }));
    const complete = await adapter.send(draft);
    expect(save.mock.calls[0]?.[0]).toMatchObject({ kind: "file", mimeType: "image/png" });
    expect(complete.content).toEqual([{ type: "text", text: "@.forgerie/attachments/large.png" }]);
  });
  it("keeps an oversized file visible with a reason, and refuses send", async () => {
    const adapter = createAttachmentAdapter(vi.fn());
    const draft = await pending(new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "too-big.bin"));
    expect(draft.status).toMatchObject({ type: "incomplete", reason: "error", message: expect.stringContaining("16 MiB") });
    await expect(adapter.send(draft)).rejects.toThrow("16 MiB");
  });
  it("propagates upload refusal and passes cancellation to the upload", async () => {
    const save = vi.fn().mockRejectedValue(new Error("Workspace is read only"));
    const adapter = createAttachmentAdapter(save);
    const draft = await pending(new File(["hi"], "notes.txt"));
    const controller = new AbortController();
    await expect(adapter.send(draft, { signal: controller.signal })).rejects.toThrow("Workspace is read only");
    controller.abort();
    expect(save.mock.calls[0]?.[1].aborted).toBe(true);
  });
  it("refuses slash commands with attachments instead of silently dropping them", () => {
    expect(() => promptOf({ content: [{ type: "text", text: "/reload" }], attachments: [image()] })).toThrow("Remove attachments");
    expect(() => promptOf({ content: [{ type: "text", text: "/review" }], attachments: [{ ...image(), content: [{ type: "text", text: "@.forgerie/attachments/notes.txt" }] }] })).toThrow("Remove attachments");
  });
  it("does not upload when cancelled before the file read", async () => {
    const save = vi.fn();
    const adapter = createAttachmentAdapter(save);
    const draft = await pending(new File(["hi"], "notes.txt"));
    const controller = new AbortController(); controller.abort();
    await expect(adapter.send(draft, { signal: controller.signal })).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
  it("accepts attachment-only images, rejects malformed content, and bounds count and total image bytes", () => {
    expect(promptOf({ content: [], attachments: [image()] }).attachments).toHaveLength(1);
    expect(() => promptOf({ content: [], attachments: [image("broken-url")] })).toThrow("invalid");
    expect(() => promptOf({ content: [], attachments: Array.from({ length: 17 }, () => image()) })).toThrow("16 attachments");
    const large = image("a".repeat(4 * 1024 * 1024));
    expect(() => promptOf({ content: [], attachments: Array.from({ length: 13 }, () => large) })).toThrow("combined upload limit");
    expect(() => promptOf({ content: [], attachments: [{ ...image(), content: [{ type: "file", data: "https://example.com/a", mimeType: "text/plain" }] }] })).toThrow("prepared");
  });
});
