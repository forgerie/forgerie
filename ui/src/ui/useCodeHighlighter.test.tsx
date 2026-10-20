// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deferred = vi.hoisted(() => ({
  imports: 0,
  finish: undefined as (() => void) | undefined,
  published: false,
}));
vi.mock("./highlightCode", async () => {
  deferred.imports++;
  await new Promise<void>((resolve) => { deferred.finish = resolve; });
  deferred.published = true;
  return { highlightCode: (text: string) => `<span class="hljs-keyword">${text}</span>` };
});

let root: Root;
// The import, its `.then`, and React's update each take a turn; a macrotask lets all of them run.
const settle = async () => { await vi.dynamicImportSettled(); await new Promise((resolve) => setTimeout(resolve, 0)); };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  deferred.finish?.();
  vi.restoreAllMocks();
  await act(async () => { await vi.dynamicImportSettled(); root.unmount(); });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("optional code highlighting", () => {
  it("loads only for finished known code, shares the import, and uses current source when it arrives", async () => {
    const { CodeSheetBody } = await import("./CodeSheetBody");
    expect(deferred.imports).toBe(0);
    await act(async () => root.render(<>
      <CodeSheetBody key="a" code="streaming" language="typescript" highlight={false} />
      <CodeSheetBody key="b" code="unknown" language="not-a-language" />
    </>));
    expect(deferred.imports).toBe(0);
    expect(document.body.textContent).toBe("streamingunknown");

    // The same sheet finishes streaming: it keeps its element and focus.
    await act(async () => root.render(<>
      <CodeSheetBody key="a" code="first" language="typescript" />
      <CodeSheetBody key="b" code="second" language="nix" />
    </>));
    await vi.waitFor(() => expect(deferred.imports).toBe(1));
    const pre = document.querySelector("pre");
    pre?.focus();
    expect(document.activeElement).toBe(pre);
    expect(document.body.textContent).toBe("firstsecond");
    expect(document.querySelector(".hljs-keyword")).toBeNull();

    // One sheet unmounts and the other changes before the shared import resolves.
    await act(async () => root.render(<><CodeSheetBody key="a" code="latest" language="typescript" /></>));
    expect(document.querySelector("pre")).toBe(pre);
    // A reader's selection inside the sheet holds the colour swap until it leaves.
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("code")!);
    selection.addRange(range);
    // testSetup.ts swallows document selectionchange for CodeMirror; keep the handler to deliver the browser's event.
    const listen = vi.spyOn(document, "addEventListener");
    await act(async () => { deferred.finish?.(); await settle(); });
    const onSelectionChange = listen.mock.calls.find(([type]) => type === "selectionchange")?.[1] as (() => void) | undefined;
    expect(onSelectionChange).toBeTypeOf("function");
    expect(deferred.published).toBe(true);
    expect(document.body.textContent).toBe("latest");
    expect(selection.toString()).toBe("latest");
    expect(document.querySelector(".hljs-keyword")).toBeNull();
    await act(async () => { selection.removeAllRanges(); onSelectionChange?.(); await settle(); });
    expect(document.querySelector(".hljs-keyword")?.textContent).toBe("latest");
    expect(document.querySelector("pre")).toBe(pre);
    expect(document.activeElement).toBe(pre);
    expect(deferred.imports).toBe(1);
  });
});
