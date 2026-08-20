import { mkdir, symlink, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_DOCUMENT_PREVIEW_BYTES } from "../../shared/workspaceFiles.js";
import { readWorkspaceDocumentPreview } from "./documentPreviewService.js";
import { cleanupTempWorkspaces, createTempWorkspace } from "./fileContentService.testSupport.js";

afterEach(async () => {
  await cleanupTempWorkspaces();
});

describe("readWorkspaceDocumentPreview", () => {
  it("streams html documents with normalized paths", async () => {
    const root = await createTempWorkspace();
    await mkdir(join(root, "lessons"));
    await writeFile(join(root, "lessons", "0001-intro.html"), "<!doctype html><h1>Intro</h1>");

    const preview = await readWorkspaceDocumentPreview(root, "./lessons//0001-intro.html");
    const content = await streamToString(preview.stream);

    expect(preview).toMatchObject({ path: "lessons/0001-intro.html", mimeType: "text/html", size: 29 });
    expect(Date.parse(preview.modifiedAt)).not.toBeNaN();
    expect(content).toBe("<!doctype html><h1>Intro</h1>");
  });

  it("serves the subresource types a self-contained page needs", async () => {
    const root = await createTempWorkspace();
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets", "course.css"), "body { margin: 0 }");
    await writeFile(join(root, "assets", "quiz.MJS"), "export {}");
    await writeFile(join(root, "assets", "serif.woff2"), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
    await writeFile(join(root, "assets", "data.json"), "{}");
    await writeFile(join(root, "assets", "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const mimeOf = async (path: string) => {
      const preview = await readWorkspaceDocumentPreview(root, path);
      preview.stream.destroy();
      return preview.mimeType;
    };

    expect(await mimeOf("assets/course.css")).toBe("text/css");
    expect(await mimeOf("assets/quiz.MJS")).toBe("text/javascript");
    expect(await mimeOf("assets/serif.woff2")).toBe("font/woff2");
    expect(await mimeOf("assets/data.json")).toBe("application/json");
    expect(await mimeOf("assets/logo.png")).toBe("image/png");
  });

  it("refuses file types outside the document allowlist", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "run.sh"), "#!/bin/sh\n");
    await writeFile(join(root, "notes.txt"), "notes");

    await expect(readWorkspaceDocumentPreview(root, "run.sh")).rejects.toThrow("Document preview is not supported for this file type");
    await expect(readWorkspaceDocumentPreview(root, "notes.txt")).rejects.toThrow("Document preview is not supported for this file type");
  });

  it("rejects missing paths, directories, traversal, absolute paths, and symlink escapes", async () => {
    const root = await createTempWorkspace();
    const outside = await createTempWorkspace();
    await mkdir(join(root, "dir"));
    await writeFile(join(outside, "secret.html"), "<p>secret</p>");
    await symlink(join(outside, "secret.html"), join(root, "sneaky.html"));

    await expect(readWorkspaceDocumentPreview(root, undefined)).rejects.toThrow("path is required");
    await expect(readWorkspaceDocumentPreview(root, "")).rejects.toThrow("path is required");
    await expect(readWorkspaceDocumentPreview(root, "dir")).rejects.toThrow("Path is not a file");
    await expect(readWorkspaceDocumentPreview(root, "../secret.html")).rejects.toThrow("Path traversal is not allowed");
    await expect(readWorkspaceDocumentPreview(root, "/etc/hosts")).rejects.toThrow("Absolute paths are not allowed");
    await expect(readWorkspaceDocumentPreview(root, "sneaky.html")).rejects.toThrow();
  });

  it("refuses documents above the preview size limit", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "huge.html"), "");
    await truncate(join(root, "huge.html"), MAX_DOCUMENT_PREVIEW_BYTES + 1);

    await expect(readWorkspaceDocumentPreview(root, "huge.html")).rejects.toThrow("Document is too large to preview");
  });
});

async function streamToString(stream: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}
