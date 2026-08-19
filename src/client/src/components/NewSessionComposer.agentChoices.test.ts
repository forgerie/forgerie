// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionModel } from "../../../shared/apiTypes";
import { completeNewSessionDestination } from "../newSessionComposer";
import type { NewSessionLaunchIntent, NewSessionSubmissionOutcome } from "../newSessionComposer";
import { NewSessionComposer } from "./NewSessionComposer";
import { PromptEditor } from "./PromptEditor";
import { settleRenderedDialog } from "./modalSurfaceTestSupport";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

/**
 * Model and thinking level are chosen the same way on both surfaces. Before a
 * session exists, the composer holds the choice and carries it into creation.
 */
describe("new-session composer agent choices", () => {
  it("carries the chosen model and thinking level into the launch", async () => {
    const submitted: NewSessionLaunchIntent[] = [];
    const composer = await mount((intent) => { submitted.push(intent); return Promise.resolve({ kind: "accepted" as const }); });

    await pickModel(composer, { provider: "anthropic", id: "claude-opus-5" });
    await pickThinking(composer, "high");
    setText(composer, "start the review");
    sendButton(composer).click();
    await settleRenderedDialog(composer);

    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.agentChoices).toEqual({
      modelSpec: "anthropic/claude-opus-5",
      thinkingLevel: "high",
    });
  });

  it("shows and carries Pi's effective defaults before the author picks anything", async () => {
    const defaultModel = { provider: "anthropic", id: "claude-opus-5", reasoning: true };
    const defaults = vi.fn(() => Promise.resolve({
      models: [defaultModel],
      model: defaultModel,
      thinkingLevel: "high",
    }));
    const submitted: NewSessionLaunchIntent[] = [];
    const composer = await mount(
      (intent) => { submitted.push(intent); return Promise.resolve({ kind: "accepted" as const }); },
      defaults,
    );

    expect(defaults).toHaveBeenCalledWith("/repos/forge/main", "local");
    expect(editor(composer).capabilities.model).toMatchObject({ model: defaultModel, thinkingLevel: "high" });

    setText(composer, "start the review");
    sendButton(composer).click();
    await settleRenderedDialog(composer);

    expect(submitted[0]?.agentChoices).toEqual({
      modelSpec: "anthropic/claude-opus-5",
      thinkingLevel: "high",
    });
  });

  it("does not replace an author choice when an earlier defaults request finishes", async () => {
    let resolveDefaults!: (value: Awaited<ReturnType<NonNullable<NewSessionComposer["loadAgentDefaults"]>>>) => void;
    const defaults = () => new Promise<Awaited<ReturnType<NonNullable<NewSessionComposer["loadAgentDefaults"]>>>>((resolve) => { resolveDefaults = resolve; });
    const composer = await mount(() => Promise.resolve({ kind: "accepted" as const }), defaults);

    const authorModel = { provider: "openai-codex", id: "gpt-5.6-sol", reasoning: true };
    await pickModel(composer, authorModel);
    await pickThinking(composer, "max");
    resolveDefaults({
      models: [authorModel, { provider: "anthropic", id: "claude-opus-5", reasoning: true }],
      model: { provider: "anthropic", id: "claude-opus-5", reasoning: true },
      thinkingLevel: "high",
    });
    await settleRenderedDialog(composer);

    expect(editor(composer).capabilities.model).toMatchObject({ model: authorModel, thinkingLevel: "max" });
  });
});

async function mount(
  onSubmit: (intent: NewSessionLaunchIntent) => Promise<NewSessionSubmissionOutcome>,
  loadAgentDefaults?: NonNullable<NewSessionComposer["loadAgentDefaults"]>,
): Promise<NewSessionComposer> {
  const composer = new NewSessionComposer();
  if (loadAgentDefaults !== undefined) composer.loadAgentDefaults = loadAgentDefaults;
  composer.initialDestination = completeNewSessionDestination(
    { id: "local", name: "Machine local", kind: "local", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", status: "online" },
    { id: "forge", name: "Project forge", path: "/repos/forge", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "main", projectId: "forge", path: "/repos/forge/main", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false, effectiveConfig: {} },
  );
  composer.onSubmit = onSubmit;
  document.body.append(composer);
  await settleRenderedDialog(composer);
  return composer;
}

function editor(composer: NewSessionComposer): PromptEditor {
  const found = composer.shadowRoot?.querySelector("prompt-editor");
  if (!(found instanceof PromptEditor)) throw new Error("Expected the shared composer");
  return found;
}

async function pickModel(composer: NewSessionComposer, model: SessionModel): Promise<void> {
  editor(composer).capabilities.model?.onChooseModel(model);
  await settleRenderedDialog(composer);
}

async function pickThinking(composer: NewSessionComposer, level: string): Promise<void> {
  editor(composer).capabilities.model?.onChooseThinkingLevel(level);
  await settleRenderedDialog(composer);
}

function setText(composer: NewSessionComposer, text: string): void {
  editor(composer).replaceText(text);
}

function sendButton(composer: NewSessionComposer): HTMLButtonElement {
  const found = editor(composer).shadowRoot?.querySelector(".send-button");
  if (!(found instanceof HTMLButtonElement)) throw new Error("Expected the composer send button");
  return found;
}
