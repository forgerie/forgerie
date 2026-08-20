// @vitest-environment happy-dom

import { undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerRuntime } from "../composerRuntime";
import { inputModeForDraft } from "../inputModes";
import type { PromptCompletionTrigger } from "../promptCompletions";
import { loadDraft, saveDraft } from "../promptDraftStorage";
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
  it("dresses the leading command token as the command mark while leaving it editable text", async () => {
    const draft = await mountDraft();

    draft.replaceText("/tree keep the current draft");

    const mark = draft.view?.dom.querySelector(".cm-command-mark");
    expect(mark?.textContent).toBe("/tree");
    expect(draft.view?.state.doc.toString()).toBe("/tree keep the current draft");

    draft.replaceText("plain prose");

    expect(draft.view?.dom.querySelector(".cm-command-mark")).toBeNull();
  });

  it("uses Enter to send and Shift+Enter to insert a new line on mobile-like screens", async () => {
    const matchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query) => {
      const result = matchMedia(query);
      Object.defineProperty(result, "matches", { value: true });
      return result;
    });
    const enterSubmit = vi.fn<(snapshot: ComposerDraftSubmitSnapshot) => ComposerDraftSubmitOutcome>(() => "accepted");
    const enterDraft = await mountDraft({ onSubmit: enterSubmit });
    enterDraft.replaceText("send me");

    press(enterDraft, "Enter");

    expect(enterSubmit).toHaveBeenCalledWith({ text: "send me" }, undefined);

    const shiftEnterSubmit = vi.fn<(snapshot: ComposerDraftSubmitSnapshot) => ComposerDraftSubmitOutcome>(() => "accepted");
    const shiftEnterDraft = await mountDraft({ onSubmit: shiftEnterSubmit });
    shiftEnterDraft.replaceText("first line");
    press(shiftEnterDraft, "Shift");
    shiftEnterDraft.view?.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));

    expect(shiftEnterSubmit).not.toHaveBeenCalled();
    expect(shiftEnterDraft.view?.state.doc.toString()).toBe("first line\n");
  });

  it("mounts in chat and modal hosts with the same runtime contract", async () => {
    const runtime = runtimeWith(({ kind, from, to }) => kind === "command" ? [{ kind: "command", replaceFrom: from, replaceTo: to, insertText: "/skill:review", detail: "skill" }] : []);
    const chatSubmit = vi.fn<(snapshot: ComposerDraftSubmitSnapshot) => ComposerDraftSubmitOutcome>(() => "accepted");
    const modalSubmit = vi.fn<(snapshot: ComposerDraftSubmitSnapshot) => ComposerDraftSubmitOutcome>(() => "accepted");
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

  it("commits dictation through one persisted, editable, undoable draft transaction", async () => {
    const onSubmit = vi.fn<(snapshot: ComposerDraftSubmitSnapshot) => ComposerDraftSubmitOutcome>(() => "accepted");
    const onDraftEdited = vi.fn();
    const draft = await mountDraft({ storageKey: "remote-a:dictation", onSubmit, onDraftEdited });
    draft.replaceText("replace this phrase");
    draft.view?.dispatch({ selection: EditorSelection.range(8, 12) });
    onDraftEdited.mockClear();

    expect(draft.beginDictationEdit()).toBe(true);
    expect(draft.commitDictationTranscript("spoken")).toBe(true);
    expect(draft.finishDictationEdit()).toBe(true);
    await draft.updateComplete;

    expect(draft.view?.state.doc.toString()).toBe("replace spoken phrase");
    expect(loadDraft("remote-a:dictation")).toBe("replace spoken phrase");
    expect(onDraftEdited).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    const view = draft.view;
    if (view === undefined) throw new Error("Expected CodeMirror to mount");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("replace this phrase");
  });

  it("locks mutation surfaces while dictation owns the draft", async () => {
    const onSubmit = vi.fn<(snapshot: ComposerDraftSubmitSnapshot) => ComposerDraftSubmitOutcome>(() => "accepted");
    const draft = await mountDraft({ promptHistory: ["history"], onSubmit });
    draft.replaceText("owned draft");
    await attachFile(draft, new File(["kept"], "kept.png", { type: "image/png" }));
    draft.view?.dispatch({ selection: EditorSelection.range(0, 5) });

    expect(draft.beginDictationEdit()).toBe(true);
    setEditorText(draft, "typed over");
    startAttachFile(draft, new File(["blocked"], "blocked.txt", { type: "text/plain" }));
    draft.querySelector<HTMLButtonElement>(".attachment-remove")?.click();
    draft.querySelector<HTMLInputElement>(".attachment-delivery input[value='folder']")?.click();
    press(draft, "ArrowUp");
    draft.submit();

    await Promise.resolve();
    await draft.updateComplete;

    expect(draft.view?.state.doc.toString()).toBe("owned draft");
    expect(draft.querySelectorAll(".attachment-chip")).toHaveLength(1);
    expect(draft.querySelector<HTMLInputElement>(".attachment-delivery input[value='inline']")?.checked).toBe(true);
    expect(draft.querySelector<HTMLInputElement>(".attachment-delivery input[value='folder']")?.checked).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(draft.insertTextAtSelection("plugin")).toBe(false);
    expect(draft.focusInput()).toBe(false);
    expect(draft.getText()).toBe("owned draft");
    expect(draft.getSelection()).toEqual({ start: 0, end: 5, text: "owned" });
  });

  it("aborts dictation ownership before owner and wholesale replacement changes", async () => {
    saveDraft("remote-a:session-2", "session two");
    const draft = await mountDraft({ storageKey: "remote-a:session-1" });
    draft.replaceText("session one");
    draft.view?.dispatch({ selection: EditorSelection.range(0, 7) });
    expect(draft.beginDictationEdit()).toBe(true);

    draft.storageKey = "remote-a:session-2";
    await draft.updateComplete;

    expect(draft.view?.state.doc.toString()).toBe("session two");
    expect(draft.commitDictationTranscript("late")).toBe(false);

    expect(draft.beginDictationEdit()).toBe(true);
    draft.replaceText("host replacement");

    expect(draft.view?.state.doc.toString()).toBe("host replacement");
    expect(draft.commitDictationTranscript("late")).toBe(false);
  });

  it("submits text, attachment-only, and delivery snapshots through one public callback", async () => {
    const onSubmit = vi.fn<(snapshot: ComposerDraftSubmitSnapshot) => ComposerDraftSubmitOutcome>(() => "accepted");
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

  it("keeps attachment chips, remove actions, delivery radios, and live updates accessible without focus theft", async () => {
    const draft = await mountDraft();
    draft.focusInput();
    const focusedEditor = editorContent(draft);

    await attachFile(draft, new File(["one"], "duplicate.txt", { type: "text/plain" }));
    await attachFile(draft, new File(["two"], "duplicate.txt", { type: "text/plain" }));

    const chips = Array.from(draft.querySelectorAll<HTMLElement>(".attachment-chip"));
    const removeButtons = Array.from(draft.querySelectorAll<HTMLButtonElement>(".attachment-remove"));
    const radios = Array.from(draft.querySelectorAll<HTMLInputElement>(".attachment-delivery input[type='radio']"));
    const live = draft.querySelector<HTMLElement>("[data-live='attachments']");

    expect(document.activeElement).toBe(focusedEditor);
    expect(chips.map((chip) => chip.getAttribute("tabindex"))).toEqual(["0", "0"]);
    expect(chips.map((chip) => chip.getAttribute("aria-label"))).toEqual([
      "attachment 1 of 2: duplicate.txt, text/plain, 3 bytes",
      "attachment 2 of 2: duplicate.txt, text/plain, 3 bytes",
    ]);
    expect(removeButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Remove attachment 1 of 2: duplicate.txt, text/plain, 3 bytes",
      "Remove attachment 2 of 2: duplicate.txt, text/plain, 3 bytes",
    ]);
    expect(draft.querySelector(".attachment-delivery")?.getAttribute("aria-label")).toBe("Attachment delivery");
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
    expect(radios.find((radio) => radio.value === "folder")?.checked).toBe(true);
    expect(radios.find((radio) => radio.value === "inline")?.disabled).toBe(true);
    expect(live?.textContent).toBe("Added attachment 2 of 2: duplicate.txt, text/plain, 3 bytes.");

    removeButtons[0]?.click();
    await draft.updateComplete;

    expect(live?.textContent).toBe("Removed attachment 1 of 2: duplicate.txt, text/plain, 3 bytes.");
  });

  it("announces attachment capture errors assertively without clearing successful attachments", async () => {
    const draft = await mountDraft();
    await attachFile(draft, new File(["ok"], "kept.txt", { type: "text/plain" }));
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      queueMicrotask(() => {
        Object.defineProperty(this, "error", { configurable: true, value: new Error("read failed") });
        this.dispatchEvent(new ProgressEvent("error"));
      });
    });

    await attachFileExpectingError(draft, new File(["bad"], "broken.txt", { type: "text/plain" }));

    expect(draft.querySelectorAll(".attachment-chip")).toHaveLength(1);
    expect(draft.querySelector(".attachment-error")?.textContent).toBe("Failed to read an attachment.");
    expect(draft.querySelector("[data-live='attachment-errors']")?.textContent).toBe("Failed to read an attachment.");
  });

  it("clears attachments, errors, and late attachment reads when the storage owner changes", async () => {
    saveDraft("remote-a:session-2", "persisted session two");
    const draft = await mountDraft({ storageKey: "remote-a:session-1" });
    draft.replaceText("session one text");
    await attachFile(draft, new File(["one"], "session-one.txt", { type: "text/plain" }));
    const errorSpy = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      queueMicrotask(() => {
        Object.defineProperty(this, "error", { configurable: true, value: new Error("read failed") });
        this.dispatchEvent(new ProgressEvent("error"));
      });
    });
    await attachFileExpectingError(draft, new File(["bad"], "broken.txt", { type: "text/plain" }));
    errorSpy.mockRestore();
    const reads = mockPendingFileReads();
    startAttachFile(draft, new File(["late"], "late.txt", { type: "text/plain" }));
    await vi.waitFor(() => { expect(reads).toHaveLength(1); });

    draft.storageKey = "remote-a:session-2";
    await draft.updateComplete;
    reads[0]?.resolve("late");
    await Promise.resolve();
    await draft.updateComplete;

    expect(draft.view?.state.doc.toString()).toBe("persisted session two");
    expect(loadDraft("remote-a:session-1")).toBe("session one text");
    expect(draft.querySelectorAll(".attachment-chip")).toHaveLength(0);
    expect(draft.querySelector(".attachment-error")).toBeNull();
  });

  it("ignores attachment input and late reads after the draft stops owning the result", async () => {
    const disabledDraft = await mountDraft();
    disabledDraft.disabled = true;
    await disabledDraft.updateComplete;
    const disabledReads = mockPendingFileReads();
    startAttachFile(disabledDraft, new File(["blocked"], "blocked.txt", { type: "text/plain" }));
    await Promise.resolve();
    expect(disabledReads).toHaveLength(0);

    const submissionDisabledDraft = await mountDraft();
    submissionDisabledDraft.submissionDisabled = true;
    await submissionDisabledDraft.updateComplete;
    const submissionDisabledReads = mockPendingFileReads();
    startAttachFile(submissionDisabledDraft, new File(["blocked"], "blocked.txt", { type: "text/plain" }));
    await Promise.resolve();
    expect(submissionDisabledReads).toHaveLength(0);

    const disabledLateDraft = await mountDraft();
    const disabledLateReads = mockPendingFileReads();
    startAttachFile(disabledLateDraft, new File(["late"], "disabled-late.txt", { type: "text/plain" }));
    await vi.waitFor(() => { expect(disabledLateReads).toHaveLength(1); });
    disabledLateDraft.disabled = true;
    await disabledLateDraft.updateComplete;
    disabledLateReads[0]?.resolve("late");
    await Promise.resolve();
    await disabledLateDraft.updateComplete;
    expect(disabledLateDraft.querySelectorAll(".attachment-chip")).toHaveLength(0);

    const submissionDisabledLateDraft = await mountDraft();
    const submissionDisabledLateReads = mockPendingFileReads();
    startAttachFile(submissionDisabledLateDraft, new File(["late"], "submission-disabled-late.txt", { type: "text/plain" }));
    await vi.waitFor(() => { expect(submissionDisabledLateReads).toHaveLength(1); });
    submissionDisabledLateDraft.submissionDisabled = true;
    await submissionDisabledLateDraft.updateComplete;
    submissionDisabledLateReads[0]?.resolve("late");
    await Promise.resolve();
    await submissionDisabledLateDraft.updateComplete;
    expect(submissionDisabledLateDraft.querySelectorAll(".attachment-chip")).toHaveLength(0);

    const discardedDraft = await mountDraft();
    const discardedReads = mockPendingFileReads();
    startAttachFile(discardedDraft, new File(["late"], "discarded.txt", { type: "text/plain" }));
    await vi.waitFor(() => { expect(discardedReads).toHaveLength(1); });
    discardedDraft.discardDraft();
    discardedReads[0]?.resolve("late");
    await Promise.resolve();
    await discardedDraft.updateComplete;
    expect(discardedDraft.querySelectorAll(".attachment-chip")).toHaveLength(0);

    const resetDraft = await mountDraft();
    const resetReads = mockPendingFileReads();
    startAttachFile(resetDraft, new File(["late"], "reset.txt", { type: "text/plain" }));
    await vi.waitFor(() => { expect(resetReads).toHaveLength(1); });
    resetDraft.clearAfterAcceptance();
    resetReads[0]?.resolve("late");
    await Promise.resolve();
    await resetDraft.updateComplete;
    expect(resetDraft.querySelectorAll(".attachment-chip")).toHaveLength(0);

    vi.restoreAllMocks();
    const host = document.createElement("div");
    const disconnectedDraft = await mountDraft({ host });
    await attachFile(disconnectedDraft, new File(["owned"], "owned.txt", { type: "text/plain" }));
    const disconnectedReads = mockPendingFileReads();
    startAttachFile(disconnectedDraft, new File(["late"], "disconnected.txt", { type: "text/plain" }));
    await vi.waitFor(() => { expect(disconnectedReads).toHaveLength(1); });
    host.remove();
    disconnectedReads[0]?.resolve("late");
    await disconnectedDraft.whenAttachmentCaptureSettled();
    expect(disconnectedDraft.currentSnapshot().attachments?.map((attachment) => attachment.name)).toEqual(["owned.txt"]);
    document.body.append(host);
    await disconnectedDraft.updateComplete;
    expect(Array.from(disconnectedDraft.querySelectorAll(".attachment-file-name")).map((name) => name.textContent)).toEqual(["owned.txt"]);
  });

  it("blocks submission until an in-flight attachment read settles", async () => {
    const reads = mockPendingFileReads();
    const onSubmit = vi.fn<(snapshot: ComposerDraftSubmitSnapshot) => ComposerDraftSubmitOutcome>(() => "accepted");
    const draft = await mountDraft({ onSubmit });
    draft.replaceText("send with attachment");
    startAttachFile(draft, new File(["pending"], "pending.txt", { type: "text/plain" }));
    await vi.waitFor(() => { expect(reads).toHaveLength(1); });

    draft.submit();
    expect(onSubmit).not.toHaveBeenCalled();

    reads[0]?.resolve("pending");
    await vi.waitFor(() => { expect(draft.querySelectorAll(".attachment-chip")).toHaveLength(1); });
    draft.submit();

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]?.[0].attachments).toHaveLength(1);
  });

  it("keeps edits after an accepted delayed submit and records the submitted text in history", async () => {
    const acceptance = deferred<"accepted">();
    const onSubmit = vi.fn(() => acceptance.promise);
    const draft = await mountDraft({ onSubmit });
    draft.replaceText("submitted text");
    await attachFile(draft, new File(["one"], "submitted.txt", { type: "text/plain" }));

    draft.submit();
    draft.replaceText("edited after submit");
    await attachFile(draft, new File(["two"], "edited.txt", { type: "text/plain" }));
    acceptance.resolve("accepted");
    await vi.waitFor(() => { expect(onSubmit).toHaveBeenCalledOnce(); });
    await draft.updateComplete;

    expect(draft.view?.state.doc.toString()).toBe("edited after submit");
    expect(Array.from(draft.querySelectorAll(".attachment-file-name")).map((name) => name.textContent)).toEqual(["submitted.txt", "edited.txt"]);

    draft.replaceText("");
    draft.view?.dispatch({ selection: EditorSelection.cursor(0) });
    press(draft, "ArrowUp");
    expect(draft.view?.state.doc.toString()).toBe("submitted text");
  });

  it("does not clear text that changed away from and back to the submitted value", async () => {
    const acceptance = deferred<"accepted">();
    const onSubmit = vi.fn(() => acceptance.promise);
    const draft = await mountDraft({ onSubmit });
    draft.replaceText("same text");

    draft.submit();
    draft.replaceText("different text");
    draft.replaceText("same text");
    await vi.waitFor(() => { expect(onSubmit).toHaveBeenCalledOnce(); });
    acceptance.resolve("accepted");
    await acceptance.promise;
    await draft.updateComplete;

    expect(draft.view?.state.doc.toString()).toBe("same text");
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

  it("restores one-shot seed snapshots without persisting recovered first-prompt text", async () => {
    saveDraft("remote-a:session-1", "durable chat draft");
    const draft = await mountDraft({ storageKey: "remote-a:session-1" });
    const seed = { id: "recovery-1", snapshot: { text: "restore me" } };

    expect(draft.restoreSeed(seed)).toBe(true);
    expect(draft.view?.state.doc.toString()).toBe("restore me");
    expect(loadDraft("remote-a:session-1")).toBe("durable chat draft");
    draft.replaceText("changed");
    expect(draft.restoreSeed(seed)).toBe(false);
    expect(draft.view?.state.doc.toString()).toBe("changed");

    draft.clearAfterAcceptance();
    expect(draft.view?.state.doc.toString()).toBe("");
    draft.replaceText("discard me");
    draft.discardDraft();
    expect(draft.view?.state.doc.toString()).toBe("");
  });

  it("discards completion results after a cursor-only move leaves the trigger", async () => {
    const completion = deferred<CompletionItem[]>();
    const resolveCompletion = vi.fn(() => completion.promise);
    const draft = await mountDraft({ runtime: runtimeWith(resolveCompletion) });

    setEditorText(draft, "/");
    await vi.waitFor(() => { expect(resolveCompletion).toHaveBeenCalledOnce(); });
    draft.view?.dispatch({ selection: EditorSelection.cursor(0) });
    completion.resolve([{ kind: "command", replaceFrom: 0, replaceTo: 1, insertText: "/review", detail: "prompt" }]);
    await Promise.resolve();
    await draft.updateComplete;

    expect(menu(draft)?.items).toEqual([]);
    expect(draft.view?.state.doc.toString()).toBe("/");
  });

  it("sizes completions from the composed chat boundary instead of the footer", async () => {
    const chat = document.createElement("main");
    chat.className = "chat-view";
    const promptEditor = document.createElement("prompt-editor");
    const footer = document.createElement("footer");
    promptEditor.attachShadow({ mode: "open" }).append(footer);
    chat.append(promptEditor);
    document.body.append(chat);
    const draft = await mountDraft({
      host: footer,
      runtime: runtimeWith(({ kind, from, to }) => kind === "command"
        ? Array.from({ length: 12 }, (_, index) => ({ kind: "command", replaceFrom: from, replaceTo: to, insertText: `/command-${String(index + 1)}`, detail: "skill" }))
        : []),
    });
    let chatHeight = 553;
    let editorTop = 438;
    vi.spyOn(chat, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 591, chatHeight));
    vi.spyOn(footer, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 429, 563, 116));
    const editorHost = draft.querySelector<HTMLElement>(".markdown-editor");
    if (editorHost === null) throw new Error("Expected markdown editor host");
    vi.spyOn(editorHost, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, editorTop, 545, 54));

    setEditorText(draft, "/");
    await waitForMenuItems(draft, 12);

    expect(menu(draft)?.style.getPropertyValue("--composer-completion-menu-max-block-size")).toBe("430px");

    chatHeight = 783;
    editorTop = 668;
    window.dispatchEvent(new Event("resize"));

    expect(menu(draft)?.style.getPropertyValue("--composer-completion-menu-max-block-size")).toBe("660px");
  });

  it("keeps completion navigation ahead of prompt history and updates combobox state", async () => {
    const draft = await mountDraft({
      promptHistory: ["previous"],
      runtime: runtimeWith(({ kind, from, to }) => kind === "command" ? [
        { kind: "command", replaceFrom: from, replaceTo: to, insertText: "/one", detail: "extension" },
        { kind: "command", replaceFrom: from, replaceTo: to, insertText: "/two", detail: "extension" },
      ] : []),
    });
    setEditorText(draft, "/");
    await waitForMenuItems(draft, 2);
    const content = editorContent(draft);
    const foundMenu = menu(draft);
    const listbox = foundMenu?.shadowRoot?.querySelector("[role='listbox']");
    const options = Array.from(foundMenu?.shadowRoot?.querySelectorAll<HTMLElement>("[role='option']") ?? []);

    expect(content.getAttribute("role")).toBe("combobox");
    expect(content.getAttribute("aria-expanded")).toBe("true");
    expect(content.getAttribute("aria-controls")).toBe(listbox?.id);
    expect(content.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");

    press(draft, "ArrowUp");
    await draft.updateComplete;
    await foundMenu?.updateComplete;

    expect(foundMenu?.shadowRoot?.querySelector("button.selected strong")?.textContent).toBe("/two");
    expect(content.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    expect(foundMenu?.shadowRoot?.querySelector("[role='option'][aria-selected='true']")?.id).toBe(options[1]?.id);
    expect(draft.view?.state.doc.toString()).toBe("/");
  });

  it("picks a pointer-selected completion and restores editor focus", async () => {
    const draft = await mountDraft({
      runtime: runtimeWith(({ kind, from, to }) => kind === "command" ? [{ kind: "command", replaceFrom: from, replaceTo: to, insertText: "/review", detail: "skill" }] : []),
    });
    setEditorText(draft, "/");
    await waitForMenuItems(draft, 1);
    const option = menu(draft)?.shadowRoot?.querySelector<HTMLElement>("[role='option']");
    if (option === null || option === undefined) throw new Error("Expected completion option");

    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true }));
    await draft.updateComplete;

    expect(draft.view?.state.doc.toString()).toBe("/review ");
    expect(editorContent(draft).getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(editorContent(draft));
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
    const draft = await mountDraft({ runtime: { supportedCompletionKinds: new Set(["command"]), inputModeForDraft, resolveCompletion: resolve } });

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
      runtime: { supportedCompletionKinds: new Set(["command"]), inputModeForDraft, resolveCompletion: () => Promise.reject(new Error("Catalog failed")) },
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

  it("clears shown and pending completion results across disconnect and reconnect", async () => {
    const pending = deferred<readonly CompletionItem[]>();
    let calls = 0;
    const host = document.createElement("div");
    const draft = await mountDraft({
      host,
      runtime: runtimeWith(({ from, to }) => {
        calls += 1;
        return calls === 1
          ? [{ kind: "command", replaceFrom: from, replaceTo: to, insertText: "/shown", detail: "skill" }]
          : pending.promise;
      }),
    });
    setEditorText(draft, "/");
    await waitForMenuItems(draft, 1);
    setEditorText(draft, "/p");

    host.remove();
    pending.resolve([{ kind: "command", replaceFrom: 0, replaceTo: 2, insertText: "/stale", detail: "skill" }]);
    await Promise.resolve();
    document.body.append(host);
    await draft.updateComplete;
    await menu(draft)?.updateComplete;

    expect(draft.view?.state.doc.toString()).toBe("/p");
    expect(menu(draft)?.items).toEqual([]);
  });

  it("updates the mounted CodeMirror placeholder when the host changes it", async () => {
    const draft = await mountDraft();
    draft.placeholderText = "Destination ready";
    await draft.updateComplete;

    expect(draft.querySelector(".cm-placeholder")?.textContent).toBe("Destination ready");
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
  onDraftEdited?: () => void;
  host?: HTMLElement;
} = {}): Promise<ComposerDraft> {
  const host = options.host ?? document.createElement("div");
  const draft = new ComposerDraft();
  draft.runtime = options.runtime ?? runtimeWith(() => []);
  if (options.storageKey !== undefined) draft.storageKey = options.storageKey;
  if (options.promptHistory !== undefined) draft.promptHistory = options.promptHistory;
  if (options.onSubmit !== undefined) draft.onSubmit = options.onSubmit;
  if (options.onCompletionError !== undefined) draft.onCompletionError = options.onCompletionError;
  if (options.onDraftEdited !== undefined) draft.onDraftEdited = options.onDraftEdited;
  host.append(draft);
  if (!host.isConnected) document.body.append(host);
  await draft.updateComplete;
  if (draft.view === undefined) throw new Error("Expected CodeMirror to mount");
  return draft;
}

function runtimeWith(resolve: (trigger: PromptCompletionTrigger) => readonly CompletionItem[] | Promise<readonly CompletionItem[]>): ComposerRuntime {
  return { supportedCompletionKinds: new Set(["command", "file", "model"]), inputModeForDraft, resolveCompletion: (trigger) => Promise.resolve(resolve(trigger)) };
}

function press(draft: ComposerDraft, key: string): KeyboardEvent {
  const view = draft.view;
  if (view === undefined) throw new Error("Expected CodeMirror to mount");
  return pressKey(view.contentDOM, key);
}

function editorContent(draft: ComposerDraft): HTMLElement {
  const content = draft.view?.contentDOM;
  if (content === undefined) throw new Error("Expected CodeMirror content DOM");
  return content;
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
  const previousCount = draft.querySelectorAll(".attachment-chip").length;
  startAttachFile(draft, file);
  await vi.waitFor(() => { expect(draft.querySelectorAll(".attachment-chip")).toHaveLength(previousCount + 1); });
}

async function attachFileExpectingError(draft: ComposerDraft, file: File): Promise<void> {
  startAttachFile(draft, file);
  await vi.waitFor(() => { expect(draft.querySelector(".attachment-error")).not.toBeNull(); });
}

function startAttachFile(draft: ComposerDraft, file: File): void {
  const input = draft.querySelector<HTMLInputElement>(".attachment-input");
  if (input === null) throw new Error("Expected attachment input");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change"));
}

interface PendingFileRead {
  readonly file: File;
  resolve: (contents: string) => void;
}

function mockPendingFileReads(): PendingFileRead[] {
  const reads: PendingFileRead[] = [];
  vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader, file: Blob) {
    reads.push({
      file: file instanceof File ? file : new File([file], "blob"),
      resolve: (contents: string) => {
        Object.defineProperty(this, "result", { configurable: true, value: `data:${file.type};base64,${btoa(contents)}` });
        this.dispatchEvent(new ProgressEvent("load"));
      },
    });
  });
  return reads;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve; });
  return { promise, resolve };
}
