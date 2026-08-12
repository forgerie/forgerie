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
 * Model, thinking level, and guidance are chosen the same way on both
 * surfaces. Before a session exists the choice is held by the composer and
 * carried into creation, rather than applied to a session that is not there.
 */
describe("new-session composer agent choices", () => {
  it("carries the chosen model, thinking level, and guidance into the launch", async () => {
    const submitted: NewSessionLaunchIntent[] = [];
    const composer = await mount((intent) => { submitted.push(intent); return Promise.resolve({ kind: "accepted" as const }); });

    await pickModel(composer, { provider: "anthropic", id: "claude-opus-5" });
    await pickThinking(composer, "high");
    await setGuidance(composer, "technical-english", true);
    setText(composer, "start the review");
    sendButton(composer).click();
    await settleRenderedDialog(composer);

    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.agentChoices).toEqual({
      modelSpec: "anthropic/claude-opus-5",
      thinkingLevel: "high",
      guidanceIds: ["technical-english"],
    });
  });

  it("states no choice at all when the author picked none", async () => {
    const submitted: NewSessionLaunchIntent[] = [];
    const composer = await mount((intent) => { submitted.push(intent); return Promise.resolve({ kind: "accepted" as const }); });

    setText(composer, "start the review");
    sendButton(composer).click();
    await settleRenderedDialog(composer);

    expect(submitted[0]?.agentChoices).toBeUndefined();
  });
});

async function mount(onSubmit: (intent: NewSessionLaunchIntent) => Promise<NewSessionSubmissionOutcome>): Promise<NewSessionComposer> {
  const composer = new NewSessionComposer();
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
  composer.onPickModel = (_current, machineId) => {
    // The catalog must be asked of the destination machine.
    expect(machineId).toBe("local");
    return Promise.resolve(model);
  };
  editor(composer).capabilities.model?.onSelectModel();
  await settleRenderedDialog(composer);
}

async function pickThinking(composer: NewSessionComposer, level: string): Promise<void> {
  composer.onPickThinkingLevel = () => Promise.resolve(level);
  editor(composer).capabilities.model?.onSelectThinking();
  await settleRenderedDialog(composer);
}

async function setGuidance(composer: NewSessionComposer, entryId: string, enabled: boolean): Promise<void> {
  await editor(composer).capabilities.guidance?.onSet(entryId, enabled);
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
