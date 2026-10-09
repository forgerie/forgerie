// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("gives Cancel the first focus even when the body scrolls and showModal focuses it", async () => {
  // A browser's showModal moves focus to the first focusable element; a body that scrolls is one.
  const showModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
    const body = this.querySelector<HTMLElement>(".wt-body");
    if (body) { body.tabIndex = 0; body.focus(); }
  };
  try {
    await act(async () => root.render(<ConfirmDialog title="Use a reset?" confirmLabel="Use reset" onConfirm={() => {}} onCancel={() => {}}>
      <p>Long body.</p></ConfirmDialog>));
    expect(document.activeElement?.textContent).toBe("Cancel");
  } finally {
    HTMLDialogElement.prototype.showModal = showModal;
  }
});
