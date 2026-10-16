// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PinnedDock } from "./PinnedDock";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const heading = () => document.querySelector<HTMLButtonElement>(".pinned-dock-heading")!;
const items = () => document.querySelector<HTMLElement>(".pinned-dock-items")!;
const render = (keys: string[], names: string[]) => act(async () => {
  root.render(<PinnedDock label={`${String(keys.length)} waiting for you`} names={names} keys={keys}>
    {keys.map((key) => <input key={key} aria-label={key} />)}
  </PinnedDock>);
});

describe("a pinned dock", () => {
  it("folds to its heading, which then names what waits, and opens again", async () => {
    await render(["s:1"], ["Land"]);
    expect(heading().getAttribute("aria-expanded")).toBe("true");
    expect(heading().getAttribute("aria-controls")).toBe(items().id);
    expect(heading().textContent).toBe("1 waiting for you");
    await act(async () => { heading().click(); });
    expect(heading().getAttribute("aria-expanded")).toBe("false");
    expect(items().hidden).toBe(true);
    expect(heading().textContent).toBe("1 waiting for youLand");
    await act(async () => { heading().click(); });
    expect(items().hidden).toBe(false);
    expect(heading().textContent).toBe("1 waiting for you");
  });

  it("keeps a folded item's half-written answer", async () => {
    await render(["s:1"], ["Land"]);
    document.querySelector("input")!.value = "half an answer";
    await act(async () => { heading().click(); });
    await act(async () => { heading().click(); });
    expect(document.querySelector("input")?.value).toBe("half an answer");
  });

  it("opens again when a new item arrives, but stays folded when one leaves", async () => {
    await render(["s:1", "q:2"], ["Land", "ui's question"]);
    await act(async () => { heading().click(); });
    await render(["s:1"], ["Land"]);
    expect(items().hidden).toBe(true);
    await render(["s:1", "g:3"], ["Land", "approval for the parent"]);
    expect(items().hidden).toBe(false);
  });
});
