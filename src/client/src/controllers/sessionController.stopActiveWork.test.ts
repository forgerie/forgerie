import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { machineSessionKey } from "../machineKeys";
import { loadDraft, saveDraft } from "../promptDraftStorage";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, FakeSocket, oldSession, replacementSession, status, workspace, type AppState } from "./sessionController.testSupport";

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SessionController stopping active work", () => {
  it("restores the atomically cleared queue before the selected session's current draft", async () => {
    const cacheKey = machineSessionKey("local", oldSession.id);
    saveDraft(cacheKey, "current draft");
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
      status: status(oldSession.id),
    };
    const replacePromptEditorText = vi.fn(() => true);
    const api: typeof defaultApi = {
      ...defaultApi,
      abort: () => Promise.resolve({
        aborted: true,
        restoredMessages: [
          { kind: "steer", text: "adjust this turn" },
          { kind: "followUp", text: "then summarize" },
        ],
      }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket(), replacePromptEditorText },
    );

    await controller.stopActiveWork();

    expect(loadDraft(cacheKey)).toBe("adjust this turn\n\nthen summarize\n\ncurrent draft");
    expect(replacePromptEditorText).toHaveBeenCalledExactlyOnceWith({
      machineId: "local",
      sessionId: oldSession.id,
      text: "adjust this turn\n\nthen summarize\n\ncurrent draft",
    });
  });

  it("stores an old session's restored queue without writing into a newly selected editor", async () => {
    const request = deferred<Awaited<ReturnType<typeof defaultApi.abort>>>();
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession, replacementSession],
      status: status(oldSession.id),
    };
    const replacePromptEditorText = vi.fn(() => true);
    const api: typeof defaultApi = { ...defaultApi, abort: () => request.promise };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket(), replacePromptEditorText },
    );

    const stopping = controller.stopActiveWork();
    state = { ...state, selectedSession: replacementSession, status: status(replacementSession.id) };
    request.resolve({ aborted: true, restoredMessages: [{ kind: "followUp", text: "keep with old session" }] });
    await stopping;

    expect(replacePromptEditorText).not.toHaveBeenCalled();
    expect(loadDraft(machineSessionKey("local", oldSession.id))).toBe("keep with old session");
  });

  it("reports editor replacement failures without discarding the restored draft", async () => {
    const cacheKey = machineSessionKey("local", oldSession.id);
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
      status: status(oldSession.id),
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      abort: () => Promise.resolve({ aborted: true, restoredMessages: [{ kind: "followUp", text: "restore me" }] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket(), replacePromptEditorText: () => Promise.reject(new Error("editor unavailable")) },
    );

    await controller.stopActiveWork();

    expect(loadDraft(cacheKey)).toBe("restore me");
    expect(state.error).toBe("Error: editor unavailable");
  });
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}
