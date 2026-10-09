// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast";
import { ToastRegion } from "./ToastRegion";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("toast", () => {
  it("shows in the page's one region, wherever it is rendered, newest last", () => {
    act(() => root.render(<>
      <div className="deep"><div><Toast message="First" /></div></div>
      <ToastRegion />
      <Toast tone="alert" message="Second" />
    </>));
    const region = document.querySelector("[data-toast-region]");
    expect([...region?.querySelectorAll(".toast") ?? []].map((toast) => toast.textContent)).toEqual(["First", "Second"]);
    expect(document.querySelector(".deep .toast")).toBeNull();
    expect(region?.getAttribute("aria-label")).toBe("Notifications");
    expect(region?.querySelector('[role="alert"]')?.textContent).toBe("Second");
  });

  it("shows in place when the page has no region", () => {
    act(() => root.render(<div className="here"><Toast message="Saved" /></div>));
    expect(document.querySelector(".here > .toast")?.textContent).toBe("Saved");
  });

  it("runs its action and its dismiss, and draws neither when not given", () => {
    const onPress = vi.fn();
    const onDismiss = vi.fn();
    act(() => root.render(<Toast message="Archived" action={{ label: "Undo", onPress }} onDismiss={onDismiss} dismissLabel="Not now" detail="Kept it." />));
    act(() => document.querySelector<HTMLButtonElement>(".toast-action")?.click());
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Not now"]')?.click());
    expect(onPress).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(document.querySelector(".toast-detail")?.textContent).toBe("Kept it.");
    act(() => root.render(<Toast message="Plain" />));
    expect(document.querySelectorAll(".toast button")).toHaveLength(0);
  });
});
