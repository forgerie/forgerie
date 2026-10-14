import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry } from "@earendil-works/pi-durable";
import { expect, it, vi } from "vitest";
import { Presentation } from "./durableParentDocuments.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import { acceptProcessEvents, PROCESS_EVENTS_KIND, processEventsExtension } from "./durableProcessEvents.js";
import type { ProcessEventSummary } from "../processes/processWatchState.js";

it("durably records attention, excludes ignore from context, and wakes only once for a replay summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-process-events-"));
  const manager = SessionManager.create(root, join(root, "sessions"));
  const registry = createRegistry(); registry.install(processEventsExtension());
  const models = createModels(); const provider = fauxProvider({ tokensPerSecond: 100000 }); models.setProvider(provider.provider);
  let turns = 0;
  provider.setResponses(Array.from({ length: 10 }, () => () => { turns++; return fauxAssistantMessage("received"); }));
  const open = () => DurableSessionJournal.open({ manager, models, registry, agent: { model: { provider: "faux", modelId: "faux-1" } } });
  let journal = await open();
  const passive: ProcessEventSummary = { id: "passive", missed: true, events: [
    { processId: "one", name: "one", watchId: "watch", attention: "context", kind: "match", line: 3, count: 1, samples: [{ number: 3, text: "context-ready" }] },
    { processId: "two", name: "two", watchId: "watch", attention: "ignore", kind: "match", line: 4, count: 1, samples: [{ number: 4, text: "ignored-secret-output" }] },
  ] };
  try {
    await acceptProcessEvents(journal.conversation, passive, context);
    journal.harness.resume();
    await journal.conversation.waitForIdle(context);
    expect(turns).toBe(0);
    const messages = JSON.stringify((await journal.conversation.context(context)).messages);
    expect(messages).toContain("context-ready"); expect(messages).not.toContain("ignored-secret-output");
    const summary: ProcessEventSummary = { id: "wake", missed: true, events: [
      ...passive.events,
      { processId: "three", name: "three", watchId: "watch", attention: "turn", kind: "match", line: 9, count: 4, samples: [{ number: 9, text: "turn-ready" }] },
      { processId: "four", name: "four", watchId: "exit", attention: "turn", kind: "exit", line: 0, count: 1, samples: [], reason: "supervisor lost" },
    ] };
    await acceptProcessEvents(journal.conversation, summary, context);
    await vi.waitFor(() => { expect(turns).toBe(1); });
    await journal.conversation.waitForIdle(context);
    await journal.close(); journal = await open();
    // New batch IDs cannot duplicate accepted process-ID/watch/line identities either.
    await acceptProcessEvents(journal.conversation, { ...summary, id: "retry" }, context);
    journal.harness.resume(); await journal.conversation.waitForIdle(context);
    expect(turns).toBe(1);
    const placed = await journal.conversation.commit(tx => tx.submissionByRequest(journal.conversation.id, "forgerie.custom-message:process-events:wake"), context);
    if (placed?.entry === undefined) throw new Error("Missing notification placement");
    expect((await journal.harness.snapshot(Presentation, journal.conversation.id, String(placed.entry), context))?.envelope?.display).toBe(false);
    const entries = (await journal.conversation.entries({}, 100, undefined, context)).items.filter(entry => entry.kind === PROCESS_EVENTS_KIND);
    expect(entries).toHaveLength(2);
    expect(JSON.stringify(entries)).toContain("ignored-secret-output");
  } finally { await journal.close(); await rm(root, { recursive: true, force: true }); }
});
