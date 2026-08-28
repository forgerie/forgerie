// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskUserOutcome, AskUserQuestion, PendingAskUser } from "../../../shared/apiTypes";
import type { ComposerDictationCapability } from "../composerCapabilities";
import { saveAskDraft } from "../askDrafts";
import { AskUserCard, type AskUserSubmitCallback } from "./AskUserCard";
import type { AskUserTextComposer } from "./AskUserTextComposer";
import type { ComposerDraft } from "./ComposerDraft";
import type { PromptEditor } from "./PromptEditor";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("ask-user-card live form", () => {
  it("uses native labelled groups and updates progress for a keyboard-focusable single select", async () => {
    const card = await mountOpenAsk(openAsk([
      question("editor", "Choose an editor", [option("vim", "Vim"), option("code", "VS Code")], { detail: "Used for examples." }),
      question("platforms", "Target platforms", [option("web", "Web"), option("desktop", "Desktop")], { multiple: true }),
    ]));
    const root = renderRoot(card);
    expect(card).toBeInstanceOf(HTMLElement);
    expect(customElements.get("ask-user-card")).toBe(AskUserCard);
    const fieldsets = root.querySelectorAll("fieldset");
    const legends = root.querySelectorAll("legend");
    const vim = inputWithValue(root, "vim");
    const code = inputWithValue(root, "code");
    const web = inputWithValue(root, "web");

    expect(fieldsets).toHaveLength(2);
    expect(legends[0]?.textContent).toContain("Choose an editor");
    expect(fieldsets[0]?.getAttribute("aria-describedby")).toBe("ask-user-question-detail-0");
    expect(root.querySelector("#ask-user-question-detail-0")?.textContent).toBe("Used for examples.");
    expect(vim.type).toBe("radio");
    expect(code.name).toBe(vim.name);
    expect(web.type).toBe("checkbox");
    expect(web.name).not.toBe(vim.name);
    expect(root.querySelector("[aria-live='polite']")?.textContent).toContain("0 of 2 answered");

    // Focus and interaction run through the rendered native control rather than
    // extracting Lit handlers, so this exercises the form's browser boundary.
    vim.focus();
    expect(root.activeElement).toBe(vim);
    vim.click();
    await card.updateComplete;

    expect(vim.checked).toBe(true);
    expect(code.checked).toBe(false);
    expect(root.querySelector("[aria-live='polite']")?.textContent).toContain("1 of 2 answered");
  });

  it("accumulates several checkbox values for a multi-select question", async () => {
    const onSubmit = vi.fn<AskUserSubmitCallback>();
    const card = await mountOpenAsk(openAsk([
      question("platforms", "Target platforms", [option("web", "Web"), option("desktop", "Desktop")], { multiple: true }),
    ]), onSubmit);
    const root = renderRoot(card);

    inputWithValue(root, "web").click();
    inputWithValue(root, "desktop").click();
    await card.updateComplete;

    expect(root.querySelector("[aria-live='polite']")?.textContent).toContain("1 of 1 answered");
    buttonWithText(root, "Send answers").click();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledWith("ask-1", {
      answers: [{ id: "platforms", values: ["web", "desktop"] }],
    });
  });

  it("uses the chat editor and its writing tools for a custom answer", async () => {
    const onSubmit = vi.fn<AskUserSubmitCallback>();
    const card = await mountOpenAsk(openAsk([
      question("stack", "Pick the stack", [option("lit", "Lit"), option("react", "React")], { multiple: true }),
    ]), onSubmit);
    const root = renderRoot(card);

    inputWithValue(root, "lit").click();
    inputWithValue(root, "__pi_web_other__").click();
    await card.updateComplete;

    const composer = requiredElement(root.querySelector<AskUserTextComposer>("ask-user-text-composer"), "custom answer composer");
    await composer.updateComplete;
    const editor = requiredElement(composer.shadowRoot?.querySelector<PromptEditor>("prompt-editor"), "shared prompt editor");
    await editor.updateComplete;
    const draft = requiredElement(editor.shadowRoot?.querySelector<ComposerDraft>("composer-draft"), "shared rich editor");
    await draft.updateComplete;

    expect(composer.shadowRoot?.textContent).not.toContain("Custom answer");
    expect(editor.editorLabel).toBe("Custom answer");
    expect(editor.shadowRoot?.querySelector(".composer-commands")).not.toBeNull();
    expect(editor.shadowRoot?.querySelector(".composer-attach")).not.toBeNull();
    expect(editor.shadowRoot?.querySelector(".dictation-button")).not.toBeNull();
    expect(editor.shadowRoot?.querySelector(".send-button")).toBeNull();
    expect(editor.surfaceMode).toBe("embedded");
    expect(editor.getAttribute("surface")).toBe("embedded");
    expect(draft.forcedAttachmentDelivery).toBe("folder");
    expect(draft.storageKey).toBeUndefined();

    setComposerText(draft, "Svelte");
    await attachFile(draft, new File(["ship"], "notes.txt", { type: "text/plain" }));
    await card.updateComplete;
    buttonWithText(root, "Send answers").click();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledWith("ask-1", {
      answers: [{
        id: "stack",
        values: ["lit"],
        otherText: "Svelte",
        attachments: [{ kind: "file", mimeType: "text/plain", data: "c2hpcA==", name: "notes.txt" }],
      }],
    });
  });

  it("blocks submission while the rich editor is still reading an attachment", async () => {
    const onSubmit = vi.fn<AskUserSubmitCallback>();
    const card = await mountOpenAsk(openAsk([
      question("notes", "Anything else?", []),
    ]), onSubmit);
    const root = renderRoot(card);
    const composer = requiredElement(root.querySelector<AskUserTextComposer>("ask-user-text-composer"), "custom answer composer");
    await composer.updateComplete;
    const editor = requiredElement(composer.shadowRoot?.querySelector<PromptEditor>("prompt-editor"), "shared prompt editor");
    await editor.updateComplete;
    const draft = requiredElement(editor.shadowRoot?.querySelector<ComposerDraft>("composer-draft"), "shared rich editor");
    await draft.updateComplete;

    const finishRead = startPendingAttachment(draft, new File(["ship"], "notes.txt", { type: "text/plain" }));

    await vi.waitFor(() => {
      expect(buttonWithText(root, "Attaching…").disabled).toBe(true);
    });
    buttonWithText(root, "Attaching…").click();
    expect(onSubmit).not.toHaveBeenCalled();

    finishRead();
    await vi.waitFor(() => {
      expect(draft.querySelectorAll(".attachment-chip")).toHaveLength(1);
      expect(buttonWithText(root, "Send answers").disabled).toBe(false);
    });
    buttonWithText(root, "Send answers").click();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledWith("ask-1", {
      answers: [{
        id: "notes",
        values: [],
        attachments: [{ kind: "file", mimeType: "text/plain", data: "c2hpcA==", name: "notes.txt" }],
      }],
    });
  });

  it("ignores a detached editor finishing after a replacement editor starts another attachment", async () => {
    const card = await mountOpenAsk(openAsk([
      question("stack", "Pick the stack", [option("lit", "Lit")], { multiple: true }),
    ]));
    const root = renderRoot(card);
    inputWithValue(root, "__pi_web_other__").click();
    await card.updateComplete;
    const oldDraft = await customAnswerDraft(root);
    const finishOldRead = startPendingAttachment(oldDraft, new File(["old"], "old.txt", { type: "text/plain" }));

    inputWithValue(root, "__pi_web_other__").click();
    await card.updateComplete;
    inputWithValue(root, "__pi_web_other__").click();
    await card.updateComplete;
    const replacementDraft = await customAnswerDraft(root);
    expect(replacementDraft).not.toBe(oldDraft);
    const finishReplacementRead = startPendingAttachment(replacementDraft, new File(["new"], "new.txt", { type: "text/plain" }));

    finishOldRead();
    await Promise.resolve();
    expect(buttonWithText(root, "Attaching…").disabled).toBe(true);

    finishReplacementRead();
    await vi.waitFor(() => {
      expect(buttonWithText(root, "Send answers").disabled).toBe(false);
    });
  });

  it("blocks partial submission while an attachment is still being read", async () => {
    const onSubmit = vi.fn<AskUserSubmitCallback>();
    const card = await mountOpenAsk(openAsk([
      question("notes", "Anything else?", []),
      question("deploy", "Choose a deployment target", [option("cloud", "Cloud")]),
    ]), onSubmit);
    const root = renderRoot(card);
    const draft = await customAnswerDraft(root);
    setComposerText(draft, "Supporting context");
    await card.updateComplete;
    buttonWithText(root, "Send answers").click();
    await card.updateComplete;

    const finishRead = startPendingAttachment(draft, new File(["ship"], "notes.txt", { type: "text/plain" }));
    await vi.waitFor(() => {
      expect(buttonWithText(root, "Attaching…").disabled).toBe(true);
    });
    buttonWithText(root, "Attaching…").click();
    expect(onSubmit).not.toHaveBeenCalled();

    finishRead();
    await vi.waitFor(() => {
      expect(buttonWithText(root, "Send answers").disabled).toBe(false);
    });
    buttonWithText(root, "Send answers").click();
    await card.updateComplete;
    buttonWithText(root, "Send anyway").click();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledWith("ask-1", {
      answers: [{
        id: "notes",
        values: [],
        otherText: "Supporting context",
        attachments: [{ kind: "file", mimeType: "text/plain", data: "c2hpcA==", name: "notes.txt" }],
      }],
    });
  });

  it("shows the aggregate attachment limit before submission", async () => {
    const card = await mountOpenAsk(openAsk([
      question("first", "First answer", []),
      question("second", "Second answer", []),
    ]));
    const root = renderRoot(card);
    const drafts = await customAnswerDrafts(root);

    await attachFiles(drafts[0], Array.from({ length: 9 }, (_, index) => new File(["a"], `first-${String(index)}.txt`, { type: "text/plain" })));
    await attachFiles(drafts[1], Array.from({ length: 9 }, (_, index) => new File(["b"], `second-${String(index)}.txt`, { type: "text/plain" })));
    await card.updateComplete;

    expect(root.querySelector(".attachment-limit")?.textContent).toContain("Remove 2 files");
    expect(buttonWithText(root, "Send answers").disabled).toBe(true);
  });

  it("shows and submits the rich answer editor directly when no options were supplied", async () => {
    const onSubmit = vi.fn<AskUserSubmitCallback>();
    const card = await mountOpenAsk(openAsk([
      question("notes", "Anything else?", [], { detail: "Add any supporting context." }),
    ]), onSubmit);
    const root = renderRoot(card);
    const composer = requiredElement(root.querySelector<AskUserTextComposer>("ask-user-text-composer"), "custom answer composer");
    await composer.updateComplete;
    const editor = requiredElement(composer.shadowRoot?.querySelector<PromptEditor>("prompt-editor"), "shared prompt editor");
    await editor.updateComplete;
    const draft = requiredElement(editor.shadowRoot?.querySelector<ComposerDraft>("composer-draft"), "shared rich editor");
    await draft.updateComplete;

    expect(root.querySelector("input")).toBeNull();
    expect(root.querySelector(".question-detail")?.textContent).toBe("Add any supporting context.");
    expect(root.querySelector("fieldset")?.getAttribute("aria-describedby")).toBe("ask-user-question-detail-0");
    setComposerText(draft, "Keep the first version small.");
    await card.updateComplete;
    buttonWithText(root, "Send answers").click();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledWith("ask-1", {
      answers: [{ id: "notes", values: [], otherText: "Keep the first version small." }],
    });
  });

  it("names unanswered questions before allowing a partial submit", async () => {
    const onSubmit = vi.fn<AskUserSubmitCallback>();
    const card = await mountOpenAsk(openAsk([
      question("editor", "Choose an editor", [option("vim", "Vim")]),
      question("deploy", "Choose a deployment target", [option("cloud", "Cloud")]),
      question("notes", "Add implementation notes", []),
    ]), onSubmit);
    const root = renderRoot(card);

    inputWithValue(root, "vim").click();
    await card.updateComplete;
    buttonWithText(root, "Send answers").click();
    await card.updateComplete;
    await Promise.resolve();

    const confirmation = requiredElement(root.querySelector("[aria-label='Confirm partial answers']"), "partial confirmation");
    expect(confirmation.textContent).toContain("Send without answering:");
    expect(confirmation.textContent).toContain("Choose a deployment target");
    expect(confirmation.textContent).toContain("Add implementation notes");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(root.activeElement).toBe(buttonWithText(root, "Send anyway"));

    buttonWithText(root, "Send anyway").click();
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledWith("ask-1", {
      answers: [{ id: "editor", values: ["vim"] }],
    });
  });
});

describe("ask-user-card record mode", () => {
  it("has no answer controls and displays draft answers retained for a superseded ask", async () => {
    const draftSessionId = "remote-a:session-1";
    saveAskDraft(draftSessionId, "ask-old", {
      speed: { values: ["fast"] },
      rationale: { values: [], otherText: "It keeps the feedback loop short." },
    });
    const outcome: AskUserOutcome = {
      askId: "ask-old",
      reason: "superseded",
      askedAt: "2026-07-20T10:00:00.000Z",
      closedAt: "2026-07-20T10:05:00.000Z",
      questions: [
        unansweredRecord(question("speed", "Preferred pace", [option("fast", "Fast"), option("careful", "Careful")])),
        unansweredRecord(question("rationale", "Why?", [])),
        unansweredRecord(question("region", "Deployment region", [option("eu", "Europe")])),
      ],
      answeredCount: 0,
      unansweredIds: ["speed", "rationale", "region"],
      summary: "Answered 0 of 3; unanswered: speed, rationale, region",
    };
    const card = new AskUserCard();
    card.draftSessionId = draftSessionId;
    card.outcome = outcome;
    document.body.append(card);
    await card.updateComplete;
    const root = renderRoot(card);

    expect(root.querySelector("input, textarea, button, select")).toBeNull();
    expect(root.textContent).toContain("Superseded");
    expect(root.textContent).toContain("Fast");
    expect(root.textContent).toContain("It keeps the feedback loop short.");
    expect(root.textContent).toContain("Draft answer · not sent");
    expect(root.textContent).toContain("Deployment region");
    expect(root.textContent).toContain("Unanswered");
  });
});

async function mountOpenAsk(ask: PendingAskUser, onSubmit?: AskUserSubmitCallback): Promise<AskUserCard> {
  const card = new AskUserCard();
  card.ask = ask;
  card.draftSessionId = "local:session-1";
  card.sessionId = "session-1";
  card.sessionCwd = "/repo";
  card.machineId = "local";
  card.dictation = dictationCapability();
  if (onSubmit !== undefined) card.onSubmit = onSubmit;
  document.body.append(card);
  await card.updateComplete;
  return card;
}

function renderRoot(card: AskUserCard): ShadowRoot {
  return requiredElement(card.shadowRoot, "ask-user-card shadow root");
}

function inputWithValue(root: ShadowRoot, value: string): HTMLInputElement {
  const input = [...root.querySelectorAll("input")].find((candidate) => candidate.value === value);
  return requiredElement(input, `input with value ${value}`);
}

function setComposerText(draft: ComposerDraft, text: string): void {
  const view = requiredElement(draft.view, "CodeMirror editor");
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

async function attachFile(draft: ComposerDraft, file: File): Promise<void> {
  await attachFiles(draft, [file]);
}

async function attachFiles(draft: ComposerDraft | undefined, files: File[]): Promise<void> {
  const found = requiredElement(draft, "shared rich editor");
  const input = requiredElement(found.querySelector<HTMLInputElement>(".attachment-input"), "attachment input");
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input.dispatchEvent(new Event("change"));
  await vi.waitFor(() => { expect(found.querySelectorAll(".attachment-chip")).toHaveLength(files.length); });
}

async function customAnswerDraft(root: ShadowRoot): Promise<ComposerDraft> {
  return requiredElement((await customAnswerDrafts(root))[0], "custom answer draft");
}

async function customAnswerDrafts(root: ShadowRoot): Promise<ComposerDraft[]> {
  const composers = [...root.querySelectorAll<AskUserTextComposer>("ask-user-text-composer")];
  await Promise.all(composers.map((composer) => composer.updateComplete));
  const editors = composers.map((composer) => requiredElement(composer.shadowRoot?.querySelector<PromptEditor>("prompt-editor"), "shared prompt editor"));
  await Promise.all(editors.map((editor) => editor.updateComplete));
  const drafts = editors.map((editor) => requiredElement(editor.shadowRoot?.querySelector<ComposerDraft>("composer-draft"), "shared rich editor"));
  await Promise.all(drafts.map((draft) => draft.updateComplete));
  return drafts;
}

function startPendingAttachment(draft: ComposerDraft, file: File): () => void {
  const finishes: (() => void)[] = [];
  vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
    finishes.push(() => {
      Object.defineProperty(this, "result", { configurable: true, value: "data:text/plain;base64,c2hpcA==" });
      this.dispatchEvent(new ProgressEvent("load"));
    });
  });
  const input = requiredElement(draft.querySelector<HTMLInputElement>(".attachment-input"), "attachment input");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change"));
  return () => { requiredElement(finishes[0], "pending file reader")(); };
}

function dictationCapability(): ComposerDictationCapability {
  return {
    getStatus: () => Promise.resolve({
      smartTurn: "ready",
      whisper: "ready",
      capability: "ready",
      limits: { sampleRateHz: 16_000, maxTurnSeconds: 60, maxTurnBytes: 3_840_000, endpointWindowSeconds: 8, endpointWindowBytes: 512_000 },
    }),
    createCaptureSession: () => Promise.reject(new Error("not used")),
    speechApi: {
      checkTurn: () => Promise.reject(new Error("not used")),
      transcribe: () => Promise.reject(new Error("not used")),
    },
    statusPollIntervalMs: 60_000,
  };
}

function buttonWithText(root: ShadowRoot, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === text);
  return requiredElement(button, `button named ${text}`);
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}

function openAsk(questions: AskUserQuestion[]): PendingAskUser {
  return { askId: "ask-1", askedAt: "2026-07-20T10:00:00.000Z", questions };
}

function question(
  id: string,
  text: string,
  options: AskUserQuestion["options"],
  settings: { detail?: string; multiple?: boolean } = {},
): AskUserQuestion {
  return {
    id,
    question: text,
    options,
    ...(settings.detail === undefined ? {} : { detail: settings.detail }),
    ...(settings.multiple === undefined ? {} : { multiple: settings.multiple }),
  };
}

function option(value: string, label: string): AskUserQuestion["options"][number] {
  return { value, label };
}

function unansweredRecord(questionValue: AskUserQuestion): AskUserOutcome["questions"][number] {
  return { question: questionValue, answered: false, values: [] };
}
