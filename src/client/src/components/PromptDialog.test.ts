// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { PromptDialog } from "./PromptDialog";
import { deepActiveElement, pressKey, requiredElement, settleRenderedDialog } from "./modalSurfaceTestSupport";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});

describe("prompt-dialog", () => {
  it("focuses the name field and keeps Save disabled until both fields are filled", async () => {
    const dialog = await mountDialog();

    expect(deepActiveElement()).toBe(nameInput(dialog));
    expect(saveButton(dialog).disabled).toBe(true);

    setValue(nameInput(dialog), "tell");
    await dialog.updateComplete;
    expect(saveButton(dialog).disabled).toBe(true);

    setValue(bodyInput(dialog), "Speak plainly.");
    await dialog.updateComplete;
    expect(saveButton(dialog).disabled).toBe(false);
  });

  it("saves through the machine's prompt endpoint and reports the written path", async () => {
    const savePrompt = vi.spyOn(api, "savePrompt").mockResolvedValue({ name: "tell", path: "/home/u/.pi/agent/prompts/tell.md" });
    const dialog = await mountDialog({ machineId: "devbox" });
    setValue(nameInput(dialog), " Tell ");
    setValue(bodyInput(dialog), "Speak plainly.");
    await dialog.updateComplete;

    saveButton(dialog).click();
    await settleRenderedDialog(dialog);

    expect(savePrompt).toHaveBeenCalledWith("Tell", "Speak plainly.", "devbox");
    expect(dialog.shadowRoot?.textContent).toContain("/tell");
    expect(dialog.shadowRoot?.textContent).toContain("/home/u/.pi/agent/prompts/tell.md");
    expect(dialog.shadowRoot?.textContent).toContain("/reload");
  });

  it("shows the server's refusal and keeps the draft for editing", async () => {
    vi.spyOn(api, "savePrompt").mockRejectedValue(new Error("/tell already exists at /home/u/.pi/agent/prompts/tell.md"));
    const dialog = await mountDialog();
    setValue(nameInput(dialog), "tell");
    setValue(bodyInput(dialog), "Speak plainly.");
    await dialog.updateComplete;

    saveButton(dialog).click();
    await settleRenderedDialog(dialog);

    expect(requiredElement(dialog.shadowRoot?.querySelector("[role='alert']"), "prompt-dialog error").textContent).toContain("already exists");
    expect(bodyInput(dialog).value).toBe("Speak plainly.");
  });

  it("saves on Ctrl+Enter so Enter stays a newline in the prompt body", async () => {
    const savePrompt = vi.spyOn(api, "savePrompt").mockResolvedValue({ name: "tell", path: "/prompts/tell.md" });
    const dialog = await mountDialog();
    setValue(nameInput(dialog), "tell");
    setValue(bodyInput(dialog), "Line one.");
    await dialog.updateComplete;

    const plainEnter = pressKey(bodyInput(dialog), "Enter");
    await dialog.updateComplete;
    expect(plainEnter.defaultPrevented).toBe(false);
    expect(savePrompt).not.toHaveBeenCalled();

    bodyInput(dialog).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true, composed: true }));
    await settleRenderedDialog(dialog);

    expect(savePrompt).toHaveBeenCalledWith("tell", "Line one.", "local");
  });

  it("starts a second prompt without reopening the dialog", async () => {
    vi.spyOn(api, "savePrompt").mockResolvedValue({ name: "tell", path: "/prompts/tell.md" });
    const dialog = await mountDialog();
    setValue(nameInput(dialog), "tell");
    setValue(bodyInput(dialog), "Speak plainly.");
    await dialog.updateComplete;
    saveButton(dialog).click();
    await settleRenderedDialog(dialog);

    buttonLabelled(dialog, "Write another").click();
    await settleRenderedDialog(dialog);

    expect(nameInput(dialog).value).toBe("");
    expect(bodyInput(dialog).value).toBe("");
  });

  it("opens with a body the caller supplied", async () => {
    const dialog = await mountDialog({ initialBody: "Speak plainly." });

    expect(bodyInput(dialog).value).toBe("Speak plainly.");
  });

  it("closes on Escape and on the explicit close controls", async () => {
    const onClose = vi.fn<() => void>();
    const dialog = await mountDialog({ onClose });

    pressKey(nameInput(dialog), "Escape");
    expect(onClose).toHaveBeenCalledOnce();

    buttonLabelled(dialog, "Cancel").click();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

async function mountDialog(props: { onClose?: () => void; machineId?: string; initialBody?: string } = {}): Promise<PromptDialog> {
  const dialog = new PromptDialog();
  Object.assign(dialog, props);
  document.body.append(dialog);
  await settleRenderedDialog(dialog);
  return dialog;
}

function nameInput(dialog: PromptDialog): HTMLInputElement {
  return requiredElement(dialog.shadowRoot?.querySelector<HTMLInputElement>("input[name='prompt-name']"), "prompt-dialog name input");
}

function bodyInput(dialog: PromptDialog): HTMLTextAreaElement {
  return requiredElement(dialog.shadowRoot?.querySelector<HTMLTextAreaElement>("textarea[name='prompt-body']"), "prompt-dialog body input");
}

function saveButton(dialog: PromptDialog): HTMLButtonElement {
  return buttonLabelled(dialog, "Save prompt");
}

function buttonLabelled(dialog: PromptDialog, label: string): HTMLButtonElement {
  const buttons = Array.from(dialog.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? []);
  const match = buttons.find((button) => button.textContent.trim() === label);
  if (match === undefined) throw new Error(`Expected a "${label}" button in prompt-dialog`);
  return match;
}

function setValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}
