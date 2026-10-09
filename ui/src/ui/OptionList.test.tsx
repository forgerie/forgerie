// @vitest-environment happy-dom
import { act, createRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OptionList, type OptionGroup, type OptionListHandle } from "./OptionList";

let root: Root;
const groups: OptionGroup[] = [
  { key: "favorites", label: "Favorites", options: [{ id: "a", name: "Alpha", details: ["1m context"] }, { id: "b", name: "Beta", current: true }] },
  { key: "rest", label: "Rest", options: [{ id: "c", name: "Gamma", details: [{ text: "/long/path/to/gamma", truncate: "start" }] }] },
];
const render = (node: ReactElement) => act(async () => root.render(node));
const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".option-row")];
const key = (target: Element, name: string) => act(async () => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("option list", () => {
  it("in focus mode, names each group, moves focus with the arrow keys from the search field, and chooses on press", async () => {
    const onChoose = vi.fn();
    const list = createRef<OptionListHandle>();
    await render(<OptionList ref={list} label="Models" groups={groups} input={{ type: "focus", onChoose }}
      search={{ value: "", onChange: () => {}, label: "Search models", placeholder: "Search models" }} />);
    expect([...document.querySelectorAll("h3")].map((node) => node.textContent)).toEqual(["Favorites", "Rest"]);
    expect(document.querySelector("section")?.getAttribute("aria-labelledby")).toBe(document.querySelector("h3")?.id);
    expect(rows()[1]?.getAttribute("aria-current")).toBe("true");
    const search = document.querySelector<HTMLInputElement>("input[type=search]")!;
    search.focus();
    await key(search, "ArrowDown");
    expect(document.activeElement).toBe(rows()[0]);
    await key(rows()[0]!, "ArrowUp");
    expect(document.activeElement).toBe(rows()[0]);
    await key(rows()[0]!, "ArrowDown"); await key(rows()[1]!, "ArrowDown");
    expect(document.activeElement).toBe(rows()[2]);
    await act(async () => rows()[2]!.click());
    expect(onChoose).toHaveBeenCalledWith("c");
    // The handle focuses a row by id, else the current one.
    await act(async () => { list.current!.focus(); });
    expect(document.activeElement).toBe(rows()[1]);
    await act(async () => { list.current!.focus("a"); });
    expect(document.activeElement).toBe(rows()[0]);
  });

  it("in highlight mode, wraps every row, keeps focus out of the list, and leaves the arrow keys to the field", async () => {
    const wrapped: string[] = [];
    await render(<OptionList label="Models" groups={groups} action={{ label: "Show 2 hidden models", onPress: () => {} }}
      input={{ type: "highlight", wrap: (row, option) => { wrapped.push(option.id); return row; } }} />);
    expect(wrapped).toEqual(["a", "b", "c"]);
    expect(rows().every((row) => row.tabIndex === -1)).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".option-list-action")!.tabIndex).toBe(-1);
    // A listbox allows groups and options only, so no list items or section headings are drawn.
    expect(document.querySelectorAll("ul, li, h3")).toHaveLength(0);
    expect([...document.querySelectorAll("[role=group]")].map((node) => node.getAttribute("aria-labelledby"))).toHaveLength(2);
    const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    await act(async () => { rows()[0]!.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  });

  it("states loading, empty, and failure as one line, and a refused choice as an alert", async () => {
    await render(<OptionList label="Projects" groups={[]} status={{ tone: "status", text: "Loading projects…" }} input={{ type: "focus", onChoose: () => {} }} />);
    expect(document.querySelector("[role=status]")?.textContent).toBe("Loading projects…");
    await render(<OptionList label="Models" groups={groups} alert="Model not found" status={{ tone: "alert", text: "Models unavailable" }}
      input={{ type: "focus", onChoose: () => {} }} />);
    expect([...document.querySelectorAll("[role=alert]")].map((node) => node.textContent)).toEqual(["Model not found", "Models unavailable"]);
    expect(document.querySelector(".option-row-path")?.getAttribute("title")).toBe("/long/path/to/gamma");
  });
});
