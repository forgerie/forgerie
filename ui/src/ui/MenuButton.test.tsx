// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MenuButton } from "./MenuButton";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/** Opens a window-level menu of a given size from a button at a given place, in a window of a given size. */
async function open(button: DOMRect, menu: { width: number; height: number }, window_: { width: number; height: number }, align?: "start" | "end") {
  vi.stubGlobal("innerWidth", window_.width);
  vi.stubGlobal("innerHeight", window_.height);
  vi.stubGlobal("visualViewport", undefined);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => button);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.getAttribute("role") === "menu" ? menu.height : 0; });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.getAttribute("role") === "menu" ? menu.width : 0; });
  await act(async () => root.render(<MenuButton label="Commands" layer="window" align={align}
    commands={[{ label: "Run now…", onSelect: () => undefined }, { label: "Delete…", onSelect: () => undefined }]} />));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  const element = document.querySelector<HTMLElement>('[role="menu"]')!;
  return { top: parseFloat(element.style.top), left: parseFloat(element.style.left) };
}

it("opens under the button while the room below fits it", async () => {
  expect(await open(rect(600, 40, 32, 32), { width: 208, height: 180 }, { width: 711, height: 374 })).toEqual({ top: 76, left: 424 });
});

it("opens above the button when the room below is short", async () => {
  expect(await open(rect(600, 300, 32, 32), { width: 208, height: 180 }, { width: 711, height: 374 })).toEqual({ top: 116, left: 424 });
});

it("stays 4px inside a short window when neither side has room", async () => {
  // A bottom row in a 711 × 374 window: 180px fits neither under nor above a button at 150.
  const placed = await open(rect(600, 150, 32, 32), { width: 208, height: 250 }, { width: 711, height: 374 });
  expect(placed.top).toBe(374 - 250 - 4);
  expect(placed.top).toBeGreaterThanOrEqual(4);
});

it("stays 4px inside the window's start", async () => {
  expect((await open(rect(2, 40, 32, 32), { width: 208, height: 180 }, { width: 352, height: 783 })).left).toBe(4);
});

it("stays 4px inside the window's end", async () => {
  expect((await open(rect(330, 40, 32, 32), { width: 208, height: 180 }, { width: 352, height: 783 }, "start")).left).toBe(352 - 208 - 4);
});

it.each(["window", "inline"] as const)("gives focus back to its button when Escape closes a %s menu", async (layer) => {
  await act(async () => root.render(<MenuButton label="Commands" layer={layer} commands={[{ label: "Run now…", onSelect: () => undefined }]} />));
  const trigger = host.querySelector<HTMLButtonElement>("button")!;
  await act(async () => trigger.click());
  const item = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  expect(document.activeElement).toBe(item);
  await act(async () => { item.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("leaves focus where a press outside put it", async () => {
  const outside = document.createElement("input");
  document.body.append(outside);
  await act(async () => root.render(<MenuButton label="Commands" layer="window" commands={[{ label: "Run now…", onSelect: () => undefined }]} />));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => { outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); outside.focus(); });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(outside);
  // Escape with focus outside a closed menu moves nothing.
  await act(async () => { outside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(document.activeElement).toBe(outside);
  outside.remove();
});
