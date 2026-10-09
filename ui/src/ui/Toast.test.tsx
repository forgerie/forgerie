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
afterEach(() => {
  act(() => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollWidth"); Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
});

/** happy-dom lays nothing out, so a test says whether a detail's first line is longer than its room. */
function previewsAreCut(cut: boolean) {
  const preview = (element: HTMLElement) => element.classList.contains("toast-preview-text");
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get(this: HTMLElement) { return preview(this) && cut ? 400 : 200; } });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get(this: HTMLElement) { return preview(this) ? 200 : 0; } });
}

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

  it("marks a failure beside its message, and the mark says nothing to a screen reader", () => {
    act(() => root.render(<><Toast tone="alert" message="Failed" /><Toast message="Plain" /></>));
    const [alert, plain] = [...document.querySelectorAll(".toast")];
    expect(alert?.querySelector(".toast-mark")?.getAttribute("aria-hidden")).toBe("true");
    expect(alert?.textContent).toBe("Failed");
    expect(plain?.querySelector(".toast-mark")).toBeNull();
  });

  it("shows in place when the page has no region", () => {
    act(() => root.render(<div className="here"><Toast message="Saved" /></div>));
    expect(document.querySelector(".here > .toast")?.textContent).toBe("Saved");
  });

  it("shows a long detail's first words, cut, and opens the whole text on a tap", () => {
    previewsAreCut(true);
    act(() => root.render(<Toast message="Archived Zed. Worktree kept." detail="It has commits that are not on main." action={{ label: "Undo", onPress: () => {} }} />));
    const detail = document.querySelector<HTMLElement>(".toast-detail");
    const more = () => document.querySelector<HTMLButtonElement>(".toast-more");
    expect(more()?.textContent).toBe("It has commits that are not on main.");
    expect(more()?.getAttribute("aria-expanded")).toBe("false");
    expect(more()?.getAttribute("aria-controls")).toBe(detail?.id);
    expect(detail?.hidden).toBe(true);
    act(() => more()?.click());
    expect(detail?.hidden).toBe(false);
    expect(more()?.textContent).toBe("Less");
    expect(more()?.getAttribute("aria-expanded")).toBe("true");
    act(() => more()?.click());
    expect(detail?.hidden).toBe(true);
    expect(more()?.textContent).toBe("It has commits that are not on main.");
  });

  it("shows a detail that fits as plain text, with nothing to open", () => {
    previewsAreCut(false);
    act(() => root.render(<Toast message="Archived Zed. Worktree kept." detail="Another session works in it." />));
    expect(document.querySelector(".toast-more")).toBeNull();
    expect(document.querySelector(".toast-preview")?.textContent).toBe("Another session works in it.");
  });

  it("draws no foot without a detail or an action", () => {
    act(() => root.render(<Toast message="Copied" onDismiss={() => {}} />));
    expect(document.querySelector(".toast-foot")).toBeNull();
    expect(document.querySelector(".toast-detail")).toBeNull();
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

  it("keeps notices persistent unless the caller supplies a timeout", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    act(() => root.render(<Toast message="Update ready" onDismiss={dismiss} />));
    act(() => vi.advanceTimersByTime(10000));
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("expires a timed notice without taking focus", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const input = document.body.appendChild(document.createElement("input")); input.focus();
    act(() => root.render(<><ToastRegion /><Toast message="Saved" durationMs={2500} onDismiss={dismiss} /></>));
    expect(document.querySelector('[data-toast-region] .toast')?.textContent).toBe("Saved");
    expect(document.activeElement).toBe(input);
    act(() => vi.advanceTimersByTime(2499)); expect(dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1)); expect(dismiss).toHaveBeenCalledOnce();
  });

  it.each(["hover", "focus"])("pauses a timed notice on %s and restarts its interval on leaving", (mode) => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    act(() => root.render(<Toast message="Saved" durationMs={2500} onDismiss={dismiss} />));
    act(() => vi.advanceTimersByTime(2000));
    const element = document.querySelector<HTMLElement>(mode === "hover" ? ".toast" : ".toast-message")!;
    act(() => { if (mode === "hover") element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); else element.focus(); });
    act(() => vi.advanceTimersByTime(10000)); expect(dismiss).not.toHaveBeenCalled();
    act(() => { if (mode === "hover") element.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); else element.blur(); });
    act(() => vi.advanceTimersByTime(2499)); expect(dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1)); expect(dismiss).toHaveBeenCalledOnce();
  });

  it("restarts for a new notice with the same words and uses the latest callback without resetting", () => {
    vi.useFakeTimers();
    const first = vi.fn(); const latest = vi.fn(); const initial = {}; const next = {};
    act(() => root.render(<Toast message="Saved" timerKey={initial} durationMs={2500} onDismiss={first} />));
    act(() => vi.advanceTimersByTime(2000));
    act(() => root.render(<Toast message="Saved" timerKey={next} durationMs={2500} onDismiss={first} />));
    act(() => vi.advanceTimersByTime(2000)); expect(first).not.toHaveBeenCalled();
    act(() => root.render(<Toast message="Saved" timerKey={next} durationMs={2500} onDismiss={latest} />));
    act(() => vi.advanceTimersByTime(500));
    expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledOnce();
  });

  it("clears a timed notice on unmount", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    act(() => root.render(<Toast message="Saved" durationMs={2500} onDismiss={dismiss} />));
    act(() => root.render(null));
    act(() => vi.advanceTimersByTime(10000)); expect(dismiss).not.toHaveBeenCalled();
  });
});
