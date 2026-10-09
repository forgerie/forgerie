import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager, createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { createRegistry } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import { DurableAgentSession } from "./durableAgentSession.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";

const directories: string[] = [];
const sessions: DurableAgentSession[] = [];
const journals: DurableSessionJournal[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await Promise.all(journals.splice(0).map((journal) => journal.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture({ supportsOff = false, defaultThinkingLevel = "high" }: { supportsOff?: boolean; defaultThinkingLevel?: DurableAgentSession["thinkingLevel"] | "unset" } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-thinking-restore-"));
  directories.push(directory);
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json") });
  const provider = fauxProvider({ models: [{ id: "reasoning-one", reasoning: true }, { id: "reasoning-two", reasoning: true }] });
  for (const model of provider.models) model.thinkingLevelMap = { ...(supportsOff ? {} : { off: null, minimal: null }), xhigh: "xhigh", max: "max" };
  modelRuntime.registerNativeProvider(provider.provider);
  const model = modelRuntime.getModel("faux", "reasoning-one");
  const otherModel = modelRuntime.getModel("faux", "reasoning-two");
  if (model === undefined || otherModel === undefined) throw new Error("Configured reasoning models must exist");
  const services = await createAgentSessionServices({ cwd: directory, agentDir: join(directory, "agent"), modelRuntime,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true } });
  services.settingsManager.applyOverrides({ defaultProvider: "faux", defaultModel: model.id,
    ...(defaultThinkingLevel === "unset" ? {} : { defaultThinkingLevel }), compaction: { enabled: false } });
  const manager = SessionManager.create(directory, join(directory, "sessions"));
  const open = async (sessionManager = manager, initialThinkingLevel?: DurableAgentSession["thinkingLevel"]) => {
    const session = await DurableAgentSession.open({ services, sessionManager, ...(initialThinkingLevel === undefined ? {} : { initialModel: model, initialThinkingLevel }) });
    sessions.push(session);
    return session;
  };
  return { directory, provider, modelRuntime, model, otherModel, services, manager, open };
}

function sessionFile(manager: SessionManager): string {
  const file = manager.getSessionFile();
  if (file === undefined) throw new Error("Fixture must have a session file");
  return file;
}

function thinkingEntries(manager: SessionManager) {
  return manager.getEntries().filter((entry) => entry.type === "thinking_level_change");
}

describe("Durable thinking selection", () => {
  it("saves initial HIGH thinking and preserves it across repeated reopens and a model change", async () => {
    const { provider, model, otherModel, manager, services, open } = await fixture();
    const session = await open(manager, "high");
    expect(manager.buildSessionContext()).toMatchObject({ model: { provider: model.provider, modelId: model.id }, thinkingLevel: "high" });
    provider.setResponses([fauxAssistantMessage("persist initial selection")]);
    await session.prompt("first input");
    await session.close();
    services.settingsManager.applyOverrides({ defaultModel: otherModel.id, defaultThinkingLevel: "low" });
    const reopenedManager = SessionManager.open(sessionFile(manager));
    const reopened = await open(reopenedManager);
    expect(reopened.model?.id).toBe(model.id);
    expect(reopened.thinkingLevel).toBe("high");
    expect((await reopened.journal.conversation.agent(context)).thinkingLevel).toBe("high");
    const count = thinkingEntries(reopenedManager).length;
    await reopened.close();
    const againManager = SessionManager.open(sessionFile(manager));
    const again = await open(againManager);
    expect(again.thinkingLevel).toBe("high");
    expect(thinkingEntries(againManager)).toHaveLength(count);
    await again.setModel(otherModel);
    const levels: unknown[] = [];
    provider.setResponses([(_messages, options) => { levels.push(options?.reasoning); return fauxAssistantMessage("after model change"); }]);
    await again.prompt("continue");
    expect(levels).toEqual(["high"]);
  });

  it("uses the configured default when no thinking selection was saved", async () => {
    const { manager, open } = await fixture();
    const session = await open();
    expect(session.thinkingLevel).toBe("high");
    expect((await session.journal.conversation.agent(context)).thinkingLevel).toBe("high");
    expect(manager.buildSessionContext().thinkingLevel).toBe("high");
  });

  it("uses the standard MEDIUM level when settings omit a default", async () => {
    const { open } = await fixture({ defaultThinkingLevel: "unset" });
    const session = await open();
    expect(session.thinkingLevel).toBe("medium");
    expect((await session.journal.conversation.agent(context)).thinkingLevel).toBe("medium");
  });

  it("saves the initial selection before the first provider request, even without an assistant", async () => {
    const { provider, model, manager, open } = await fixture();
    const session = await open(manager, "high");
    const selections: unknown[] = [];
    provider.setResponses([() => {
      const saved = SessionManager.open(sessionFile(manager)).buildSessionContext();
      selections.push({ model: saved.model, thinkingLevel: saved.thinkingLevel });
      return fauxAssistantMessage("first answer");
    }]);
    await session.prompt("first input");
    expect(selections).toEqual([{ model: { provider: model.provider, modelId: model.id }, thinkingLevel: "high" }]);
  });

  it.each(["off", "medium", "max"] as const)("preserves an explicit legacy %s selection instead of the default", async (level) => {
    const { manager, open } = await fixture({ supportsOff: true });
    manager.appendThinkingLevelChange(level);
    const session = await open();
    expect(session.thinkingLevel).toBe(level);
    expect((await session.journal.conversation.agent(context)).thinkingLevel).toBe(level);
  });

  it.each(["missing", "stale"] as const)("repairs a %s transcript selection from the existing native engine state", async (projection) => {
    const { provider, modelRuntime, model, otherModel, manager, services, open } = await fixture();
    // Recreate a pre-fix journal: native settings exist without a matching JSONL selection.
    const journal = await DurableSessionJournal.open({ manager, models: modelRuntime, registry: createRegistry(),
      agent: { model: { provider: model.provider, modelId: model.id }, thinkingLevel: "high" } });
    journals.push(journal);
    provider.setResponses([fauxAssistantMessage("pre-fix answer")]);
    await (await journal.conversation.submit({ type: "input", content: "pre-fix input" }, context)).wait(context);
    await journal.project();
    if (projection === "stale") {
      manager.appendModelChange(otherModel.provider, otherModel.id);
      manager.appendThinkingLevelChange("low");
    }
    await journal.close();
    services.settingsManager.applyOverrides({ defaultModel: otherModel.id, defaultThinkingLevel: "low" });
    const restoredManager = SessionManager.open(sessionFile(manager));
    const restored = await open(restoredManager);
    expect(restored.model?.id).toBe(model.id);
    expect(restored.thinkingLevel).toBe("high");
    expect(restoredManager.buildSessionContext()).toMatchObject({ model: { provider: model.provider, modelId: model.id }, thinkingLevel: "high" });
    expect((await restored.journal.conversation.agent(context)).thinkingLevel).toBe("high");
    await restored.setModel(otherModel);
    const levels: unknown[] = [];
    provider.setResponses([(_messages, options) => { levels.push(options?.reasoning); return fauxAssistantMessage("repaired model change"); }]);
    await restored.prompt("continue after repair");
    expect(levels).toEqual(["high"]);
  });
});
