// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "./FileTree";

let root: Root;
const tree = "ui/src/\n  ui/\n    + OptionRow.tsx # one choice\n    - modelMenu.css\n  ~ mentionSource.ts\n~ README.md";
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button.path-tree-open")];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("FileTree", () => {
  it("opens each file that still exists by its full path", async () => {
    const open = vi.fn();
    await act(async () => root.render(<FileTree code={tree} onOpen={open} />));
    expect(buttons().map((button) => button.title)).toEqual(["ui/src/ui/OptionRow.tsx", "ui/src/mentionSource.ts", "README.md"]);
    await act(async () => buttons()[0]!.click());
    expect(open).toHaveBeenCalledWith("ui/src/ui/OptionRow.tsx");
  });

  it("keeps a deleted file and a directory as plain rows", async () => {
    await act(async () => root.render(<FileTree code={tree} onOpen={() => {}} />));
    const names = buttons().map((button) => button.textContent);
    expect(names.some((name) => name?.includes("modelMenu.css"))).toBe(false);
    expect(names.some((name) => name?.includes("ui/"))).toBe(false);
    // The note stays outside the control, so it does not join the file's name.
    expect(buttons()[0]!.textContent).toBe("OptionRow.tsx");
  });

  it("has no controls without a way to open a file", async () => {
    await act(async () => root.render(<FileTree code={tree} />));
    expect(buttons()).toEqual([]);
  });
});
