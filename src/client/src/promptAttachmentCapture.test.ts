// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptEditor } from "./components/PromptEditor";
import { capturePromptAttachments, DEFAULT_FILE_MIME_TYPE, effectivePromptAttachmentDelivery, READ_FAILURE_MESSAGE, type CapturableFile } from "./promptAttachmentCapture";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function file(name: string, type: string, size = 10): CapturableFile {
  return { name, type, size };
}

describe("capturePromptAttachments", () => {
  it("reads supported images as native inline image attachments", async () => {
    const result = await capturePromptAttachments(
      [file("shot.png", "image/png"), file("pic.webp", "image/webp")],
      (f) => Promise.resolve(`data-for-${f.name}`),
    );

    expect(result.error).toBeUndefined();
    expect(result.attachments).toEqual([
      { kind: "image", name: "shot.png", mimeType: "image/png", data: "data-for-shot.png", size: 10 },
      { kind: "image", name: "pic.webp", mimeType: "image/webp", data: "data-for-pic.webp", size: 10 },
    ]);
  });

  it("captures generic files with their browser MIME type", async () => {
    const result = await capturePromptAttachments(
      [file("report.pdf", "application/pdf", 1234), file("vector.svg", "image/svg+xml")],
      (f) => Promise.resolve(`data-for-${f.name}`),
    );

    expect(result.error).toBeUndefined();
    expect(result.attachments).toEqual([
      { kind: "file", name: "report.pdf", mimeType: "application/pdf", data: "data-for-report.pdf", size: 1234 },
      { kind: "file", name: "vector.svg", mimeType: "image/svg+xml", data: "data-for-vector.svg", size: 10 },
    ]);
  });

  it("uses application/octet-stream when the browser does not provide a MIME type", async () => {
    const result = await capturePromptAttachments([file("archive", "")], () => Promise.resolve("x"));

    expect(result.attachments[0]).toMatchObject({ kind: "file", name: "archive", mimeType: DEFAULT_FILE_MIME_TYPE });
  });

  it("derives fallback names for unnamed pasted attachments", async () => {
    const result = await capturePromptAttachments(
      [file("", "image/jpeg"), file("", "application/pdf")],
      () => Promise.resolve("x"),
    );

    expect(result.attachments.map((attachment) => attachment.name)).toEqual(["pasted-image.jpg", "pasted-file.bin"]);
  });

  it("reports a read failure without dropping other attachments", async () => {
    const result = await capturePromptAttachments(
      [file("bad.png", "image/png"), file("good.txt", "text/plain")],
      (f) => f.name === "bad.png" ? Promise.reject(new Error("boom")) : Promise.resolve("ok"),
    );

    expect(result.error).toBe(READ_FAILURE_MESSAGE);
    expect(result.attachments.map((attachment) => attachment.name)).toEqual(["good.txt"]);
  });

  it("returns no attachments and no error for an empty batch", async () => {
    const result = await capturePromptAttachments([], () => Promise.resolve("x"));
    expect(result).toEqual({ attachments: [] });
  });
});

describe("effectivePromptAttachmentDelivery", () => {
  it("preserves inline delivery when all pending attachments are supported images", () => {
    expect(effectivePromptAttachmentDelivery("inline", [{ kind: "image", mimeType: "image/png" }])).toBe("inline");
  });

  it("preserves an explicit folder preference for supported images", () => {
    expect(effectivePromptAttachmentDelivery("folder", [{ kind: "image", mimeType: "image/png" }])).toBe("folder");
  });

  it("forces folder delivery when any attachment is a generic file", () => {
    expect(effectivePromptAttachmentDelivery("inline", [
      { kind: "image", mimeType: "image/png" },
      { kind: "file", mimeType: "application/pdf" },
    ])).toBe("folder");
  });
});

describe("PromptEditor attachment wiring", () => {
  it("captures pasted files, strips data URL prefixes, and keeps successful reads when others fail", async () => {
    const onSend = vi.fn<NonNullable<PromptEditor["onSend"]>>();
    const editor = await mountPromptEditor(onSend, "inspect attachments");
    const restoreFileReader = installFileReaderStub([
      { kind: "load", result: "data:image/png;base64,UE5H" },
      { kind: "error", error: new DOMException("File unavailable", "NotReadableError") },
    ]);

    try {
      const pasteEvent = pasteEventWithFiles([
        new File(["png"], "shot.png", { type: "image/png" }),
        new File(["pdf"], "report.pdf", { type: "application/pdf" }),
      ]);
      const preventDefault = vi.spyOn(pasteEvent, "preventDefault");

      pasteTarget(editor).dispatchEvent(pasteEvent);
      await flushMicrotasks();
      await editor.updateComplete;

      expect(preventDefault).toHaveBeenCalledOnce();

      sendButton(editor).click();

      // report.pdf failed to read, so only the successfully-read image survives to onSend — proving
      // the paste is wired to capture, the data URL prefix is stripped, and a failed read does not
      // drop the other attachment.
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(onSend).toHaveBeenCalledWith("inspect attachments", undefined, [
        { kind: "image", mimeType: "image/png", data: "UE5H", name: "shot.png" },
      ], "inline");
    } finally {
      restoreFileReader();
    }
  });

  it("removes a pending attachment chip before sending the remaining attachments", async () => {
    const onSend = vi.fn<NonNullable<PromptEditor["onSend"]>>();
    const editor = await mountPromptEditor(onSend, "please review");
    const restoreFileReader = installFileReaderStub([
      { kind: "load", result: "data:application/pdf;base64,UkVQT1JU" },
      { kind: "load", result: "data:image/png;base64,UE5H" },
    ]);

    try {
      pasteTarget(editor).dispatchEvent(pasteEventWithFiles([
        new File(["report"], "report.pdf", { type: "application/pdf" }),
        new File(["png"], "shot.png", { type: "image/png" }),
      ]));
      await flushMicrotasks();
      await editor.updateComplete;

      removeButton(editor, "Remove attachment 1 of 2: report.pdf, application/pdf, 6 bytes").click();
      await editor.updateComplete;
      sendButton(editor).click();

      // onSend receives only the image, proving the remove handler dropped report.pdf while leaving
      // shot.png queued (folder delivery is not forced because no generic file remains).
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(onSend).toHaveBeenCalledWith("please review", undefined, [
        { kind: "image", mimeType: "image/png", data: "UE5H", name: "shot.png" },
      ], "inline");
    } finally {
      restoreFileReader();
    }
  });
});

type StubFileReaderOutcome =
  | { kind: "load"; result: string }
  | { kind: "error"; error: DOMException };

async function mountPromptEditor(onSend: NonNullable<PromptEditor["onSend"]>, text: string): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.onSend = onSend;
  document.body.append(editor);
  await editor.updateComplete;
  editor.replaceText(text);
  return editor;
}

function pasteTarget(editor: PromptEditor): HTMLElement {
  const target = editor.shadowRoot?.querySelector<HTMLElement>("composer-draft .editor-wrap");
  if (target === null || target === undefined) throw new Error("Expected composer paste target");
  return target;
}

function sendButton(editor: PromptEditor): HTMLButtonElement {
  const button = editor.shadowRoot?.querySelector<HTMLButtonElement>(".send-button");
  if (button === null || button === undefined) throw new Error("Expected send button");
  return button;
}

function removeButton(editor: PromptEditor, label: string): HTMLButtonElement {
  const buttons = Array.from(editor.shadowRoot?.querySelectorAll<HTMLButtonElement>("composer-draft .attachment-remove") ?? []);
  const button = buttons.find((candidate) => candidate.getAttribute("aria-label") === label);
  if (button === undefined) throw new Error(`Expected ${label}`);
  return button;
}

function installFileReaderStub(outcomes: StubFileReaderOutcome[]): () => void {
  const hadFileReader = Reflect.has(globalThis, "FileReader");
  const previousFileReader = Reflect.get(globalThis, "FileReader");

  class StubFileReader {
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    error: DOMException | null = null;
    result: string | ArrayBuffer | null = null;

    readAsDataURL(): void {
      const outcome = outcomes.shift();
      if (outcome === undefined) throw new Error("Unexpected FileReader.readAsDataURL call");
      if (outcome.kind === "error") {
        this.error = outcome.error;
        this.onerror?.();
        return;
      }
      this.result = outcome.result;
      this.onload?.();
    }
  }

  Reflect.set(globalThis, "FileReader", StubFileReader);
  return () => {
    if (hadFileReader) {
      Reflect.set(globalThis, "FileReader", previousFileReader);
      return;
    }
    Reflect.deleteProperty(globalThis, "FileReader");
  };
}


function pasteEventWithFiles(files: readonly File[]): Event {
  const event = new Event("paste", { cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files } });
  return event;
}

async function flushMicrotasks(): Promise<void> {
  for (let remaining = 0; remaining < 10; remaining += 1) await Promise.resolve();
}
