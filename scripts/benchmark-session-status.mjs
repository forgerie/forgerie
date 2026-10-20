#!/usr/bin/env -S tsx
/**
 * node_modules/.bin/tsx scripts/benchmark-session-status.mjs [turns=200] [calls=100]
 * Temporary Durable session, no network or service changes. Each turn has three messages.
 * Times the heartbeat's synchronous status builder, stats, and the annotation/settings costs
 * independently. Attention hints are disabled to isolate the risk-label/status chain.
 * Isolated stages are not additive (JIT, allocations, and filesystem caches).
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { UserEntry, AssistantEntry, ToolResultEntry } from "@earendil-works/pi-durable";

const { turns, calls } = z.object({ turns: z.coerce.number().int().min(1).max(5000), calls: z.coerce.number().int().min(1).max(100000) })
  .parse({ turns: process.argv[2] ?? 200, calls: process.argv[3] ?? 100 });
const directory = await mkdtemp(join(tmpdir(), "forgerie-status-benchmark-"));
// Bundled SDK extensions resolve this environment variable independently of agentDir.
process.env.PI_CODING_AGENT_DIR = join(directory, "agent");
process.env.CLIPROXYAPI_API_KEY = "";
process.env.CLIPROXYAPI_BASE_URL = "";
let session;
let service;
try {
  await mkdir(join(directory, "agent"));
  const [{ ModelRuntime, SessionManager, createAgentSessionServices }, { fauxProvider, fauxAssistantMessage, fauxToolCall },
    { DurableAgentSession }, { PiSessionService }, { SessionEventHub }, { decisionAnnotations, withRiskAnnotations },
    { createDecisionHintsSettingsReader, readDecisionHintsSettings }, { loadPiWebConfig }, { createPiSessionManagerGateway }] = await Promise.all([
    import("@earendil-works/pi-coding-agent"), import("@earendil-works/pi-ai/providers/faux"),
    import("../src/server/sessions/durableAgentSession.ts"), import("../src/server/sessions/piSessionService.ts"),
    import("../src/server/realtime/sessionEventHub.ts"), import("../src/server/decisions/optionalDecisionAnnotations.ts"),
    import("../src/server/decisions/decisionHintsSettings.ts"), import("../src/config.ts"), import("../src/server/sessions/piSessionManagerGateway.ts"),
  ]);
  const config = { azureDevops: { azureCliCommand: "az" }, plugins: { "decision-hints": { enabled: true, settings: { gateway_url: "http://gateway.invalid", risk_labels: true, attention: false } } } };
  const options = { env: { PI_WEB_CONFIG: join(directory, "config.json") } };
  await writeFile(options.env.PI_WEB_CONFIG, JSON.stringify(config));
  const readSettings = createDecisionHintsSettingsReader(options);
  const hints = { readSettings, client: { ask: () => Promise.resolve(undefined) }, status: () => ({ keyPresent: false, source: "none" }) };
  const models = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: null, allowModelNetwork: false });
  models.registerNativeProvider(fauxProvider().provider);
  const services = await createAgentSessionServices({ cwd: directory, agentDir: join(directory, "agent"), modelRuntime: models,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true } });
  const manager = SessionManager.create(directory, join(directory, "sessions"));
  session = await DurableAgentSession.open({ services, sessionManager: manager, decisionHints: hints });
  await session.journal.conversation.commit(async tx => {
    for (let turn = 0; turn < turns; turn++) {
      await tx.appendEntry(UserEntry, session.journal.conversation.id, { model: [{ role: "user", content: `input ${turn}`, timestamp: turn }] });
      await tx.appendEntry(AssistantEntry, session.journal.conversation.id, { model: [fauxAssistantMessage([fauxToolCall("bash", { command: `printf ${turn}` }, { id: `call-${turn}` })], { stopReason: "toolUse" })] });
      await tx.appendEntry(ToolResultEntry, session.journal.conversation.id, { model: [{ role: "toolResult", toolCallId: `call-${turn}`, toolName: "bash", content: [{ type: "text", text: String(turn) }], isError: false, timestamp: turn }] });
    }
  }, context);
  await session.journal.project();
  await session.refreshDurableReads();
  service = new PiSessionService(new SessionEventHub(), { agentDir: join(directory, "agent"), modelRuntime: models, decisionHints: hints, sessionManager: createPiSessionManagerGateway({ agentDir: join(directory, "agent"), env: { HOME: directory }, sessionDirEnvKeys: [] }), heartbeatIntervalMs: 60000 });
  const owner = session.journal.harness;
  const conversation = session.journal.conversation.id;
  const store = decisionAnnotations(owner);
  // Include actual sidecar labels, not just an empty annotation store.
  for (const message of session.messages) for (const [id, invocationId] of Object.entries(message.toolInvocations ?? {})) {
    await store.write(String(conversation), invocationId, { target: "tool", id, invocationId, sourceInvocationId: invocationId,
      label: { model: "benchmark", deletes_data: 0.1, outside_worktree: 0.2, acts_as_user: 0.3, risk: "low", risk_score: 0.4 } });
  }
  const raw = manager.buildSessionContext().messages;
  const measure = work => {
    for (let i = 0; i < 100; i++) work();
    const samples = [];
    for (let batch = 0; batch < 5; batch++) {
      const started = performance.now();
      for (let i = 0; i < calls; i++) work();
      samples.push((performance.now() - started) / calls);
    }
    return samples.sort((a, b) => a - b)[2];
  };
  // Intentionally call the private synchronous builder: async service.status also performs
  // runtime acquisition, which is not part of the per-session heartbeat cost.
  const statusMs = measure(() => service.statusFromSession(session));
  const statsMs = measure(() => session.getSessionStats());
  const contextUsageMs = measure(() => session.getContextUsage());
  const messagesMs = measure(() => session.messages);
  const settingsMs = measure(readSettings);
  const uncachedConfigMs = measure(() => loadPiWebConfig(options));
  const uncachedSettingsMs = measure(() => readDecisionHintsSettings(loadPiWebConfig(options).config));
  store.setRiskVisibility(() => true);
  const annotationOnlyMs = measure(() => withRiskAnnotations(owner, conversation, raw));
  store.setRiskVisibility(() => { const settings = readSettings(); return settings.enabled && settings.risk_labels; });
  const annotationWithSettingsMs = measure(() => withRiskAnnotations(owner, conversation, raw));
  const projectionMs = measure(() => manager.buildSessionContext());
  process.stdout.write(JSON.stringify({ turns, messages: raw.length, labels: store.values(String(conversation)).length, callsPerBatch: calls, batches: 5,
    msPerCall: { status: statusMs, stats: statsMs, contextUsage: contextUsageMs, messages: messagesMs, rawProjection: projectionMs, settings: settingsMs,
      uncachedConfigReadParseValidate: uncachedConfigMs, uncachedSettings: uncachedSettingsMs, annotationOnly: annotationOnlyMs, annotationWithSettings: annotationWithSettingsMs },
    settingsFractionOfAnnotation: settingsMs / annotationWithSettingsMs,
    configFractionOfUncachedAnnotationEstimate: uncachedConfigMs / (annotationOnlyMs + uncachedSettingsMs),
    statusMessageCount: service.statusFromSession(session).messageCount }, null, 2) + "\n");
} finally {
  try { await service?.dispose(); }
  finally { try { await session?.close(); } finally { await rm(directory, { recursive: true, force: true }); } }
}
