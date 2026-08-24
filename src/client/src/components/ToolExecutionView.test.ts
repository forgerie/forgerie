// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { ToolExecutionPart } from "./shared";
import { ToolExecutionView } from "./ToolExecutionView";

afterEach(() => {
  document.body.replaceChildren();
});

describe("ToolExecutionView", () => {
  it("renders nothing before an execution is available", async () => {
    const view = await mount();

    expect(view.shadowRoot?.querySelector(".tool-card")).toBeNull();
  });

  it.each([
    ["pending", "○", "pending"],
    ["running", "●", "running"],
    ["success", "✓", "done"],
    ["error", "✖", "failed"],
  ] as const)("renders %s status", async (status, icon, label) => {
    const view = await mount(execution({ status }));

    expect(text(view, ".status-icon")).toBe(icon);
    expect(text(view, ".status-label")).toBe(label);
    expect(view.shadowRoot?.querySelector(".tool-card")?.classList.contains(status)).toBe(true);
  });

  it("prefers file and command targets before the summary", async () => {
    const fileView = await mount(execution({ args: { path: "src/app.ts", command: "ignored" }, summary: "summary" }));
    expect(text(fileView, ".path")).toBe("src/app.ts");
    expect(fileView.shadowRoot?.querySelector(".path")?.getAttribute("aria-label")).toBe("File: src/app.ts");

    const commandView = await mount(execution({ args: { command: "npm test" }, summary: "summary" }));
    expect(text(commandView, ".summary")).toBe("npm test");
    expect(commandView.shadowRoot?.querySelector(".summary")?.getAttribute("aria-label")).toBe("Command: npm test");

    const summaryView = await mount(execution({ summary: "inspect repository", args: null }));
    expect(text(summaryView, ".summary")).toBe("inspect repository");
    expect(summaryView.shadowRoot?.querySelector(".summary")?.getAttribute("aria-label")).toBe("Input: inspect repository");
  });

  it("omits targets and empty details when no display text exists", async () => {
    const view = await mount(execution({ summary: "", args: undefined, resultText: "", details: undefined }));

    expect(view.shadowRoot?.querySelector(".path, .summary, .text-body, .diff-body")).toBeNull();
  });

  it("renders text results, errors, and edit counts", async () => {
    const edited = await mount(execution({
      toolName: "edit",
      args: { edits: [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }] },
      resultText: "updated",
    }));
    expect(edited.shadowRoot?.textContent).toContain("2 edits");
    expect(text(edited, ".detail-result pre")).toBe("updated");

    const single = await mount(execution({ toolName: "edit", args: { oldText: "a", newText: "b" } }));
    expect(single.shadowRoot?.textContent).toContain("1 edit");

    const failed = await mount(execution({ status: "error", resultText: "permission denied" }));
    expect(text(failed, ".error-text")).toBe("permission denied");
    expect(text(failed, ".detail-result pre")).toBe("permission denied");
  });

  it("renders preview differences and reports an applied mismatch", async () => {
    const preview = "diff --git a/file b/file\nindex 111..222 100644\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n context";
    const applied = `${preview}\n+extra`;
    const view = await mount(execution({
      toolName: "edit",
      args: { file_path: "file" },
      details: { diff: applied },
      preview: { diff: preview, error: "preview warning" },
    }));

    expect(text(view, ".notice")).toBe("Applied diff differs from the preview.");
    expect(text(view, ".diff-stats .added")).toBe("+2");
    expect(text(view, ".diff-stats .removed")).toBe("-1");
    expect(view.shadowRoot?.querySelectorAll(".diff-content .file")).toHaveLength(2);
    expect(view.shadowRoot?.querySelectorAll(".diff-content .hunk")).toHaveLength(1);
    expect(view.shadowRoot?.querySelectorAll(".diff-content .removed")).toHaveLength(1);
    expect(view.shadowRoot?.querySelectorAll(".diff-content .added")).toHaveLength(2);
    expect(view.shadowRoot?.querySelector(".diff-content .context")).not.toBeNull();
    expect(view.shadowRoot?.querySelectorAll(".diff-content .meta")).toHaveLength(2);
    expect(text(view, ".diff-header span")).toBe("Applied diff");
  });

  it("shows a preview error when no execution error exists", async () => {
    const view = await mount(execution({ preview: { error: "preview unavailable" }, resultText: "" }));

    expect(text(view, ".error-text")).toBe("preview unavailable");
  });

  it("expands a long difference on request", async () => {
    const diff = Array.from({ length: 181 }, (_, index) => `+line ${String(index)}`).join("\n");
    const view = await mount(execution({ preview: { diff } }));

    expect(view.shadowRoot?.querySelectorAll(".diff-content span")).toHaveLength(180);
    expect(view.shadowRoot?.textContent).toContain("Showing 180 of 181 lines");

    const button = view.shadowRoot?.querySelector<HTMLButtonElement>("button.show-more");
    button?.click();
    await view.updateComplete;

    expect(view.shadowRoot?.querySelectorAll(".diff-content span")).toHaveLength(181);
    expect(view.shadowRoot?.querySelector("button.show-more")).toBeNull();
    expect(view.shadowRoot?.textContent).toContain("Full diff");
  });
});

async function mount(value?: ToolExecutionPart): Promise<ToolExecutionView> {
  const view = new ToolExecutionView();
  view.execution = value;
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function execution(patch: Partial<ToolExecutionPart> = {}): ToolExecutionPart {
  return {
    type: "toolExecution",
    toolName: "bash",
    summary: "run command",
    status: "success",
    resultText: "done",
    ...patch,
  };
}

function text(view: ToolExecutionView, selector: string): string {
  return view.shadowRoot?.querySelector(selector)?.textContent.trim() ?? "";
}
