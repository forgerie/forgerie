import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "../../shared/apiTypes.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import { createDurableParentInitializer, DurableSdkSessionView } from "./durableSdkSessionView.js";
import { ExtensionEntries, Labels, SessionName } from "./durableParentDocuments.js";
import { createDurableParentState } from "./durableParentState.js";
import { askDeliveryExtension } from "./durableAskDelivery.js";
import { createRegistry } from "@earendil-works/pi-durable";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function imported() {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-parent-composition-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const manager = SessionManager.create(directory, join(directory, "sessions"));
  manager.appendModelChange("faux", "faux-1");
  manager.appendCustomEntry("extension-state", { before: true });
  const user = manager.appendMessage({ role: "user", content: "historical cut", timestamp: 1 });
  manager.appendCustomEntry("extension-state", { after: true });
  manager.appendLabelChange(user, "bookmark");
  manager.appendSessionInfo("Imported title");
  manager.appendMessage(fauxAssistantMessage("an imported answer"));
  const provider = fauxProvider();
  const models = createModels(); models.setProvider(provider.provider);
  const registry = createRegistry(); registry.install(askDeliveryExtension());
  const journal = await DurableSessionJournal.open({ manager, models, registry, agent: { model: { provider: "faux", modelId: "faux-1" } },
    initializeParentDocuments: createDurableParentInitializer(manager) });
  cleanups.push(() => journal.close());
  return { journal, manager, provider, user };
}

it("imports parent metadata at each native SDK boundary and preserves historical custom state at a fork", async () => {
  const { journal, provider, user } = await imported();
  const state = await journal.harness.snapshot(ExtensionEntries, journal.conversation.id, "extension-state", context);
  expect(state?.entries.map((entry) => entry.data)).toEqual([{ before: true }, { after: true }]);
  expect((await journal.harness.snapshot(SessionName, journal.conversation.id, context))?.name).toBe("Imported title");
  const fork = await journal.nativeHistory.fork(user, "at", "logical-fork", context);
  try {
    const inherited = await journal.harness.snapshot(ExtensionEntries, fork.handle.conversation.id, "extension-state", context);
    expect(inherited?.entries.map((entry) => entry.data)).toEqual([{ before: true }]);
    expect((await journal.harness.snapshot(Labels, fork.handle.conversation.id, context))?.entries[user]?.label).toBe("bookmark");
    expect((await journal.harness.snapshot(SessionName, fork.handle.conversation.id, context))?.name).toBe("Imported title");
    expect(provider.state.callCount).toBe(0);
  } finally { await fork.handle.release(context); }
});

it("mounts real parent documents separately and projects an accepted answer without a second notice", async () => {
  const { journal } = await imported();
  const view = await DurableSdkSessionView.open(journal.handle, context);
  const parent = createDurableParentState(journal.handle, journal.nativeHistory);
  const watch = await view.appWatch(context);
  const snapshots: typeof watch.value[] = [];
  watch.start((value) => { snapshots.push(value); return Promise.resolve(); });
  try {
    const opened = await parent.openAsk([{ id: "q", question: "Choose", options: [] }], context);
    await vi.waitFor(() => { expect(snapshots.at(-1)?.pendingAsk?.askId).toBe(opened.ask.askId); });
    const outcome = await parent.voidForChatReply(context);
    expect(outcome?.reason).toBe("answered-in-chat");
    await vi.waitFor(() => { expect(snapshots.at(-1)?.pendingAsk).toBeUndefined(); });
    await view.refresh(context);
    const entries = (await journal.conversation.entries({}, 256, undefined, context)).items;
    const notices = entries.flatMap((entry) => view.projectEntry(entry) ?? []);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ role: "custom", customType: ASK_USER_ANSWERS_CUSTOM_TYPE });
    expect((await journal.harness.inspect(context)).scheduling).toBe("paused");
  } finally { await watch.stop(); view.close(); }
});
