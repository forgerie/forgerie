// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type Unstable_TriggerItem } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MentionSource, ModelSuggestions } from "../mentionSource";
import type { AskBinding } from "./useAskMode";
import { Composer } from "./Composer";
import { useThreadMessages } from "../useThreadMessages";
import type { ComposerInputElement } from "./ComposerEditor";

let root: Root;
const files: Unstable_TriggerItem[] = [
  { id: "src/main.ts", type: "file", label: "src/main.ts", description: "tracked" },
  { id: "src/file with spaces.ts", type: "file", label: "src/file with spaces.ts", description: "tracked" },
];
const models: ModelSuggestions = { hidden: 0, groups: [{ key: "favorites", label: "Favorites", options: [{ id: "p/model", name: "Friendly name", details: ["P"] }] }] };
function source(config: Partial<MentionSource> = {}): MentionSource {
  return { key: "session-a", files: async () => files, models: async () => models, ...config };
}
interface Props { mentions: MentionSource; ask?: AskBinding; disabled?: boolean; onNew?: (message: AppendMessage) => Promise<void> }
function Fixture({ mentions, ask, disabled = false, onNew = async () => {} }: Props) {
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages([], false), onNew, isDisabled: disabled });
  return <AssistantRuntimeProvider runtime={runtime}><Composer mentions={mentions} ask={ask} /></AssistantRuntimeProvider>;
}
const render = (props: Props) => act(async () => root.render(<Fixture {...props} />));
const input = () => document.querySelector<ComposerInputElement>('[aria-label="Message"]')!;
const suggestions = () => document.querySelector('[role="listbox"]');
const options = () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
async function type(text: string, cursor = text.length) {
  await act(async () => {
    input().value = text;
    input().setSelectionRange(cursor, cursor);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = (key: string, init: KeyboardEventInit = {}) => act(async () => {
  input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
});
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 90)); }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("assistant-ui mention composer", () => {
  it("uses file suggestions, supports keyboard selection and keeps the existing path syntax", async () => {
    const lookup = vi.fn<MentionSource["files"]>().mockResolvedValue(files);
    const onNew = vi.fn<NonNullable<Props["onNew"]>>().mockResolvedValue(undefined);
    await render({ mentions: source({ files: lookup }), onNew });
    await type("read @src");
    expect(suggestions()?.getAttribute("aria-label")).toBe("Files suggestions");
    expect(document.querySelector('.option-list-status[role="status"]')?.textContent).toBe("Searching…");
    await settle();
    expect(lookup).toHaveBeenCalledWith("src", "tracked", expect.any(AbortSignal));
    expect(options()).toHaveLength(2);
    expect(input().getAttribute("aria-controls")).toBe(suggestions()?.id);
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
    await press("ArrowDown");
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    await press("Enter");
    expect(input().value).toBe('read @"src/file with spaces.ts" ');
    expect(onNew).not.toHaveBeenCalled();
    expect(suggestions()).toBeNull();
  });
  it("uses # for qualified model references, without immediately changing the session model", async () => {
    const lookup = vi.fn<MentionSource["models"]>().mockResolvedValue(models);
    await render({ mentions: source({ models: lookup }) });
    await type("use #friendly"); await settle();
    expect(lookup).toHaveBeenCalledWith("friendly", { showHidden: false }, expect.any(AbortSignal));
    expect(suggestions()?.getAttribute("aria-label")).toBe("Models suggestions");
    expect(document.querySelector('[role="listbox"] [role="group"]')?.textContent).toContain("Favorites");
    expect(options()[0]?.textContent).toBe("Friendly nameP");
    await press("Tab");
    expect(input().value).toBe("use #p/model ");
    expect(suggestions()).toBeNull();
  });
  it("clicks an item without replacing the remainder of the draft", async () => {
    await render({ mentions: source() });
    await type("read @src then explain", 9); await settle();
    await act(async () => options()[0]!.click());
    expect(input().value).toBe("read @src/main.ts then explain");
    expect(input().selectionStart).toBe("read @src/main.ts ".length);
  });
  it("continues discovery inside a quoted directory without moving past its closing quote", async () => {
    const lookup = vi.fn<MentionSource["files"]>().mockResolvedValue([{ id: "dir with space/", type: "file", label: "dir with space/" }]);
    await render({ mentions: source({ files: lookup }) });
    await type('@"dir'); await settle(); await press("Enter");
    expect(input().value).toBe('@"dir with space/" ');
    expect(input().selectionStart).toBe('@"dir with space/'.length);
    await settle();
    expect(lookup).toHaveBeenLastCalledWith("dir with space/", "tracked", expect.any(AbortSignal));
  });
  it("dismisses without deleting the draft and does not select during IME composition", async () => {
    await render({ mentions: source() }); await type("@src"); await settle();
    await press("Enter", { isComposing: true });
    expect(input().value).toBe("@src");
    await press("Escape");
    expect(suggestions()).toBeNull();
    expect(input().value).toBe("@src");
  });
  it("clears outdated results while a new query loads and ignores its late response", async () => {
    const old = deferred<readonly Unstable_TriggerItem[]>();
    const lookup: MentionSource["files"] = async (query) => query === "old" ? old.promise : files;
    await render({ mentions: source({ files: lookup }) });
    await type("@old"); await settle();
    await type("@new"); expect(options()).toHaveLength(0); await settle();
    expect(options()[0]?.textContent).toContain("src/main.ts");
    await act(async () => old.resolve([{ id: "old.txt", type: "file", label: "old.txt" }]));
    expect(document.body.textContent).not.toContain("old.txt");
  });
  it("aborts discovery when the source session changes", async () => {
    const old = deferred<readonly Unstable_TriggerItem[]>(); let signal: AbortSignal | undefined;
    await render({ mentions: source({ files: async (_q, _scope, received) => { signal = received; return old.promise; } }) });
    await type("@src"); await settle();
    await render({ mentions: source({ key: "session-b" }) });
    expect(signal?.aborted).toBe(true);
    await settle();
    await act(async () => old.resolve([{ id: "old.txt", type: "file", label: "old.txt" }]));
    expect(document.body.textContent).not.toContain("old.txt");
  });
  it("shows empty results and failures, and prevents Enter from sending while the picker is open", async () => {
    const onNew = vi.fn<NonNullable<Props["onNew"]>>().mockResolvedValue(undefined);
    const lookup: MentionSource["files"] = async (query) => { if (query === "error") throw new Error("Files unavailable"); return []; };
    await render({ mentions: source({ files: lookup }), onNew });
    await type("@missing"); await settle();
    expect(document.body.textContent).toContain("No matching files.");
    await press("Enter"); expect(onNew).not.toHaveBeenCalled();
    await type("@error"); await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Files unavailable");
    await press("Enter"); expect(onNew).not.toHaveBeenCalled();
  });
  it("keeps one input in ask mode and consumes mention selection before advancing an answer", async () => {
    const onSubmit = vi.fn();
    const ask: AskBinding = { ask: { askId: "a", askedAt: "now", questions: [{ id: "q", question: "Which file?", options: [] }] },
      phase: { type: "answering" }, offline: false, onSubmit, onDismiss: () => {}, onChat: async () => {} };
    const mentions = source();
    await render({ mentions }); await type("ordinary draft");
    await render({ mentions, ask }); await type("@src"); await settle();
    expect(document.querySelectorAll("[data-composer-input]")).toHaveLength(1);
    await press("Enter");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input().value).toBe("@src/main.ts ");
    await press("Enter");
    expect(onSubmit).toHaveBeenCalledWith([{ id: "q", values: [], otherText: "@src/main.ts" }]);
    await render({ mentions }); expect(input().value).toBe("ordinary draft");
  });
  it("hides suggestions while offline without discarding the draft", async () => {
    const mentions = source(); await render({ mentions }); await type("@src"); await settle();
    await render({ mentions, disabled: true });
    expect(suggestions()).toBeNull(); expect(input().value).toBe("@src");
    await render({ mentions }); await settle(); expect(options()).toHaveLength(2);
  });
  it("uses all-file discovery for @<space> and !@, preserving directory navigation", async () => {
    const lookup = vi.fn<MentionSource["files"]>().mockResolvedValue([{ id: "vendor/", type: "file", label: "vendor/" }]);
    await render({ mentions: source({ files: lookup }) });
    await type("@ ven"); await settle();
    expect(lookup).toHaveBeenCalledWith("ven", "all", expect.any(AbortSignal));
    await type("!@ven"); await settle();
    expect(suggestions()?.getAttribute("aria-label")).toBe("All files suggestions");
    await press("Enter");
    expect(input().value).toBe("!@vendor/ ");
    expect(input().selectionStart).toBe("!@vendor/".length);
    await settle();
    expect(lookup).toHaveBeenCalledWith("vendor/", "all", expect.any(AbortSignal));
  });
});
