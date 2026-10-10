import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiSessionService, type PiSessionManager } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, sessionGateway, testModelRuntime, type RuntimeCreator } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PiSessionService handoffSession", () => {
  it("detaches the source, blocks destination input, verifies preparation, then continues", async () => {
    const workspace = await tempWorkspace();
    const sourceTransitions: unknown[] = [];
    const destinationTransitions: unknown[] = [];
    const sourceManager = sessionManager("source-1", "/sessions/source-1.jsonl", workspace, sourceTransitions);
    const destinationManager = sessionManager("destination-1", "/sessions/destination-1.jsonl", workspace, destinationTransitions);
    const source = fakeRuntime("source-1", { sessionFile: "/sessions/source-1.jsonl", sessionManager: sourceManager });
    const destination = fakeRuntime("destination-1", { sessionFile: "/sessions/destination-1.jsonl", sessionManager: destinationManager });
    let finishPreparation: (() => void) | undefined;
    let observePreparation: (() => void) | undefined;
    const preparationStarted = new Promise<void>((resolve) => { observePreparation = resolve; });
    let observeContinuation: (() => void) | undefined;
    const continuationStarted = new Promise<void>((resolve) => { observeContinuation = resolve; });
    const promptTexts: string[] = [];
    destination.session.prompt = (text, options) => {
      promptTexts.push(text);
      preflight(options)?.("started");
      if (promptTexts.length > 1) {
        observeContinuation?.();
        return Promise.resolve();
      }
      observePreparation?.();
      return new Promise<void>((resolve) => {
        finishPreparation = () => {
          destination.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "prepared" }] } });
          resolve();
        };
      });
    };
    const log: { details: Record<string, unknown>; message: string }[] = [];
    const service = handoffService([source.runtime, destination.runtime], workspace, log);
    await service.start(workspace);

    const result = await service.handoffSession({
      spawningCwd: workspace,
      sourceSessionId: "source-1",
      sourceSessionFile: "/sessions/source-1.jsonl",
      sourceLeafId: "leaf-1",
      focus: "Continue the deployment",
      cwd: undefined,
    });

    expect(result).toMatchObject({
      sourceSessionId: "source-1",
      destinationSessionId: "destination-1",
      cwd: workspace,
      state: "preparing",
    });
    await preparationStarted;
    expect(promptTexts).toHaveLength(1);
    expect(promptTexts[0]).toContain(join(tmpdir(), `forgerie-handoff-${result.handoffId}.json`));
    expect(promptTexts[0]).not.toContain("/sessions/source-1.jsonl");
    expect(promptTexts[0]).toContain("Continue the deployment");
    const snapshot = await readFile(join(tmpdir(), `forgerie-handoff-${result.handoffId}.json`), "utf8");
    expect(snapshot).toContain("source work");
    expect(snapshot).not.toContain("forgerie.handoff.lifecycle");
    expect(destination.calls.sendCustomMessage).toHaveLength(1);
    expect(destination.calls.sendCustomMessage[0]?.message.customType).toBe("forgerie.handoff.status");
    expect(destination.calls.sendCustomMessage[0]?.message.content).toContain("Preparing");
    expect(states(sourceTransitions)).toEqual(["requested", "destination-created", "source-detached", "preparing"]);
    expect(states(destinationTransitions)).toEqual(["destination-created", "source-detached", "preparing"]);
    expect(sourceTransitions.some(hasSourceFilePath)).toBe(false);
    await expect(service.prompt({ id: "destination-1", cwd: workspace }, "too soon"))
      .rejects.toThrow("Handoff destination is preparing context");
    await expect(service.runPromptResourceCommand(
      { id: "destination-1", cwd: workspace },
      "/review",
      { source: "prompt", name: "review", fingerprint: "a".repeat(64) },
    )).rejects.toThrow("Handoff destination is preparing context");
    await expect(service.shell({ id: "destination-1", cwd: workspace }, "!pwd"))
      .rejects.toThrow("Handoff destination is preparing context");
    await expect(service.runCommand({ id: "destination-1", cwd: workspace }, "/compact"))
      .rejects.toThrow("Handoff destination is preparing context");
    await expect(service.openAsk({ sessionId: "destination-1", questions: [] }))
      .rejects.toThrow("cannot ask questions while preparing context");
    await expect(service.submitAsk({ id: "destination-1", cwd: workspace }, "ask-1", { answers: [] }))
      .rejects.toThrow("Handoff destination is preparing context");
    await expect(service.cancelAsk({ id: "destination-1", cwd: workspace }, "ask-1"))
      .rejects.toThrow("Handoff destination is preparing context");
    await expect(service.answerDialog({ id: "destination-1", cwd: workspace }, "dialog-1", true))
      .rejects.toThrow("Handoff destination is preparing context");
    await expect(service.cancelDialog({ id: "destination-1", cwd: workspace }, "dialog-1"))
      .rejects.toThrow("Handoff destination is preparing context");
    await expect(service.setModel({ id: "destination-1", cwd: workspace }, "openai", "gpt-5"))
      .rejects.toThrow("Handoff destination is preparing context");
    await expect(service.cycleModel({ id: "destination-1", cwd: workspace }, "forward"))
      .rejects.toThrow("Handoff destination is preparing context");
    await expect(service.setThinkingLevel({ id: "destination-1", cwd: workspace }, "high"))
      .rejects.toThrow("Handoff destination is preparing context");
    await expect(service.cycleThinkingLevel({ id: "destination-1", cwd: workspace }))
      .rejects.toThrow("Handoff destination is preparing context");
    await expect(service.navigateTree(
      { id: "destination-1", cwd: workspace },
      { targetId: "entry-1", expectedLeafId: "leaf-1", summary: { mode: "none" } },
    )).rejects.toThrow("Handoff destination is preparing context");
    await expect(service.forkFromTree(
      { id: "destination-1", cwd: workspace },
      { entryId: "entry-1", expectedLeafId: "leaf-1" },
    )).rejects.toThrow("Handoff destination is preparing context");
    await expect(service.reload({ id: "destination-1", cwd: workspace }))
      .rejects.toThrow("Handoff destination is preparing context");

    const handoffDirectory = join(workspace, ".pi-web", "handoffs");
    await mkdir(handoffDirectory, { recursive: true });
    await writeFile(join(handoffDirectory, `${result.handoffId}.md`), "ready\n", "utf8");
    finishPreparation?.();
    await continuationStarted;
    await waitForBackgroundWork();

    expect(promptTexts).toHaveLength(2);
    expect(promptTexts[1]).toContain("Continue the work from the prepared handoff");
    expect(states(sourceTransitions)).toEqual(["requested", "destination-created", "source-detached", "preparing", "ready"]);
    expect(states(destinationTransitions)).toEqual(["destination-created", "source-detached", "preparing", "ready"]);
    expect(destination.calls.sendCustomMessage.at(-1)?.message.content).toContain("ready");
    expect(log.map(({ details }) => details["state"]).filter((state) => state !== undefined)).toEqual(["requested", "destination-created", "source-detached", "preparing", "ready"]);
    await expect(service.prompt({ id: "destination-1", cwd: workspace }, "after ready")).resolves.toBeUndefined();
    await waitForBackgroundWork();
    expect(source.calls.abort).toBe(1);
    await service.dispose();
  });

  it("records failure when preparation finishes without a handoff document", async () => {
    const workspace = await tempWorkspace();
    const sourceTransitions: unknown[] = [];
    const destinationTransitions: unknown[] = [];
    const source = fakeRuntime("source-1", {
      sessionFile: "/sessions/source-1.jsonl",
      sessionManager: sessionManager("source-1", "/sessions/source-1.jsonl", workspace, sourceTransitions),
    });
    const destination = fakeRuntime("destination-1", {
      sessionFile: "/sessions/destination-1.jsonl",
      sessionManager: sessionManager("destination-1", "/sessions/destination-1.jsonl", workspace, destinationTransitions),
    });
    let finishPreparation: (() => void) | undefined;
    let observePreparation: (() => void) | undefined;
    const preparationStarted = new Promise<void>((resolve) => { observePreparation = resolve; });
    destination.session.prompt = (_text, options) => {
      preflight(options)?.("started");
      observePreparation?.();
      return new Promise<void>((resolve) => {
        finishPreparation = () => {
          destination.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "prepared" }] } });
          resolve();
        };
      });
    };
    const log: { details: Record<string, unknown>; message: string }[] = [];
    const service = handoffService([source.runtime, destination.runtime], workspace, log);
    await service.start(workspace);

    await expect(service.handoffSession({
      spawningCwd: workspace,
      sourceSessionId: "source-1",
      sourceSessionFile: "/sessions/source-1.jsonl",
      sourceLeafId: "leaf-1",
      focus: undefined,
      cwd: undefined,
    })).resolves.toMatchObject({ state: "preparing" });

    await preparationStarted;
    finishPreparation?.();
    await waitForState(sourceTransitions, "failed");

    expect(states(sourceTransitions).at(-1)).toBe("failed");
    expect(states(destinationTransitions).at(-1)).toBe("failed");
    expect(destination.calls.sendCustomMessage.at(-1)?.message.content).toContain("did not create");
    expect(log.at(-1)?.details).toMatchObject({ state: "failed" });
    await service.dispose();
  });

  it("auto-cancels destination startup dialogs instead of blocking source detachment", async () => {
    const workspace = await tempWorkspace();
    const source = fakeRuntime("source-1", {
      sessionFile: "/sessions/source-1.jsonl",
      sessionManager: sessionManager("source-1", "/sessions/source-1.jsonl", workspace, []),
    });
    let startupDialogResult: boolean | undefined;
    const destination = fakeRuntime("destination-1", {
      sessionFile: "/sessions/destination-1.jsonl",
      sessionManager: sessionManager("destination-1", "/sessions/destination-1.jsonl", workspace, []),
      bindExtensions: async (bindings) => {
        startupDialogResult = await bindings.uiContext?.confirm("Startup", "Continue?");
      },
    });
    const service = handoffService([source.runtime, destination.runtime], workspace, []);
    await service.start(workspace);

    await expect(service.handoffSession({
      spawningCwd: workspace,
      sourceSessionId: "source-1",
      sourceSessionFile: "/sessions/source-1.jsonl",
      sourceLeafId: "leaf-1",
      focus: undefined,
      cwd: undefined,
    })).resolves.toMatchObject({ destinationSessionId: "destination-1", state: "preparing" });

    expect(startupDialogResult).toBe(false);
    await service.dispose();
  });

  it("records requested and failed in the source when destination creation is rejected", async () => {
    const workspace = await tempWorkspace();
    const sourceTransitions: unknown[] = [];
    const source = fakeRuntime("source-1", {
      sessionFile: "/sessions/source-1.jsonl",
      sessionManager: sessionManager("source-1", "/sessions/source-1.jsonl", workspace, sourceTransitions),
    });
    const log: { details: Record<string, unknown>; message: string }[] = [];
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: () => Promise.resolve(source.runtime),
      sessionManager: sessionGateway([]),
      spawnTargets: { resolveSpawnTarget: () => Promise.resolve({ allowed: false, reason: "out-of-project", allowedCwds: [workspace] }) },
      logger: { info: (details, message) => { log.push({ details, message }); } },
      heartbeatIntervalMs: 60_000,
    });
    await service.start(workspace);

    await expect(service.handoffSession({
      spawningCwd: workspace,
      sourceSessionId: "source-1",
      sourceSessionFile: "/sessions/source-1.jsonl",
      sourceLeafId: "leaf-1",
      focus: undefined,
      cwd: "/outside",
    })).rejects.toThrow("cwd must be a workspace");

    expect(states(sourceTransitions)).toEqual(["requested", "failed"]);
    expect(log.map(({ details }) => details["state"])).toEqual(["requested", "failed"]);
    await service.dispose();
  });

  it("fails before destination creation when source lifecycle persistence is unavailable", async () => {
    const workspace = await tempWorkspace();
    const sourceManager = sessionManager("source-1", "/sessions/source-1.jsonl", workspace, [], false);
    const source = fakeRuntime("source-1", { sessionFile: "/sessions/source-1.jsonl", sessionManager: sourceManager });
    const service = handoffService([source.runtime], workspace, []);
    await service.start(workspace);

    await expect(service.handoffSession({
      spawningCwd: workspace,
      sourceSessionId: "source-1",
      sourceSessionFile: "/sessions/source-1.jsonl",
      sourceLeafId: "leaf-1",
      focus: undefined,
      cwd: undefined,
    })).rejects.toThrow("Could not persist handoff state requested");

    expect(service.activeCount()).toBe(1);
    await service.dispose();
  });

  it("aborts the destination when destination lifecycle persistence fails", async () => {
    const workspace = await tempWorkspace();
    const sourceManager = sessionManager("source-1", "/sessions/source-1.jsonl", workspace, []);
    const destinationManager = sessionManager("destination-1", "/sessions/destination-1.jsonl", workspace, []);
    destinationManager.appendCustomEntry = () => { throw new Error("disk full"); };
    const source = fakeRuntime("source-1", { sessionFile: "/sessions/source-1.jsonl", sessionManager: sourceManager });
    const destination = fakeRuntime("destination-1", { sessionFile: "/sessions/destination-1.jsonl", sessionManager: destinationManager });
    const service = handoffService([source.runtime, destination.runtime], workspace, []);
    await service.start(workspace);

    await expect(service.handoffSession({
      spawningCwd: workspace,
      sourceSessionId: "source-1",
      sourceSessionFile: "/sessions/source-1.jsonl",
      sourceLeafId: "leaf-1",
      focus: undefined,
      cwd: undefined,
    })).rejects.toThrow("Could not persist handoff state destination-created");

    expect(destination.calls.abort).toBe(1);
    await service.dispose();
  });

  it("fails the handoff when source termination fails", async () => {
    const workspace = await tempWorkspace();
    const sourceTransitions: unknown[] = [];
    const destinationTransitions: unknown[] = [];
    const source = fakeRuntime("source-1", {
      sessionFile: "/sessions/source-1.jsonl",
      sessionManager: sessionManager("source-1", "/sessions/source-1.jsonl", workspace, sourceTransitions),
      abort: () => Promise.reject(new Error("cannot abort")),
    });
    const destination = fakeRuntime("destination-1", {
      sessionFile: "/sessions/destination-1.jsonl",
      sessionManager: sessionManager("destination-1", "/sessions/destination-1.jsonl", workspace, destinationTransitions),
    });
    const log: { details: Record<string, unknown>; message: string }[] = [];
    const service = handoffService([source.runtime, destination.runtime], workspace, log);
    await service.start(workspace);

    await expect(service.handoffSession({
      spawningCwd: workspace,
      sourceSessionId: "source-1",
      sourceSessionFile: "/sessions/source-1.jsonl",
      sourceLeafId: "leaf-1",
      focus: undefined,
      cwd: undefined,
    })).resolves.toMatchObject({ state: "preparing" });
    await waitForState(sourceTransitions, "failed");

    expect(states(destinationTransitions).at(-1)).toBe("failed");
    expect(destination.calls.abort).toBe(1);
    expect(log.at(-1)?.details).toMatchObject({ state: "failed", error: "Source termination failed: cannot abort" });
    source.session.abort = () => Promise.resolve();
    await service.dispose();
  });

  it("records a resolved provider error even when preparation wrote a partial document", async () => {
    const workspace = await tempWorkspace();
    const sourceTransitions: unknown[] = [];
    const destinationTransitions: unknown[] = [];
    const source = fakeRuntime("source-1", {
      sessionFile: "/sessions/source-1.jsonl",
      sessionManager: sessionManager("source-1", "/sessions/source-1.jsonl", workspace, sourceTransitions),
    });
    const destination = fakeRuntime("destination-1", {
      sessionFile: "/sessions/destination-1.jsonl",
      sessionManager: sessionManager("destination-1", "/sessions/destination-1.jsonl", workspace, destinationTransitions),
    });
    let finishPreparation: (() => void) | undefined;
    let observePreparation: (() => void) | undefined;
    const preparationStarted = new Promise<void>((resolve) => { observePreparation = resolve; });
    destination.session.prompt = (_text, options) => {
      preflight(options)?.("started");
      observePreparation?.();
      return new Promise<void>((resolve) => {
        finishPreparation = () => {
          destination.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "model failed", content: [] } });
          resolve();
        };
      });
    };
    const log: { details: Record<string, unknown>; message: string }[] = [];
    const service = handoffService([source.runtime, destination.runtime], workspace, log);
    await service.start(workspace);

    const result = await service.handoffSession({
      spawningCwd: workspace,
      sourceSessionId: "source-1",
      sourceSessionFile: "/sessions/source-1.jsonl",
      sourceLeafId: "leaf-1",
      focus: undefined,
      cwd: undefined,
    });

    await preparationStarted;
    const handoffDirectory = join(workspace, ".pi-web", "handoffs");
    await mkdir(handoffDirectory, { recursive: true });
    await writeFile(join(handoffDirectory, `${result.handoffId}.md`), "partial\n", "utf8");
    finishPreparation?.();
    await waitForState(sourceTransitions, "failed");

    expect(states(sourceTransitions).at(-1)).toBe("failed");
    expect(states(destinationTransitions).at(-1)).toBe("failed");
    expect(destination.calls.sendCustomMessage.at(-1)?.message.content).toContain("failed");
    expect(log.at(-1)?.details).toMatchObject({ state: "failed", error: "Preparation run ended with stop reason error: model failed" });
    await service.dispose();
  });

  it("starts a second handoff from the same source session", async () => {
    const workspace = await tempWorkspace();
    const sourceTransitions: unknown[] = [];
    const source = fakeRuntime("source-1", {
      sessionFile: "/sessions/source-1.jsonl",
      sessionManager: sessionManager("source-1", "/sessions/source-1.jsonl", workspace, sourceTransitions),
    });
    const first = preparableDestination("destination-1", workspace);
    const second = preparableDestination("destination-2", workspace);
    const service = handoffService([source.runtime, first.runtime, second.runtime], workspace, []);
    await service.start(workspace);

    const firstResult = await service.handoffSession(handoffRequest(workspace));
    const secondResult = await service.handoffSession(handoffRequest(workspace));

    expect(firstResult).toMatchObject({ destinationSessionId: "destination-1", state: "preparing" });
    expect(secondResult).toMatchObject({ destinationSessionId: "destination-2", state: "preparing" });
    expect(secondResult.handoffId).not.toBe(firstResult.handoffId);

    await first.preparationStarted;
    await second.preparationStarted;
    const firstSnapshotFile = join(tmpdir(), `forgerie-handoff-${firstResult.handoffId}.json`);
    const secondSnapshotFile = join(tmpdir(), `forgerie-handoff-${secondResult.handoffId}.json`);
    expect(first.prompts[0]).toContain(firstSnapshotFile);
    expect(second.prompts[0]).toContain(secondSnapshotFile);
    await expect(readFile(firstSnapshotFile, "utf8")).resolves.toContain(firstResult.handoffId);
    await expect(readFile(secondSnapshotFile, "utf8")).resolves.toContain(secondResult.handoffId);

    const handoffDirectory = join(workspace, ".pi-web", "handoffs");
    await mkdir(handoffDirectory, { recursive: true });
    await writeFile(join(handoffDirectory, `${firstResult.handoffId}.md`), "first ready\n", "utf8");
    await writeFile(join(handoffDirectory, `${secondResult.handoffId}.md`), "second ready\n", "utf8");

    first.finishPreparation();
    await first.continuationStarted;
    await waitForBackgroundWork();
    expect(statesFor(sourceTransitions, firstResult.handoffId)).toEqual(["requested", "destination-created", "source-detached", "preparing", "ready"]);
    await expect(readFile(secondSnapshotFile, "utf8")).resolves.toContain(secondResult.handoffId);

    second.finishPreparation();
    await second.continuationStarted;
    await waitForBackgroundWork();
    expect(statesFor(sourceTransitions, secondResult.handoffId)).toEqual(["requested", "destination-created", "source-detached", "preparing", "ready"]);

    expect(first.prompts[1]).toContain(`${firstResult.handoffId}.md`);
    expect(second.prompts[1]).toContain(`${secondResult.handoffId}.md`);
    expect(source.calls.abort).toBe(2);
    await service.dispose();
  });
});

function handoffRequest(workspace: string) {
  return {
    spawningCwd: workspace,
    sourceSessionId: "source-1",
    sourceSessionFile: "/sessions/source-1.jsonl",
    sourceLeafId: "leaf-1",
    focus: undefined,
    cwd: undefined,
  };
}

/**
 * A destination whose preparation run stays open until the test releases it, so
 * two handoffs can be held in flight at the same time.
 */
function preparableDestination(id: string, workspace: string) {
  const destination = fakeRuntime(id, {
    sessionFile: `/sessions/${id}.jsonl`,
    sessionManager: sessionManager(id, `/sessions/${id}.jsonl`, workspace, []),
  });
  const prompts: string[] = [];
  let finishPreparation: (() => void) | undefined;
  let observePreparation: (() => void) | undefined;
  let observeContinuation: (() => void) | undefined;
  const preparationStarted = new Promise<void>((resolve) => { observePreparation = resolve; });
  const continuationStarted = new Promise<void>((resolve) => { observeContinuation = resolve; });
  destination.session.prompt = (text, options) => {
    prompts.push(text);
    preflight(options)?.("started");
    if (prompts.length > 1) {
      observeContinuation?.();
      return Promise.resolve();
    }
    observePreparation?.();
    return new Promise<void>((resolve) => {
      finishPreparation = () => {
        destination.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "prepared" }] } });
        resolve();
      };
    });
  };
  return {
    runtime: destination.runtime,
    prompts,
    preparationStarted,
    continuationStarted,
    finishPreparation: () => { finishPreparation?.(); },
  };
}

function handoffService(runtimes: ReturnType<typeof fakeRuntime>["runtime"][], workspace: string, log: { details: Record<string, unknown>; message: string }[]) {
  let index = 0;
  const createAgentRuntime: RuntimeCreator = () => {
    const runtime = runtimes[index];
    index += 1;
    if (runtime === undefined) return Promise.reject(new Error("unexpected runtime creation"));
    return Promise.resolve(runtime);
  };
  return new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    createAgentRuntime,
    sessionManager: sessionGateway([]),
    spawnTargets: { resolveSpawnTarget: (_source, requested) => Promise.resolve({ allowed: true, cwd: requested ?? workspace }) },
    logger: { info: (details, message) => { log.push({ details, message }); } },
    heartbeatIntervalMs: 60_000,
  });
}

function sessionManager(id: string, file: string, cwd: string, transitions: unknown[], persistence = true): PiSessionManager {
  return {
    getCwd: () => cwd,
    getSessionId: () => id,
    getSessionFile: () => file,
    getBranch: () => [{ type: "message", message: { role: "user", content: [{ type: "text", text: "source work" }] } }],
    getLeafId: () => "leaf-1",
    ...(persistence ? {
      appendCustomEntry: (_customType: string, data?: unknown) => {
        transitions.push(data);
        return `entry-${String(transitions.length)}`;
      },
    } : {}),
  };
}

function states(transitions: unknown[]): unknown[] {
  return transitions.map((transition) => {
    if (typeof transition !== "object" || transition === null) return undefined;
    const state: unknown = Reflect.get(transition, "state");
    return state;
  });
}

function statesFor(transitions: unknown[], handoffId: string): unknown[] {
  return states(transitions.filter((transition) => handoffIdOf(transition) === handoffId));
}

function handoffIdOf(transition: unknown): unknown {
  if (typeof transition !== "object" || transition === null) return undefined;
  return Reflect.get(transition, "handoffId");
}

function hasSourceFilePath(transition: unknown): boolean {
  return typeof transition === "object" && transition !== null && Reflect.has(transition, "sourceSessionFile");
}

function preflight(options: unknown): ((disposition: "started") => void) | undefined {
  if (typeof options !== "object" || options === null) return undefined;
  const callback: unknown = Reflect.get(options, "preflightResult");
  return isPreflightCallback(callback) ? callback : undefined;
}

function isPreflightCallback(value: unknown): value is (disposition: "started") => void {
  return typeof value === "function";
}

async function tempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forgerie-handoff-test-"));
  tempRoots.push(root);
  return root;
}

async function waitForState(transitions: unknown[], state: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (states(transitions).includes(state)) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`state ${state} did not appear`);
}

async function waitForBackgroundWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}
