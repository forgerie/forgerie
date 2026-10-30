// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ArchiveNextButton } from "./ArchiveNext";

it("confirms permanent deletion for ephemeral sessions, but archives ordinary sessions in one click", () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), onArchive = vi.fn();
  try {
    act(() => root.render(<ArchiveNextButton availability={{ type: "ready" }} deletion={{ title: "Delete this ephemeral session?", message: "This cannot be undone." }} onArchive={onArchive} />));
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Delete and next");
    act(() => button.click()); expect(onArchive).not.toHaveBeenCalled();
    const confirm = document.querySelector<HTMLButtonElement>(".wt-dialog .wt-primary");
    expect(confirm?.textContent).toBe("Delete permanently");
    expect(document.activeElement?.textContent).toBe("Cancel");
    act(() => confirm?.click()); expect(onArchive).toHaveBeenCalledOnce();
    act(() => root.render(<ArchiveNextButton availability={{ type: "ready" }} onArchive={onArchive} />));
    expect(button.getAttribute("aria-label")).toBe("Archive and next");
    act(() => button.click()); expect(onArchive).toHaveBeenCalledTimes(2);
  } finally { act(() => root.unmount()); host.remove(); }
});
