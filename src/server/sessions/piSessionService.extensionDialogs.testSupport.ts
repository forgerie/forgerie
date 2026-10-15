import { PiSessionService } from "./piSessionService.js";
import { PendingExtensionDialogStore } from "./pendingExtensionDialogStore.js";
import type { DecisionHints } from "../decisions/decisionHints.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, testModelRuntime } from "./piSessionService.testSupport.js";

export const ACTIVE_SESSION_ID = "session-1";
const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

/**
 * Service over a clocked store with sequential dialog ids, so dialogs are named
 * `dialog-1`, `dialog-2`, … and timestamps are fixed. The daemon default
 * timeout is `0` (wait forever) unless a test says otherwise, so parked waits
 * arm no real timers.
 */
export function dialogService(options: { extensionDialogsTimeoutMs?: number; decisionHints?: DecisionHints } = {}) {
  const store = new PendingExtensionDialogStore({
    now: () => new Date("2026-02-01T10:00:00.000Z"),
    createDialogId: (() => {
      let next = 0;
      return () => { next += 1; return `dialog-${next.toString()}`; };
    })(),
  });
  const fake = fakeRuntime(ACTIVE_SESSION_ID);
  const events = new CapturingSessionEventHub();
  const service = new PiSessionService(events, {
    ...(options.decisionHints === undefined ? {} : { decisionHints: options.decisionHints }),
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    sessionManager: sessionGateway([sessionRecord(ACTIVE_SESSION_ID)]),
    archiveStore: emptyArchiveStore(),
    createAgentRuntime: runtimeCreator(fake.runtime),
    pendingExtensionDialogStore: store,
    extensionDialogsTimeoutMs: options.extensionDialogsTimeoutMs ?? 0,
    heartbeatIntervalMs: 60_000,
  });
  return { service, store, events, fake };
}

/** Production startup seam: extension binding waits for the user's confirm. */
export function startupDialogService(decisionHints?: DecisionHints) {
  const harness = dialogService(decisionHints === undefined ? {} : { decisionHints });
  const confirmAnswers: (boolean | string | undefined)[] = [];
  harness.fake.session.bindExtensions = (bindings) => {
    harness.fake.calls.bindExtensions.push(bindings);
    if (bindings.uiContext === undefined) return Promise.resolve();
    return bindings.uiContext.confirm("Proceed at startup?", "Really?").then((answer) => { confirmAnswers.push(answer); });
  };
  return { ...harness, confirmAnswers };
}
