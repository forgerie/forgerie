// @vitest-environment happy-dom

import { EditorSelection } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerRuntime } from "../composerRuntime";
import type { PromptCompletionTrigger } from "../promptCompletions";
import { loadDraft } from "../promptDraftStorage";
import { pressKey } from "./modalSurfaceTestSupport";
import type { AutocompleteMenu } from "./AutocompleteMenu";
import { ComposerDraft, type ComposerDraftSubmitOutcome, type ComposerDraftSubmitSnapshot } from "./ComposerDraft";
import type { CompletionItem } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("ComposerDraft", () => {
  it("mounts in chat and modal hosts with the same runtime contract", async () => {
    const runtime = runtimeWith(({ kind, from, to }) => kind === "command" ? [{ kind: "command", replaceFrom: from, replaceTo: to, insertText: "/skill:review", detail: "skill" }] : []);
    const chatSubmit = vi.fn<(snapshot: ComposerDraftSubmitSnapshot) => void>();
    const modalSubmit = vi.fn<(snapshot: ComposerDraftSubmitSnapshot) => void>();
    const chat = await mountDraft({ runtime, onSubmit: chatSubmit, host: document.createElement("footer") });
    const modalHost = document.createElement("section");
    modalHost.setAttribute("role", "dialog");
    const modal = await mountDraft({ runtime, onSubmit: modalSubmit, host: modalHost });

    for (const draft of [chat, modal]) {
      setEditorText(draft, "/");
      await waitForMenuItems(draft, 1);
      press(draft, "Enter");
      expect(draft.view?.state.doc.toString()).toBe("/skill:review ");
      draft.replaceText("send me");
      press(draft, "Enter");
    }

    expect(chatSubmit).toHaveBeenCalledWith({ text: "send me" }, undefined);
    expect(modalSubmit).toHaveBeenCalledWith({ text: "send me" }, undefined);
  });

  it("replaces durable and CodeMirror text, moves the cursor, and resets completion state", async () => {
    const draft = await mountDraft({ storageKey: "remote-a:session-1", runtime: runtimeWith(() => [{ kind: "command", replaceFrom: 0, replaceTo: 4, insertText: "/tree", detail: "builtin" }]) });
    setEditorText(draft, "/old");
    await waitForMenuItems(draft, 1);

    draft.replaceText("!pwd");
    await draft.updateComplete;
    await menu(draft)?.updateComplete;

    expect(draft.view?.state.doc.toString()).toBe("!pwd");
    expect(draft.view?.state.selection.main.head).toBe(4);
    expect(loadDraft("remote-a:session-1")).toBe("!pwd");
    expect(menu(draft)?.items).toEqual([]);
    expect(draft.textContent).toContain("Shell command");
  });

  it("submits text, attachment-only, and delivery snapshots through one public callback", async () => {
    const onSubmit = vi.fn<(snapshot: ComposerDraftSubmitSnapshot) => void>();
    const draft = await mountDraft({ onSubmit });

    await attachFile(draft, new File(["hello"], "note.txt", { type: "text/plain" }));
    press(draft, "Enter");
    await draft.updateComplete;

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      text: "",
      attachments: [{ kind: "file", mimeType: "text/plain", name: "note.txt" }],
      delivery: "folder",
    });
    expect(draft.querySelector(".attachment-chip")).toBeNull();
  });

  it("keeps an immutable submitted snapshot until the host accepts it", async () => {
    const acceptance = deferred<"accepted" | "rejected">();
    const onSubmit = vi.fn((snapshot: ComposerDraftSubmitSnapshot) => acceptance.promise.then((outcome) => {
      expect(snapshot.text).toBe("validate me");
      return outcome;
    }));
    const draft = await mountDraft({ onSubmit });

    draft.replaceText("validate me");
    draft.submit();
    draft.replaceText("edited while validating");
    await draft.updateComplete;

    expect(draft.view?.state.doc.toString()).toBe("edited while validating");
    acceptance.resolve("rejected");
    await vi.waitFor(() => { expect(draft.view?.state.doc.toString()).toBe("edited while validating"); });

    const second = deferred<"accepted">();
    onSubmit.mockImplementationOnce(() => second.promise);
    draft.submit();
    expect(draft.view?.state.doc.toString()).toBe("edited while validating");
    second.resolve("accepted");
    await vi.waitFor(() => { expect(draft.view?.state.doc.toString()).toBe(""); });
  });

  it("restores one-shot seed snapshots and exposes explicit clear/discard operations", async () => {
    const draft = await mountDraft();
    const seed = { id: "recovery-1", snapshot: { text: "restore me" } };

    expect(draft.restoreSeed(seed)).toBe(true);
    expect(draft.view?.state.doc.toString()).toBe("restore me");
    draft.replaceText("changed");
    expect(draft.restoreSeed(seed)).toBe(false);
    expect(draft.view?.state.doc.toString()).toBe("changed");

    draft.clearAfterAcceptance();
    expect(draft.view?.state.doc.toString()).toBe("");
    draft.replaceText("discard me");
    draft.discardDraft();
    expect(draft.view?.state.doc.toString()).toBe("");
  });

  it("keeps completion navigation ahead of prompt history", async () => {
    const draft = await mountDraft({
      promptHistory: ["previous"],
      runtime: runtimeWith(({ kind, from, to }) => kind === "command" ? [
        { kind: "command", replaceFrom: from, replaceTo: to, insertText: "/one", detail: "extension" },
        { kind: "command", replaceFrom: from, replaceTo: to, insertText: "/two", detail: "extension" },
      ] : []),
    });
    setEditorText(draft, "/");
    await waitForMenuItems(draft, 2);

    press(draft, "ArrowUp");
    await draft.updateComplete;
    await menu(draft)?.updateComplete;

    expect(menu(draft)?.shadowRoot?.querySelector("button.selected strong")?.textContent).toBe("/two");
    expect(draft.view?.state.doc.toString()).toBe("/");
  });

  it("browses session prompts and restores the unsent draft", async () => {
    const draft = await mountDraft({ promptHistory: ["most recent", "older"] });
    draft.replaceText("unfinished");
    draft.view?.dispatch({ selection: EditorSelection.cursor(0) });

    press(draft, "ArrowUp");
    expect(draft.view?.state.doc.toString()).toBe("most recent");
    press(draft, "ArrowUp");
    expect(draft.view?.state.doc.toString()).toBe("older");
    press(draft, "ArrowDown");
    expect(draft.view?.state.doc.toString()).toBe("most recent");
    press(draft, "ArrowDown");
    expect(draft.view?.state.doc.toString()).toBe("unfinished");
  });

  it("discards stale completion results after the runtime context changes", async () => {
    const first = deferred<readonly CompletionItem[]>();
    const draft = await mountDraft({ runtime: runtimeWith(() => first.promise) });
    setEditorText(draft, "/");
    draft.runtime = runtimeWith(({ kind, from, to }) => kind === "command" ? [{ kind: "command", replaceFrom: from, replaceTo: to, insertText: "/fresh", detail: "skill" }] : []);
    await draft.updateComplete;
    setEditorText(draft, "/f");
    first.resolve([{ kind: "command", replaceFrom: 0, replaceTo: 1, insertText: "/stale", detail: "skill" }]);

    await waitForMenuItems(draft, 1);

    expect(menu(draft)?.items.map((item) => item.insertText)).toEqual(["/fresh"]);
  });

  it("opens no empty menu for unsupported trigger kinds or zero matches", async () => {
    const resolve = vi.fn(() => Promise.resolve<readonly CompletionItem[]>([]));
    const draft = await mountDraft({ runtime: { supportedCompletionKinds: new Set(["command"]), resolveCompletion: resolve } });

    setEditorText(draft, "#cla");
    await Promise.resolve();
    expect(resolve).not.toHaveBeenCalled();
    expect(menu(draft)?.items).toEqual([]);

    setEditorText(draft, "/missing");
    await vi.waitFor(() => { expect(resolve).toHaveBeenCalledOnce(); });
    expect(menu(draft)?.items).toEqual([]);
    expect(draft.querySelector(".completion-error")).toBeNull();
  });

  it("surfaces completion provider failure without clearing the draft", async () => {
    const onCompletionError = vi.fn();
    const draft = await mountDraft({
      runtime: { supportedCompletionKinds: new Set(["command"]), resolveCompletion: () => Promise.reject(new Error("Catalog failed")) },
      onCompletionError,
    });

    setEditorText(draft, "/review");

    await vi.waitFor(() => { expect(draft.querySelector(".completion-error")?.textContent).toContain("Catalog failed"); });
    expect(onCompletionError).toHaveBeenCalledWith({ kind: "command", message: "Catalog failed" });
    expect(draft.view?.state.doc.toString()).toBe("/review");

    draft.runtime = runtimeWith(() => []);
    await draft.updateComplete;
    expect(draft.querySelector(".completion-error")).toBeNull();
  });

  it("survives disconnect and reconnect without losing the draft", async () => {
    const host = document.createElement("div");
    const draft = await mountDraft({ host });
    draft.replaceText("still here");

    host.remove();
    document.body.append(host);
    await draft.updateComplete;

    expect(draft.view?.state.doc.toString()).toBe("still here");
    draft.focusInput();
    expect(draft.view).not.toBeUndefined();
  });
});

async function mountDraft(options: {
  runtime?: ComposerRuntime;
  storageKey?: string;
  promptHistory?: readonly string[];
  onSubmit?: (snapshot: ComposerDraftSubmitSnapshot, streamingBehavior?: "steer" | "followUp") => ComposerDraftSubmitOutcome | Promise<ComposerDraftSubmitOutcome>;
  onCompletionError?: (error: { kind: string; message: string }) => void;
  host?: HTMLElement;
} = {}): Promise<ComposerDraft> {
  const host = options.host ?? document.createElement("div");
  const draft = new ComposerDraft();
  draft.runtime = options.runtime ?? runtimeWith(() => []);
  if (options.storageKey !== undefined) draft.storageKey = options.storageKey;
  if (options.promptHistory !== undefined) draft.promptHistory = options.promptHistory;
  if (options.onSubmit !== undefined) draft.onSubmit = options.onSubmit;
  if (options.onCompletionError !== undefined) draft.onCompletionError = options.onCompletionError;
  host.append(draft);
  document.body.append(host);
  await draft.updateComplete;
  if (draft.view === undefined) throw new Error("Expected CodeMirror to mount");
  return draft;
}

function runtimeWith(resolve: (trigger: PromptCompletionTrigger) => readonly CompletionItem[] | Promise<readonly CompletionItem[]>): ComposerRuntime {
  return { supportedCompletionKinds: new Set(["command", "file", "model"]), resolveCompletion: (trigger) => Promise.resolve(resolve(trigger)) };
}

function press(draft: ComposerDraft, key: string): KeyboardEvent {
  const view = draft.view;
  if (view === undefined) throw new Error("Expected CodeMirror to mount");
  return pressKey(view.contentDOM, key);
}

function menu(draft: ComposerDraft): AutocompleteMenu | null | undefined {
  return draft.querySelector<AutocompleteMenu>("autocomplete-menu");
}

function setEditorText(draft: ComposerDraft, text: string): void {
  const view = draft.view;
  if (view === undefined) throw new Error("Expected CodeMirror to mount");
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: EditorSelection.cursor(text.length) });
}

async function waitForMenuItems(draft: ComposerDraft, count: number): Promise<void> {
  const found = menu(draft);
  if (found === null || found === undefined) throw new Error("Expected autocomplete menu");
  await vi.waitFor(() => { expect(found.items).toHaveLength(count); });
  await found.updateComplete;
}

async function attachFile(draft: ComposerDraft, file: File): Promise<void> {
  const input = draft.querySelector<HTMLInputElement>(".attachment-input");
  if (input === null) throw new Error("Expected attachment input");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change"));
  await vi.waitFor(() => { expect(draft.querySelector(".attachment-chip")).not.toBeNull(); });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve; });
  return { promise, resolve };
}
