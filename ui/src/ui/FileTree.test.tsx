// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_CHECK_DELAY_MS, FileTree, type FileLinks } from "./FileTree";

let root: Root;
const tree = "ui/src/\n  ui/\n    + OptionRow.tsx # one choice\n    ~ Gone.tsx\n    - modelMenu.css\n  ~ mentionSource.ts\n~ README.md";
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button.path-tree-open")];
const onDisk = new Set(["ui/src/ui/OptionRow.tsx", "ui/src/mentionSource.ts", "README.md", "ui/src/ui/modelMenu.css"]);
function links(open = vi.fn()) {
  const existing = vi.fn(async (paths: readonly string[]) => new Set(paths.filter((path) => onDisk.has(path))));
  return { existing, open } satisfies FileLinks;
}
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(FILE_CHECK_DELAY_MS); }); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("FileTree", () => {
  it("links only the files that exist, and opens one by its full path", async () => {
    const fileLinks = links();
    await act(async () => root.render(<FileTree code={tree} links={fileLinks} />));
    // Nothing is a link until the files are known to be there.
    expect(buttons()).toEqual([]);
    await settle();
    // A deleted file is never asked about, even if the disk still has it.
    expect(fileLinks.existing).toHaveBeenCalledWith(["ui/src/ui/OptionRow.tsx", "ui/src/ui/Gone.tsx", "ui/src/mentionSource.ts", "README.md"], expect.anything());
    expect(buttons().map((button) => button.title)).toEqual(["ui/src/ui/OptionRow.tsx", "ui/src/mentionSource.ts", "README.md"]);
    await act(async () => buttons()[0]!.click());
    expect(fileLinks.open).toHaveBeenCalledWith("ui/src/ui/OptionRow.tsx");
    // The note stays outside the control, so it does not join the file's name.
    expect(buttons()[0]!.textContent).toBe("OptionRow.tsx");
  });

  it("asks once the text stops changing, as a streamed block does", async () => {
    const fileLinks = links();
    await act(async () => root.render(<FileTree code={"~ READ"} links={fileLinks} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(FILE_CHECK_DELAY_MS - 1); });
    await act(async () => root.render(<FileTree code={"~ README.md"} links={fileLinks} />));
    await settle();
    expect(fileLinks.existing).toHaveBeenCalledTimes(1);
    expect(fileLinks.existing).toHaveBeenCalledWith(["README.md"], expect.anything());
    expect(buttons().map((button) => button.title)).toEqual(["README.md"]);
  });

  it("stays a plain listing when the lookup fails or there are no links", async () => {
    await act(async () => root.render(<FileTree code={tree} links={{ existing: async () => { throw new Error("offline"); }, open: () => {} }} />));
    await settle();
    expect(buttons()).toEqual([]);
    await act(async () => root.render(<FileTree code={tree} />));
    await settle();
    expect(buttons()).toEqual([]);
  });
});
