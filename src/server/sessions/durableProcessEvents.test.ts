import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Type } from "@earendil-works/pi-ai";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry, defineExtension, defineTool, InboxDoc } from "@earendil-works/pi-durable";
import { expect, it, vi } from "vitest";
import { Presentation } from "./durableParentDocuments.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import { acceptProcessEvents, PROCESS_EVENTS_KIND, processEventsExtension } from "./durableProcessEvents.js";
import { processSummarySchema, type ProcessEventSummary } from "../processes/processWatchState.js";

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
    const capped: ProcessEventSummary = { id: "capped", seriesId: "overflow", missed: true, events: [], turnRequired: true,
      overflow: { turn: 1, context: 0, ignore: 0, samples: 1, aggregates: 1 } };
    await acceptProcessEvents(journal.conversation, capped, context);
    await vi.waitFor(() => { expect(turns).toBe(2); });
    await journal.conversation.waitForIdle(context);
    await journal.close(); journal = await open();
    await acceptProcessEvents(journal.conversation, { ...capped, id: "capped-retry" }, context);
    journal.harness.resume(); await journal.conversation.waitForIdle(context);
    expect(turns).toBe(2);
  } finally { await journal.close(); await rm(root, { recursive: true, force: true }); }
});


it("counts only new coalesced matches and overflow after acceptance, restart and later eviction", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-process-counts-"));
  const manager = SessionManager.create(root, join(root, "sessions"));
  const models = createModels(); const registry = createRegistry(); registry.install(processEventsExtension());
  const open = () => DurableSessionJournal.open({ manager, models, registry, agent: {} });
  let journal = await open();
  const first: ProcessEventSummary = { id: "first", seriesId: "series", missed: true, events: [
    { processId: "one", name: "one", watchId: "watch", kind: "match", attention: "context", line: 20, count: 20, totalCount: 20, samples: [] },
  ] };
  const next: ProcessEventSummary = { ...first, id: "next", events: first.events.map(event => ({ ...event, line: 40, count: 40, totalCount: 40 })),
    overflow: { turn: 0, context: 10, ignore: 0, samples: 12, aggregates: 2 } };
  const more: ProcessEventSummary = { ...next, id: "more", overflow: { turn: 0, context: 15, ignore: 0, samples: 20, aggregates: 3 } };
  try {
    await acceptProcessEvents(journal.conversation, first, context);
    await journal.close(); journal = await open();
    await acceptProcessEvents(journal.conversation, next, context);
    await acceptProcessEvents(journal.conversation, more, context);
    await journal.close(); journal = await open();
    await acceptProcessEvents(journal.conversation, { ...more, id: "retry" }, context);
    // The previously accepted aggregate is now evicted; only the new match counts again.
    await acceptProcessEvents(journal.conversation, { ...more, id: "eviction", events: [
      { processId: "two", name: "two", watchId: "watch", kind: "match", attention: "context", line: 1, count: 1, totalCount: 1, samples: [] },
    ], overflow: { turn: 0, context: 55, ignore: 0, samples: 20, aggregates: 4 } }, context);
    const summaries = (await journal.conversation.entries({ order: "ascending" }, 100, undefined, context)).items.filter(entry => entry.kind === PROCESS_EVENTS_KIND)
      .map(entry => processSummarySchema.parse(entry.data));
    expect(summaries).toHaveLength(4);
    expect(summaries.map(summary => summary.events.reduce((count, event) => count + event.count, 0) + (summary.overflow?.context ?? 0))).toEqual([20, 30, 5, 1]);
  } finally { await journal.close(); await rm(root, { recursive: true, force: true }); }
});

it("joins process-event wakes queued behind a busy turn into one follow-up, and keeps them all after withdrawal", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-process-coalesce-"));
  const manager = SessionManager.create(root, join(root, "sessions"));
  const models = createModels(); const provider = fauxProvider({ tokensPerSecond: 100000 }); models.setProvider(provider.provider);
  const hold = defineExtension({ name: "process-hold", tools: [defineTool({
    name: "hold", description: "Hold this turn until it is stopped", parameters: Type.Object({}), replay: "safe",
    execute: async (_args, _api, ctx) => { await sleep(60_000, undefined, { signal: ctx.abortSignal }); return { content: [] }; },
  })] });
  const prompts: string[] = [];
  provider.setResponses(Array.from({ length: 20 }, () => (request) => {
    const last = [...request.messages].reverse().find(message => message.role === "user");
    const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
    prompts.push(text);
    return text === "Start" ? fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }) : fauxAssistantMessage("received");
  }));
  const registry = createRegistry(); registry.install(processEventsExtension()); registry.install(hold);
  const journal = await DurableSessionJournal.open({ manager, models, registry, agent: { model: { provider: "faux", modelId: "faux-1" }, extensions: [hold] } });
  const wake = (id: string, name: string): ProcessEventSummary => ({ id, missed: false, events: [
    { processId: name, name, watchId: "exit", attention: "turn", kind: "exit", line: 0, count: 1, samples: [], reason: "exited 1" },
  ] });
  const inbox = async () => (await journal.harness.snapshot(InboxDoc, journal.conversation.id, context))?.items ?? [];
  const wakes = () => prompts.filter(prompt => prompt.includes("Managed process events"));
  try {
    journal.harness.resume();
    await journal.conversation.submit({ type: "input", content: "Start" }, context);
    await vi.waitFor(() => { expect(prompts).toContain("Start"); });
    await acceptProcessEvents(journal.conversation, wake("a", "alpha"), context);
    await vi.waitFor(async () => { expect(await inbox()).toHaveLength(1); });
    await acceptProcessEvents(journal.conversation, wake("b", "beta"), context);
    await acceptProcessEvents(journal.conversation, wake("c", "gamma"), context);
    const items = await inbox();
    expect(items).toHaveLength(1);
    const queued = JSON.stringify(items[0]);
    for (const name of ["alpha", "beta", "gamma"]) expect(queued).toContain(name);
    expect(queued.split("Managed process events").length - 1).toBe(1);
    // Abort withdraws the queued wake. Its retry must carry the joined text, not only the first event.
    await journal.conversation.abort(context);
    await vi.waitFor(() => { expect(wakes()).toHaveLength(1); });
    await journal.conversation.waitForIdle(context);
    expect(wakes()).toHaveLength(1);
    for (const name of ["alpha", "beta", "gamma"]) expect(wakes()[0]).toContain(name);
  } finally { await journal.close(); await rm(root, { recursive: true, force: true }); }
});
