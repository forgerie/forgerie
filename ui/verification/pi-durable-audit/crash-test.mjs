#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, appendFile, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Type } from 'typebox';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { Harness, createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';

async function worker(directory, safety, phase) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const route = request => {
    const last = request.messages.findLast(message => message.role !== 'system');
    return last.role === 'toolResult'
      ? fauxAssistantMessage('recovered')
      : fauxAssistantMessage([fauxToolCall('slow_tool', {})], { stopReason: 'toolUse' });
  };
  faux.setResponses(Array.from({ length: 12 }, () => route));
  const tool = defineTool({
    name: 'slow_tool', description: 'Exercise interruption', parameters: Type.Object({}), replay: safety,
    async execute(_args, api, callContext) {
      await appendFile(join(directory, 'attempts.log'), `${process.pid}\n`);
      if (safety === 'unsafe') await appendFile(join(directory, 'side-effects.log'), 'effect\n');
      api.output('started\n');
      await api.details({ phase: 'running' }, callContext);
      if (phase === 'start') {
        console.log('READY');
        await new Promise(resolve => setTimeout(resolve, 60_000));
      }
      return { content: [{ type: 'text', text: 'completed' }] };
    },
  });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'crash-test', tools: [tool] }));
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'state.sqlite')), { models, registry }, context);
  const root = await harness.root(context, { agent: { model: { provider: 'faux', modelId: 'faux-1' } } });
  harness.resume();
  const submission = await root.submit({ type: 'input', content: 'run the slow tool', requestId: 'fixed-request' }, context);
  const settled = await submission.wait(context);
  const modelContext = await root.context(context);
  const toolResult = modelContext.messages.findLast(message => message.role === 'toolResult');
  await harness.close(context);
  console.log(JSON.stringify({ submissionId: submission.id, status: settled.status, toolResult }));
}

function startChild(directory, safety, phase) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'worker', directory, safety, phase], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  child.stdout.on('data', chunk => { output += chunk; if (output.includes('READY\n')) readyResolve(); });
  child.stderr.on('data', chunk => { errors += chunk; });
  child.on('error', readyReject);
  const exited = once(child, 'exit');
  const done = exited.then(([code, signal]) => ({ code, signal, output, errors }));
  return { child, ready, done };
}

if (process.argv[2] === 'worker') {
  await worker(process.argv[3], process.argv[4], process.argv[5]);
} else {
  const results = [];
  for (const safety of ['safe', 'unsafe']) {
    const directory = await mkdtemp(join(tmpdir(), `forgerie-durable-crash-${safety}-`));
    const first = startChild(directory, safety, 'start');
    const deadline = setTimeout(() => first.child.kill('SIGKILL'), 15_000);
    try {
      await Promise.race([first.ready, first.done.then(result => { throw new Error(`Child exited before ready: ${JSON.stringify(result)}`); })]);
      first.child.kill('SIGKILL');
      const killed = await first.done;
      assert.equal(killed.signal, 'SIGKILL');
    } finally { clearTimeout(deadline); }
    const second = startChild(directory, safety, 'resume');
    const resumeDeadline = setTimeout(() => second.child.kill('SIGKILL'), 15_000);
    let resumed;
    try { resumed = await second.done; } finally { clearTimeout(resumeDeadline); }
    assert.equal(resumed.code, 0, resumed.errors);
    const receipt = JSON.parse(resumed.output.trim().split('\n').at(-1));
    assert.equal(receipt.status, 'done');
    const attempts = (await readFile(join(directory, 'attempts.log'), 'utf8')).trim().split('\n').length;
    assert.equal(attempts, safety === 'safe' ? 2 : 1);
    if (safety === 'unsafe') {
      assert.equal(receipt.toolResult.isError, true);
      assert.match(JSON.stringify(receipt.toolResult), /interrupted/);
      assert.equal((await readFile(join(directory, 'side-effects.log'), 'utf8')).trim().split('\n').length, 1);
    } else { assert.equal(receipt.toolResult.isError, false); }
    results.push({ safety, passed: true, directory, attempts, receipt });
  }
  await writeFile(new URL('./crash-results.json', import.meta.url), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
