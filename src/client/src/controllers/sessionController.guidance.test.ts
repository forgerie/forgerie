import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import {
  defaultApi,
  deferred,
  FakeSocket,
  oldSession,
  replacementSession,
  sessionLookupId,
  status,
  workspace,
  type AppState,
  type SessionStatus,
} from "./sessionController.testSupport";

function machine(id: string): NonNullable<AppState["selectedMachine"]> {
  return { id, name: id, kind: "remote", createdAt: "now", updatedAt: "now" };
}

function stateWithStatus(currentStatus: SessionStatus): AppState {
  return {
    ...initialAppState(),
    selectedMachine: machine("remote-a"),
    selectedWorkspace: workspace,
    selectedSession: oldSession,
    sessions: [oldSession, replacementSession],
    status: currentStatus,
    sessionStatuses: { [oldSession.id]: currentStatus },
  };
}

describe("SessionController session guidance", () => {
  it("applies authoritative guidance status for the selected machine and session", async () => {
    const response = { ...status(oldSession.id), activeGuidanceIds: ["technical-english"] };
    const calls: { sessionId: string; entryId: string; enabled: boolean; machineId: string }[] = [];
    let state = stateWithStatus(status(oldSession.id));
    const api: typeof defaultApi = {
      ...defaultApi,
      setGuidance: (session, entryId, enabled, machineId) => {
        calls.push({ sessionId: sessionLookupId(session), entryId, enabled, machineId: machineId ?? "local" });
        return Promise.resolve(response);
      },
    };
    const controller = controllerFor(() => state, (patch) => { state = { ...state, ...patch }; }, api);

    await expect(controller.setGuidance("technical-english", true)).resolves.toBe(true);

    expect(calls).toEqual([{ sessionId: oldSession.id, entryId: "technical-english", enabled: true, machineId: "remote-a" }]);
    expect(state.status).toEqual(response);
  });

  it("does not apply a stale response after the selected session changes", async () => {
    const request = deferred<SessionStatus>();
    const oldStatus = status(oldSession.id);
    const replacementStatus = status(replacementSession.id);
    let state = stateWithStatus(oldStatus);
    const api: typeof defaultApi = { ...defaultApi, setGuidance: () => request.promise };
    const controller = controllerFor(() => state, (patch) => { state = { ...state, ...patch }; }, api);

    const changing = controller.setGuidance("technical-english", true);
    state = { ...state, selectedSession: replacementSession, status: replacementStatus };
    request.resolve({ ...oldStatus, activeGuidanceIds: ["technical-english"] });

    await expect(changing).resolves.toBe(false);
    expect(state.status).toBe(replacementStatus);
  });

  it("does not let an older same-session response replace a newer mutation", async () => {
    const first = deferred<SessionStatus>();
    const second = deferred<SessionStatus>();
    const requests = [first, second];
    let call = 0;
    let state = stateWithStatus(status(oldSession.id));
    const api: typeof defaultApi = { ...defaultApi, setGuidance: () => requests[call++]?.promise ?? Promise.reject(new Error("unexpected call")) };
    const controller = controllerFor(() => state, (patch) => { state = { ...state, ...patch }; }, api);

    const enabling = controller.setGuidance("technical-english", true);
    const disabling = controller.setGuidance("technical-english", false);
    second.resolve({ ...status(oldSession.id), activeGuidanceIds: [] });
    await expect(disabling).resolves.toBe(true);
    first.resolve({ ...status(oldSession.id), activeGuidanceIds: ["technical-english"] });

    await expect(enabling).resolves.toBe(false);
    expect(state.status?.activeGuidanceIds).toEqual([]);
  });

  it("keeps newer live fields while applying confirmed guidance", async () => {
    const request = deferred<SessionStatus>();
    let state = stateWithStatus(status(oldSession.id));
    const api: typeof defaultApi = { ...defaultApi, setGuidance: () => request.promise };
    const controller = controllerFor(() => state, (patch) => { state = { ...state, ...patch }; }, api);
    const changing = controller.setGuidance("technical-english", true);
    const liveStatus = { ...status(oldSession.id), cost: 4, activeGuidanceIds: [] };

    controller.applySessionStatus(liveStatus);
    request.resolve({ ...status(oldSession.id), activeGuidanceIds: ["technical-english"] });

    await expect(changing).resolves.toBe(true);
    expect(state.status).toMatchObject({ cost: 4, activeGuidanceIds: ["technical-english"] });
  });

  it("reports failure and leaves current guidance available for retry", async () => {
    const currentStatus = { ...status(oldSession.id), activeGuidanceIds: [] };
    let state = stateWithStatus(currentStatus);
    const api: typeof defaultApi = { ...defaultApi, setGuidance: () => Promise.reject(new Error("guidance failed")) };
    const controller = controllerFor(() => state, (patch) => { state = { ...state, ...patch }; }, api);

    await expect(controller.setGuidance("technical-english", true)).resolves.toBe(false);

    expect(state.error).toBe("Error: guidance failed");
    expect(state.status).toBe(currentStatus);
  });
});

function controllerFor(
  getState: () => AppState,
  setState: (patch: Partial<AppState>) => void,
  api: typeof defaultApi,
): SessionController {
  return new SessionController(getState, setState, () => undefined, undefined, { api, socket: new FakeSocket() });
}
