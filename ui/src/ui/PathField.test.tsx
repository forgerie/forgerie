// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PathField, type PathSuggest } from "./PathField";
import { TextSubmit } from "./TextSubmit";
import { suggestFolders } from "./fixtures/paths";

let root: Root;
const input = () => document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const options = () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(65); });
const type = (value: string) => act(async () => {
  input().focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
  input().dispatchEvent(new Event("input", { bubbles: true }));
});
const key = async (name: string, extra: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...extra });
  await act(async () => input().dispatchEvent(event));
  return event;
};
function Field({ source = suggestFolders, disabled = false }: { source?: PathSuggest; disabled?: boolean }) {
  const [value, setValue] = useState("");
  return <PathField aria-label="Folder" value={value} onChange={setValue} disabled={disabled} suggestions={{ label: "Folders", source }} />;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it("opens on typing, wraps keyboard navigation, and inserts plain folder paths with Enter and Tab", async () => {
  await act(async () => root.render(<Field />));
  expect(input().getAttribute("aria-expanded")).toBe("false");
  await type("/code/"); await settle();
  expect(options().length).toBe(4);
  expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
  expect(input().getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
  await key("ArrowUp");
  expect(options().at(-1)?.getAttribute("aria-selected")).toBe("true");
  await key("ArrowDown"); await key("ArrowDown");
  expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
  expect((await key("Enter")).defaultPrevented).toBe(true);
  expect(input().value).toBe("/code/forgerie/");
  await settle();
  expect(options().map((row) => row.textContent)).toEqual(["/code/forgerie/ui/", "/code/forgerie/src/"]);
  // A completed folder is already usable: Enter must not accidentally pick its first child.
  expect(input().hasAttribute("aria-activedescendant")).toBe(false);
  expect((await key("Tab")).defaultPrevented).toBe(true);
  expect(input().value).toBe("/code/forgerie/ui/");
  expect(document.activeElement).toBe(input());
});

it("closes on Escape, blur and dismissal, and reopens with ArrowDown", async () => {
  await act(async () => root.render(<Field />));
  await type("/code/"); await settle();
  expect((await key("Escape")).defaultPrevented).toBe(true);
  expect(input().value).toBe("/code/");
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  await key("ArrowDown"); await settle();
  expect(options().length).toBe(4);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Dismiss folders suggestions"]')!.click());
  expect(input().getAttribute("aria-expanded")).toBe("false");
  await key("ArrowDown"); await settle();
  await act(async () => input().blur());
  expect(input().getAttribute("aria-expanded")).toBe("false");
});

it("keeps focus on pointer selection, drills into folders, and leaves Shift+Tab free", async () => {
  await act(async () => root.render(<Field />));
  await type("/code/"); await settle();
  expect((await key("Tab", { shiftKey: true })).defaultPrevented).toBe(false);
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  await act(async () => { options()[1]!.dispatchEvent(down); options()[1]!.click(); });
  expect(down.defaultPrevented).toBe(true);
  expect(input().value).toBe("/code/forgerie/");
  expect(document.activeElement).toBe(input());
  await settle();
  await key("ArrowDown");
  expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
});

it("closes after completing a file rather than looking for children", async () => {
  const source: PathSuggest = async () => ["/code/README.md"];
  await act(async () => root.render(<Field source={source} />));
  await type("/code/R"); await settle(); await key("Enter");
  expect(input().value).toBe("/code/README.md");
  expect(input().getAttribute("aria-expanded")).toBe("false");
});

it("aborts old queries and does not show a late response for the wrong path", async () => {
  const pending: { query: string; signal: AbortSignal; resolve: (paths: string[]) => void }[] = [];
  const source: PathSuggest = (query, signal) => new Promise((resolve) => pending.push({ query, signal, resolve }));
  await act(async () => root.render(<Field source={source} />));
  await type("/old"); await settle();
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Searching…");
  await type("/new"); await settle();
  expect(pending[0]!.signal.aborted).toBe(true);
  await act(async () => pending[1]!.resolve(["/new/"]));
  await act(async () => pending[0]!.resolve(["/old/"]));
  expect(options().map((row) => row.textContent)).toEqual(["/new/"]);
  await key("Escape");
  expect(pending[1]!.signal.aborted).toBe(true);
});

it("shows errors without blocking manual entry, and handles no matches", async () => {
  const source: PathSuggest = async () => { throw new Error("Cannot read folders"); };
  await act(async () => root.render(<Field source={source} />));
  await type("/code/"); await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Cannot read folders");
  expect((await key("Enter")).defaultPrevented).toBe(false);
  await act(async () => root.render(<Field />));
  await type("/missing/new/"); await settle();
  expect(document.querySelector('[role="status"]')?.textContent).toBe("No matching folders.");
  expect((await key("Enter")).defaultPrevented).toBe(false);
});

it("does not consume IME composition keys or open a disabled field", async () => {
  await act(async () => root.render(<Field />));
  await type("/code/"); await settle();
  expect((await key("Enter", { isComposing: true })).defaultPrevented).toBe(false);
  expect(input().value).toBe("/code/");
  await act(async () => root.render(<Field disabled />));
  expect(input().disabled).toBe(true);
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});

it("lets TextSubmit offer creation of an unmatched folder and clear it only after confirmation", async () => {
  const submitted: string[] = [];
  const created: string[] = [];
  await act(async () => root.render(<TextSubmit label="Add a project folder" placeholder="/path" action="Add folder" pending={false}
    suggestions={{ label: "Folders", source: suggestFolders }} onSubmit={async (value) => {
      submitted.push(value);
      return { message: `Create ${value}?`, action: "Create folder", run: async () => { created.push(value); } };
    }} />));
  await type("/code/new-repo"); await settle();
  await act(async () => document.querySelector("form")!.requestSubmit());
  expect(submitted).toEqual(["/code/new-repo"]);
  expect(created).toEqual([]);
  expect(input().value).toBe("/code/new-repo");
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Create folder")!;
  await act(async () => button.click());
  expect(created).toEqual(["/code/new-repo"]);
  expect(input().value).toBe("");
});
