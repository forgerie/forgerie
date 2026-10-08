#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 -c node
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { ModelRuntime, createReadToolDefinition } from '@earendil-works/pi-coding-agent';
import { CodemodeSandbox } from '@earendil-works/pi-codemode';
import { Harness, createRegistry, defineExtension, defineTool, configure, defineDoc, watchEvents } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createReadTool } from '@earendil-works/pi-durable/tools';

const work = await mkdtemp(join(tmpdir(), 'forgerie-durable-smoke-'));
const results = [];
const passed = (name, detail) => results.push({ name, passed: true, detail });
const png = join(work, 'pixel.png');
await writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhGQAAAAASUVORK5CYII=', 'base64'));
const faux = fauxProvider();
const models = await ModelRuntime.create({ authPath: join(work, 'auth.json'), modelsPath: null, refreshOnCreate: false });
models.registerNativeProvider(faux.provider);
const route = (request) => {
  const last = request.messages.findLast(message => message.role !== 'system');
  if (last?.role === 'toolResult') return fauxAssistantMessage('tool completed');
  const text = typeof last?.content === 'string' ? last.content : last?.content?.filter(part => part.type === 'text').map(part => part.text).join('');
  if (text === 'image test') return fauxAssistantMessage([fauxToolCall('read', { path: png })], { stopReason: 'toolUse' });
  if (text === 'codemode test') return fauxAssistantMessage([fauxToolCall('codemode', { code: 'return await tools.add({a: 20, b: 22})' })], { stopReason: 'toolUse' });
  if (text === 'end turn') return fauxAssistantMessage([fauxToolCall('end_turn', {})], { stopReason: 'toolUse' });
  if (text === 'child task test') return fauxAssistantMessage([fauxToolCall('delegate', {})], { stopReason: 'toolUse' });
  return fauxAssistantMessage(`answer: ${text}`);
};
faux.setResponses(Array.from({ length: 40 }, () => route));
const sdkRead = createReadToolDefinition(work, { autoResizeImages: false });
const read = defineTool({
  name: 'read', description: sdkRead.description, parameters: sdkRead.parameters,
  async execute(args, api, callContext) {
    const agent = await api.agent(callContext);
    const result = await sdkRead.execute(api.callId, args, callContext.abortSignal, undefined, { cwd: agent.cwd, model: models.getModel(agent.model.provider, agent.model.modelId) });
    return { content: result.content, ...(result.details === undefined ? {} : { details: result.details }), isError: result.isError };
  },
});
const codemode = defineTool({
  name: 'codemode', description: 'Run bounded JavaScript', parameters: Type.Object({ code: Type.String() }),
  async execute(args, api, callContext) {
    const sandbox = new CodemodeSandbox({ tools: [{ name: 'add', execute: async ({ a, b }) => a + b }] });
    try {
      const result = await sandbox.execute(args.code, { signal: callContext.abortSignal });
      assert.equal(result.ok, true);
      return { content: [{ type: 'text', text: String(result.value) }], details: { calls: result.calls } };
    } finally { await sandbox.close(); }
  },
});
const Meta = defineDoc({ kind: 'app.forgerie', version: 1, scope: 'conversation', history: 'latest', fork: 'current', initial: () => ({ response: 'none' }) });
const children = [];
const delegate = defineTool({
  name: 'delegate', description: 'Run a durable child', parameters: Type.Object({}), replay: 'safe',
  async execute(_args, api, callContext) {
    const childId = await api.commit(async tx => {
      const prior = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
      if (prior) return prior.id;
      const child = await tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } });
      await configure(tx, child.id, { tools: { remove: [delegate] } });
      return child.id;
    }, callContext);
    children.push(childId);
    const child = await api.conversation(childId, callContext);
    const settled = await (await child.submit({ type: 'input', content: 'child answer', requestId: `child:${api.taskId}` }, callContext)).wait(callContext);
    assert.equal(settled.status, 'done');
    return { content: [{ type: 'text', text: 'child done' }], details: { childId } };
  },
});
const endTurn = defineTool({
  name: 'end_turn', description: 'End the run', parameters: Type.Object({}),
  async execute(_args, api, callContext) {
    await api.commit(async tx => { (await tx.doc(Meta, api.conversationId)).response = 'reply'; }, callContext);
    return { content: [{ type: 'text', text: 'done' }], control: { terminate: true } };
  },
});
const extension = defineExtension({ name: 'forgerie-audit', tools: [read, codemode, delegate, endTurn] });
const registry = createRegistry();
registry.install(extension);
const db = join(work, 'session.sqlite');
const options = { models, registry, settings: { compaction: { enabled: false, keepRecentTokens: 16, reserveTokens: 1024 } }, env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? work }) };
let harness = await Harness.open(await openNodeSqliteStorage(db), options, context);
let root = await harness.root(context, { agent: { model: { provider: 'faux', modelId: 'faux-1' }, cwd: work } });
const rootId = root.id;
const events = [];
const stream = await watchEvents(harness, rootId, context);
stream.start(async batch => { events.push(...batch); });
const first = await root.submit({ type: 'input', content: 'reuse models', requestId: 'reuse-1' }, context);
assert.equal((await first.wait(context)).status, 'done');
passed('ModelRuntime reuse', 'The coding-agent ModelRuntime serves durable generation without AgentSession.');
const entries = await root.entries({ order: 'ascending' }, 100, undefined, context);
const user = entries.items.find(entry => entry.kind === 'pi.user');
const fork = await root.fork(user.id, { ownership: { kind: 'ownerless' } }, context);
assert.ok((await fork.context(context)).messages.some(message => message.role === 'user'));
assert.notEqual(fork.id, rootId);
passed('History fork', 'A new conversation sees the parent history at the selected entry.');
await (await root.submit({ type: 'input', content: 'image test' }, context)).wait(context);
const imageContext = await root.context(context);
assert.ok(imageContext.messages.some(message => message.role === 'toolResult' && message.content.some(part => part.type === 'image')));
const nativeImage = await createReadTool().execute({ path: png }, { env: new NodeExecutionEnv({ cwd: work }) }, context);
assert.equal(nativeImage.isError, true);
passed('Image adapter', 'SDK read tool returns a PNG through durable model context; native durable read rejects that same PNG.');
await (await root.submit({ type: 'input', content: 'codemode test' }, context)).wait(context);
assert.ok((await root.context(context)).messages.some(message => message.role === 'toolResult' && message.toolName === 'codemode' && message.content.some(part => part.text === '42')));
passed('Codemode package reuse', 'Standalone QuickJS sandbox returns 42 inside a durable tool. Nested-call replay policy still needs design.');
await (await root.submit({ type: 'input', content: 'child task test' }, context)).wait(context);
assert.equal(children.length, 1, JSON.stringify((await root.context(context)).messages.filter(message => message.role === 'toolResult' && message.toolName === 'delegate')));
assert.ok((await (await harness.conversation(children[0], context)).context(context)).messages.some(message => message.role === 'assistant'));
passed('Owned child', 'A durable tool creates, awaits, and reads an owned child conversation. This does not load pi-subagents.');
const callsBefore = faux.state.callCount;
await (await root.submit({ type: 'input', content: 'end turn' }, context)).wait(context);
assert.equal(faux.state.callCount - callsBefore, 1);
assert.equal((await harness.snapshot(Meta, rootId, context)).response, 'reply');
passed('Turn-ending tool and custom state', 'Termination avoids the next model request, with reply state committed first.');
const compactionId = await root.compact('Keep the important details', context);
const compaction = await harness.waitForTask(compactionId, context);
assert.equal(compaction.state.outcome.status, 'completed');
assert.ok(compaction.state.outcome.result.submissionId);
assert.equal((await (await harness.submission(compaction.state.outcome.result.submissionId, context)).wait(context)).status, 'done');
const rawAfterCompact = await root.entries({ order: 'ascending' }, 100, undefined, context);
assert.ok(rawAfterCompact.items.some(entry => entry.kind === 'pi.compaction'));
assert.ok(rawAfterCompact.items.some(entry => entry.id === user.id));
assert.equal((await harness.snapshot(Meta, rootId, context)).response, 'reply');
passed('Manual compaction', 'Compaction commits a summary while retaining old transcript entries and the custom reply document.');
await stream.stop();
assert.ok(events.some(event => event.type === 'message_end'));
assert.ok(events.some(event => event.type === 'tool_execution_start'));
passed('Event stream', 'Committed message and tool events observed; message_end uses entry, not coding-agent message.');
await harness.close(context);
harness = await Harness.open(await openNodeSqliteStorage(db), options, context);
root = await harness.conversation(rootId, context);
const duplicate = await root.submit({ type: 'input', content: 'reuse models', requestId: 'reuse-1' }, context);
assert.equal(duplicate.id, first.id);
assert.equal((await duplicate.wait(context)).status, 'done');
assert.equal((await harness.snapshot(Meta, rootId, context)).response, 'reply');
const reconnect = await watchEvents(harness, rootId, context);
assert.ok(reconnect.snapshot.entries.length > 0);
await reconnect.stop();
passed('Reopen, deduplication, reconnect', 'The same request ID finds its settled submission; custom state and transcript snapshot survive SQLite reopen.');
await harness.close(context);
const summary = { packageVersion: '1.1.0', work, results };
await writeFile(new URL('./smoke-results.json', import.meta.url), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
