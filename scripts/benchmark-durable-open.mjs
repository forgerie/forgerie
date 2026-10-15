#!/usr/bin/env -S tsx
/**
 * Usage: node_modules/.bin/tsx scripts/benchmark-durable-open.mjs [attachments=3] [seconds=10] [turns=1500]
 * Real temporary SQLite journal. No provider, scheduler resume, server, or network.
 * Acquisition time includes waiting for the execution line; serialized time measures only the callback.
 * Initial seeds are reported separately. Streaming counters start after every attachment has seeded.
 * Rates use the offered interval, not an extended drain time that could hide overload. Exit 1 misses a target.
 */
import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, UserEntry, AssistantEntry, LiveDoc, GenerationTask } from "@earendil-works/pi-durable";
import { DurableJournalPool } from "../src/server/sessions/durableJournalPool.ts";
import { initializeParentDocuments } from "../src/server/sessions/durableParentDocuments.ts";
import { DurableParentReadModel } from "../src/server/sessions/durableParentReadModel.ts";
import { DurableSessionReader } from "../src/server/sessions/durableSessionReader.ts";
import { SessionEventHub } from "../src/server/realtime/sessionEventHub.ts";

const settings = z.object({ attachments: z.coerce.number().int().min(1).max(10), seconds: z.coerce.number().min(1).max(60), turns: z.coerce.number().int().min(1).max(10000) })
  .parse({ attachments: process.argv[2] ?? 3, seconds: process.argv[3] ?? 10, turns: process.argv[4] ?? 1500 });
const directory = await mkdtemp(join(tmpdir(), "forgerie-native-benchmark-"));
const pool = new DurableJournalPool();
let totalMs = 0, serializedMs = 0, acquisitions = 0, deliveries = 0;
let reader;
let owner;
const faults = [];
try {
  owner = await pool.acquire({ databasePath: join(directory, "state.sqlite"), sessionId: "benchmark", create: {}, initializeParentDocuments }, { models: createModels(), registry: createRegistry() }, context);
  await owner.conversation.commit(async tx => {
    for (let turn = 0; turn < settings.turns; turn++) {
      await tx.appendEntry(UserEntry, owner.conversation.id, { model: [{ role: "user", content: `input ${turn}`, timestamp: turn }] });
      await tx.appendEntry(AssistantEntry, owner.conversation.id, { model: [fauxAssistantMessage(`answer ${turn}`)] });
    }
    const taskId = await tx.createTask(GenerationTask, {}, { ownership: { kind: "conversation" } });
    (await tx.doc(LiveDoc, owner.conversation.id)).run = { inputs: [], taskId };
  }, context);
  const hub = new SessionEventHub();
  reader = new DurableSessionReader({
    locate: async () => owner.address,
    acquire: address => pool.acquireRead(address, context),
    readModel: handle => {
      const conversation = new Proxy(handle.conversation, { get(target, key) {
        if (key === "commit") return (change, ctx) => target.commit(async tx => {
          const started = performance.now();
          try { return await change(tx); } finally { serializedMs += performance.now() - started; }
        }, ctx);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const model = new DurableParentReadModel({ handle: { ...handle, conversation }, messageId: (entry, index) => `${entry.id}:${index}` });
      const open = model.open.bind(model);
      model.open = async (...args) => {
        const started = performance.now(); acquisitions++;
        try { return await open(...args); } finally { totalMs += performance.now() - started; }
      };
      return model;
    },
    history: () => { throw new Error("Benchmark does not read trees"); },
  });
  for (let index = 0; index < settings.attachments; index++) await reader.attachOpen({ id: "benchmark", cwd: directory }, hub,
    async () => { deliveries++; }, error => { faults.push(String(error)); });
  const seed = { totalMs, serializedMs, acquisitions };
  totalMs = 0; serializedMs = 0; acquisitions = 0; deliveries = 0;
  const started = performance.now();
  const ticks = Math.round(settings.seconds * 10);
  for (let tick = 0; tick < ticks; tick++) {
    await sleep(Math.max(0, started + tick * 100 - performance.now()));
    await owner.conversation.commit(async tx => {
      (await tx.doc(LiveDoc, owner.conversation.id)).generation = { attempt: 1, message: fauxAssistantMessage("streaming partial ".repeat(tick + 1)) };
    }, context);
    hub.publish("benchmark", { type: "status.update", status: { sessionId: "benchmark", isStreaming: true, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 } });
  }
  await sleep(Math.max(0, started + settings.seconds * 1000 - performance.now()));
  await reader.close();
  const elapsedSeconds = (performance.now() - started) / 1000;
  const totalMsPerSecond = totalMs / settings.seconds;
  const serializedMsPerSecond = serializedMs / settings.seconds;
  const passesTargets = totalMsPerSecond <= 150 && serializedMsPerSecond <= 50 && faults.length === 0;
  process.stdout.write(JSON.stringify({ ...settings, ticks, elapsedSeconds, seed, acquisitions, deliveries, totalMs, serializedMs,
    totalMsPerSecond, serializedMsPerSecond, passesTargets, faults }, null, 2) + "\n");
  if (!passesTargets) process.exitCode = 1;
} finally {
  await reader?.close(); await owner?.release(context); await pool.close(context); await rm(directory, { recursive: true, force: true });
}
