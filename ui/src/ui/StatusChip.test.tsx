// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusChip, type StatusChipPanel } from "./StatusChip";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const live = () => document.querySelector(".status-chip-live")?.textContent;
const face = () => document.querySelector<HTMLElement>(".status-chip-face");
const panel = () => document.querySelector(".status-chip-panel");
const detail = (onPress = () => undefined): StatusChipPanel => ({ title: "2 problems", actions: [{ label: "Dismiss all", onPress }], children: <p>Overloaded</p> });

describe("status chip", () => {
  it("draws nothing for a quiet status but keeps announcing it", () => {
    act(() => root.render(<StatusChip label="Connected" tone="quiet" />));
    expect(live()).toBe("Connected");
    expect(face()).toBeNull();
  });

  it("is a plain word without a panel", () => {
    act(() => root.render(<StatusChip label="Running" tone="live" />));
    expect(face()?.tagName).toBe("SPAN");
    expect(face()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("is a button with a panel, and reads its count with the label", () => {
    act(() => root.render(<StatusChip label="Running" tone="live" count={2} countLabel="2 problems" panel={detail()} />));
    expect(live()).toBe("Running, 2 problems");
    expect(face()?.tagName).toBe("BUTTON");
    expect(face()?.getAttribute("aria-label")).toBe("Running, 2 problems. Show details");
    expect(document.querySelector(".status-chip-count")?.textContent).toBe("2");
    expect(panel()).toBeNull();
    act(() => face()?.click());
    expect(face()?.getAttribute("aria-expanded")).toBe("true");
    expect(panel()?.textContent).toContain("Overloaded");
    expect(document.activeElement).toBe(panel());
  });

  it("closes on Escape, on the scrim, and on close, and gives focus back to the chip", () => {
    act(() => root.render(<StatusChip label="Problem" tone="bad" panel={detail()} />));
    act(() => face()?.click());
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(face());
    act(() => face()?.click());
    act(() => document.querySelector<HTMLElement>(".status-chip-scrim")?.click());
    expect(panel()).toBeNull();
    act(() => face()?.click());
    act(() => document.querySelector<HTMLElement>(".status-chip-close")?.click());
    expect(panel()).toBeNull();
  });

  it("runs a head action, and closes when nothing is left to show", () => {
    const onPress = vi.fn();
    act(() => root.render(<StatusChip label="Problem" tone="bad" panel={detail(onPress)} />));
    act(() => face()?.click());
    act(() => [...document.querySelectorAll<HTMLElement>(".status-chip-action")].find((node) => node.textContent === "Dismiss all")?.click());
    expect(onPress).toHaveBeenCalledOnce();
    act(() => root.render(<StatusChip label="Connected" tone="quiet" />));
    expect(panel()).toBeNull();
    act(() => root.render(<StatusChip label="Problem" tone="bad" panel={detail()} />));
    expect(panel()).toBeNull();
  });

  it("rings again for each new arrival", () => {
    act(() => root.render(<StatusChip label="Problem" tone="bad" ring={1} panel={detail()} />));
    const first = document.querySelector(".status-chip-ring");
    expect(first).not.toBeNull();
    act(() => root.render(<StatusChip label="Problem" tone="bad" ring={2} panel={detail()} />));
    expect(document.querySelector(".status-chip-ring")).not.toBe(first);
  });
});
