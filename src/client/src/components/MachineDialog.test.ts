// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { MachineDialog, machineBaseUrlValidationMessage, suggestedMachineNameFromUrl } from "./MachineDialog";
import { deepActiveElement, pressKey, requiredElement, settleRenderedDialog } from "./modalSurfaceTestSupport";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("machine-dialog modal surface", () => {
  it("focuses the base URL input when opened", async () => {
    const dialog = await mountDialog();

    expect(deepActiveElement()).toBe(urlInput(dialog));
  });

  it("cancels on Escape", async () => {
    const onCancel = vi.fn<() => void>();
    const dialog = await mountDialog({ onCancel });

    pressKey(urlInput(dialog), "Escape");

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("moves focus to the machine name on Enter in a valid base URL", async () => {
    const dialog = await mountDialog();
    const url = urlInput(dialog);
    url.value = "http://devbox.local:8504";
    url.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settleRenderedDialog(dialog);

    pressKey(url, "Enter");
    await settleRenderedDialog(dialog);

    expect(deepActiveElement()).toBe(nameInput(dialog));
  });

  it("suggests a name, preserves edits, and submits an optional token", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const dialog = await mountDialog({ onSubmit });
    setInput(urlInput(dialog), "https://devbox.example.test:8504");
    await dialog.updateComplete;
    expect(nameInput(dialog).value).toBe("devbox.example.test");

    setInput(nameInput(dialog), "Friendly Box");
    setInput(urlInput(dialog), "https://changed.example.test:8504");
    const token = requiredElement(dialog.shadowRoot?.querySelector<HTMLInputElement>("input[name='token']"), "machine token input");
    setInput(token, "secret");
    await dialog.updateComplete;

    requiredElement(dialog.shadowRoot?.querySelector<HTMLButtonElement>("button[type='submit']"), "submit button").click();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledWith({ name: "Friendly Box", baseUrl: "https://changed.example.test:8504", token: "secret" });
  });

  it("shows URL validation and server errors", async () => {
    const dialog = await mountDialog({ error: "Remote rejected" });
    setInput(urlInput(dialog), "ftp://devbox.example.test");
    await dialog.updateComplete;

    expect(dialog.shadowRoot?.textContent).toContain("Use an http:// or https:// URL");
    expect(dialog.shadowRoot?.textContent).toContain("Remote rejected");
    expect(requiredElement(dialog.shadowRoot?.querySelector<HTMLButtonElement>("button[type='submit']"), "submit button").disabled).toBe(true);
  });

  it("routes explicit cancel controls", async () => {
    const onCancel = vi.fn();
    const dialog = await mountDialog({ onCancel });
    const cancelButtons = Array.from(dialog.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? []).filter((button) => button.textContent.trim() === "Cancel" || button.getAttribute("aria-label") === "Close");

    for (const button of cancelButtons) button.click();

    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

async function mountDialog(props: { onCancel?: () => void; onSubmit?: MachineDialog["onSubmit"]; error?: string } = {}): Promise<MachineDialog> {
  const dialog = new MachineDialog();
  Object.assign(dialog, props);
  document.body.append(dialog);
  await settleRenderedDialog(dialog);
  return dialog;
}

function urlInput(dialog: MachineDialog): HTMLInputElement {
  return requiredElement(dialog.shadowRoot?.querySelector<HTMLInputElement>("input[name='baseUrl']"), "machine-dialog base URL input");
}

function nameInput(dialog: MachineDialog): HTMLInputElement {
  return requiredElement(dialog.shadowRoot?.querySelector<HTMLInputElement>("input[name='name']"), "machine-dialog name input");
}

function setInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

describe("suggestedMachineNameFromUrl", () => {
  it("suggests the host without protocol or port", () => {
    expect(suggestedMachineNameFromUrl("http://127.0.0.1:8504")).toBe("127.0.0.1");
    expect(suggestedMachineNameFromUrl("https://devbox.example.test:8504/pi-web")).toBe("devbox.example.test");
  });

  it("also suggests a host while the URL protocol is being typed", () => {
    expect(suggestedMachineNameFromUrl("devbox.local:8504")).toBe("devbox.local");
    expect(suggestedMachineNameFromUrl("http://[::1]:8504")).toBe("::1");
    expect(suggestedMachineNameFromUrl("")).toBe("");
  });
});

describe("machineBaseUrlValidationMessage", () => {
  it("accepts http and https base URLs", () => {
    expect(machineBaseUrlValidationMessage("http://127.0.0.1:8504")).toBeUndefined();
    expect(machineBaseUrlValidationMessage("https://devbox.example.test/pi-web")).toBeUndefined();
  });

  it("explains invalid machine URLs", () => {
    expect(machineBaseUrlValidationMessage("")).toBe("Remote Forgerie URL is required.");
    expect(machineBaseUrlValidationMessage("devbox.local:8504")).toBe("Use an http:// or https:// URL.");
    expect(machineBaseUrlValidationMessage("ftp://devbox.example.test")).toBe("Use an http:// or https:// URL.");
    expect(machineBaseUrlValidationMessage("https://user@devbox.example.test")).toBe("Do not include credentials in the machine URL.");
    expect(machineBaseUrlValidationMessage("https://devbox.example.test?q=1")).toBe("Do not include a query string or fragment.");
    expect(machineBaseUrlValidationMessage("https://devbox.example.test#section")).toBe("Do not include a query string or fragment.");
  });
});
