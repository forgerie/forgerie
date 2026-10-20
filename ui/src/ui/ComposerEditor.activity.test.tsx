// @vitest-environment happy-dom
import { Activity, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AssistantRuntime } from "@assistant-ui/react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThreadMessages } from "../useThreadMessages";
import { Composer } from "./Composer";
import type { ComposerInputElement } from "./ComposerEditor";
import { ImageViewerProvider } from "./ImageViewer";

// A retained session's composer is hidden by Activity, not unmounted. These
// tests pin that a reveal looks exactly like the fresh editor it used to be,
// while the editor itself (and its drawn DOM) survives the hide.
let root: Root;
const runtimes: AssistantRuntime[] = [];
function Session({ index }: { index: number }) {
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages([], false), onNew: async () => {} });
  runtimes[index] = runtime;
  return <AssistantRuntimeProvider runtime={runtime}><ImageViewerProvider><Composer /></ImageViewerProvider></AssistantRuntimeProvider>;
}
/** `shown` is the visible session; `kept` the ones still retained. */
const render = (shown: number, kept: readonly number[] = [0, 1]) => act(async () => root.render(<>
  {kept.map((index) => <Activity key={index} mode={index === shown ? "visible" : "hidden"}><div data-session={index}><Session index={index} /></div></Activity>)}
</>));
const input = (index: number) => document.querySelector<ComposerInputElement>(`[data-session="${index}"] [data-composer-input]`)!;
const view = (index: number) => EditorView.findFromDOM(input(index))!;
const press = (index: number, key: string, init: KeyboardEventInit = {}) =>
  act(async () => { input(index).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  await act(async () => { await Promise.resolve(); });
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("composer editor across Activity hide and reveal", () => {
  it("keeps the drawn editor instead of rebuilding it on each reveal", async () => {
    await render(0);
    const editor = input(0);
    const create = vi.spyOn(EditorView.prototype, "destroy");
    for (const shown of [1, 0, 1, 0]) await render(shown);
    expect(input(0)).toBe(editor);
    expect(create).not.toHaveBeenCalled();
  });

  it("reveals like a fresh editor: the composer's draft, the caret at the end, and no undo across the switch", async () => {
    await render(0);
    await act(async () => { input(0).value = "first draft"; });
    await act(async () => { view(0).dispatch({ selection: EditorSelection.cursor(2) }); });
    await render(1);
    await render(0);
    expect(input(0).value).toBe("first draft");
    expect(runtimes[0]!.thread.composer.getState().text).toBe("first draft");
    expect(input(0).selectionStart).toBe("first draft".length);
    await press(0, "z", { ctrlKey: true });
    expect(input(0).value).toBe("first draft");
    // Typing after the reveal still has its own undo.
    await act(async () => { view(0).dispatch({ changes: { from: view(0).state.doc.length, insert: "!" }, userEvent: "input.type" }); });
    expect(runtimes[0]!.thread.composer.getState().text).toBe("first draft!");
    await press(0, "z", { ctrlKey: true });
    expect(input(0).value).toBe("first draft");
  });

  it("shows a draft the composer changed while the session was hidden", async () => {
    await render(0);
    await act(async () => { input(0).value = "before"; });
    await render(1);
    await act(async () => { runtimes[0]!.thread.composer.setText("restored while hidden"); });
    await render(0);
    expect(input(0).value).toBe("restored while hidden");
    expect(input(0).selectionStart).toBe("restored while hidden".length);
  });

  it("keeps each session's editor and draft separate", async () => {
    await render(0);
    await act(async () => { input(0).value = "zero"; });
    await render(1);
    await act(async () => { input(1).value = "one"; });
    await render(0);
    expect(input(0).value).toBe("zero");
    expect(input(1).value).toBe("one");
    expect(input(0)).not.toBe(input(1));
  });

  it("destroys the editor of a session removed while hidden, and of one removed while shown", async () => {
    await render(0);
    const destroy = vi.spyOn(EditorView.prototype, "destroy");
    await render(1);
    // Session 0 leaves the retained set while hidden: React runs no effect for it.
    // The registry evicts when another session opens, so the next bar sweeps it.
    await render(1, [1]);
    await act(async () => { await Promise.resolve(); });
    expect(destroy).not.toHaveBeenCalled();
    await render(2, [1, 2]);
    await act(async () => { await Promise.resolve(); });
    expect(destroy).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<></>));
    await act(async () => { await Promise.resolve(); });
    expect(destroy).toHaveBeenCalledTimes(3);
  });
});
