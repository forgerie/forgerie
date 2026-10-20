// stopAdvancingTurns() is process-wide and one-way, as a daemon stop is. Each test loads a fresh module graph.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { ModelRuntime, SessionManager, createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, describe, expect, it, vi } from "vitest";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixture() {
  vi.resetModules();
  const { DurableAgentSession } = await import("./durableAgentSession.js");
  const { durableSessionPaths } = await import("./durableSessionJournal.js");
  const directory = await mkdtemp(join(tmpdir(), "forgerie-durable-stop-"));
  directories.push(directory);
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json") });
  const provider = fauxProvider({ models: [{ id: "faux-1" }] });
  modelRuntime.registerNativeProvider(provider.provider);
  await modelRuntime.refresh({ allowNetwork: false });
  const model = modelRuntime.getModel("faux", "faux-1");
  if (model === undefined) throw new Error("Configured provider must have a model");
  const services = await createAgentSessionServices({ cwd: directory, agentDir: join(directory, "agent"), modelRuntime,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true } });
  services.settingsManager.applyOverrides({ compaction: { enabled: false } });
  const manager = SessionManager.create(directory, join(directory, "sessions"));
  const session = await DurableAgentSession.open({ services, sessionManager: manager, initialModel: model });
  session.subscribe(() => undefined);
  await session.bindExtensions({});
  const file = manager.getSessionFile();
  if (file === undefined) throw new Error("Fixture must persist");
  return { directory, provider, session, database: durableSessionPaths(file).database, stop: () => { DurableAgentSession.stopAdvancingTurns(); } };
}

/** Committed tool results and the state of every tool task, read after the stopping session closed. */
async function committed(database: string) {
  const storage = await openNodeSqliteStorage(database);
  try {
    const entries = (await storage.scanEntries({ conversationId: ROOT_CONVERSATION_ID }, 1000, undefined, context)).items;
    const tasks = (await storage.scanTasks({ kind: "pi.tool" }, 1000, undefined, context)).items;
    return {
      results: entries.flatMap((entry) => entry.model ?? []).filter((message) => message.role === "toolResult"),
      tools: tasks.map((task) => {
        const checkpoint = task.state.status === "running" ? task.state.checkpoint : undefined;
        const phase = typeof checkpoint === "object" && checkpoint !== null && !Array.isArray(checkpoint) ? checkpoint["phase"] : undefined;
        return { status: task.state.status, ...(phase === undefined ? {} : { phase }) };
      }),
    };
  } finally { await storage.close(context); }
}

const ended = (pid: number) => { try { process.kill(pid, 0); return false; } catch { return true; } };

describe("a daemon stop during a Durable turn", () => {
  it("records no result for a command the stop signal killed and sends no further request", { timeout: 30_000 }, async () => {
    const { directory, provider, session, database, stop } = await fixture();
    const pidFile = join(directory, "command.pid");
    provider.setResponses([
      fauxAssistantMessage([fauxToolCall("bash", { command: `echo $$ > ${pidFile}; exec sleep 30` }, { id: "killed" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("The stopping daemon must not request this answer."),
    ]);
    const turn = session.prompt("Run the long command.").catch((error: unknown) => error);
    const pid = await vi.waitFor(async () => {
      const value = Number(await readFile(pidFile, "utf8").catch(() => ""));
      expect(value).toBeGreaterThan(0);
      return value;
    }, { timeout: 10_000 });
    // The order of a service stop: the daemon learns of the stop, and the same signal ends the command (exit 143).
    stop();
    process.kill(pid, "SIGTERM");
    await vi.waitFor(() => { expect(ended(pid)).toBe(true); }, { timeout: 10_000 });
    // The bash tool returns at once after its process ends. Give that result time to reach a commit.
    await delay(500);
    expect(provider.state.callCount).toBe(1);
    await session.close();
    await turn;
    // Nothing reports exit 143. The next owner finds the call in execution and reports it interrupted, without a rerun.
    expect(await committed(database)).toEqual({ results: [], tools: [{ status: "running", phase: "execute" }] });
  });

  it("does not start a tool call that the model returned during the stop", { timeout: 30_000 }, async () => {
    const { directory, provider, session, database, stop } = await fixture();
    const marker = join(directory, "started.txt");
    provider.setResponses([
      () => {
        // The stop arrives while this response streams.
        stop();
        return fauxAssistantMessage([fauxToolCall("bash", { command: `echo started > ${marker}` }, { id: "unstarted" })], { stopReason: "toolUse" });
      },
      fauxAssistantMessage("The stopping daemon must not request this answer."),
    ]);
    const turn = session.prompt("Run one command.").catch((error: unknown) => error);
    await vi.waitFor(() => { expect(provider.state.callCount).toBe(1); }, { timeout: 10_000 });
    // Time for the response to commit and its tool call to reach the hold.
    await delay(500);
    expect(provider.state.callCount).toBe(1);
    await session.close();
    await turn;
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    // Held before intent: the next owner starts this call as new.
    expect(await committed(database)).toEqual({ results: [], tools: [{ status: "running", phase: "call" }] });
  });

  it("sends no request for a turn that starts after the stop", { timeout: 30_000 }, async () => {
    const { provider, session, database, stop } = await fixture();
    provider.setResponses([fauxAssistantMessage("The stopping daemon must not request this answer.")]);
    stop();
    const turn = session.prompt("Hello.").catch((error: unknown) => error);
    await delay(500);
    expect(provider.state.callCount).toBe(0);
    await session.close();
    await turn;
    expect(await committed(database)).toEqual({ results: [], tools: [] });
  });
});
