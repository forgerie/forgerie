// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { CodeViewer } from "./CodeViewer";

afterEach(() => {
  document.body.replaceChildren();
});

describe("CodeViewer", () => {
  it("renders source as a read-only CodeMirror document", async () => {
    const element = await mount("const answer: number = 42;", "typescript");

    expect(editorContent(element)?.textContent).toContain("const answer: number = 42;");
    expect(element.shadowRoot?.querySelector(".cm-editor")?.getAttribute("class")).toContain("cm-editor");
    expect(element.shadowRoot?.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
  });

  it("recreates the document when content and language change", async () => {
    const element = await mount("first", "text");
    const firstEditor = element.shadowRoot?.querySelector(".cm-editor");

    element.content = "# Heading\n\nBody";
    element.language = "markdown";
    await element.updateComplete;

    const nextEditor = element.shadowRoot?.querySelector(".cm-editor");
    expect(nextEditor).not.toBe(firstEditor);
    expect(editorContent(element)?.textContent).toContain("Heading");
    expect(editorContent(element)?.getAttribute("dir")).toBe("auto");
  });

  it.each([
    "javascript",
    "json",
    "css",
    "html",
    "python",
    "rust",
    "go",
    "diff",
  ])("renders supported %s documents", async (language) => {
    const element = await mount("sample content", language);

    expect(editorContent(element)?.textContent).toContain("sample content");
  });

  it("accepts unsupported and absent language identifiers as plain text", async () => {
    const element = await mount("plain text", undefined);

    element.language = "unknown-language";
    element.content = "still plain";
    await element.updateComplete;

    expect(editorContent(element)?.textContent).toContain("still plain");
  });
});

async function mount(content: string, language: string | undefined): Promise<CodeViewer> {
  const element = new CodeViewer();
  element.content = content;
  element.language = language;
  document.body.append(element);
  await element.updateComplete;
  await element.updateComplete;
  return element;
}

function editorContent(element: CodeViewer): HTMLElement | null {
  const content = element.shadowRoot?.querySelector(".cm-content");
  return content instanceof HTMLElement ? content : null;
}
