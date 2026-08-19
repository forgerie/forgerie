// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { deepActiveElement, dialogSection, dialogSurface, pressKey, requiredElement, settleRenderedDialog, surfaceBackdrop } from "./modalSurfaceTestSupport";
import type { SessionCleanupExecuteResponse, SessionCleanupPreviewResponse, SessionCleanupRequest } from "../api";
import { SessionCleanupDialog } from "./SessionCleanupDialog";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("session-cleanup-dialog modal surface", () => {
  it("moves focus into the labelled dialog when opened", async () => {
    const dialog = await mountDialog();

    expect(deepActiveElement()).toBe(dialogSection(dialog));
    expect(dialogSection(dialog).getAttribute("aria-label")).toBe("Clean up sessions");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn<() => void>();
    const dialog = await mountDialog({ onClose });

    pressKey(dialogSurface(dialog), "Escape");

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when the backdrop itself is pressed", async () => {
    const onClose = vi.fn<() => void>();
    const dialog = await mountDialog({ onClose });

    surfaceBackdrop(dialog).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("moves focus from the dialog section to the first dialog control on Tab", async () => {
    const dialog = await mountDialog();
    const closeButton = requiredElement(dialog.shadowRoot?.querySelector<HTMLButtonElement>("header .close-button"), "cleanup close button");
    expect(deepActiveElement()).toBe(dialogSection(dialog));

    pressKey(dialogSurface(dialog), "Tab");

    expect(deepActiveElement()).toBe(closeButton);
  });

  it("previews the default cleanup request", async () => {
    const onPreview = vi.fn<(request: SessionCleanupRequest) => void>();
    const dialog = await mountDialog({ onPreview });

    button(dialog, "Preview").click();

    expect(onPreview).toHaveBeenCalledWith({ archiveIdleDays: 30, deleteArchivedDays: null });
  });

  it("renders project selection, busy skips, and cleanup results", async () => {
    const dialog = await mountDialog({
      preview,
      previewRequest,
      result: { ...preview, archivedSessionIds: ["a"], deletedSessionIds: ["d1", "d2"] },
    });

    expect(dialog.shadowRoot?.textContent).toContain("2 of 2 projects selected");
    expect(dialog.shadowRoot?.textContent).toContain("3 busy sessions were skipped");
    expect(dialog.shadowRoot?.textContent).toContain("Archived 1 session; permanently deleted 2 archived sessions");
    expect(dialog.shadowRoot?.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(button(dialog, "Run cleanup").disabled).toBe(false);
  });

  it("runs only selected projects after confirmation", async () => {
    const onRun = vi.fn<(request: SessionCleanupRequest) => void>();
    vi.stubGlobal("confirm", vi.fn(() => true));
    const dialog = await mountDialog({ preview, previewRequest, onRun });

    const projectCheckboxes = dialog.shadowRoot?.querySelectorAll<HTMLInputElement>("tbody input[type='checkbox']");
    const second = projectCheckboxes?.[1];
    if (second === undefined) throw new Error("Expected second project checkbox");
    second.checked = false;
    second.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await dialog.updateComplete;

    button(dialog, "Run cleanup").click();

    expect(confirm).toHaveBeenCalledOnce();
    expect(onRun).toHaveBeenCalledWith({ archiveIdleDays: 30, deleteArchivedDays: null, projectCwds: ["/repo-a"] });
  });

  it("blocks cleanup after all projects are deselected", async () => {
    const onRun = vi.fn<(request: SessionCleanupRequest) => void>();
    const dialog = await mountDialog({ preview, previewRequest, onRun });

    button(dialog, "Deselect all").click();
    await dialog.updateComplete;

    expect(dialog.shadowRoot?.textContent).toContain("Select at least one project to run cleanup");
    expect(button(dialog, "Run cleanup").disabled).toBe(true);
    expect(onRun).not.toHaveBeenCalled();

    button(dialog, "Select all").click();
    await dialog.updateComplete;
    expect(button(dialog, "Run cleanup").disabled).toBe(false);
  });

  it("requires another preview after threshold changes", async () => {
    const dialog = await mountDialog({ preview, previewRequest });
    const days = requiredElement(dialog.shadowRoot?.querySelector<HTMLInputElement>("input.days"), "archive days input");
    days.value = "31";
    days.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await dialog.updateComplete;

    expect(dialog.shadowRoot?.textContent).toContain("Thresholds changed. Preview again before running cleanup");
    expect(button(dialog, "Run cleanup").disabled).toBe(true);
  });
});

interface SessionCleanupDialogCallbacks {
  onClose?: () => void;
  onPreview?: (request: SessionCleanupRequest) => void;
  onRun?: (request: SessionCleanupRequest) => void;
  preview?: SessionCleanupPreviewResponse;
  previewRequest?: SessionCleanupRequest;
  result?: SessionCleanupExecuteResponse;
}

const previewRequest: SessionCleanupRequest = { archiveIdleDays: 30, deleteArchivedDays: null };
const preview: SessionCleanupPreviewResponse = {
  generatedAt: "now",
  thresholds: { archiveIdleDays: 30, deleteArchivedDays: 90 },
  projects: [
    { cwd: "/repo-a", archiveCount: 2, deleteCount: 0 },
    { cwd: "/repo-b", archiveCount: 1, deleteCount: 2 },
  ],
  totals: { archiveCount: 3, deleteCount: 2 },
  skippedBusySessionIds: ["busy-1", "busy-2", "busy-3"],
};

async function mountDialog(callbacks: SessionCleanupDialogCallbacks = {}): Promise<SessionCleanupDialog> {
  const dialog = new SessionCleanupDialog();
  Object.assign(dialog, callbacks);
  document.body.append(dialog);
  await settleRenderedDialog(dialog);
  return dialog;
}

function button(dialog: SessionCleanupDialog, label: string): HTMLButtonElement {
  const match = Array.from(dialog.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((candidate) => candidate.textContent.trim() === label);
  return requiredElement(match, `${label} button`);
}
